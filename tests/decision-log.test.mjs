import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {DecisionLog} from '../src/decision-log.mjs';
import {DeckStore} from '../src/store.mjs';
import {startReceiver} from '../src/receiver.mjs';
const bridge=fileURLToPath(new URL('../hooks/bridge.cjs',import.meta.url));
function temp(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-log-'));return Promise.resolve(fn(dir)).finally(()=>{assert.ok(path.basename(dir).startsWith('cardea-log-'));fs.rmSync(dir,{recursive:true,force:true});});}
const lines=dir=>fs.readFileSync(path.join(dir,'decisions.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
test('an entry holds exactly time, session, tool and decision',()=>temp(dir=>{
 new DecisionLog({directory:dir,clock:()=>Date.UTC(2026,10,4,12)}).record({sessionId:'s-1',tool:'Read',decision:'allow',prompt:'PRIVATE',summary:{text:'PRIVATE'},toolInput:'PRIVATE'});
 assert.deepEqual(lines(dir),[{at:'2026-11-04T12:00:00.000Z',sessionId:'s-1',tool:'Read',decision:'allow'}]);
 assert.ok(!fs.readFileSync(path.join(dir,'decisions.jsonl'),'utf8').includes('PRIVATE'));
}));
test('unknown outcomes are refused and control characters cannot forge lines',()=>temp(dir=>{
 const log=new DecisionLog({directory:dir});assert.equal(log.record({sessionId:'a',tool:'Read',decision:'maybe'}),false);
 log.record({sessionId:'a\n{"forged":true}',tool:'Re\r\nad',decision:'deny'});assert.equal(lines(dir).length,1);assert.equal(lines(dir)[0].tool,'Read');
}));
test('size stays bounded: the log rotates and keeps a fixed number of old files',()=>temp(dir=>{
 const log=new DecisionLog({directory:dir,maxBytes:400,keep:2});
 for(let i=0;i<200;i++)assert.equal(log.record({sessionId:'session-'+i,tool:'Read',decision:'allow'}),true);
 assert.deepEqual(fs.readdirSync(dir).sort(),['decisions.jsonl','decisions.jsonl.1','decisions.jsonl.2']);
 for(const name of fs.readdirSync(dir))assert.ok(fs.statSync(path.join(dir,name)).size<=400,name);
 assert.equal(lines(dir).at(-1).sessionId,'session-199');
}));
test('a write failure is reported, never thrown into the decision path',()=>temp(dir=>{
 const blocked=path.join(dir,'file');fs.writeFileSync(blocked,'not a directory');
 const log=new DecisionLog({directory:path.join(blocked,'below')});assert.equal(log.record({sessionId:'a',tool:'Read',decision:'allow'}),false);assert.equal(log.ok,false);
}));
function hook(home,session,tool,input){const child=spawn(process.execPath,[bridge,'PermissionRequest'],{env:{...process.env,CARDEA_DECK_HOME:home},windowsHide:true,stdio:['pipe','pipe','pipe']});const ended=once(child,'close');child.stdin.end(JSON.stringify({session_id:session,cwd:'G:\\P',tool_name:tool,tool_input:input}));return ended;}
test('allow, deny, timeout and deferred requests are each recorded once by the real path',()=>temp(async dir=>{
 const store=new DeckStore(),policy=()=>({enabled:true,allowlist:['Read']}),receiver=await startReceiver(store,{directory:dir,policy,timeoutMs:400});
 try{
  const decide=async(session,decision)=>{const done=hook(dir,session,'Read',{file_path:'C:\\PRIVATE_SENTINEL'});while(!store.get(session)?.requestId)await once(store,'change');assert.equal(receiver.broker.answer({sessionId:session,requestId:store.get(session).requestId},decision),true);await done;};
  await decide('allow-session','allow');await decide('deny-session','deny');
  await hook(dir,'timeout-session','Read',{file_path:'C:\\PRIVATE_SENTINEL'});
  await hook(dir,'deferred-session','Bash',{command:'PRIVATE_SENTINEL'});
  assert.deepEqual(lines(dir).map(({sessionId,tool,decision,reason})=>[sessionId,tool,decision,reason]),[['allow-session','Read','allow',undefined],['deny-session','Read','deny',undefined],['timeout-session','Read','timeout',undefined],['deferred-session','Bash','deferred','not_allowlisted']]);
  assert.ok(!fs.readFileSync(path.join(dir,'decisions.jsonl'),'utf8').includes('PRIVATE_SENTINEL'));
 }finally{await receiver.close();}
}));
