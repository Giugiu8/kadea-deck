// Keys answer only allowlisted low-risk tools, and only with the concrete request visible.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {DeckStore} from '../src/store.mjs';
import {startReceiver} from '../src/receiver.mjs';
import {DEFAULT_ALLOWLIST,RISKY_TOOLS,evaluateRequest,loadPolicy,writeConfig} from '../src/approval-policy.mjs';
import {cardSvg,detailLines} from '../src/cards.mjs';
const {summarizeTool,MAX}=createRequire(import.meta.url)('../hooks/tool-summary.cjs');
const bridge=fileURLToPath(new URL('../hooks/bridge.cjs',import.meta.url));

test('summaries pick the field that describes the action',()=>{
 assert.deepEqual(summarizeTool('Read',{file_path:'C:\\a\\b.txt'}),{kind:'path',text:'C:\\a\\b.txt'});
 assert.deepEqual(summarizeTool('Bash',{command:'npm test',description:'ignored'}),{kind:'text',text:'npm test'});
 assert.deepEqual(summarizeTool('Grep',{pattern:'TODO',path:'src'}),{kind:'text',text:'TODO in src'});
 assert.deepEqual(summarizeTool('WebFetch',{url:'https://example.test/x'}),{kind:'text',text:'https://example.test/x'});
 assert.equal(summarizeTool('mcp__s__do',{target:'prod',n:1}).text,'target=prod');
});
test('no describable input yields no summary',()=>{
 for(const input of [undefined,null,'text',[],{},{count:3},{file_path:'   '}])assert.equal(summarizeTool('Read',input),null);
});
test('summaries neutralize hidden characters that could disguise the action',()=>{
 const{text}=summarizeTool('Bash',{command:'safe\u202e cmd\u0000\u200b\nrm -rf x\u2066'});
 assert.equal(text,'safe cmd rm -rf x');
});
test('summaries redact common secret forms',()=>{
 for(const[command,secret]of [['deploy --token abc123','abc123'],['deploy --password=abc123','abc123'],['API_KEY=abc123 npm start','abc123'],['curl -H "Authorization: Bearer abc123" x','abc123'],['git clone https://me:abc123@host/r','abc123'],['x?token=abc123&y=1','abc123']]){
  const{text}=summarizeTool('Bash',{command});assert.ok(!text.includes(secret),text);assert.ok(text.includes('***'),text);
 }
});
test('long values are cut visibly; a path keeps its file name and a command its start',()=>{
 const long='x'.repeat(MAX+50);
 const path_=summarizeTool('Read',{file_path:'C:\\'+long+'\\secret.env'}),command=summarizeTool('Bash',{command:'rm '+long});
 assert.ok(path_.text.startsWith('…')&&path_.text.endsWith('secret.env'));assert.ok(command.text.startsWith('rm ')&&command.text.endsWith('…'));
 assert.ok(path_.text.length<=MAX+1&&command.text.length<=MAX+1);
 const lines=detailLines(path_);assert.equal(lines.length,3);assert.ok(lines[0].startsWith('…'));assert.ok(lines.at(-1).endsWith('secret.env'));
 assert.ok(detailLines(command).at(-1).endsWith('…'));
});
test('the approval key shows tool and content and escapes it',()=>{
 const svg=cardSvg({kind:'approval',decision:'allow',tool:'Read',summary:{kind:'path',text:'C:\\<a>&b.txt'},title:'Approve',hint:'HOLD 1 S'});
 for(const part of ['Read','&lt;a&gt;&amp;b.txt','Approve','HOLD 1 S'])assert.ok(svg.includes(part),part);assert.ok(!svg.includes('<a>'));
});

