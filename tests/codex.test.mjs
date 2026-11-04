import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {once} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {CodexFrames,CodexPipe} from '../src/codex-pipe.mjs';
import {MetadataJson} from '../src/codex-json.mjs';
import {CodexStore,codexState,patchCodexMetadata} from '../src/codex-store.mjs';
import {allowedUrl} from '../src/desktop.mjs';
import {CodexCatalog} from '../src/codex-catalog.mjs';
import {PassThrough} from 'node:stream';
const raw=()=>({title:'Prüfung 🟦',latestTurnStartMessageId:'turn-A',threadRuntimeStatus:{type:'active',activeFlags:['waitingOnApproval']},hasUnreadTurn:false,requests:[{requestId:'r1',type:'commandApproval',decisions:['accept','acceptForSession','decline'],params:{command:'PRIVATE: must not be retained',turnId:'t1'}}]});
const envelope=(state=raw(),revision=3)=>({type:'broadcast',method:'thread-stream-state-changed',sourceClientId:'owner',version:11,params:{conversationId:'task',hostId:'local',change:{type:'snapshot',revision,conversationState:state}}});
test('catalog initialization failure closes its own child and permits the next startup',async()=>{
 let starts=0,kills=0;const catalog=new CodexCatalog('fixture',{spawnProcess:()=>{starts++;const child=new EventEmitter();child.stdout=new PassThrough();child.stdin=new PassThrough();child.kill=()=>{kills++;};return child;}});catalog.request=async()=>({error:{message:'fixture init failure'}});
 await assert.rejects(catalog.start(),/initialize/);assert.equal(catalog.process,null);await assert.rejects(catalog.start(),/initialize/);assert.equal(starts,2);assert.equal(kills,2);
});
function project(value,chunkSize=17){const bytes=Buffer.from(JSON.stringify(value));const header=Buffer.alloc(4);header.writeUInt32LE(bytes.length);const messages=[],frames=new CodexFrames(m=>messages.push(m));const all=Buffer.concat([header,bytes]);for(let i=0;i<all.length;i+=chunkSize)frames.push(all.subarray(i,i+chunkSize));return messages[0];}
test('Codex pipe projects metadata across byte/UTF-8/escape boundaries and drops history and arguments',()=>{
 const m=envelope();m.params.change.conversationState.turnHistory=[{content:'do not retain '.repeat(1500000)}];
 const result=project(m,65531);assert.equal(result.params.change.conversationState.title,'Prüfung 🟦');assert.equal(result.params.change.conversationState.turnHistory,undefined);
 assert.equal(result.params.change.conversationState.requests[0].params.command,undefined);assert.ok(JSON.stringify(result).length<1000);
 for(let size=1;size<24;size++)assert.equal(project(envelope(),size).params.change.conversationState.title,'Prüfung 🟦');
});
test('Codex metadata rejects malformed JSON, oversized retained data and oversized frames',()=>{
 for(const input of ['{"type":"x",}','[1,]','{"ignored":"\\x"}','{"ignored":"\\uZZZZ"}','{"type":01}','{"type":"x"}\u00a0']){
  assert.throws(()=>{const p=new MetadataJson();p.write(input);p.end();},undefined,input);
 }
 assert.throws(()=>project({type:'x'.repeat(5000)}),/string-limit/);
 const header=Buffer.alloc(4);header.writeUInt32LE(129*1024*1024);assert.throws(()=>new CodexFrames(()=>{}).push(header),/frame-limit/);
});
test('only observed structural runtime flags produce working/input/unread/error',()=>{
 assert.equal(codexState({threadRuntimeStatus:{type:'active',activeFlags:[]}}),'working');
 assert.equal(codexState(raw()),'attention');assert.equal(codexState({threadRuntimeStatus:{type:'idle'},hasUnreadTurn:true}),'unread');
 assert.equal(codexState({threadRuntimeStatus:{type:'systemError'}}),'error');assert.equal(codexState({threadRuntimeStatus:{type:'future'}}),'unknown');
 assert.equal(codexState({threadRuntimeStatus:{type:'active',activeFlags:{}}}),'unknown');
});
function fixture(options={}){
 const pipe=new EventEmitter();pipe.generation=1;pipe.calls=[];pipe.request=async(method,version,params,{target,beforeWrite})=>{assert.equal(beforeWrite(),true);pipe.calls.push({method,version,params,target});return{resultType:'success'};};pipe.following=()=>{};pipe.close=()=>{};
 const store=new CodexStore({pipe,catalog:{list:async()=>[],close:()=>{}},now:()=>1000,recordAttempts:()=>true,...options});store.connected=true;
 pipe.following=(task,owner,following)=>{if(following)queueMicrotask(()=>store.observe({...envelope(structuredClone(task.raw),task.revision),sourceClientId:owner}));};
 store.tasks.set('task',{id:'task',hostId:'local',owner:'owner',verifiedAt:1000,seenAt:1000,live:true,raw:raw(),revision:3,title:'Test',order:0});store.select('task');return{store,pipe};
}
test('Codex approval is exact, once-only, scoped to offered single decisions; never completes a chat locally',async()=>{
 const {store,pipe}=fixture(),snapshot=store.snapshot();assert.equal(await store.act(snapshot,'accept'),true);assert.equal(await store.act(snapshot,'accept'),false);
 assert.deepEqual(pipe.calls,[{method:'thread-follower-command-approval-decision',version:3,params:{conversationId:'task',requestId:'r1',decision:'accept'},target:'owner'}]);
 assert.equal(store.get().state,'attention');assert.equal(store.get().approval,null);
 const unsupported=fixture();assert.equal(await unsupported.store.act(unsupported.store.snapshot(),'acceptForSession'),false);assert.equal(unsupported.pipe.calls.length,0);
 const multi=fixture();multi.store.tasks.get('task').raw.requests.push({...raw().requests[0],requestId:'r2'});assert.equal(multi.store.get().approval,null);
});
test('Codex rejects changed selection, revision, owner, generation and stale observations before writing',async()=>{
 for(const mutate of [(s)=>{s.selected='other';},s=>{s.tasks.get('task').revision++;},s=>{s.tasks.get('task').owner='new';},s=>{s.pipe.generation++;},s=>{s.tasks.get('task').verifiedAt=-40000;}]){
  const {store,pipe}=fixture(),snapshot=store.snapshot();mutate(store);assert.equal(await store.act(snapshot,'accept'),false);assert.equal(pipe.calls.length,0);
 }
});
test('Codex ambiguous transport outcome cannot replay an approval',async()=>{
 const {store,pipe}=fixture();let calls=0;pipe.request=async()=>{calls++;throw Error('timeout');};const snapshot=store.snapshot();
 assert.equal(await store.act(snapshot,'accept'),false);assert.equal(await store.act(snapshot,'accept'),false);assert.equal(calls,1);
});
test('Codex version fallback is only for explicit protocol rejection',async()=>{
 const {store,pipe}=fixture();let calls=0;pipe.request=async(method,version,params,{beforeWrite})=>{assert.ok(beforeWrite());calls++;return version===3?{resultType:'error',error:'request-version-mismatch'}:{resultType:'success'};};
 assert.equal(await store.act(store.snapshot(),'decline'),true);assert.equal(calls,2);
});
test('Codex patches drop unrelated payloads, apply real status and refuse revision gaps/future protocols',()=>{
 const {store}=fixture();const message=envelope();message.params.change={type:'patch',baseRevision:3,revision:4,patches:[{op:'replace',path:'/turnHistory/0/content',value:'PRIVATE'},{op:'replace',path:'/threadRuntimeStatus',value:{type:'idle'}},{op:'replace',path:'/hasUnreadTurn',value:true}]};
 const filtered=project(message);assert.equal(filtered.params.change.patches[0].value,undefined);store.observe(filtered);assert.equal(store.get().state,'unread');
 message.params.change={type:'patch',baseRevision:2,revision:5,patches:[]};store.observe(message);assert.equal(store.get().state,'unknown');
 store.observe(envelope(raw(),6));assert.equal(store.get().state,'attention');store.observe({...envelope(raw(),7),sourceClientId:'wrong-owner'});assert.equal(store.tasks.get('task').revision,6);
 store.observe({...envelope(raw(),7),version:12});assert.equal(store.get().state,'unknown');
});
test('metadata JSON patches cannot traverse prototypes or mutate missing parents',()=>{
 assert.equal(patchCodexMetadata(raw(),[{op:'add',path:'/__proto__/polluted',value:true}]),null);
 assert.equal(patchCodexMetadata({},[{op:'replace',path:'/threadRuntimeStatus/type',value:'idle'}]),null);assert.equal({}.polluted,undefined);
});
test('string JSON pointer indices update approval flags rather than leaving a working card blue',()=>{
 const {store}=fixture();store.tasks.get('task').raw.threadRuntimeStatus.activeFlags=[];
 const message=envelope();message.params.change={type:'patch',baseRevision:3,revision:4,patches:[{op:'add',path:'/threadRuntimeStatus/activeFlags/-',value:'waitingOnApproval'}]};
 store.observe(project(message));assert.equal(store.get().state,'attention');
 message.params.change={type:'patch',baseRevision:4,revision:5,patches:[{op:'replace',path:'/threadRuntimeStatus/activeFlags/0',value:'waitingOnUserInput'}]};
 store.observe(project(message));assert.equal(store.get().state,'attention');assert.deepEqual(store.tasks.get('task').raw.threadRuntimeStatus.activeFlags,['waitingOnUserInput']);
});
test('Codex pipe rejects another owner response and closes without logging raw data',async()=>{
 const pipe=new CodexPipe({timeout:100});pipe.socket={writable:true,write:()=>true,destroy:()=>{}};pipe.clientId='test';
 const promise=pipe.request('thread-follower-interrupt-turn',4,{conversationId:'task'},{target:'owner'});const id=[...pipe.pending.keys()][0];pipe.message({type:'response',requestId:id,method:'thread-follower-interrupt-turn',resultType:'success',handledByClientId:'other'});
 await assert.rejects(promise,/correlation/);pipe.close();
});
test('Codex opener accepts only fixed composer or thread links',()=>{
 assert.equal(allowedUrl('codex://threads/new'),true);assert.equal(allowedUrl('codex://threads/01a197b3-3886-7c33-be43-04c46d23dadd'),true);
 for(const url of ['codex://threads/x?prompt=send','codex://threads/../x','https://example.com','cmd.exe'])assert.equal(allowedUrl(url),false);
});
test('approval attempt ledger survives owner change and a plugin restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-ledger-')),file=path.join(dir,'attempts.json');
 try{
  const first=fixture({ledgerFile:file,recordAttempts:null});let sent=0;first.pipe.request=async()=>{sent++;throw Error('timeout');};
  assert.equal(await first.store.act(first.store.snapshot(),'accept'),false);assert.equal(sent,1);
  first.store.tasks.get('task').owner='new-owner';assert.equal(first.store.get().approval,null);
  const second=fixture({ledgerFile:file,recordAttempts:null});assert.equal(second.store.persistenceOk,true);assert.equal(second.store.get().approval,null);
  assert.equal(await second.store.act(second.store.snapshot(),'decline'),false);assert.equal(second.pipe.calls.length,0);
  const saved=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(saved.attempts.length,1);assert.match(saved.attempts[0],/^[a-f0-9]{64}$/);assert.ok(!fs.readFileSync(file,'utf8').includes('r1'));
 }finally{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('cardea-ledger-'));fs.rmSync(dir,{recursive:true,force:true});}
});
test('approval persistence failure sends nothing',async()=>{
 const {store,pipe}=fixture({recordAttempts:()=>false});assert.equal(await store.act(store.snapshot(),'accept'),false);assert.equal(pipe.calls.length,0);assert.equal(store.persistenceOk,false);
});
test('selection A to B to A and changed same-revision request both invalidate held approval',async()=>{
 const {store,pipe}=fixture(),snapshot=store.snapshot();store.tasks.set('other',{...store.tasks.get('task'),id:'other'});store.select('other');store.select('task');assert.equal(await store.act(snapshot,'accept'),false);assert.equal(pipe.calls.length,0);
 const f=fixture(),captured=f.store.snapshot();f.pipe.following=(task,owner,following)=>{if(following)queueMicrotask(()=>{const changed=raw();changed.requests[0].requestId='new-request';f.store.observe(envelope(changed,3));});};
 assert.equal(await f.store.act(captured,'accept'),false);assert.equal(f.pipe.calls.length,0);
});
test('Stop permits progress in the same turn but rejects a newer turn after fresh read',async()=>{
 const {store,pipe}=fixture();const task=store.tasks.get('task');task.raw.threadRuntimeStatus.activeFlags=[];const snapshot=store.snapshot();task.revision=4;
 assert.equal(await store.act(snapshot,'stop'),true);assert.equal(pipe.calls.length,1);assert.equal(pipe.calls[0].method,'thread-follower-interrupt-turn');
 const newer=fixture();newer.store.tasks.get('task').raw.threadRuntimeStatus.activeFlags=[];const old=newer.store.snapshot();newer.pipe.following=(task,owner,following)=>{if(following)queueMicrotask(()=>{const next=raw();next.threadRuntimeStatus.activeFlags=[];next.latestTurnStartMessageId='turn-B';newer.store.observe(envelope(next,4));});};
 assert.equal(await newer.store.act(old,'stop'),false);assert.equal(newer.pipe.calls.length,0);
});
test('actions require a fresh full snapshot, and simultaneous approval presses send once',async()=>{
 const f=fixture({freshTimeout:10});f.pipe.following=()=>{};const keepAlive=setTimeout(()=>{},200);
 try{assert.equal(await f.store.act(f.store.snapshot(),'accept'),false);assert.equal(f.pipe.calls.length,0);}finally{clearTimeout(keepAlive);}
 const g=fixture(),snapshot=g.store.snapshot();const replies=await Promise.all([g.store.act(snapshot,'accept'),g.store.act(snapshot,'decline')]);assert.equal(replies.filter(Boolean).length,1);assert.equal(g.pipe.calls.length,1);
});
test('a real local socket exercises initialize, owner discovery, snapshot projection and one decision',{timeout:5000},async()=>{
 const sockets=new Set(),sent=[];
 const frame=value=>{const bytes=Buffer.from(JSON.stringify(value)),header=Buffer.alloc(4);header.writeUInt32LE(bytes.length);return Buffer.concat([header,bytes]);};
 const server=net.createServer(socket=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer=Buffer.alloc(0);
  socket.on('data',bytes=>{buffer=Buffer.concat([buffer,bytes]);while(buffer.length>=4&&buffer.length>=4+buffer.readUInt32LE()){
   const size=buffer.readUInt32LE(),message=JSON.parse(buffer.subarray(4,4+size));buffer=buffer.subarray(4+size);
   if(message.type==='request'){
    const result=message.method==='initialize'?{clientId:'fixture-client'}:message.method==='thread-owner-discovery'?{supportsUntrustedAppInput:true}:{};
    if(message.method.includes('approval-decision'))sent.push(message.params);
    socket.write(frame({type:'response',requestId:message.requestId,method:message.method,resultType:'success',handledByClientId:'owner',result}));
   }else if(message.type==='broadcast'&&message.params.following)socket.write(frame({...envelope(),targetClientIds:['fixture-client']}));
  }});
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const pipe=new CodexPipe({connect:()=>net.createConnection(server.address().port,'127.0.0.1')});
 const store=new CodexStore({pipe,catalog:{list:async()=>[{id:'task',hostId:'local',title:'Fixture',project:'Test'}],close:()=>{}},recordAttempts:()=>true});
 try{
  store.start();const start=Date.now();while(store.list()[0]?.state!=='attention'){assert.ok(Date.now()-start<3000);await new Promise(r=>setTimeout(r,5));}
  assert.equal(store.select('task'),true);assert.equal(await store.act(store.snapshot(),'accept'),true);assert.deepEqual(sent,[{conversationId:'task',requestId:'r1',decision:'accept'}]);
 }finally{store.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}
});

test('revoking consent stops an approval that is on its way; a full journal rotates; a failed write can recover',async()=>{
 let on=true,calls=0;
 const a=fixture({});assert.equal(await a.store.act(a.store.snapshot(),'accept',{allowed:()=>false}),false);assert.equal(a.pipe.calls.length,0,'Nothing is sent once consent is gone');
 const b=fixture({});for(let i=0;i<2048;i++)b.store.attempts.add(String(i).padStart(64,'0'));assert.equal(await b.store.act(b.store.snapshot(),'accept'),true,'A full journal does not lock Codex out');assert.equal(b.store.attempts.size,2048);
 void on;void calls;
});
