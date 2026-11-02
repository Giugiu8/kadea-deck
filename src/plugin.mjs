import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import streamDeck,{SingletonAction} from '@elgato/streamdeck';
import {DeckStore} from './store.mjs';
import {startReceiver} from './receiver.mjs';
import {cardSvg} from './cards.mjs';
import {refreshDesktopMetadata,openUrl,USAGE,NEW_CHAT} from './desktop.mjs';
import runtime from '../hooks/runtime.cjs';
import {CodexStore} from './codex-store.mjs';
const directory=runtime.runtimeDirectory();
// Migrate state only from the native plugin's own view. Never reuse an old
// connection/token, or overwrite a shared file created by a newer receiver.
fs.mkdirSync(directory,{recursive:true,mode:0o700});
for(const name of ['state.json','statusline.json']){
  const old=path.join(process.env.LOCALAPPDATA,'CardeaDeck',name),next=path.join(directory,name);
  if(!fs.existsSync(next))try{fs.copyFileSync(old,next,fs.constants.COPYFILE_EXCL);}catch{}
}
const store=new DeckStore({file:path.join(directory,'state.json')});
const contexts=new Map(),down=new Map(),images=new Map(),bindings=new Map(),pendingImages=new Map();let imageSequence=0;
const inputDiagnostics={keyDownCount:0,keyUpCount:0,lastAction:null,lastResult:null};
let codex=null;
try{const config=JSON.parse(fs.readFileSync(path.join(directory,'codex-client.json'),'utf8').replace(/^\uFEFF/,''));const executable=String(config.executable??'');if(config.enabled===true&&/^[A-Z]:[\\/]Program Files[\\/]WindowsApps[\\/]OpenAI\.Codex_[^\\/]+[\\/]app[\\/]resources[\\/]codex\.exe$/i.test(executable)&&fs.existsSync(executable))codex=new CodexStore({executable,ledgerFile:path.join(directory,'codex-attempts.json')});}catch{}
const receiver=await startReceiver(store,{directory,getDiagnostics:()=>({visibleKeys:contexts.size,renderedKeys:images.size,...inputDiagnostics,codex:{configured:!!codex,connected:codex?.connected===true,known:codex?.list().length??0,live:codex?.list().filter(t=>t.state!=='unknown').length??0}})});
const helper=path.join(path.dirname(fileURLToPath(import.meta.url)),'open.exe');
const metadataRoots=()=>{const base=path.join(process.env.LOCALAPPDATA,'Claude-Data');try{return fs.readdirSync(base,{withFileTypes:true}).filter(e=>e.isDirectory()&&e.name.startsWith('claude')).map(e=>path.join(base,e.name,'claude-code-sessions'));}catch{return[];}};
let chatOffset=0;
const label={working:'WORKING',attention:'INPUT',unread:'NEW',error:'ERROR',unknown:'UNKNOWN',idle:'READY',ended:'READY'};
function lines(value){const words=(value||'Claude chat').split(/\s+/),rows=[''];for(const word of words){const i=rows.length-1;if(rows[i]&&(rows[i]+' '+word).length>13&&i<2)rows.push(word);else rows[i]+=(rows[i]?' ':'')+word;}return rows.slice(0,3).map(v=>v.length>14?v.slice(0,13)+'…':v);}
function selectedCard(s,kicker='CLAUDE',emptyCreatesChat=false) {
  if(!s&&emptyCreatesChat)return{kind:'action',title:'New chat',icon:'chatplus',caption:store.connected?'Empty slot':'Source unverified',state:'idle'};
  return s?{kind:'session',agent:'claude',kicker,title:lines(s.title||s.project),subtitle:s.project,hint:s.requestId?s.pendingTool:s.stale?'Stale signal':!s.desktopId?'No chat link':s.project,footer:s.requestId?`${s.pendingTool||'Tool'} · INPUT`:label[s.state],state:s.state,selected:s.id===store.selected}:{kind:'session',agent:'claude',kicker,title:store.connected?['Empty slot']:['No source'],empty:store.connected,subtitle:'',footer:store.connected?'NO CHAT ASSIGNED':'UNKNOWN STATUS',state:'unknown'};
}
function view(kind,settings){
  if(kind.startsWith('codex-')){
    const target=codex?.get(),task=kind==='codex-session'?codex?.list()[Math.max(0,Number(settings.slot)||0)]:target;
    if(kind==='codex-session')return task?{kind:'session',agent:'codex',title:lines(task.title),hint:task.state==='unknown'?'Unverified signal':task.project,state:task.state,selected:task.selected}:{kind:'action',title:'New chat',icon:'chatplus',caption:codex?'Empty slot':'Set up Codex'};
    if(kind==='codex-permission'){const decision=settings.decision==='deny'?'decline':'accept',ready=!!target?.approval?.decisions.includes(decision);return{kind:'action',title:decision==='accept'?'Approve':'Decline',icon:decision==='accept'?'check':'close',disabled:!ready,caption:ready?`${target.approval.type} · ${target.project}`:target?.state==='attention'?'Check in chat':'No request'};}
    return{kind:'action',title:'Stop',icon:'stop',caption:'CODEX · HOLD 1 S',disabled:!target?.stopAllowed};
  }
  const list=store.list(),s=store.get();
  if(kind==='session')return selectedCard(list[(['claude','chats'].includes(settings.page)?chatOffset:0)+Math.max(0,Number(settings.slot)||0)],'CLAUDE',true);
  if(kind==='summary'&&settings.mode==='page')return{kind:'action',kicker:'CLAUDE',title:'More chats',caption:'CLAUDE',subtitle:list.length>6?`${chatOffset+1}–${Math.min(chatOffset+6,list.length)} of ${list.length}`:'All captured chats visible',icon:'next',state:'idle'};
  if(kind==='summary')return {kind:'summary',agent:'claude',kicker:'CLAUDE',title:store.connected?String(list.length):'—',subtitle:store.connected?'captured chats':'waiting for source',footer:store.connected?`${list.filter(s=>s.state==='attention').length} need input`:'UNKNOWN STATUS',state:list.some(s=>s.state==='attention')?'attention':store.connected?'idle':'unknown'};
  if(kind==='target')return selectedCard(s,'CLAUDE · TARGET');
  if(kind==='quota'){const q=store.quotaView(settings.window==='five_hour'?'five_hour':'seven_day');if(q&&!q.stale)return{kind:'quota',kicker:settings.window==='five_hour'?'CLAUDE · 5 HOURS':'CLAUDE · WEEK',value:`${Math.round(100-q.used)}%`,subtitle:'remaining · reported by source',progress:(100-q.used)/100,state:'unread'};return{kind:'action',kicker:'CLAUDE',title:'Usage',subtitle:q?'Stale value · open':'Open actual limits',icon:'gauge',state:'unknown'};}
  if(kind==='permission'){const ready=s?.requestId&&receiver.broker.pending.has(s.requestId);return{kind:'action',kicker:'CLAUDE',title:settings.decision==='deny'?'Decline':'Approve',caption:ready?`${s.pendingTool||'Request'} · ${s.project}`:'No request',subtitle:ready?`${s.project} · ${s.pendingTool||'Request'}`:'No selected request',icon:settings.decision==='deny'?'close':'check',state:ready?(settings.decision==='deny'?'error':'unread'):'unknown',disabled:!ready};}
  return{kind:'action',kicker:'CLAUDE',title:kind==='ack'?'Read':'Open',subtitle:kind==='ack'?'This result only':'Selected chat',icon:kind==='ack'?'read':'open',state:kind==='ack'&&s?.unread?'unread':'idle',disabled:kind==='ack'&&!s?.unread};
}
function inputBinding(kind,settings){const cd=kind.startsWith('codex-');const s=cd?(kind==='codex-session'?codex?.list()[Math.max(0,Number(settings.slot)||0)]:codex?.get()):kind==='session'?store.list()[(['claude','chats'].includes(settings.page)?chatOffset:0)+Math.max(0,Number(settings.slot)||0)]:store.get();return{session:s?{...s}:null,settings:{...settings},codexSnapshot:cd?codex?.snapshot(s):null};}
function paint(){if(chatOffset>=store.list().length)chatOffset=0;for(const [id,{kind,action,settings}]of contexts){const svg=cardSvg(view(kind,settings)),binding=inputBinding(kind,settings);if(images.get(id)===svg){if(!pendingImages.has(id))bindings.set(id,binding);continue;}images.set(id,svg);const token=++imageSequence;pendingImages.set(id,token);action.setImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`).then(()=>{if(pendingImages.get(id)===token&&contexts.has(id)){bindings.set(id,binding);pendingImages.delete(id);}}).catch(()=>{if(pendingImages.get(id)===token){pendingImages.delete(id);images.delete(id);}});}}
async function navigate(s){
  if(!s)return false;store.select(s.id);
  if(!s.desktopId)return false;
  const url=`claude://claude.ai/epitaxy/${s.desktopId}`;
  return openUrl(helper,url);
}
class CardeaAction extends SingletonAction {
  constructor(kind){super();this.kind=kind;this.manifestId=`de.cardea.deck.${kind}`;}
  onWillAppear(ev){contexts.set(ev.action.id,{kind:this.kind,action:ev.action,settings:ev.payload.settings??{}});paint();}
  onWillDisappear(ev){contexts.delete(ev.action.id);images.delete(ev.action.id);down.delete(ev.action.id);bindings.delete(ev.action.id);pendingImages.delete(ev.action.id);}
  onDidReceiveSettings(ev){contexts.set(ev.action.id,{kind:this.kind,action:ev.action,settings:ev.payload.settings??{}});images.delete(ev.action.id);paint();}
  onKeyDown(ev){inputDiagnostics.keyDownCount++;inputDiagnostics.lastAction=this.kind;const binding=bindings.get(ev.action.id);if(!binding||pendingImages.has(ev.action.id)){down.delete(ev.action.id);inputDiagnostics.lastResult='updating';return;}down.set(ev.action.id,{...binding,at:Date.now()});}
  async onKeyUp(ev){
    inputDiagnostics.keyUpCount++;
    const captured=down.get(ev.action.id);down.delete(ev.action.id);if(!captured)return;
    const {session:s,settings}=captured;let ok=false;
    try{
      // Empty at key-down means a new composer, even if the list changes while held.
      if(this.kind==='codex-session'){
        if(s)ok=!!codex?.select(s.id)&&await openUrl(helper,`codex://threads/${s.id}`);
        else ok=await openUrl(helper,'codex://threads/new');
      }
      else if(this.kind==='codex-permission')ok=!!codex&&await codex.act(captured.codexSnapshot,settings.decision==='deny'?'decline':'accept');
      else if(this.kind==='codex-stop')ok=Date.now()-captured.at>=1000&&!!codex&&await codex.act(captured.codexSnapshot,'stop');
      else if(this.kind==='session')ok=s?await navigate(s):await openUrl(helper,NEW_CHAT);
      else if(this.kind==='open')ok=await navigate(s);
      else if(this.kind==='summary'&&settings.mode==='page'){chatOffset=store.list().length?(chatOffset+6)%(Math.ceil(store.list().length/6)*6):0;ok=true;}
      else if(this.kind==='summary'||this.kind==='target'){
        const list=store.list();const candidates=settings.mode==='waiting'?list.filter(v=>v.state==='attention'):list;
        const index=candidates.findIndex(v=>v.id===store.selected);const next=candidates[(index+1)%candidates.length];
        ok=next?this.kind==='target'?store.select(next.id):await navigate(next):false;
      }else if(this.kind==='permission')ok=!!s&&receiver.broker.answer({sessionId:s.id,requestId:s.requestId},settings.decision==='deny'?'deny':'allow');
      else if(this.kind==='ack')ok=!!s&&store.acknowledge(s.id,s.turn);
      else if(this.kind==='quota')ok=await openUrl(helper,USAGE);
      if(!ok)await ev.action.showAlert();
    }catch{await ev.action.showAlert();}
    inputDiagnostics.lastResult=ok?(this.kind==='session'&&!s?'new-chat':'ok'):'unavailable';paint();
  }
}
for(const kind of ['session','summary','target','permission','ack','quota','open','codex-session','codex-permission','codex-stop'])streamDeck.actions.registerAction(new CardeaAction(kind));
codex?.on('change',paint);codex?.start();
store.on('change',paint);setInterval(paint,1000).unref();
let scanning=false,lastScan=0;async function refresh(){if(scanning||Date.now()-lastScan<5000)return;scanning=true;lastScan=Date.now();try{for(const root of metadataRoots())await refreshDesktopMetadata(store,root);}finally{scanning=false;}}
setInterval(refresh,30_000).unref();store.on('change',()=>{if(!scanning)void refresh();});
void refresh();
process.on('SIGTERM',()=>{receiver.broker.close();codex?.close();process.exit(0);});
process.on('uncaughtException',()=>{streamDeck.logger.error('Cardea Deck: unexpected error; no approval granted.');receiver.broker.close();codex?.close();process.exit(1);});
streamDeck.connect();
