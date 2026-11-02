import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { DeckStore } from '../src/store.mjs';
import { PermissionBroker } from '../src/broker.mjs';
import { startReceiver } from '../src/receiver.mjs';
import { refreshDesktopMetadata } from '../src/desktop.mjs';
let sequence=0;
const event=(store,name,at=1000,extra={})=>store.event({event:name,at,eventId:`event-${++sequence}`,sessionId:'session-a',cwd:'G:\\ExampleProject-Homelab',...extra});
const response=()=>Object.assign(new EventEmitter(),{destroyed:false,writableEnded:false,end(text){this.text=text;this.writableEnded=true;this.emit('close');}});
test('late events cannot overwrite newer state or resurrect an ended session',()=>{
 const s=new DeckStore({clock:()=>2000});event(s,'UserPromptSubmit',1000);event(s,'Stop',1500);assert.equal(event(s,'PreToolUse',1200),false);event(s,'SessionEnd',1600);
 assert.equal(event(s,'PostToolUse',1800),false);assert.equal(s.get('session-a').state,'unread');assert.equal(s.get('session-a').ended,true);
 assert.equal(event(s,'SessionStart',1850,{source:'startup'}),false);
 assert.equal(event(s,'SessionStart',1900,{source:'resume'}),true);assert.equal(s.get('session-a').ended,false);assert.equal(s.get('session-a').state,'unread');
 event(s,'UserPromptSubmit',1950);assert.equal(s.get('session-a').state,'working');assert.equal(s.get('session-a').unread,false);
});
test('completed turns reject delayed tool hooks even when their hook process starts later',()=>{
 const s=new DeckStore({clock:()=>3000});event(s,'UserPromptSubmit');event(s,'Stop',1200);
 assert.equal(event(s,'PostToolUse',2000),false);assert.equal(event(s,'PermissionRequest',2100),false);assert.equal(s.get('session-a').state,'unread');
 event(s,'UserPromptSubmit',2200);assert.equal(event(s,'PreToolUse',2300),true);assert.equal(s.get('session-a').state,'working');
});
test('read acknowledgement binds to the exact turn and survives a process restart',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-test-'));const file=path.join(dir,'state.json');
 try{const s=new DeckStore({file,clock:()=>3000});event(s,'UserPromptSubmit');event(s,'Stop',1100);const old=s.get('session-a').turn;event(s,'UserPromptSubmit',1200);event(s,'Stop',1300);
  assert.equal(s.acknowledge('session-a',old),false);assert.equal(s.acknowledge('session-a',old+1),true);
  const restored=new DeckStore({file,clock:()=>3000});assert.equal(restored.get('session-a').unread,false);assert.equal(restored.connected,false);
 }finally{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('cardea-test-'));fs.rmSync(dir,{recursive:true,force:true});}
});
test('unread results remain visible after SessionEnd and vanish only after explicit acknowledgement',()=>{
 const s=new DeckStore({clock:()=>2000});event(s,'UserPromptSubmit');event(s,'Stop',1100);event(s,'SessionEnd',1200);assert.equal(s.list().length,1);
 s.acknowledge('session-a',s.get('session-a').turn);assert.equal(s.list().length,0);
});
test('duplicate event IDs do not start another turn; stale activity is unknown',()=>{
 let now=2000;const s=new DeckStore({clock:()=>now,staleMs:100});const e={event:'UserPromptSubmit',eventId:'fixed-id',sessionId:'s1',at:1000};assert.equal(s.event(e),true);assert.equal(s.event(e),false);assert.equal(s.get('s1').turn,1);assert.equal(s.get('s1').state,'working');now+=101;assert.equal(s.get('s1').state,'unknown');
});

