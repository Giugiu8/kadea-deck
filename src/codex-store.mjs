import {EventEmitter} from 'node:events';
import {CodexPipe} from './codex-pipe.mjs';
import {CodexCatalog} from './codex-catalog.mjs';
import {statePath} from './codex-json.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const priorities={attention:0,error:1,unread:2,working:3,idle:4,unknown:5};
const pathOf=p=>Array.isArray(p)?p:typeof p==='string'&&p.startsWith('/')?p.slice(1).split('/').map(s=>s.replaceAll('~1','/').replaceAll('~0','~')):null;
export function patchCodexMetadata(state,patches){
 const next=structuredClone(state);
 for(const p of patches??[]){
  const keys=pathOf(p.path);if(!keys||keys.some(k=>['__proto__','prototype','constructor'].includes(k)))return null;
  const relevant=statePath(keys),from=pathOf(p.from);
  if(!relevant){if(from&&statePath(from)&&['move','copy'].includes(p.op))return null;continue;}
  if(!['add','replace','remove','test'].includes(p.op)||!keys.length)return null;
  let parent=next;for(const key of keys.slice(0,-1)){if(parent==null||typeof parent!=='object'||!Object.hasOwn(parent,key))return null;parent=parent[key];}
  if(parent==null||typeof parent!=='object')return null;const key=keys.at(-1);
  if(p.op==='test'){if(JSON.stringify(parent[key])!==JSON.stringify(p.value))return null;continue;}
  if(p.op==='remove'){if(Array.isArray(parent)){if(!/^\d+$/.test(String(key))||Number(key)>=parent.length)return null;parent.splice(Number(key),1);}else delete parent[key];}
  else if(!Object.hasOwn(p,'value'))return null;
  else if(Array.isArray(parent)&&p.op==='add'){if(key==='-')parent.push(p.value);else if(/^\d+$/.test(String(key))&&Number(key)<=parent.length)parent.splice(Number(key),0,p.value);else return null;}
  else parent[key]=p.value;
 }
 return next;
}
export function codexState(state){
 const runtime=state?.threadRuntimeStatus;
 if(runtime?.type==='systemError')return'error';
 if(runtime?.type==='active'){if(runtime.activeFlags!=null&&!Array.isArray(runtime.activeFlags))return'unknown';return Array.isArray(runtime.activeFlags)&&runtime.activeFlags.some(f=>['waitingOnUserInput','waitingOnApproval'].includes(f))?'attention':'working';}
 if(runtime?.type==='idle')return state.hasUnreadTurn===true?'unread':'idle';return'unknown';
}
function approvalFor(state){
 if(codexState(state)!=='attention'||!Array.isArray(state.requests)||state.requests.length!==1)return null;
 const request=state.requests[0],params=request.params??{},type=String(request.type??request.kind??request.method??request.requestType??params.type??params.method??'');
 const method=/command.*approval|execCommandApproval/i.test(type)?'thread-follower-command-approval-decision':/file.*approval|applyPatchApproval/i.test(type)?'thread-follower-file-approval-decision':null;
 const requestId=request.requestId??request.id??params.requestId??params.id;
 const decisions=request.decisions??request.options??request.availableDecisions??params.decisions??params.options??params.availableDecisions;
 if(!method||!['string','number'].includes(typeof requestId)||!Array.isArray(decisions))return null;
 return{method,requestId,turnId:request.turnId??params.turnId??null,itemId:request.itemId??params.itemId??request.callId??params.callId??null,decisions:decisions.filter(d=>['accept','decline'].includes(d)),type:method.includes('command')?'Command':'Files'};
}
const turnWitness=raw=>typeof raw?.latestTurnStartMessageId==='string'&&raw.latestTurnStartMessageId.length>0?raw.latestTurnStartMessageId:null;
const requestKey=(task,approval)=>approval?createHash('sha256').update(JSON.stringify([task.hostId,task.id,approval.method,approval.requestId,approval.turnId,approval.itemId])).digest('hex'):null;
export class CodexStore extends EventEmitter {
 constructor({executable,pipe=new CodexPipe(),catalog=new CodexCatalog(executable),now=Date.now,ledgerFile=null,recordAttempts=null,freshTimeout=8000}={}){
  super();this.pipe=pipe;this.catalog=catalog;this.now=now;this.freshTimeout=freshTimeout;this.tasks=new Map();this.selected=null;this.selectionEpoch=0;this.disposed=false;this.refreshing=false;this.ledgerFile=ledgerFile;this.recordAttempts=recordAttempts;this.attempts=new Set();this.persistenceOk=!!ledgerFile||!!recordAttempts;
  if(ledgerFile)try{const bytes=fs.readFileSync(ledgerFile);if(bytes.length>200000)throw Error('ledger-size');const data=JSON.parse(bytes.toString('utf8'));if(data.schema!==1||!Array.isArray(data.attempts)||data.attempts.length>2048||!data.attempts.every(s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s)))throw Error('ledger-schema');this.attempts=new Set(data.attempts);}catch(e){if(e.code!=='ENOENT')this.persistenceOk=false;}
  pipe.on('connection',connected=>{this.connected=connected;if(!connected)for(const t of this.tasks.values()){t.live=false;t.owner=null;t.raw=null;}this.emit('change');if(connected)void this.refresh();});
  pipe.on('broadcast',message=>this.observe(message));
 }
 start(){if(this.started||this.disposed)return;this.started=true;this.pipe.start();void this.refresh();this.timer=setInterval(()=>void this.refresh(),15_000).unref();}
 async refresh(){
  if(this.refreshing||this.disposed)return;this.refreshing=true;
  try{
   const rows=(await this.catalog.list()).slice(0,6),ids=new Set(rows.map(r=>r.id));
   for(const [id]of this.tasks)if(!ids.has(id)&&id!==this.selected)this.tasks.delete(id);
   rows.forEach((row,index)=>{const t=this.tasks.get(row.id);if(t){t.project=row.project;t.order=index;if(!t.raw?.title)t.title=row.title;}else this.tasks.set(row.id,{...row,order:index,live:false,owner:null,raw:null,revision:null});});
   this.catalogOk=true;this.emit('change');
   if(this.connected)await Promise.allSettled([...this.tasks.values()].map(async task=>{
    try{const reply=await this.pipe.request('thread-owner-discovery',1,{conversationId:task.id,hostId:task.hostId});
     if(this.disposed||!this.tasks.has(task.id))return;
     if(reply.resultType!=='success'||reply.result?.supportsUntrustedAppInput!==true||!reply.handledByClientId)throw Error('codex-no-owner');
     if(task.owner!==reply.handledByClientId||!task.subscribed){if(task.owner===reply.handledByClientId)this.pipe.following(task,task.owner,false);else{task.submitted=null;task.revision=null;}task.owner=reply.handledByClientId;task.live=false;task.raw=null;task.subscribed=true;this.pipe.following(task,task.owner);}
     task.verifiedAt=this.now();
    }catch{task.live=false;task.owner=null;task.subscribed=false;task.raw=null;}finally{this.emit('change');}
   }));
  }catch{this.catalogOk=false;for(const task of this.tasks.values()){task.live=false;task.subscribed=false;}this.emit('change');}
  finally{this.refreshing=false;}
 }
 observe(message){
  if(message.method!=='thread-stream-state-changed')return;
  const params=message.params,task=this.tasks.get(params?.conversationId),change=params?.change;
  if(!task||params.hostId!==task.hostId||message.sourceClientId!==task.owner)return;
  if(!Number.isInteger(message.version)||message.version<1||message.version>11||!Number.isSafeInteger(change?.revision)||change.revision<0){task.live=false;task.subscribed=false;this.emit('change');return;}
  let next=null;
  if(change.type==='snapshot'){if(task.revision!=null&&change.revision<task.revision)return;next=change.conversationState;}
  else if(['patch','patches'].includes(change.type)){
   if(task.revision!=null&&change.revision<=task.revision)return;
   if(task.raw&&change.baseRevision===task.revision)next=patchCodexMetadata(task.raw,change.patches);
  }
  if(!next?.threadRuntimeStatus){task.live=false;task.subscribed=false;this.emit('change');return;}
  task.raw=next;task.revision=change.revision;task.live=true;task.seenAt=this.now();task.streamVersion=message.version;task.title=typeof next.title==='string'&&next.title?next.title.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'').slice(0,512):task.title;if(change.type==='snapshot'){task.snapshotSequence=(task.snapshotSequence??0)+1;this.emit('snapshot',task.id);}this.emit('change');
 }
 view(task){if(!task)return null;const fresh=this.connected&&task.live&&task.verifiedAt!=null&&this.now()-task.verifiedAt<35_000;let state=fresh?codexState(task.raw):'unknown';if(state==='working'&&this.now()-task.seenAt>900000)state='unknown';const approval=fresh?approvalFor(task.raw):null;return{...task,raw:undefined,state,stopAllowed:fresh&&state==='working'&&!!turnWitness(task.raw),approval:approval&&this.persistenceOk&&!this.attempts.has(requestKey(task,approval))&&!task.sending?approval:null,selected:task.id===this.selected};}
 list(){return[...this.tasks.values()].map(t=>this.view(t)).sort((a,b)=>priorities[a.state]-priorities[b.state]||a.order-b.order);}
 get(){return this.view(this.tasks.get(this.selected));}
 select(id){if(!this.tasks.has(id))return false;this.selected=id;this.selectionEpoch++;this.emit('change');return true;}
 snapshot(task=this.get()){return task?{id:task.id,hostId:task.hostId,owner:task.owner,revision:task.revision,requestId:task.approval?.requestId,requestKey:requestKey(task,task.approval),turnWitness:turnWitness(this.tasks.get(task.id)?.raw),selectionEpoch:this.selectionEpoch,generation:this.pipe.generation}:null;}
 current(snapshot,{progress=false}={}){const t=snapshot?this.tasks.get(snapshot.id):null;return !!t&&this.selected===snapshot.id&&this.selectionEpoch===snapshot.selectionEpoch&&t.hostId===snapshot.hostId&&this.connected&&t.live&&t.owner===snapshot.owner&&this.pipe.generation===snapshot.generation&&this.now()-t.verifiedAt<35_000&&(progress?!!snapshot.turnWitness&&turnWitness(t.raw)===snapshot.turnWitness&&codexState(t.raw)==='working':t.revision===snapshot.revision&&(!snapshot.requestKey||requestKey(t,approvalFor(t.raw))===snapshot.requestKey));}
 persistAttempts(){
  if(!this.persistenceOk)return false;
  try{if(this.recordAttempts){if(this.recordAttempts([...this.attempts])!==true)throw Error('ledger-write');}
   else{fs.mkdirSync(path.dirname(this.ledgerFile),{recursive:true});const temp=this.ledgerFile+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify({schema:1,attempts:[...this.attempts]}),{mode:0o600,flag:'wx'});fs.renameSync(temp,this.ledgerFile);}finally{try{fs.unlinkSync(temp);}catch{}}}
   return true;
  }catch{this.persistenceOk=false;return false;}
 }
 fresh(task){
  if(task.freshPromise)return task.freshPromise;
  const sequence=task.snapshotSequence??0,owner=task.owner,generation=this.pipe.generation;
  const promise=new Promise(resolve=>{
   let done=false,timer;const finish=ok=>{if(done)return;done=true;clearTimeout(timer);this.off('snapshot',check);this.pipe.off('connection',lost);resolve(ok);};
   const check=id=>{if(id===task.id&&task.owner===owner&&this.pipe.generation===generation&&(task.snapshotSequence??0)>sequence)finish(true);};
   const lost=connected=>{if(!connected)finish(false);};this.on('snapshot',check);this.pipe.on('connection',lost);timer=setTimeout(()=>finish(false),this.freshTimeout).unref();
   try{this.pipe.following(task,owner,false);this.pipe.following(task,owner,true);}catch{finish(false);}
  });
  task.freshPromise=promise.finally(()=>{task.freshPromise=null;});return task.freshPromise;
 }
 async act(snapshot,decision){
  const isStop=decision==='stop';
  if(!this.current(snapshot,{progress:isStop}))return false;const task=this.tasks.get(snapshot.id);
  if(task.sending||!await this.fresh(task)||!this.current(snapshot,{progress:isStop})||task.sending)return false;
  const view=this.view(task);
  const approval=view.approval;
  const token=isStop?`stop:${snapshot.revision}`:snapshot.requestId;
  if(task.sending||task.submitted===token||(!isStop&&(!approval||approval.requestId!==snapshot.requestId||!approval.decisions.includes(decision)))||(isStop&&!view.stopAllowed))return false;
  const method=isStop?'thread-follower-interrupt-turn':approval.method,params={conversationId:task.id,...!isStop?{requestId:approval.requestId,decision}:{}};
  const key=!isStop?requestKey(task,approval):null;
  if(key){if(this.attempts.size>=2048)return false;this.attempts.add(key);if(!this.persistAttempts())return false;}
  task.sending=true;task.submitted=token;this.emit('change');
  try{
   for(const version of isStop?[4,3,2,1]:[3,2,1]){
    const reply=await this.pipe.request(method,version,params,{target:snapshot.owner,beforeWrite:()=>this.current(snapshot,{progress:isStop})&&this.now()-task.seenAt<10_000});
    if(reply.resultType==='success'){task.submitted=snapshot.requestId??`stop:${snapshot.revision}`;return true;}
    if(!['request-version-mismatch','no-handler-for-request'].includes(reply.error))return false;
   }
   if(key){this.attempts.delete(key);this.persistAttempts();}task.submitted=null;return false;
  }catch(e){if(e.message==='codex-target-changed'){if(key){this.attempts.delete(key);this.persistAttempts();}task.submitted=null;}return false;}finally{task.sending=false;this.emit('change');}
 }
 close(){this.disposed=true;clearInterval(this.timer);for(const task of this.tasks.values())if(this.connected&&task.owner)try{this.pipe.following(task,task.owner,false);}catch{}this.pipe.close();this.catalog.close();}
}
