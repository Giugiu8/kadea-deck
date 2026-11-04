import {hookHome} from './support/hook-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../package.json',import.meta.url));
const {WebSocketServer}=require('ws');
const root=fileURLToPath(new URL('..',import.meta.url));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('built plugin registers with the real SDK and renders live receiver events through the socket',{timeout:25_000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-sdk-'));
 const appData=path.join(dir,'native-appdata'),pluginRoot=path.join(appData,'Elgato/StreamDeck/Plugins/de.cardea.deck.sdPlugin'),bin=path.join(pluginRoot,'bin'),win=path.join(dir,'fake-windows');fs.mkdirSync(win);
 fs.cpSync(path.join(root,'dist/de.cardea.deck.sdPlugin'),pluginRoot,{recursive:true,filter:source=>path.basename(source)!=='logs'});
 const settingsFile=path.join(dir,'.claude/settings.json'),foreign={env:{KEEP:'fixture'},statusLine:{type:'command',command:'echo preserved'}};fs.mkdirSync(path.dirname(settingsFile),{recursive:true});fs.writeFileSync(settingsFile,JSON.stringify(foreign));
 // Test-only stand-in for explorer.exe records the route instead of launching an application.
 const helperSource=path.join(dir,'capture.cs');fs.writeFileSync(helperSource,'using System; using System.IO; class Capture { static int Main(string[] args) { File.AppendAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"opened.txt"),String.Join("|",args)+"\\n"); return 0; } }');
 execFileSync(path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/target:winexe',`/out:${path.join(win,'explorer.exe')}`,helperSource],{windowsHide:true});
 const server=new WebSocketServer({port:0,host:'127.0.0.1'});await once(server,'listening');
 const info={application:{font:'Segoe UI',language:'de',platform:'windows',platformVersion:'10',version:'7.6.0'},plugin:{uuid:'de.cardea.deck',version:'0.1.0.0'},devices:[{id:'test-device',name:'Test',size:{columns:5,rows:3},type:0}]};
 const p=spawn(process.execPath,[path.join(bin,'plugin.mjs'),'-port',String(server.address().port),'-pluginUUID','de.cardea.deck','-registerEvent','registerPlugin','-info',JSON.stringify(info)],{cwd:pluginRoot,env:{...Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^(windir|programfiles|programdata)$/i.test(name))),WINDIR:win,ProgramFiles:path.join(dir,'program-files'),ProgramData:path.join(dir,'program-data'),APPDATA:appData,LOCALAPPDATA:appData,USERPROFILE:dir},stdio:['ignore','pipe','pipe'],windowsHide:true});
 let stderr='',socket;const messages=[];p.stderr.on('data',b=>stderr+=b);
 const deadline=setTimeout(()=>p.kill(),20_000);deadline.unref();
 try{
  [socket]=await Promise.race([once(server,'connection'),once(p,'exit').then(([code])=>{throw Error(`Plugin startup failed (${code}): ${stderr}`);})]);socket.on('message',b=>messages.push(JSON.parse(b)));
  const waitFor=async predicate=>{const start=Date.now();while(!(await predicate())){if(p.exitCode!==null)throw Error(`Plugin exited: ${stderr}`);if(Date.now()-start>4000)throw Error(`Timed out waiting for SDK event: ${stderr}`);await new Promise(r=>setTimeout(r,10));}};
  await waitFor(()=>messages.some(m=>m.event==='registerPlugin'));
  socket.send(JSON.stringify({event:'willAppear',action:'de.cardea.deck.session',context:'test-key',device:'test-device',payload:{controller:'Keypad',coordinates:{column:0,row:0},isInMultiAction:false,settings:{slot:0},state:0}}));
  await waitFor(()=>messages.some(m=>m.event==='setImage'));
  socket.send(JSON.stringify({event:'propertyInspectorDidAppear',action:'de.cardea.deck.session',context:'test-key',device:'test-device'}));
  await waitFor(()=>messages.some(m=>m.event==='sendToPropertyInspector'&&m.context==='test-key'&&m.payload.type==='integrationStatus'));
  const nonce=messages.find(m=>m.event==='sendToPropertyInspector'&&m.context==='test-key').payload.nonce;
  const inspect=payload=>socket.send(JSON.stringify({event:'sendToPlugin',action:'de.cardea.deck.session',context:'test-key',payload}));
  inspect({cmd:'setupClaude',nonce,plugin:'C:/must-not-use'});inspect({cmd:'setupClaude',nonce});
  await waitFor(()=>messages.some(m=>m.event==='sendToPropertyInspector'&&m.payload.claude==='installed'));
  const integrated=JSON.parse(fs.readFileSync(settingsFile));assert.deepEqual(integrated.env,foreign.env);assert.deepEqual(integrated.statusLine,foreign.statusLine);assert.ok(integrated.hooks.Stop[0].hooks[0].args[0].includes(pluginRoot));assert.equal(integrated.hooks.PermissionRequest,undefined,'Setup alone never adds the approval hook');
  // Key approvals need the consent field, and enabling them adds exactly that hook.
  inspect({cmd:'enableApprovals',nonce});await pause(100);assert.equal(JSON.parse(fs.readFileSync(settingsFile)).hooks.PermissionRequest,undefined);
  inspect({cmd:'enableApprovals',nonce,consent:'approve-by-key'});await waitFor(()=>messages.some(m=>m.event==='sendToPropertyInspector'&&m.payload.approvals==='on'));
  assert.ok(JSON.parse(fs.readFileSync(settingsFile)).hooks.PermissionRequest[0].hooks[0].args[0].includes(pluginRoot));
  inspect({cmd:'removeClaude',nonce});await waitFor(()=>messages.some(m=>m.event==='sendToPropertyInspector'&&m.payload.message==='done'&&m.payload.claude==='not_set_up'&&m.payload.approvals==='off'));
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile)),foreign);
  // Back on for the key tests below; the receiver reads the same consent record.
  inspect({cmd:'enableApprovals',nonce,consent:'approve-by-key'});const enabledAt=messages.length;await waitFor(()=>messages.slice(enabledAt).some(m=>m.event==='sendToPropertyInspector'&&m.payload.approvals==='on'));
  socket.send(JSON.stringify({event:'propertyInspectorDidDisappear',action:'de.cardea.deck.session',context:'test-key',device:'test-device'}));
  const c=JSON.parse(fs.readFileSync(path.join(dir,'.cardeadeck/connection.json'),'utf8'));
  const result=await fetch(`http://127.0.0.1:${c.port}/event`,{method:'POST',headers:{'X-Cardea-Token':c.token},body:JSON.stringify({event:'UserPromptSubmit',sessionId:'sdk-fixture',eventId:'sdk-event',at:Date.now(),cwd:'G:\\TestProject'})});
  assert.equal(result.status,200);
  await waitFor(()=>messages.filter(m=>m.event==='setImage').some(m=>decodeURIComponent(m.payload.image).includes('TestProject')));
  // Showing/selecting a card never emits an approval or a native application launch.
  assert.ok(!messages.some(m=>m.event==='openUrl'));
  const headers={'X-Cardea-Token':c.token},base=`http://127.0.0.1:${c.port}`;
  const sessionKey=(context,slot,event)=>socket.send(JSON.stringify({event,action:'de.cardea.deck.session',context,device:'test-device',payload:{controller:'Keypad',coordinates:{column:slot,row:0},isInMultiAction:false,settings:{slot},state:0}}));
  const press=(context,slot)=>{for(const event of ['keyDown','keyUp'])sessionKey(context,slot,event);};
  socket.send(JSON.stringify({event:'willAppear',action:'de.cardea.deck.session',context:'empty-key',device:'test-device',payload:{controller:'Keypad',coordinates:{column:1,row:0},isInMultiAction:false,settings:{slot:1},state:0}}));
  await waitFor(()=>messages.some(m=>m.event==='setImage'&&m.context==='empty-key'&&decodeURIComponent(m.payload.image).includes('New chat')));
  sessionKey('empty-key',1,'keyDown');
  await waitFor(async()=> (await(await fetch(base+'/status',{headers})).json()).keyDownCount===1);
  // The formerly empty slot fills while held. Release must still create a new
  // composer, rather than navigate to this newly arrived unrelated chat.
  const arrived=await fetch(base+'/event',{method:'POST',headers,body:JSON.stringify({event:'SessionStart',sessionId:'arrived-mid-press',eventId:'mid-press',at:Date.now(),cwd:'G:\\ArrivedProject'})});assert.equal(arrived.status,200);
  await waitFor(()=>messages.some(m=>m.event==='setImage'&&m.context==='empty-key'&&decodeURIComponent(m.payload.image).includes('ArrivedProject')));
  sessionKey('empty-key',1,'keyUp');
  await waitFor(async()=> (await(await fetch(base+'/status',{headers})).json()).lastResult!==null);
  assert.equal(messages.filter(m=>m.event==='showAlert'&&m.context==='empty-key').length,0,'An unassigned slot must not display the yellow warning triangle');
  assert.equal((await(await fetch(base+'/status',{headers})).json()).lastResult,'new-chat');
  assert.equal(fs.readFileSync(path.join(win,'opened.txt'),'utf8'),'claude://code/new?source=desktop_action\n');
  // A real chat without a desktop link still reports unavailability. The fix
  // must not suppress alerts for actual failed navigation attempts.
  press('test-key',0);
  await waitFor(()=>messages.some(m=>m.event==='showAlert'&&m.context==='test-key'));
  const post=(route,event,extra={})=>fetch(base+route,{method:'POST',headers,body:JSON.stringify({event,sessionId:'sdk-fixture',eventId:`sdk-${++seq}`,at:Date.now(),cwd:'G:\\TestProject',...extra})});let seq=0;
  const permission=(tool,tool_input)=>{
   const hook=spawn(process.execPath,[path.join(root,'dist/de.cardea.deck.sdPlugin/hooks/bridge.cjs'),'PermissionRequest'],{env:{...process.env,USERPROFILE:hookHome(path.join(dir,'.cardeadeck'))},windowsHide:true,stdio:['pipe','pipe','pipe']});
   let output='',errors='';hook.stdout.on('data',b=>output+=b);hook.stderr.on('data',b=>errors+=b);
   const ended=once(hook,'close');hook.stdin.end(JSON.stringify({session_id:'sdk-fixture',tool_name:tool,tool_input,cwd:'G:\\TestProject'}));
   return ended.then(([code])=>{assert.equal(code,0,errors);assert.equal(errors,'');return output?JSON.parse(output):{};});
  };
  socket.send(JSON.stringify({event:'willAppear',action:'de.cardea.deck.permission',context:'approve-key',device:'test-device',payload:{controller:'Keypad',coordinates:{column:1,row:0},isInMultiAction:false,settings:{decision:'allow'},state:0}}));
  const first=permission('Read',{file_path:'C:\\a\\one.txt'});
  await waitFor(()=>messages.some(m=>m.event==='setImage'&&m.context==='approve-key'&&decodeURIComponent(m.payload.image).includes('one.txt')));
  const key=event=>socket.send(JSON.stringify({event,action:'de.cardea.deck.permission',context:'approve-key',device:'test-device',payload:{controller:'Keypad',coordinates:{column:1,row:0},isInMultiAction:false,settings:{decision:'allow'},state:0}}));
  key('keyDown');await new Promise(r=>setTimeout(r,15));
  await post('/event','UserPromptSubmit');assert.deepEqual(await first,{});
  const next=permission('Read',{file_path:'C:\\a\\two.txt'});
  await waitFor(()=>messages.some(m=>m.event==='setImage'&&m.context==='approve-key'&&decodeURIComponent(m.payload.image).includes('two.txt')));
  assert.ok(messages.some(m=>m.event==='setImage'&&m.context==='approve-key'&&decodeURIComponent(m.payload.image).includes('Hold: Approve')));
  key('keyUp');await waitFor(()=>messages.some(m=>m.event==='showAlert'&&m.context==='approve-key'));
  assert.equal((await(await fetch(base+'/status',{headers})).json()).pendingRequests,1);
  // One quick press must not allow anything; holding for a second does.
  const alerts=()=>messages.filter(m=>m.event==='showAlert'&&m.context==='approve-key').length,alertsBefore=alerts();
  await pause(700);
  key('keyDown');await pause(30);key('keyUp');await waitFor(()=>alerts()>alertsBefore);
  assert.equal((await(await fetch(base+'/status',{headers})).json()).pendingRequests,1,'A short press leaves the request open');
  // A Multi Action cannot hold the key for anyone.
  const multi=alerts();socket.send(JSON.stringify({event:'keyDown',action:'de.cardea.deck.permission',context:'approve-key',device:'test-device',payload:{controller:'Keypad',coordinates:{column:1,row:0},isInMultiAction:true,settings:{decision:'allow'},state:0}}));await waitFor(()=>alerts()>multi);
  assert.equal((await(await fetch(base+'/status',{headers})).json()).pendingRequests,1);
  key('keyDown');await pause(1050);key('keyUp');assert.equal((await next).hookSpecificOutput.decision.behavior,'allow');
  // Commands never wait for a key: no decision at once, so Claude opens its own dialog.
  assert.deepEqual(await permission('Bash',{command:'echo PRIVATE_SENTINEL'}),{});
  assert.equal((await(await fetch(base+'/status',{headers})).json()).pendingRequests,0);
  const decisions=fs.readFileSync(path.join(dir,'.cardeadeck/decisions.jsonl'),'utf8');
  assert.deepEqual(decisions.trim().split('\n').map(line=>{const e=JSON.parse(line);return[e.tool,e.decision];}),[['Read','cancelled'],['Read','allow'],['Bash','deferred']]);
  assert.ok(!decisions.includes('two.txt')&&!decisions.includes('PRIVATE_SENTINEL'));
  // Without a configured Codex source, its permission key must fail closed;
  // an empty chat key may still open only the fixed new-composer route.
  const codexKey=(kind,context,event,settings={})=>socket.send(JSON.stringify({event,action:`de.cardea.deck.codex-${kind}`,context,device:'test-device',payload:{controller:'Keypad',coordinates:{column:0,row:1},isInMultiAction:false,settings,state:0}}));
  codexKey('permission','codex-allow','willAppear',{decision:'allow'});
  await waitFor(()=>messages.some(m=>m.event==='setImage'&&m.context==='codex-allow'&&decodeURIComponent(m.payload.image).includes('No request')));
  codexKey('permission','codex-allow','keyDown',{decision:'allow'});codexKey('permission','codex-allow','keyUp',{decision:'allow'});
  await waitFor(()=>messages.some(m=>m.event==='showAlert'&&m.context==='codex-allow'));
  codexKey('session','codex-empty','willAppear',{slot:0});await waitFor(()=>messages.some(m=>m.event==='setImage'&&m.context==='codex-empty'));codexKey('session','codex-empty','keyDown',{slot:0});codexKey('session','codex-empty','keyUp',{slot:0});
  await waitFor(()=>fs.readFileSync(path.join(win,'opened.txt'),'utf8').includes('codex://threads/new'));
 }finally{clearTimeout(deadline);if(p.exitCode===null&&p.signalCode===null){const ended=once(p,'exit');p.kill();await ended;}socket?.terminate();await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('cardea-sdk-'));fs.rmSync(dir,{recursive:true,force:true});}
});