test('idle notifications preserve unread completion and do not renew working freshness',()=>{
 let now=3000;const s=new DeckStore({clock:()=>now,staleMs:100});event(s,'UserPromptSubmit');event(s,'Stop',1100);
 event(s,'Notification',1200,{notificationType:'idle_prompt'});assert.equal(s.get().state,'unread');assert.equal(s.acknowledge('session-a',s.get().turn),true);assert.equal(s.get().state,'idle');
 event(s,'UserPromptSubmit',1300);now+=101;event(s,'Notification',1400,{notificationType:'idle_prompt'});assert.equal(s.get().state,'unknown');
});

test('old attention stays in priority order with an explicit stale marker',()=>{
 let now=2000;const s=new DeckStore({clock:()=>now,staleMs:100});event(s,'Notification',1000,{notificationType:'permission_prompt'});now+=101;
 assert.equal(s.get().state,'attention');assert.equal(s.get().stale,true);assert.equal(s.list()[0].state,'attention');
});

test('tool events do not reorder chats within the same status, including after restart',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-test-')),file=path.join(dir,'state.json');let now=2000;
 try{const s=new DeckStore({file,clock:()=>now});event(s,'UserPromptSubmit',1000);now=2100;event(s,'UserPromptSubmit',1100,{sessionId:'session-b'});
  assert.deepEqual(s.list().map(v=>v.id),['session-a','session-b']);event(s,'PostToolUse',1200,{sessionId:'session-b'});assert.deepEqual(s.list().map(v=>v.id),['session-a','session-b']);
  const restored=new DeckStore({file,clock:()=>3000});assert.deepEqual(restored.list().map(v=>v.id),['session-a','session-b']);
 }finally{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('cardea-test-'));fs.rmSync(dir,{recursive:true,force:true});}
});

test('compaction preserves a running turn and its exact held permission',()=>{
 const s=new DeckStore({clock:()=>3000});event(s,'UserPromptSubmit');event(s,'PermissionRequest',1100,{tool:'Read'});const b=new PermissionBroker(s),r=response(),id=b.hold('session-a',r),turn=s.get().turn;
 event(s,'SessionStart',1200,{source:'compact'});assert.equal(s.get().state,'attention');assert.equal(s.get().turn,turn);assert.equal(s.get().requestId,id);assert.equal(r.writableEnded,false);
 assert.equal(b.answer({sessionId:'session-a',requestId:id},'deny'),true);assert.equal(s.get().state,'working');b.close();
});

test('deny resolves local attention while an unanswered request remains attention',()=>{
 const s=new DeckStore({clock:()=>3000}),b=new PermissionBroker(s);event(s,'PermissionRequest');let r=response(),id=b.hold('session-a',r);
 b.answer({sessionId:'session-a',requestId:id},'deny');assert.equal(s.get().state,'working');
 event(s,'PermissionRequest',1100);r=response();id=b.hold('session-a',r);b.finish(id,null);assert.equal(s.get().state,'attention');b.close();
});

test('URL elicitation is real input attention',()=>{
 const s=new DeckStore({clock:()=>2000});event(s,'Notification',1000,{notificationType:'elicitation_url_dialog'});assert.equal(s.get().state,'attention');
});

test('desktop archive metadata hides and restores a chat without deleting it',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-test-'));const s=new DeckStore({clock:()=>2000});
 try{event(s,'UserPromptSubmit');const file=path.join(dir,'local_fixture.json');fs.writeFileSync(file,JSON.stringify({cliSessionId:'session-a',sessionId:'local_123',title:'Fixture',isArchived:true}));
  await refreshDesktopMetadata(s,dir);assert.equal(s.list().length,0);assert.equal(s.get('session-a').archived,true);assert.equal(s.selected,null);
  fs.writeFileSync(file,JSON.stringify({cliSessionId:'session-a',sessionId:'local_123',title:'Fixture',isArchived:false}));await refreshDesktopMetadata(s,dir);assert.equal(s.list().length,1);assert.equal(s.get('session-a').archived,false);
 }finally{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('cardea-test-'));fs.rmSync(dir,{recursive:true,force:true});}
});

