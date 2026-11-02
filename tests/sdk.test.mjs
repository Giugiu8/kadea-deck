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
test('built plugin registers with the real SDK and renders live receiver events through the socket',{timeout:12_000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kadea-sdk-'));
 const pluginRoot=path.join(dir,'test.sdPlugin'),bin=path.join(pluginRoot,'bin');fs.mkdirSync(bin,{recursive:true});
 for(const name of ['manifest.json','package.json'])fs.copyFileSync(path.join(root,'dist/de.cardea.kadeadeck.sdPlugin',name),path.join(pluginRoot,name));
 fs.copyFileSync(path.join(root,'dist/de.cardea.kadeadeck.sdPlugin/bin/plugin.mjs'),path.join(bin,'plugin.mjs'));
 // Test-only opener records the route instead of launching an application.
 const helperSource=path.join(dir,'capture.cs');fs.writeFileSync(helperSource,'using System; using System.IO; class Capture { static int Main(string[] args) { File.AppendAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"opened.txt"),String.Join("|",args)+"\\n"); return 0; } }');
 execFileSync(path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/target:winexe',`/out:${path.join(bin,'open.exe')}`,helperSource],{windowsHide:true});
 const server=new WebSocketServer({port:0,host:'127.0.0.1'});await once(server,'listening');
 const info={application:{font:'Segoe UI',language:'de',platform:'windows',platformVersion:'10',version:'7.6.0'},plugin:{uuid:'de.cardea.kadeadeck',version:'0.1.0.0'},devices:[{id:'test-device',name:'Test',size:{columns:5,rows:3},type:0}]};
 const p=spawn(process.execPath,[path.join(bin,'plugin.mjs'),'-port',String(server.address().port),'-pluginUUID','de.cardea.kadeadeck','-registerEvent','registerPlugin','-info',JSON.stringify(info)],{cwd:pluginRoot,env:{...process.env,LOCALAPPDATA:path.join(dir,'native-appdata'),USERPROFILE:dir,KADEA_DECK_HOME:''},stdio:['ignore','pipe','pipe'],windowsHide:true});
 let stderr='',socket;const messages=[];p.stderr.on('data',b=>stderr+=b);
 const deadline=setTimeout(()=>p.kill(),7000);deadline.unref();
 try{
  [socket]=await Promise.race([once(server,'connection'),once(p,'exit').then(([code])=>{throw Error(`Plugin startup failed (${code}): ${stderr}`);})]);socket.on('message',b=>messages.push(JSON.parse(b)));
  const waitFor=async predicate=>{const start=Date.now();while(!(await predicate())){if(p.exitCode!==null)throw Error(`Plugin exited: ${stderr}`);if(Date.now()-start>4000)throw Error(`Timed out waiting for SDK event: ${stderr}`);await new Promise(r=>setTimeout(r,10));}};
  await waitFor(()=>messages.some(m=>m.event==='registerPlugin'));
  socket.send(JSON.stringify({event:'willAppear',action:'de.cardea.kadeadeck.session',context:'test-key',device:'test-device',payload:{controller:'Keypad',coordinates:{column:0,row:0},isInMultiAction:false,settings:{slot:0},state:0}}));
  await waitFor(()=>messages.some(m=>m.event==='setImage'));
  const c=JSON.parse(fs.readFileSync(path.join(dir,'.kadeadeck/connection.json'),'utf8'));
  const result=await fetch(`http://127.0.0.1:${c.port}/event`,{method:'POST',headers:{'X-Kadea-Token':c.token},body:JSON.stringify({event:'UserPromptSubmit',sessionId:'sdk-fixture',eventId:'sdk-event',at:Date.now(),cwd:'G:\\TestProject'})});
  assert.equal(result.status,200);
  await waitFor(()=>messages.filter(m=>m.event==='setImage').some(m=>decodeURIComponent(m.payload.image).includes('TestProject')));
  // Showing/selecting a card never emits an approval or a native application launch.
  assert.ok(!messages.some(m=>m.event==='openUrl'));
  const headers={'X-Kadea-Token':c.token},base=`http://127.0.0.1:${c.port}`;
  const sessionKey=(context,slot,event)=>socket.send(JSON.stringify({event,action:'de.cardea.kadeadeck.session',context,device:'test-device',payload:{controller:'Keypad',coordinates:{column:slot,row:0},isInMultiAction:false,settings:{slot},state:0}}));
  const press=(context,slot)=>{for(const event of ['keyDown','keyUp'])sessionKey(context,slot,event);};
  socket.send(JSON.stringify({event:'willAppear',action:'de.cardea.kadeadeck.session',context:'empty-key',device:'test-device',payload:{controller:'Keypad',coordinates:{column:1,row:0},isInMultiAction:false,settings:{slot:1},state:0}}));
  await waitFor(()=>messages.some(m=>m.event==='setImage'&&m.context==='empty-key'&&decodeURIComponent(m.payload.image).includes('Neuer Chat')));
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
  assert.equal(fs.readFileSync(path.join(bin,'opened.txt'),'utf8'),'claude://code/new?source=desktop_action\n');
  // A real chat without a desktop link still reports unavailability. The fix
  // must not suppress alerts for actual failed navigation attempts.
  press('test-key',0);
  await waitFor(()=>messages.some(m=>m.event==='showAlert'&&m.context==='test-key'));
  const post=(route,event,extra={})=>fetch(base+route,{method:'POST',headers,body:JSON.stringify({event,sessionId:'sdk-fixture',eventId:`sdk-${++seq}`,at:Date.now(),cwd:'G:\\TestProject',...extra})});let seq=0;
  socket.send(JSON.stringify({event:'willAppear',action:'de.cardea.kadeadeck.permission',context:'approve-key',device:'test-device',payload:{controller:'Keypad',coordinates:{column:1,row:0},isInMultiAction:false,settings:{decision:'allow'},state:0}}));
  const first=post('/permission','PermissionRequest',{tool:'Bash'});
  await waitFor(()=>messages.some(m=>m.event==='setImage'&&m.context==='approve-key'&&decodeURIComponent(m.payload.image).includes('Bash')));
  const key=event=>socket.send(JSON.stringify({event,action:'de.cardea.kadeadeck.permission',context:'approve-key',device:'test-device',payload:{controller:'Keypad',coordinates:{column:1,row:0},isInMultiAction:false,settings:{decision:'allow'},state:0}}));
  key('keyDown');await new Promise(r=>setTimeout(r,15));
  await post('/event','UserPromptSubmit');assert.deepEqual(await(await first).json(),{});
  const next=post('/permission','PermissionRequest',{tool:'Read'});
  await waitFor(()=>messages.some(m=>m.event==='setImage'&&m.context==='approve-key'&&decodeURIComponent(m.payload.image).includes('Read')));
  key('keyUp');await waitFor(()=>messages.some(m=>m.event==='showAlert'&&m.context==='approve-key'));
  assert.equal((await(await fetch(base+'/status',{headers})).json()).pendingRequests,1);
  key('keyDown');key('keyUp');assert.equal((await(await next).json()).hookSpecificOutput.decision.behavior,'allow');
  // Without a configured Codex source, its permission key must fail closed;
  // an empty chat key may still open only the fixed new-composer route.
  const codexKey=(kind,context,event,settings={})=>socket.send(JSON.stringify({event,action:`de.cardea.kadeadeck.codex-${kind}`,context,device:'test-device',payload:{controller:'Keypad',coordinates:{column:0,row:1},isInMultiAction:false,settings,state:0}}));
  codexKey('permission','codex-allow','willAppear',{decision:'allow'});
  await waitFor(()=>messages.some(m=>m.event==='setImage'&&m.context==='codex-allow'&&decodeURIComponent(m.payload.image).includes('Keine Anfrage')));
  codexKey('permission','codex-allow','keyDown',{decision:'allow'});codexKey('permission','codex-allow','keyUp',{decision:'allow'});
  await waitFor(()=>messages.some(m=>m.event==='showAlert'&&m.context==='codex-allow'));
  codexKey('session','codex-empty','willAppear',{slot:0});await waitFor(()=>messages.some(m=>m.event==='setImage'&&m.context==='codex-empty'));codexKey('session','codex-empty','keyDown',{slot:0});codexKey('session','codex-empty','keyUp',{slot:0});
  await waitFor(()=>fs.readFileSync(path.join(bin,'opened.txt'),'utf8').includes('codex://threads/new'));
 }finally{clearTimeout(deadline);if(p.exitCode===null){p.kill();await once(p,'exit');}socket?.terminate();await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('kadea-sdk-'));fs.rmSync(dir,{recursive:true,force:true});}
});
