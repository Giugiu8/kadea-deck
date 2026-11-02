import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {DeckStore} from '../src/store.mjs';
import {startReceiver} from '../src/receiver.mjs';
const bridge=fileURLToPath(new URL('../hooks/bridge.cjs',import.meta.url));
function call(home,event,payload){
 const p=spawn(process.execPath,[bridge,event],{env:{...process.env,CARDEA_DECK_HOME:home},windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.stdin.end(JSON.stringify(payload));
 return once(p,'exit').then(([code])=>({code,stdout,stderr}));
}
function removeFixture(dir){assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('cardea-'));fs.rmSync(dir,{recursive:true,force:true});}
test('MSIX appdata overlays do not split the native receiver and desktop hook',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-msix-'));
 const shared=path.join(dir,'.cardeadeck'),s=new DeckStore(),r=await startReceiver(s,{directory:shared});
 try{
  const p=spawn(process.execPath,[bridge,'UserPromptSubmit'],{env:{...process.env,USERPROFILE:dir,LOCALAPPDATA:path.join(dir,'claude-private-overlay'),CARDEA_DECK_HOME:''},windowsHide:true,stdio:['pipe','pipe','pipe']});
  let errors='';p.stderr.on('data',b=>errors+=b);p.stdin.end(JSON.stringify({session_id:'msix-fixture',cwd:'G:\\Test'}));
  const [code]=await once(p,'exit');assert.equal(code,0,errors);assert.equal(s.get('msix-fixture')?.state,'working');
  assert.equal(fs.existsSync(path.join(dir,'claude-private-overlay')),false);
 }finally{await r.close();removeFixture(dir);}
});
async function fixture(fn,timeoutMs=55_000){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-bridge-'));const s=new DeckStore(),r=await startReceiver(s,{directory:dir,timeoutMs});try{await fn(s,r,dir);}finally{await r.close();removeFixture(dir);}}
test('real bridge process forwards only the metadata allowlist',()=>fixture(async(s,r,dir)=>{
 const result=await call(dir,'PreToolUse',{session_id:'bridge-session',cwd:'G:\\ExampleProject',tool_use_id:'tool-123',prompt:'PRIVATE_SENTINEL',tool_input:{secret:'PRIVATE_SENTINEL'},transcript_path:'PRIVATE_SENTINEL'});
 assert.deepEqual(result,{code:0,stdout:'',stderr:''});assert.equal(s.get('bridge-session').state,'working');assert.equal(s.get('bridge-session').lastToolId,'tool-123');assert.ok(!JSON.stringify([...s.sessions.values()]).includes('PRIVATE_SENTINEL'));
}));
test('permission roundtrip returns one native hook decision for the exact chosen request',()=>fixture(async(s,r,dir)=>{
 const result=call(dir,'PermissionRequest',{session_id:'approval-session',cwd:'G:\\ExampleProject',tool_name:'Bash',tool_input:{command:'PRIVATE_SENTINEL'}});
 while(!s.get('approval-session')?.requestId)await once(s,'change');
 const target=s.get('approval-session');assert.equal(r.broker.answer({sessionId:target.id,requestId:target.requestId},'deny'),true);
 const response=await result;assert.equal(response.code,0);const value=JSON.parse(response.stdout);assert.equal(value.hookSpecificOutput.decision.behavior,'deny');assert.ok(!response.stdout.includes('PRIVATE_SENTINEL'));
}));
test('permission timeout emits no provider decision and restores the native prompt',()=>fixture(async(s,r,dir)=>{
 const response=await call(dir,'PermissionRequest',{session_id:'timeout-session',cwd:'G:\\ExampleProject',tool_name:'Read'});
 assert.equal(response.stdout,'');assert.equal(response.code,0);assert.equal(s.get('timeout-session').requestId,null);assert.equal(s.get('timeout-session').state,'attention');
},35));
test('missing connection never blocks or writes a fake decision',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-offline-'));try{assert.deepEqual(await call(dir,'PermissionRequest',{session_id:'x'}),{code:0,stdout:'',stderr:''});}finally{removeFixture(dir);}
});