test('changed plugin files stop hook service and show a warning, while hooks fall back to no decision',{timeout:15_000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-sdk-')),appData=path.join(dir,'native-appdata'),pluginRoot=path.join(appData,'Elgato/StreamDeck/Plugins/de.cardea.deck.sdPlugin');
 fs.cpSync(path.join(root,'dist/de.cardea.deck.sdPlugin'),pluginRoot,{recursive:true,filter:source=>path.basename(source)!=='logs'});
 fs.appendFileSync(path.join(pluginRoot,'hooks/bridge.cjs'),'\n// edited after installation\n');
 const runtime=path.join(dir,'.cardeadeck');fs.mkdirSync(runtime);fs.writeFileSync(path.join(runtime,'connection.json'),'{"schema":2,"stale":true}');
 const server=new WebSocketServer({port:0,host:'127.0.0.1'});await once(server,'listening');
 const info={application:{font:'Segoe UI',language:'de',platform:'windows',platformVersion:'10',version:'7.6.0'},plugin:{uuid:'de.cardea.deck',version:'0.1.0.0'},devices:[{id:'test-device',name:'Test',size:{columns:5,rows:3},type:0}]};
 const p=spawn(process.execPath,[path.join(pluginRoot,'bin/plugin.mjs'),'-port',String(server.address().port),'-pluginUUID','de.cardea.deck','-registerEvent','registerPlugin','-info',JSON.stringify(info)],{cwd:pluginRoot,env:{...process.env,APPDATA:appData,LOCALAPPDATA:appData,USERPROFILE:dir},stdio:['ignore','pipe','pipe'],windowsHide:true});
 let stderr='',socket;const messages=[];p.stderr.on('data',b=>stderr+=b);const deadline=setTimeout(()=>p.kill(),10_000);deadline.unref();
 try{
  [socket]=await Promise.race([once(server,'connection'),once(p,'exit').then(([code])=>{throw Error('Plugin startup failed ('+code+'): '+stderr);})]);socket.on('message',b=>messages.push(JSON.parse(b)));
  const waitFor=async predicate=>{const start=Date.now();while(!predicate()){if(Date.now()-start>5000)throw Error('Timed out: '+stderr);await pause(10);}};
  await waitFor(()=>messages.some(m=>m.event==='registerPlugin'));
  const payload={controller:'Keypad',coordinates:{column:0,row:0},isInMultiAction:false,settings:{decision:'allow'},state:0};
  for(const event of ['willAppear'])socket.send(JSON.stringify({event,action:'de.cardea.deck.permission',context:'warned-key',device:'test-device',payload}));
  await waitFor(()=>messages.some(m=>m.event==='setImage'&&m.context==='warned-key'&&decodeURIComponent(m.payload.image).includes('FILES CHANGED')));
  assert.equal(fs.existsSync(path.join(runtime,'connection.json')),false,'No receiver is published and a stale one is removed');
  socket.send(JSON.stringify({event:'keyDown',action:'de.cardea.deck.permission',context:'warned-key',device:'test-device',payload}));
  await waitFor(()=>messages.some(m=>m.event==='showAlert'&&m.context==='warned-key'));
  const hook=spawn(process.execPath,[path.join(pluginRoot,'hooks/bridge.cjs'),'PermissionRequest'],{env:{...process.env,USERPROFILE:hookHome(runtime)},windowsHide:true,stdio:['pipe','pipe','pipe']});let output='';hook.stdout.on('data',b=>output+=b);const ended=once(hook,'close');hook.stdin.end(JSON.stringify({session_id:'x',tool_name:'Read',tool_input:{file_path:'C:/a'}}));
  assert.equal((await ended)[0],0);assert.equal(output,'','No decision: Claude uses its own dialog');
 }finally{clearTimeout(deadline);if(p.exitCode===null&&p.signalCode===null){const ended=once(p,'exit');p.kill();await ended;}socket?.terminate();await new Promise(resolve=>server.close(resolve));assert.ok(path.basename(dir).startsWith('cardea-sdk-'));fs.rmSync(dir,{recursive:true,force:true});}
});
