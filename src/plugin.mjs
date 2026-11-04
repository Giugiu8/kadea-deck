import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import streamDeck,{SingletonAction} from '@elgato/streamdeck';
import {DeckStore} from './store.mjs';
import {startReceiver} from './receiver.mjs';
import {cardSvg} from './cards.mjs';
import {refreshDesktopMetadata,openUrl,USAGE,NEW_CHAT} from './desktop.mjs';
import {unexpectedPluginFiles,verifyPluginFiles} from './integrity.mjs';
import {loadPolicy} from './approval-policy.mjs';
import summaries from '../hooks/tool-summary.cjs';
import runtime from '../hooks/runtime.cjs';
import {CodexStore} from './codex-store.mjs';
import {createIntegrations} from './integrations.mjs';
import {registerIntegrationUi} from './integration-ui.mjs';
import {discoverCodex} from './windows-apps.mjs';
const directory=runtime.runtimeDirectory();
const HOLD_MS=1000;
// A press that began on the previous image must not reach a new request.
const ARM_MS=600;
const HOLD_KINDS=new Set(['permission','codex-permission','codex-stop']);
const pluginDirectory=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Set once the files or their permissions cannot be trusted: no hook service, a warning on every key.
let serviceProblem=null;
const integrityResult=verifyPluginFiles(pluginDirectory);
// A file briefly out of reach, for example held by a scanner, is checked again later; it is not damage.
if(integrityResult&&integrityResult.reason!=='file_unreadable'){serviceProblem='integrity_failed';streamDeck.logger.error(`Cardea Deck: plugin files failed the integrity check (${integrityResult.reason}${integrityResult.file?': '+integrityResult.file:''}). Hooks are not served; reinstall the plugin.`);}
else if(!integrityResult){const extra=unexpectedPluginFiles(pluginDirectory);if(extra.length)streamDeck.logger.warn(`Cardea Deck: files not part of this release: ${extra.slice(0,5).join(', ')}`);}
// Migrate state only from the native plugin's own view. Never reuse an old
// connection/token, or overwrite a shared file created by a newer receiver.
// A link here could lead anywhere: nothing is written or removed through it.
const runtimeLinked=()=>{try{return fs.lstatSync(directory).isSymbolicLink();}catch{return false;}};
if(runtimeLinked())serviceProblem??='acl_failed';
else try{
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  for(const name of ['state.json','statusline.json']){
    const old=path.join(process.env.LOCALAPPDATA,'CardeaDeck',name),next=path.join(directory,name);
    if(!fs.existsSync(next))try{fs.copyFileSync(old,next,fs.constants.COPYFILE_EXCL);}catch{}
  }
}catch{serviceProblem??='acl_failed';streamDeck.logger.error('Cardea Deck: the runtime folder is not usable. Hooks are not served.');}
const store=new DeckStore({file:path.join(directory,'state.json')});
const contexts=new Map(),down=new Map(),images=new Map(),bindings=new Map(),pendingImages=new Map();let imageSequence=0;
const inputDiagnostics={keyDownCount:0,keyUpCount:0,lastAction:null,lastResult:null};
let codex=null,codexExecutable='',connectingCodex=false;
const integrations=createIntegrations({home:process.env.USERPROFILE,appData:process.env.APPDATA,plugin:pluginDirectory});
let receiver=null;
const publicationFile=path.join(directory,'connection.json');
let serviceLogged=false;
async function startService(){try{receiver=await startReceiver(store,{directory,holdable:id=>store.selected===id&&[...contexts.values()].some(context=>context.kind==='permission'&&context.settings.decision!=='deny'),getDiagnostics:()=>({visibleKeys:contexts.size,renderedKeys:images.size,...inputDiagnostics,codex:{configured:!!codex,connected:codex?.connected===true,known:codex?.list().length??0,live:codex?.list().filter(t=>t.state!=='unknown').length??0}})});serviceProblem=null;}catch{serviceProblem='acl_failed';if(!serviceLogged){serviceLogged=true;streamDeck.logger.error('Cardea Deck: could not make the runtime folder private. Hooks are not served; retrying.');}}}
if(!serviceProblem)await startService();
// Hooks find no receiver and return no decision, so Claude keeps using its own dialogs.
if(serviceProblem&&!runtimeLinked())try{fs.rmSync(publicationFile,{force:true});}catch{}
const codexApprovalsOn=()=>{try{return loadPolicy({directory}).codexEnabled===true;}catch{return false;}};
let approvalsOn=false;
const refreshPolicy=()=>{try{approvalsOn=receiver?.policy().enabled===true;receiver?.broker.revalidate();}catch{approvalsOn=false;}};refreshPolicy();
setInterval(refreshPolicy,5000).unref();
// A slow or busy PC at logon must not leave hooks off until the next restart.
setInterval(async()=>{if(serviceProblem!=='acl_failed'||runtimeLinked())return;await startService();if(!serviceProblem){refreshPolicy();paint();}},60_000).unref();
const metadataRoots=()=>{const base=path.join(process.env.LOCALAPPDATA,'Claude-Data');try{return fs.readdirSync(base,{withFileTypes:true}).filter(e=>e.isDirectory()&&e.name.startsWith('claude')).map(e=>path.join(base,e.name,'claude-code-sessions'));}catch{return[];}};
let chatOffset=0;
const label={working:'WORKING',attention:'INPUT',unread:'NEW',error:'ERROR',unknown:'UNKNOWN',idle:'READY',ended:'READY'};
function lines(value){const words=(value||'Claude chat').split(/\s+/),rows=[''];for(const word of words){const i=rows.length-1;if(rows[i]&&(rows[i]+' '+word).length>13&&i<2)rows.push(word);else rows[i]+=(rows[i]?' ':'')+word;}return rows.slice(0,3).map(v=>v.length>14?v.slice(0,13)+'…':v);}
function selectedCard(s,kicker='CLAUDE',emptyCreatesChat=false) {
  if(!s&&emptyCreatesChat)return{kind:'action',title:'New chat',icon:'chatplus',caption:store.connected?'Empty slot':'Source unverified',state:'idle'};
  return s?{kind:'session',agent:'claude',kicker,title:lines(s.title||s.project),subtitle:s.project,hint:s.requestId?s.pendingTool:s.stale?'Stale signal':!s.desktopId?'No chat link':s.project,footer:s.requestId?`${s.pendingTool||'Tool'} · INPUT`:label[s.state],state:s.state,selected:s.id===store.selected}:{kind:'session',agent:'claude',kicker,title:store.connected?['Empty slot']:['No source'],empty:store.connected,subtitle:'',footer:store.connected?'NO CHAT ASSIGNED':'UNKNOWN STATUS',state:'unknown'};
}
function view(kind,settings){
  if(serviceProblem==='integrity_failed')return{kind:'action',title:'Reinstall',caption:'FILES CHANGED',icon:'close',state:'error',disabled:true};
  if(serviceProblem&&kind==='permission')return{kind:'action',title:'Hooks off',caption:'FOLDER NOT PRIVATE',icon:'close',state:'error',disabled:true};
  if(kind.startsWith('codex-')){
    const target=codex?.get(),task=kind==='codex-session'?codex?.list()[Math.max(0,Number(settings.slot)||0)]:target;
    if(kind==='codex-session')return task?{kind:'session',agent:'codex',title:lines(task.title),hint:task.state==='unknown'?'Unverified signal':task.project,state:task.state,selected:task.selected}:{kind:'action',title:'New chat',icon:'chatplus',caption:codex?'Empty slot':'Set up Codex'};
    if(kind==='codex-permission'){const decision=settings.decision==='deny'?'decline':'accept',available=!!target?.approval?.decisions.includes(decision),off=decision==='accept'&&!codexApprovalsOn(),ready=available&&!off,marker=(codex?.snapshot(target)?.requestKey??'').slice(0,4).toUpperCase();return{kind:'action',title:decision==='accept'?'Approve':'Decline',icon:decision==='accept'?'check':'close',disabled:!ready,caption:available&&off?'Key approvals off':ready?(decision==='accept'?`${marker} HOLD ${target.approval.type}`:`${target.approval.type} · ${target.project}`):target?.state==='attention'?'Check in chat':'No request'};}
    return{kind:'action',title:'Stop',icon:'stop',caption:'CODEX · HOLD 1 S',disabled:!target?.stopAllowed};
  }
  const list=store.list(),s=store.get();
  if(kind==='session')return selectedCard(list[(['claude','chats'].includes(settings.page)?chatOffset:0)+Math.max(0,Number(settings.slot)||0)],'CLAUDE',true);
  if(kind==='summary'&&settings.mode==='page')return{kind:'action',kicker:'CLAUDE',title:'More chats',caption:'CLAUDE',subtitle:list.length>6?`${chatOffset+1}–${Math.min(chatOffset+6,list.length)} of ${list.length}`:'All captured chats visible',icon:'next',state:'idle'};
  if(kind==='summary')return {kind:'summary',agent:'claude',kicker:'CLAUDE',title:store.connected?String(list.length):'—',subtitle:store.connected?'captured chats':'waiting for source',footer:store.connected?`${list.filter(s=>s.state==='attention').length} need input`:'UNKNOWN STATUS',state:list.some(s=>s.state==='attention')?'attention':store.connected?'idle':'unknown'};
  if(kind==='target')return selectedCard(s,'CLAUDE · TARGET');
  if(kind==='quota'){const q=store.quotaView(settings.window==='five_hour'?'five_hour':'seven_day');if(q&&!q.stale)return{kind:'quota',kicker:settings.window==='five_hour'?'CLAUDE · 5 HOURS':'CLAUDE · WEEK',value:`${Math.round(100-q.used)}%`,subtitle:'remaining · reported by source',progress:(100-q.used)/100,state:'unread'};return{kind:'action',kicker:'CLAUDE',title:'Usage',subtitle:q?'Stale value · open':'Open actual limits',icon:'gauge',state:'unknown'};}
  if(kind==='permission'){const deny=settings.decision==='deny',request=s?.requestId?receiver?.broker.request(s.requestId):null;if(request?.summary)return{kind:'approval',decision:deny?'deny':'allow',tool:request.tool,summary:request.summary,marker:s.requestId.slice(0,4).toUpperCase(),project:summaries.plain(s.project)?s.project:'',title:deny?'Decline':'Hold: Approve'};return{kind:'action',kicker:'CLAUDE',title:deny?'Decline':'Approve',caption:!approvalsOn?'Key approvals off':s?.state==='attention'?'Check in chat':'No request',subtitle:'No selected request',icon:deny?'close':'check',state:'unknown',disabled:true};}
  return{kind:'action',kicker:'CLAUDE',title:kind==='ack'?'Read':'Open',subtitle:kind==='ack'?'This result only':'Selected chat',icon:kind==='ack'?'read':'open',state:kind==='ack'&&s?.unread?'unread':'idle',disabled:kind==='ack'&&!s?.unread};
}
function inputBinding(kind,settings){const cd=kind.startsWith('codex-');const s=cd?(kind==='codex-session'?codex?.list()[Math.max(0,Number(settings.slot)||0)]:codex?.get()):kind==='session'?store.list()[(['claude','chats'].includes(settings.page)?chatOffset:0)+Math.max(0,Number(settings.slot)||0)]:store.get();return{session:s?{...s}:null,settings:{...settings},codexSnapshot:cd?codex?.snapshot(s):null};}
function paint(){if(chatOffset>=store.list().length)chatOffset=0;for(const [id,{kind,action,settings}]of contexts){let svg,binding;try{svg=cardSvg(view(kind,settings));binding=inputBinding(kind,settings);encodeURIComponent(svg);}catch{bindings.delete(id);continue;}if(images.get(id)===svg){if(!pendingImages.has(id))bindings.set(id,{...binding,shownAt:bindings.get(id)?.shownAt??Date.now()});continue;}images.set(id,svg);const token=++imageSequence;pendingImages.set(id,token);action.setImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`).then(()=>{if(pendingImages.get(id)===token&&contexts.has(id)){bindings.set(id,{...binding,shownAt:Date.now()});pendingImages.delete(id);}}).catch(()=>{if(pendingImages.get(id)===token){pendingImages.delete(id);images.delete(id);}});}}
async function navigate(s){
  if(!s)return false;store.select(s.id);
  if(!s.desktopId)return false;
  const url=`claude://claude.ai/epitaxy/${s.desktopId}`;
  return openUrl(url);
}
class CardeaAction extends SingletonAction {
  constructor(kind){super();this.kind=kind;this.manifestId=`de.cardea.deck.${kind}`;}
  onWillAppear(ev){contexts.set(ev.action.id,{kind:this.kind,action:ev.action,settings:ev.payload.settings??{}});paint();}
  onWillDisappear(ev){contexts.delete(ev.action.id);images.delete(ev.action.id);down.delete(ev.action.id);bindings.delete(ev.action.id);pendingImages.delete(ev.action.id);}
  onDidReceiveSettings(ev){contexts.set(ev.action.id,{kind:this.kind,action:ev.action,settings:ev.payload.settings??{}});images.delete(ev.action.id);paint();}
  onKeyDown(ev){if(serviceProblem==='integrity_failed'){void ev.action.showAlert();return;}
    // A Multi Action sends its presses without a person holding this key.
    if(HOLD_KINDS.has(this.kind)&&ev.payload.isInMultiAction){down.delete(ev.action.id);void ev.action.showAlert();return;}
    inputDiagnostics.keyDownCount++;inputDiagnostics.lastAction=this.kind;const binding=bindings.get(ev.action.id);if(!binding||pendingImages.has(ev.action.id)){down.delete(ev.action.id);inputDiagnostics.lastResult='updating';return;}
    if(['permission','codex-permission'].includes(this.kind)&&binding.settings.decision!=='deny'&&Date.now()-binding.shownAt<ARM_MS){down.delete(ev.action.id);inputDiagnostics.lastResult='arming';void ev.action.showAlert();return;}
    down.set(ev.action.id,{...binding,at:performance.now()});}
  async onKeyUp(ev){
    inputDiagnostics.keyUpCount++;
    const captured=down.get(ev.action.id);down.delete(ev.action.id);if(!captured)return;
    const {session:s,settings}=captured,held=performance.now()-captured.at>=HOLD_MS;let ok=false;
    try{
      // Empty at key-down means a new composer, even if the list changes while held.
      if(this.kind==='codex-session'){
        if(s)ok=!!codex?.select(s.id)&&await openUrl(`codex://threads/${s.id}`);
        else ok=await openUrl('codex://threads/new');
      }
      else if(this.kind==='codex-permission')ok=!!codex&&(settings.decision==='deny'||(held&&codexApprovalsOn()))&&await codex.act(captured.codexSnapshot,settings.decision==='deny'?'decline':'accept',settings.decision==='deny'?{}:{allowed:codexApprovalsOn});
      else if(this.kind==='codex-stop')ok=held&&!!codex&&await codex.act(captured.codexSnapshot,'stop');
      else if(this.kind==='session')ok=s?await navigate(s):await openUrl(NEW_CHAT);
      else if(this.kind==='open')ok=await navigate(s);
      else if(this.kind==='summary'&&settings.mode==='page'){chatOffset=store.list().length?(chatOffset+6)%(Math.ceil(store.list().length/6)*6):0;ok=true;}
      else if(this.kind==='summary'||this.kind==='target'){
        const list=store.list();const candidates=settings.mode==='waiting'?list.filter(v=>v.state==='attention'):list;
        const index=candidates.findIndex(v=>v.id===store.selected);const next=candidates[(index+1)%candidates.length];
        ok=next?this.kind==='target'?store.select(next.id):await navigate(next):false;
      }else if(this.kind==='permission'){const deny=settings.decision==='deny';ok=!!s&&!!receiver&&(deny||held)&&receiver.broker.answer({sessionId:s.id,requestId:s.requestId},deny?'deny':'allow');}
      else if(this.kind==='ack')ok=!!s&&store.acknowledge(s.id,s.turn);
      else if(this.kind==='quota')ok=await openUrl(USAGE);
      if(!ok)await ev.action.showAlert();
    }catch{await ev.action.showAlert();}
    inputDiagnostics.lastResult=ok?(this.kind==='session'&&!s?'new-chat':'ok'):'unavailable';paint();
  }
}
for(const kind of ['session','summary','target','permission','ack','quota','open','codex-session','codex-permission','codex-stop'])streamDeck.actions.registerAction(new CardeaAction(kind));
async function connectCodex(stillCurrent=()=>true,persist=true){
 if(connectingCodex)return false;connectingCodex=true;
 try{
  const executable=await discoverCodex();if(!executable||!stillCurrent())return false;
  if(persist)integrations.saveCodex(executable);
  if(codex&&codexExecutable===executable)return true;
  codex?.close();codexExecutable=executable;codex=new CodexStore({executable,ledgerFile:path.join(directory,'codex-attempts.json')});codex.on('change',()=>{paint();integrationUi.refresh();});codex.start();paint();return true;
 }finally{connectingCodex=false;}
}
function pendingText(){const s=store.get(),summary=s?.requestId?receiver?.broker.summary(s.requestId):null;return summary?`${s.pendingTool}: ${summary.text}`:'';}
const integrationUi=registerIntegrationUi({ui:streamDeck.ui,manager:integrations,connectCodex,blocked:()=>serviceProblem,diagnostics:()=>{refreshPolicy();return{sourceHasEvents:store.connected,codexConfigured:integrations.codexEnabled(),codexConnected:codex?.connected===true,pending:pendingText()};}});
store.on('change',()=>integrationUi.refresh());
if(serviceProblem!=='integrity_failed'&&integrations.codexEnabled())void connectCodex(()=>true,false).catch(()=>{});
// Hook files are read anew on every event, so recheck them while running too.
let integrityStrikes=0;
setInterval(()=>{if(serviceProblem==='integrity_failed')return;const result=verifyPluginFiles(pluginDirectory);if(!result){integrityStrikes=0;return;}
  // A changed file counts at once. A file out of reach, as on a redirected folder after wake, must stay so for 15 minutes.
  if(result.reason==='file_unreadable'||result.reason==='file_missing'){if(++integrityStrikes<3)return;}
  serviceProblem='integrity_failed';streamDeck.logger.error(`Cardea Deck: plugin files changed while running (${result.reason}). Hooks are no longer served.`);void receiver?.close().catch(()=>{});receiver=null;refreshPolicy();codex?.close();codex=null;paint();},5*60_000).unref();
setInterval(()=>{if(serviceProblem!=='integrity_failed'&&codexExecutable&&!fs.existsSync(codexExecutable))void connectCodex(()=>true,false).catch(()=>{});},60_000).unref();
store.on('change',paint);setInterval(paint,1000).unref();
let scanning=false,lastScan=0;async function refresh(){if(scanning||Date.now()-lastScan<5000)return;scanning=true;lastScan=Date.now();try{for(const root of metadataRoots())await refreshDesktopMetadata(store,root);}finally{scanning=false;}}
setInterval(refresh,30_000).unref();store.on('change',()=>{if(!scanning)void refresh();});
void refresh();
function shutdown(){receiver?.removeConnection();receiver?.broker.close();codex?.close();}
process.on('SIGTERM',()=>{shutdown();process.exit(0);});
process.on('exit',()=>receiver?.removeConnection());
process.on('uncaughtException',()=>{streamDeck.logger.error('Cardea Deck: unexpected error; no approval granted.');shutdown();process.exit(1);});
streamDeck.connect();