const summary={kind:'path',text:'C:\\a.txt'},on={enabled:true,allowlist:[...DEFAULT_ALLOWLIST]};
test('only allowlisted tools with visible content can be answered by key',()=>{
 assert.deepEqual(evaluateRequest(on,'Read',summary),{approvable:true,reason:'allowlisted'});
 assert.equal(evaluateRequest(on,'Read',null).reason,'no_visible_content');
 assert.equal(evaluateRequest(on,'mcp__unknown__tool',summary).reason,'not_allowlisted');
 assert.equal(evaluateRequest({...on,enabled:false},'Read',summary).reason,'approvals_off');
 assert.equal(evaluateRequest(null,'Read',summary).reason,'approvals_off');
 for(const tool of ['', 'read',undefined,'Read Bash','x'.repeat(201)])assert.equal(evaluateRequest(on,tool,summary).approvable,false,String(tool));
});
test('risky tools stay out even when a configuration lists them',()=>{
 for(const tool of RISKY_TOOLS)assert.equal(evaluateRequest({enabled:true,allowlist:[tool]},tool,summary).approvable,false,tool);
 for(const tool of ['Bash','PowerShell','Write','Edit','MultiEdit','NotebookEdit','WebFetch','WebSearch','Agent'])assert.ok(RISKY_TOOLS.has(tool),tool);
});
function temp(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-policy-'));return Promise.resolve(fn(dir)).finally(()=>{assert.ok(path.basename(dir).startsWith('cardea-policy-'));fs.rmSync(dir,{recursive:true,force:true});});}
test('policy defaults to off and uses a validated configurable allowlist',()=>temp(dir=>{
 const machineFile=path.join(dir,'machine.json'),load=()=>loadPolicy({directory:dir,machineFile});
 assert.deepEqual(load(),{enabled:false,lockedOff:false,allowlist:[...DEFAULT_ALLOWLIST]});
 writeConfig(dir,{approvalsEnabled:true,allowlist:['Read','mcp__docs__search','Bash','bad name*','Write']});
 assert.deepEqual(load().allowlist,['Read','mcp__docs__search']);assert.equal(load().enabled,true);
 fs.writeFileSync(path.join(dir,'config.json'),'{broken');assert.equal(load().enabled,false,'A damaged configuration means off');
}));
test('a machine policy can only narrow the user configuration',()=>temp(dir=>{
 const machineFile=path.join(dir,'machine.json'),load=()=>loadPolicy({directory:dir,machineFile});
 writeConfig(dir,{approvalsEnabled:true,allowlist:['Read','Grep']});
 fs.writeFileSync(machineFile,JSON.stringify({allowlist:['Read','Glob','Bash']}));assert.deepEqual(load().allowlist,['Read']);
 fs.writeFileSync(machineFile,JSON.stringify({approvalsAllowed:false}));assert.equal(load().enabled,false);assert.equal(load().lockedOff,true);
 fs.writeFileSync(machineFile,JSON.stringify({approvalsAllowed:true}));assert.equal(load().enabled,true);
}));

function hook(home,payload){
 const child=spawn(process.execPath,[bridge,'PermissionRequest'],{env:{...process.env,CARDEA_DECK_HOME:home},windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='';child.stdout.on('data',b=>stdout+=b);
 const ended=once(child,'close');child.stdin.end(JSON.stringify(payload));return ended.then(([code])=>({code,stdout}));
}
const allowed=()=>({enabled:true,allowlist:['Read']});
test('a real hook for a risky tool returns no decision at once, without waiting for a key',()=>temp(async dir=>{
 const store=new DeckStore(),receiver=await startReceiver(store,{directory:dir,policy:allowed,timeoutMs:30_000});
 try{
  const start=Date.now(),result=await hook(dir,{session_id:'risky',cwd:'G:\\P',tool_name:'Bash',tool_input:{command:'rm -rf x'}});
  assert.deepEqual(result,{code:0,stdout:''});assert.ok(Date.now()-start<10_000);assert.equal(receiver.broker.pending.size,0);
  assert.equal(store.get('risky').state,'attention');assert.equal(store.get('risky').requestId,null);
 }finally{await receiver.close();}
}));
test('with approvals off a hook returns no decision and nothing is held',()=>temp(async dir=>{
 const store=new DeckStore(),receiver=await startReceiver(store,{directory:dir,timeoutMs:30_000});
 try{
  assert.deepEqual(await hook(dir,{session_id:'off',cwd:'G:\\P',tool_name:'Read',tool_input:{file_path:'C:\\a'}}),{code:0,stdout:''});
  assert.equal(receiver.broker.pending.size,0);
 }finally{await receiver.close();}
}));
test('an allowlisted tool without describable input stays in the normal dialog',()=>temp(async dir=>{
 const store=new DeckStore(),receiver=await startReceiver(store,{directory:dir,policy:allowed,timeoutMs:30_000});
 try{assert.deepEqual(await hook(dir,{session_id:'empty',cwd:'G:\\P',tool_name:'Read',tool_input:{}}),{code:0,stdout:''});assert.equal(receiver.broker.pending.size,0);}
 finally{await receiver.close();}
}));
test('the summary reaches the key in memory but never the state file or the log',()=>temp(async dir=>{
 const stateFile=path.join(dir,'state.json'),store=new DeckStore({file:stateFile}),receiver=await startReceiver(store,{directory:dir,policy:allowed,timeoutMs:30_000});
 try{
  const pending=hook(dir,{session_id:'visible',cwd:'G:\\P',tool_name:'Read',tool_input:{file_path:'C:\\PRIVATE_SENTINEL.txt'}});
  while(!store.get('visible')?.requestId)await once(store,'change');
  const target=store.get('visible');assert.equal(receiver.broker.summary(target.requestId).text,'C:\\PRIVATE_SENTINEL.txt');
  assert.ok(!fs.readFileSync(stateFile,'utf8').includes('PRIVATE_SENTINEL'));
  receiver.broker.answer({sessionId:target.id,requestId:target.requestId},'allow');
  assert.equal(JSON.parse((await pending).stdout).hookSpecificOutput.decision.behavior,'allow');
  assert.equal(receiver.broker.summary(target.requestId),null);
  assert.ok(!fs.readFileSync(stateFile,'utf8').includes('PRIVATE_SENTINEL'));
  assert.ok(!fs.readFileSync(path.join(dir,'decisions.jsonl'),'utf8').includes('PRIVATE_SENTINEL'));
 }finally{await receiver.close();}
}));
