// Keys answer only allowlisted low-risk tools, and only with the concrete request visible.
import {hookHome} from './support/hook-home.mjs';
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
import {DEFAULT_ALLOWLIST,eligibleTool,evaluateRequest,loadPolicy,writeConfig} from '../src/approval-policy.mjs';
import {cardSvg,detailLines,KEY_TEXT} from '../src/cards.mjs';
const {summarizeTool,MAX}=createRequire(import.meta.url)('../hooks/tool-summary.cjs');
const bridge=fileURLToPath(new URL('../hooks/bridge.cjs',import.meta.url));

test('summaries pick the field that describes the action',()=>{
 assert.deepEqual(summarizeTool('Read',{file_path:'C:\\a\\b.txt'}),{kind:'path',text:'C:\\a\\b.txt'});
 assert.deepEqual(summarizeTool('Bash',{command:'npm test',description:'ignored'}),{kind:'text',text:'npm test'});
 assert.deepEqual(summarizeTool('Grep',{pattern:'TODO',path:'C:\\src'}),{kind:'text',text:'C:\\src : TODO'});
 assert.deepEqual(summarizeTool('WebFetch',{url:'https://example.test/x'}),{kind:'text',text:'https://example.test/x'});
 assert.equal(summarizeTool('mcp__s__do',{target:'prod'}).text,'target="prod"');
});
test('no describable input yields no summary',()=>{
 for(const input of [undefined,null,'text',[],{},{count:3},{file_path:'   '}])assert.equal(summarizeTool('Read',input),null);
});
test('summaries neutralize hidden characters that could disguise the action',()=>{
 const{text,blocked}=summarizeTool('Bash',{command:'safe\u202e cmd\u0000\u200b\nrm -rf x\u2066'});
 assert.equal(text,'safe cmd rm -rf x');assert.equal(blocked,'unusual_characters');
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
 const lines=detailLines(path_);assert.equal(lines.length,4);assert.ok(lines[0].startsWith('…'));assert.ok(lines.at(-1).endsWith('secret.env'));
 assert.ok(detailLines(command).at(-1).endsWith('…'));
});
test('the approval key shows tool and content and escapes it',()=>{
 const svg=cardSvg({kind:'approval',decision:'allow',tool:'Read',summary:{kind:'path',text:'C:\\<a>&b.txt'},title:'Hold: Approve'});
 for(const part of ['Read','&lt;a&gt;&amp;b.txt','Hold: Approve'])assert.ok(svg.includes(part),part);assert.ok(!svg.includes('<a>'));
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
 for(const tool of ['Bash','BashOutput','PowerShell','Write','Edit','MultiEdit','NotebookEdit','WebFetch','WebSearch','Task','Agent','Skill','Monitor','EnterWorktree','SomeFutureTool','read'])assert.equal(evaluateRequest({enabled:true,allowlist:[tool]},tool,summary).approvable,false,tool);
 assert.equal(eligibleTool('mcp__d__find'),true);assert.equal(eligibleTool('mcp__github__merge_pull_request'),false,'A name the key cannot show whole');
});
function temp(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-policy-'));return Promise.resolve(fn(dir)).finally(()=>{assert.ok(path.basename(dir).startsWith('cardea-policy-'));fs.rmSync(dir,{recursive:true,force:true});});}
test('policy defaults to off and uses a validated configurable allowlist',()=>temp(dir=>{
 const machineFile=path.join(dir,'machine.json'),load=()=>loadPolicy({directory:dir,machineFile});
 assert.deepEqual(load(),{enabled:false,codexEnabled:false,lockedOff:false,allowlist:[...DEFAULT_ALLOWLIST]});
 writeConfig(dir,{approvalsEnabled:true,allowlist:['Read','mcp__docs__search','Bash','bad name*','Write','Monitor']});
 assert.deepEqual(load().allowlist,['Read','mcp__docs__search']);assert.equal(load().enabled,true);
 fs.writeFileSync(path.join(dir,'config.json'),'{broken');assert.equal(load().enabled,false,'A damaged configuration means off');
}));
test('a machine policy can only narrow the user configuration',()=>temp(dir=>{
 const machineFile=path.join(dir,'machine.json'),load=()=>loadPolicy({directory:dir,machineFile});
 writeConfig(dir,{approvalsEnabled:true,allowlist:['Read','Grep']});
 fs.writeFileSync(machineFile,JSON.stringify({allowlist:['Read','Glob','Bash']}));assert.deepEqual(load().allowlist,['Read']);
 fs.writeFileSync(machineFile,JSON.stringify({approvalsAllowed:false}));assert.equal(load().enabled,false);assert.equal(load().lockedOff,true);
 fs.writeFileSync(machineFile,JSON.stringify({approvalsAllowed:true}));assert.equal(load().enabled,true);
 for(const damaged of ['{broken','{"approvalsAllowed":"false"}','{"approvalsAllowed":0}','{"allowlist":"Read"}','[]','null']){fs.writeFileSync(machineFile,damaged);assert.equal(load().enabled,false,damaged);assert.equal(load().lockedOff,true,damaged);}
}));

function hook(home,payload){
 const child=spawn(process.execPath,[bridge,'PermissionRequest'],{env:{...process.env,USERPROFILE:hookHome(home)},windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='';child.stdout.on('data',b=>stdout+=b);
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

const allow={enabled:true,allowlist:['Read','Grep','Glob','LS','mcp__x__send']};
const verdict=(tool,input)=>evaluateRequest(allow,tool,summarizeTool(tool,input));
test('network and device paths never wait for a key, through any read-only tool',()=>{
 for(const value of ['\\\\host\\share\\x','//host/share/x','\\\\?\\UNC\\host\\share\\x','\\\\.\\pipe\\x','/\\host\\share','  \\\\host\\share','file://host/share/x']){
  assert.equal(verdict('Read',{file_path:value}).reason,'network_path',value);
  assert.equal(verdict('LS',{path:value}).reason,'network_path',value);
  assert.equal(verdict('Grep',{pattern:'a',path:value}).reason,'network_path',value);
  assert.equal(verdict('Glob',{pattern:'*',path:value}).reason,'network_path',value);
 }
 assert.equal(verdict('Glob',{pattern:'\\\\host\\share\\*'}).reason,'network_path');
 assert.equal(verdict('Grep',{pattern:'\\\\d+',path:'C:\\a'}).approvable,true,'A search pattern with backslashes is no path');
});
test('a request with invisible characters stays in the dialog',()=>{
 for(const cp of [0x200b,0x202e,0xad,0x0a,0x61c,0x180e,0x206a,0xfff9,0xe0041,0x34f,0x3164,0xfe0f,0xa0,0x5d0,0x627,0x430,0x3b1,0x8cc7,0x1f6e1,0x131,0x17f,0x1c3,0x1c0]){const value='C:\\a\\b'+String.fromCodePoint(cp)+'c.txt';assert.equal(verdict('Read',{file_path:value}).reason,'unusual_characters','U+'+cp.toString(16));}
 assert.equal(verdict('Read',{file_path:'C:\\a\\Prüfung Größe.txt'}).approvable,true,'Ordinary Western text is fine');
 assert.equal(verdict('Read',{file_path:'C:\\work\\public  report.txt'}).reason,'unusual_characters','Two spaces name another file than one');
 assert.equal(verdict('Read',{file_path:' C:\\a.txt'}).approvable,false);
});
test('the key shows where a path really leads',()=>{
 const secret='C:\\Users\\me\\.ssh\\id_rsa';
 assert.equal(summarizeTool('Read',{file_path:secret+'\\'+'decoy'.repeat(20)+'.txt\\..'}).text,secret);
 assert.equal(summarizeTool('Read',{file_path:'C:\\a\\.\\b\\..\\c.txt'}).text,'C:\\a\\c.txt');
 // Relative paths resolve against the session folder, and redaction never touches a path.
 const cwd='C:\\work\\demo';
 assert.equal(summarizeTool('Read',{file_path:'token=x\\..\\.ssh\\id_rsa'},cwd).text,'C:\\work\\demo\\.ssh\\id_rsa');
 assert.equal(summarizeTool('Read',{file_path:'--token ..\\.ssh\\id_rsa'},cwd).blocked,'unusual_path','A name ending in a dot is not what it seems');
 assert.equal(summarizeTool('Grep',{pattern:'a',path:'password=x\\..\\..\\secrets'},cwd).text,'C:\\work\\secrets : a');
 assert.equal(summarizeTool('Grep',{pattern:'a'},cwd).text,'C:\\work\\demo : a','No folder means the session folder');
 assert.equal(summarizeTool('Read',{file_path:'a.txt'}).blocked,'relative_path');
 for(const value of ['~\\.ssh\\id_rsa','%USERPROFILE%\\x','C:foo.txt','\\foo.txt','C:\\a.txt:hidden','C:\\a.txt.','C:\\a .txt ','C:\\a*.txt'])assert.ok(summarizeTool('Read',{file_path:value},cwd).blocked,value);
});
test('a long search pattern cannot push the searched folder off the key',()=>{
 const lines=detailLines(summarizeTool('Grep',{pattern:'a'.repeat(200),path:'C:\\Users\\me\\.ssh'})).join('');
 assert.ok(lines.startsWith('C:\\Users\\me\\.ssh'),lines);
 assert.equal(summarizeTool('Glob',{pattern:'*.txt',path:'C:\\'+'x'.repeat(80)+'\\.ssh'}).blocked,'incomplete_display','A folder that does not fit whole stays in the dialog');
});
test('unknown tools must show their whole input or stay in the dialog',()=>{
 assert.equal(verdict('mcp__x__send',{to:'me'}).approvable,true);
 assert.equal(verdict('mcp__x__send',{to:'me',options:{bcc:'other'}}).reason,'incomplete_display');
 assert.equal(verdict('mcp__x__send',{dry_run:'true path=x'}).approvable,true);assert.notEqual(summarizeTool('mcp__x__send',{dry_run:'true path=x'}).text,summarizeTool('mcp__x__send',{dry_run:'true',path:'x'}).text,'Two different inputs must look different');
 assert.equal(verdict('mcp__x__send',{a:'b"c'}).reason,'incomplete_display');
 assert.equal(verdict('mcp__x__send',{'to="me" msg':'x'}).approvable,false,'A key cannot pretend to be two arguments');
 assert.equal(verdict('mcp__x__send',{password_reset_for:'admin'}).reason,'incomplete_display','Redaction must not hide what an unknown tool does');
 assert.equal(verdict('mcp__x__send',{command:' '.repeat(5000)+'payload'}).approvable,false);
 for(const value of ['\\\\host\\share\\x','//host/x','file://host/x','https://example.test/x'])assert.equal(verdict('mcp__x__send',{path:value}).reason,'network_path',value);
 assert.equal(verdict('mcp__x__send',{to:'x'.repeat(60)}).reason,'incomplete_display');
 assert.equal(verdict('mcp__x__send',{a:'1',b:'2',c:'3',d:'4'}).approvable,true,'Four short fields fit');
 assert.equal(verdict('mcp__x__send',{n:1}).reason,'no_visible_content');
});
test('input size cannot slow the hook down',()=>{
 for(const command of ['a'.repeat(2_000_000),' a'.repeat(1_000_000),'token'.repeat(400_000),'-'.repeat(2_000_000),'//a:'.repeat(500_000)]){const start=Date.now();summarizeTool('Bash',{command});assert.ok(Date.now()-start<500,command.slice(0,8));}
});
test('key text fits the key at the size it is drawn',()=>{
 const {perLine,rows,fontSize}=KEY_TEXT;assert.ok(perLine*fontSize*0.6<=144-2*12,'Line width');assert.ok(rows*19+42<=120,'Rows stop above the title');
 assert.ok(perLine*rows>=52,'The display limit for unknown tools fits');
 assert.ok(summarizeTool('mcp__x__send',{to:'x'.repeat(47)}).blocked===undefined,'52 characters are allowed');assert.equal(detailLines(summarizeTool('mcp__x__send',{to:'x'.repeat(47)})).join(''),'to="'+'x'.repeat(47)+'"');
});

test('oversized values never reach the key, whatever their last part looks like',()=>{
 const padded='\\\\evil\\share\\'+'x\\..\\'.repeat(1000)+'decoy.txt';
 assert.equal(verdict('Read',{file_path:padded}).approvable,false);assert.equal(verdict('LS',{path:padded}).approvable,false);assert.equal(verdict('Grep',{pattern:'a',path:padded}).approvable,false);
 assert.equal(verdict('Read',{file_path:'C:\\Users\\me\\.ssh\\id_rsa\\'+'decoy\\..\\'.repeat(600)}).reason,'incomplete_display');
 assert.equal(verdict('Grep',{pattern:'a'.repeat(5000),path:'C:\\a'}).reason,'incomplete_display');
});
test('a Glob pattern cannot leave the folder the key names',()=>{
 for(const pattern of ['..\\..\\*','C:\\Users\\me\\.ssh\\*','~\\*','%TEMP%\\*'])assert.equal(verdict('Glob',{pattern,path:'C:\\a'}).reason,'unusual_path',pattern);
 assert.equal(verdict('Glob',{pattern:'**/*.txt',path:'C:\\a'}).approvable,true);
});
test('the hook itself refuses an allow for anything a key may not answer',async()=>temp(async dir=>{
 const {hookMayAllow,readMachinePolicy}=createRequire(import.meta.url)('../hooks/approval-rules.cjs');
 const shown={kind:'path',text:'C:\\a.txt'},machine=path.join(dir,'policy.json'),none=readMachinePolicy(path.join(dir,'missing.json'));
 assert.equal(hookMayAllow('Read',shown,none),true);
 for(const tool of ['Bash','Write','Monitor','mcp__github__merge_pull_request'])assert.equal(hookMayAllow(tool,shown,none),false,tool);
 assert.equal(hookMayAllow('Read',null,none),false);assert.equal(hookMayAllow('Read',{...shown,blocked:'network_path'},none),false);
 for(const[content,allowed]of [['{"approvalsAllowed":false}',false],['{broken',false],['{"allowlist":["Grep"]}',false],['{"allowlist":["Read"]}',true],['{"approvalsAllowed":true}',true]]){fs.writeFileSync(machine,content);assert.equal(hookMayAllow('Read',shown,readMachinePolicy(machine)),allowed,content);}
}));
test('revoking approvals reaches a request that already waits for the key',()=>temp(async dir=>{
 let enabled=true;const store=new DeckStore(),receiver=await startReceiver(store,{directory:dir,policy:()=>({enabled,allowlist:['Read']}),timeoutMs:30_000});
 try{
  const first=hook(dir,{session_id:'revoked',cwd:'G:\\P',tool_name:'Read',tool_input:{file_path:'C:\\a.txt'}});
  while(!store.get('revoked')?.requestId)await once(store,'change');
  const target=store.get('revoked');enabled=false;
  assert.equal(receiver.broker.answer({sessionId:target.id,requestId:target.requestId},'allow'),false);
  assert.deepEqual(await first,{code:0,stdout:''});
  enabled=true;const second=hook(dir,{session_id:'revoked',cwd:'G:\\P',tool_name:'Read',tool_input:{file_path:'C:\\b.txt'}});
  while(receiver.broker.pending.size===0)await once(store,'change');
  enabled=false;receiver.broker.revalidate();assert.equal(receiver.broker.pending.size,0);assert.deepEqual(await second,{code:0,stdout:''});
 }finally{await receiver.close();}
}));
test('a cut emoji cannot break a key image',()=>{
 const svg=cardSvg({kind:'session',agent:'claude',title:['abc\ud83d'],hint:'x',state:'idle'});
 assert.doesNotThrow(()=>encodeURIComponent(svg));
});
test('browser requests are refused on every route',()=>temp(async dir=>{
 const receiver=await startReceiver(new DeckStore(),{directory:dir});
 try{for(const route of ['/health','/identity','/status','/event']){const response=await fetch('http://127.0.0.1:'+receiver.port+route,{headers:{Origin:'https://example.test'}});assert.equal(response.status,403,route);}}
 finally{await receiver.close();}
}));

test('a session folder with odd characters blocks a relative request too',()=>{
 for(const[cwd,reason]of [['C:\\work\\safe'+String.fromCodePoint(0x202e)+'txt','unusual_characters'],['C:\\work  two','unusual_characters'],['C:\\'+String.fromCodePoint(0x430)+'\\x','unusual_characters'],['C:\\work~1','unusual_path']]){
  assert.equal(summarizeTool('Read',{file_path:'a.txt'},cwd).blocked,reason,cwd);assert.equal(summarizeTool('Grep',{pattern:'a',path:'.'},cwd).blocked,reason,cwd);assert.equal(summarizeTool('LS',{path:'.'},cwd).blocked,reason,cwd);
 }
});
test('reserved device names and short names stay in the dialog',()=>{
 for(const value of ['C:\\work\\CON','C:\\work\\aux.txt','C:\\work\\com1','C:\\work\\LPT9.log','C:\\work\\COM¹','C:\\SECRET~1.TXT'])assert.equal(summarizeTool('Read',{file_path:value}).blocked,'unusual_path',value);
 assert.equal(summarizeTool('Read',{file_path:'C:\\work\\console.txt'}).blocked,undefined);
});
test('fields the key does not show keep a request in the dialog',()=>{
 for(const[tool,input]of [['Grep',{pattern:'TODO',path:'C:\\a',glob:'**/.ssh/*'}],['Grep',{pattern:'a',path:'C:\\a','-C':100000}],['Grep',{pattern:'a',path:'C:\\a',multiline:true}],['Read',{file_path:'C:\\a.txt',extra:'\\\\host\\x'}],['Read',{file_path:'C:\\a.txt',offset:'x'}],['LS',{path:'C:\\a',ignore:['x']}]])assert.equal(summarizeTool(tool,input).blocked,'incomplete_display',JSON.stringify(input));
 assert.equal(summarizeTool('Read',{file_path:'C:\\a.txt',offset:10,limit:20}).blocked,undefined);assert.equal(summarizeTool('Grep',{pattern:'a',path:'C:\\a',output_mode:'files_with_matches',head_limit:50}).blocked,undefined);
 for(const extra of [{output_mode:'content'},{output_mode:'count'},{'-i':true},{'-n':true}])assert.equal(summarizeTool('Grep',{pattern:'a',path:'C:\\a',...extra}).blocked,'incomplete_display',JSON.stringify(extra));
});
test('a search must be shown whole and unredacted',()=>{
 assert.equal(summarizeTool('Grep',{pattern:'token=x|BEGIN.*PRIVATE',path:'C:\\proj'}).blocked,'incomplete_display');
 assert.equal(summarizeTool('Glob',{pattern:'password=x*',path:'C:\\a'}).blocked,'incomplete_display');
 assert.equal(summarizeTool('Grep',{pattern:'a'.repeat(60),path:'C:\\a'}).blocked,'incomplete_display');
 for(const pattern of ['{..,x}/**','{C:/Windows,x}/**','{//evil/share,x}/**'])assert.equal(summarizeTool('Glob',{pattern,path:'C:\\a'}).blocked,'unusual_path',pattern);
 assert.equal(summarizeTool('Glob',{pattern:'**/*.{ts,js}',path:'C:\\a'}).blocked,undefined);
});
test('a very long path reaches neither key nor inspector',()=>{
 assert.equal(summarizeTool('Read',{file_path:'C:\\'+'a\\'.repeat(200)+'b.txt'}).blocked,'incomplete_display');
 assert.equal(summarizeTool('Read',{file_path:'a\\'.repeat(125)+'secret.txt'},'C:\\work').blocked,'incomplete_display','Relative spelling changes nothing');
});
test('the hook prints only its own decision, whatever a signed reply adds',()=>temp(async dir=>{
 const http=await import('node:http'),{randomBytes,createHmac}=await import('node:crypto');
 const key=randomBytes(32).toString('hex'),token=randomBytes(32).toString('hex'),mac=(...parts)=>createHmac('sha256',Buffer.from(key,'hex')).update(JSON.stringify(parts)).digest('hex');
 const reply=JSON.stringify({continue:false,systemMessage:'x',hookSpecificOutput:{hookEventName:'PermissionRequest',decision:{behavior:'allow',updatedInput:{file_path:'C:\\other'},updatedPermissions:[{type:'addRules'}]}}});
 const server=http.createServer(async(req,res)=>{for await(const _ of req);const nonce=req.headers['x-cardea-nonce'];if(req.url==='/identity'){res.setHeader('X-Cardea-Proof',mac('cardea-receiver-identity-v1',nonce));res.end('{}');return;}let body='';res.setHeader('X-Cardea-Proof','');res.removeHeader('X-Cardea-Proof');res.setHeader('X-Cardea-Proof',mac('cardea-permission-response-v1',nonce,req.body??lastBody,200,reply));res.end(reply);});
 let lastBody='';server.prependListener('request',req=>{const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{lastBody=Buffer.concat(chunks).toString();});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  fs.writeFileSync(path.join(dir,'connection.json'),JSON.stringify({schema:2,port:server.address().port,token,permissionKey:key}));
  const result=await hook(dir,{session_id:'s',cwd:'C:\\P',tool_name:'Read',tool_input:{file_path:'C:\\a.txt'}});
  assert.deepEqual(JSON.parse(result.stdout),{hookSpecificOutput:{hookEventName:'PermissionRequest',decision:{behavior:'allow'}}});
 }finally{await new Promise(resolve=>server.close(resolve));}
}));
test('nothing waits when no key could answer it',()=>temp(async dir=>{
 const store=new DeckStore(),receiver=await startReceiver(store,{directory:dir,policy:allowed,holdable:()=>false,timeoutMs:30_000});
 try{assert.deepEqual(await hook(dir,{session_id:'unseen',cwd:'C:\\P',tool_name:'Read',tool_input:{file_path:'C:\\a.txt'}}),{code:0,stdout:''});assert.equal(receiver.broker.pending.size,0);assert.match(fs.readFileSync(path.join(dir,'decisions.jsonl'),'utf8'),/no_key_shown/);}
 finally{await receiver.close();}
}));
test('Codex approvals have their own off-by-default consent and honor the machine policy',()=>temp(dir=>{
 const machineFile=path.join(dir,'machine.json'),load=()=>loadPolicy({directory:dir,machineFile});
 assert.equal(load().codexEnabled,false);writeConfig(dir,{approvalsEnabled:true});assert.equal(load().codexEnabled,false,'Claude consent is not Codex consent');
 writeConfig(dir,{approvalsEnabled:false,codexApprovalsEnabled:true});assert.equal(load().codexEnabled,true);assert.equal(load().enabled,false);
 fs.writeFileSync(machineFile,'{"approvalsAllowed":false}');assert.equal(load().codexEnabled,false);
}));

test('the hook takes its folder from the profile only',()=>{
 const {runtimeDirectory}=createRequire(import.meta.url)('../hooks/runtime.cjs');
 assert.equal(runtimeDirectory({USERPROFILE:'C:\\Users\\me',CARDEA_DECK_HOME:'C:\\elsewhere'}),path.join('C:\\Users\\me','.cardeadeck'));
});
test('the bundle cannot load optional native add-ons from next to the plugin',()=>{
 const bundle=fs.readFileSync('dist/de.cardea.deck.sdPlugin/bin/plugin.mjs','utf8');
 assert.ok(!bundle.includes('process.env.WS_NO_BUFFER_UTIL')&&!bundle.includes('process.env.WS_NO_UTF_8_VALIDATE'));
});