test('archiving never hides or cancels an exact held permission before it is answered',()=>{
 const s=new DeckStore({clock:()=>2000});event(s,'PermissionRequest');const b=new PermissionBroker(s),r=response(),id=b.hold('session-a',r);
 s.annotate('session-a',{title:'Fixture',desktopId:'local_123',archived:true});assert.equal(s.list().length,1);assert.equal(s.get().requestId,id);assert.equal(r.writableEnded,false);
 assert.equal(b.answer({sessionId:'session-a',requestId:id},'deny'),true);assert.equal(s.list().length,0);assert.equal(s.selected,null);assert.equal(JSON.parse(r.text).hookSpecificOutput.decision.behavior,'deny');b.close();
});
test('pending permission keeps its original tool when parallel hooks arrive',()=>{
 const s=new DeckStore({clock:()=>3000});event(s,'PermissionRequest',1000,{tool:'Bash',toolUseId:'bash-1'});const b=new PermissionBroker(s),r=response(),id=b.hold('session-a',r);
 event(s,'PostToolUse',1100,{tool:'Read',toolUseId:'read-1'});event(s,'Notification',1200,{notificationType:'permission_prompt'});
 assert.equal(s.get().pendingTool,'Bash');assert.equal(s.get().requestId,id);assert.equal(b.pending.get(id).tool,'Bash');
 assert.equal(b.answer({sessionId:'session-a',requestId:id},'deny'),true);assert.equal(JSON.parse(r.text).hookSpecificOutput.decision.behavior,'deny');b.close();
});
test('persistence failures do not strand permission transports or confirm an unsaved read',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-test-'));let b;
 try{const s=new DeckStore({file:dir,clock:()=>3000});assert.doesNotThrow(()=>event(s,'PermissionRequest',1000,{tool:'Bash'}));assert.ok(s.persistenceError);
  b=new PermissionBroker(s);const r=response(),id=b.hold('session-a',r);assert.ok(id);assert.equal(b.answer({sessionId:'session-a',requestId:id},'deny'),true);assert.ok(r.writableEnded);assert.equal(b.pending.size,0);
  event(s,'Stop',1200);assert.equal(s.acknowledge('session-a',s.get().turn),false);assert.equal(s.get().unread,true);assert.equal(s.get().state,'unread');
 }finally{b?.close();assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('cardea-test-'));fs.rmSync(dir,{recursive:true,force:true});}
});
test('a cold receiver recovers a turn whose prompt happened while it was offline',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-test-')),file=path.join(dir,'state.json');
 try{const before=new DeckStore({file,clock:()=>3000});event(before,'UserPromptSubmit',1000);event(before,'Stop',1100);const old=before.get().turn;
  const restored=new DeckStore({file,clock:()=>4000});assert.equal(restored.get().unread,true);assert.equal(event(restored,'PermissionRequest',3500,{tool:'Read'}),true);assert.equal(restored.get().turn,old+1);assert.equal(restored.get().state,'attention');assert.equal(restored.get().unread,false);
 }finally{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('cardea-test-'));fs.rmSync(dir,{recursive:true,force:true});}
});
test('a fresh tool ID can continue after Stop while an old hook cannot reopen the result',()=>{
 const s=new DeckStore({clock:()=>4000});event(s,'UserPromptSubmit',1000);event(s,'PreToolUse',1100,{toolUseId:'old-tool'});event(s,'Stop',1200);const turn=s.get().turn;
 assert.equal(event(s,'PreToolUse',1300,{toolUseId:'old-tool'}),false);assert.equal(event(s,'PostToolUse',1400,{toolUseId:'old-tool'}),false);
 assert.equal(event(s,'PreToolUse',1500,{toolUseId:'new-tool'}),true);assert.equal(s.get().turn,turn+1);assert.equal(s.get().state,'working');assert.equal(s.get().unread,false);
});
test('a local permission answer cannot move the provider ordering clock past a delayed Stop',()=>{
 let now=2000;const s=new DeckStore({clock:()=>now,staleMs:100}),b=new PermissionBroker(s),r=response();event(s,'PermissionRequest',1000);const id=b.hold('session-a',r);
 now=3000;assert.equal(b.answer({sessionId:'session-a',requestId:id},'allow'),true);assert.equal(s.get().at,1000);assert.equal(s.get().state,'working');
 assert.equal(event(s,'Stop',1500),true);assert.equal(s.get().state,'unread');b.close();
});
test('annotation and opening selection cannot acknowledge pending attention',()=>{
 const s=new DeckStore({clock:()=>2000});event(s,'PermissionRequest');s.beginPermission('session-a','request-1');s.annotate('session-a',{title:'Changed title',desktopId:'local_123'});s.select('session-a');assert.equal(s.get().requestId,'request-1');assert.equal(s.get().state,'attention');
});
test('quota derives reset time on every render; absent values stay absent',()=>{
 let now=1000;const s=new DeckStore({clock:()=>now});assert.equal(s.quotaView(),null);s.setQuota({seven_day:{used_percentage:31,resets_at:121}});now=61_000;assert.equal(s.quotaView().remainingMs,60_000);assert.equal(s.quotaView('five_hour'),null);assert.equal(s.setQuota({seven_day:{used_percentage:120,resets_at:1}}),false);
});
test('broker answers only the selected session and immutable request, once',()=>{
 const s=new DeckStore({clock:()=>2000});event(s,'PermissionRequest');const b=new PermissionBroker(s);const r=response(),id=b.hold('session-a',r);
 assert.equal(b.answer({sessionId:'wrong',requestId:id},'allow'),false);assert.equal(b.answer({sessionId:'session-a',requestId:id},'always'),false);
 assert.equal(b.answer({sessionId:'session-a',requestId:id},'allow'),true);assert.equal(b.answer({sessionId:'session-a',requestId:id},'allow'),false);
 assert.equal(JSON.parse(r.text).hookSpecificOutput.decision.behavior,'allow');b.close();
});
test('session end cancels a held request without auto-allowing it',()=>{
 const s=new DeckStore({clock:()=>2000});event(s,'PermissionRequest');const b=new PermissionBroker(s),r=response();b.hold('session-a',r);event(s,'SessionEnd',1100);assert.equal(r.text,'{}');assert.equal(b.pending.size,0);b.close();
});
test('expired and disconnected permission transports return to the native prompt',()=>{
 let now=2000;const s=new DeckStore({clock:()=>now});event(s,'PermissionRequest');const b=new PermissionBroker(s,{clock:()=>now,timeoutMs:100});const r=response(),id=b.hold('session-a',r);now+=101;
 assert.equal(b.answer({sessionId:'session-a',requestId:id},'deny'),false);b.finish(id,null);assert.equal(r.text,'{}');assert.equal(s.get().state,'attention');assert.equal(s.get().requestId,null);b.close();
});
test('HTTP rejects unauthorized and cross-origin writes; real local bridge contract works',async()=>{
 const s=new DeckStore(),receiver=await startReceiver(s),url=`http://127.0.0.1:${receiver.port}`;
 try{
  assert.equal((await fetch(url+'/event',{method:'POST',body:'{}'})).status,403);
  assert.equal((await fetch(url+'/event',{method:'POST',headers:{'X-Cardea-Token':'é'.repeat(64)},body:'{}'})).status,403);
  assert.equal((await fetch(url+'/event',{method:'POST',headers:{'X-Cardea-Token':receiver.token,Origin:'https://example.com'},body:'{}'})).status,403);
  const payload={event:'UserPromptSubmit',at:Date.now(),eventId:'http-test',sessionId:'http-session',cwd:'G:\\ExampleProject'};
  assert.equal((await fetch(url+'/event',{method:'POST',headers:{'X-Cardea-Token':receiver.token},body:JSON.stringify(payload)})).status,200);
  assert.equal(s.get('http-session').state,'working');
 }finally{await receiver.close();}
});
