import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createHmac,randomBytes} from 'node:crypto';
import {DeckStore} from '../src/store.mjs';
import {startReceiver} from '../src/receiver.mjs';

const bridge=fileURLToPath(new URL('../hooks/bridge.cjs',import.meta.url));
const allow=JSON.stringify({hookSpecificOutput:{hookEventName:'PermissionRequest',decision:{behavior:'allow'}}});
async function hook(home,executable=bridge,event='PermissionRequest'){
 const child=spawn(process.execPath,[executable,event],{env:{...process.env,CARDEA_DECK_HOME:home},windowsHide:true,stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 const ended=once(child,'close');child.stdin.end(JSON.stringify({session_id:'isolated-approval',tool_name:'Read',cwd:'C:\\Prüfung-🛡',rate_limits:{five_hour:{used_percentage:10,resets_at:2000000000}}}));
 const [code]=await ended;return{code,stdout,stderr};
}
function removeFixture(directory){
 assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));
 assert.ok(path.basename(directory).startsWith('cardea-permission-'));
 fs.rmSync(directory,{recursive:true,force:true});
}

test('a process taking over the port after a receiver crash cannot forge a hook approval',{timeout:10_000},async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-permission-'));
 // A real receiver subprocess is killed without cleanup, leaving its genuine
 // connection file behind. The substitute knows only what arrives over HTTP.
 const source=`import {DeckStore} from ${JSON.stringify(new URL('../src/store.mjs',import.meta.url).href)};
 import {startReceiver} from ${JSON.stringify(new URL('../src/receiver.mjs',import.meta.url).href)};
 await startReceiver(new DeckStore(),{directory:process.argv[1]});process.send('ready');`;
 const child=spawn(process.execPath,['--input-type=module','--eval',source,directory],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
 let substitute;
 try{
  await once(child,'message');
  const connection=JSON.parse(fs.readFileSync(path.join(directory,'connection.json'),'utf8'));
  const ended=once(child,'exit');child.kill();await ended;
  let requests=0;
  substitute=http.createServer((req,res)=>{requests++;assert.equal(req.url,'/identity');assert.equal(req.headers['x-cardea-token'],undefined);req.resume();res.setHeader('Content-Type','application/json');res.end(allow);});
  await new Promise((resolve,reject)=>{substitute.once('error',reject);substitute.listen(connection.port,'127.0.0.1',resolve);});
  const result=await hook(directory);
  assert.equal(requests,1,'The stale port was actually reached');
  assert.deepEqual(result,{code:0,stdout:'',stderr:''},'An unverified receiver must never output allow to Claude');
 }finally{
  if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill();await ended;}
  if(substitute)await new Promise(resolve=>substitute.close(resolve));
  removeFixture(directory);
 }
});

// Independent implementation of the wire contract; do not use the production
// signing helper to generate expectations for the client-verification tests.
const sign=(key,nonce,request,status,response)=>createHmac('sha256',Buffer.from(key,'hex'))
 .update(JSON.stringify(['cardea-permission-response-v1',nonce,request,status,response])).digest('hex');
const identify=(key,nonce)=>createHmac('sha256',Buffer.from(key,'hex')).update(JSON.stringify(['cardea-receiver-identity-v1',nonce])).digest('hex');
for(const [label,executable]of [
 ['source',bridge],
 ['built',fileURLToPath(new URL('../dist/de.cardea.deck.sdPlugin/hooks/bridge.cjs',import.meta.url))]
]){
 test(`${label} hook authenticates permission replies and rejects forgery/replay`,{timeout:15_000},async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-permission-'));
  const token=randomBytes(32).toString('hex'),permissionKey=randomBytes(32).toString('hex');
  let reply,identityReply,priorIdentityProof,requests=0,posts=0;const nonces=new Set();
  const server=http.createServer(async(req,res)=>{
   const parts=[];for await(const part of req)parts.push(part);
   const body=Buffer.concat(parts).toString('utf8'),nonce=req.headers['x-cardea-nonce'];requests++;
   assert.ok(!JSON.stringify(req.headers).includes(permissionKey)&&!body.includes(permissionKey),'Response key never crosses the socket');
   assert.match(nonce,/^[a-f0-9]{64}$/);assert.ok(!nonces.has(nonce),'Each hook invocation has a fresh challenge');nonces.add(nonce);
   if(req.url==='/identity'){assert.equal(req.headers['x-cardea-token'],undefined);assert.equal(body,'');if(identityReply){identityReply({req,res,body,nonce});return;}priorIdentityProof=identify(permissionKey,nonce);res.setHeader('X-Cardea-Proof',priorIdentityProof);res.end('{}');return;}
   posts++;
   reply({req,res,body,nonce});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const connection={schema:2,port:server.address().port,token,permissionKey};
  const save=value=>fs.writeFileSync(path.join(directory,'connection.json'),JSON.stringify(value));save(connection);
  const accept={code:0,stdout:allow,stderr:''},reject={code:0,stdout:'',stderr:''};
  let priorProof;
  try{
   await t.test('valid receiver proof permits only this signed request',async()=>{
    reply=({res,body,nonce})=>{priorProof=sign(permissionKey,nonce,body,200,allow);res.setHeader('X-Cardea-Proof',priorProof);res.end(allow);};
    assert.deepEqual(await hook(directory,executable),accept);
   });
   const cases=[
    ['missing proof',()=>null],
    ['bearer token used as signing key',({nonce,body})=>sign(token,nonce,body,200,allow)],
    ['unrelated signing key',({nonce,body})=>sign('ff'.repeat(32),nonce,body,200,allow)],
    ['proof replayed from an earlier request',()=>priorProof],
    ['wrong challenge',({body})=>sign(permissionKey,'00'.repeat(32),body,200,allow)],
    ['different request metadata',({nonce})=>sign(permissionKey,nonce,'{}',200,allow)],
    ['modified decision',({nonce,body})=>sign(permissionKey,nonce,body,200,allow.replace('allow','deny'))],
    ['modified HTTP status',({nonce,body})=>sign(permissionKey,nonce,body,201,allow)],
    ['uppercase proof',({nonce,body})=>sign(permissionKey,nonce,body,200,allow).toUpperCase()],
    ['duplicate proof',({nonce,body})=>[sign(permissionKey,nonce,body,200,allow),sign(permissionKey,nonce,body,200,allow)]],
    ['malformed proof',()=> 'é'.repeat(64)]
   ];
   for(const [name,proof]of cases)await t.test(name,async()=>{
    reply=context=>{const value=proof(context);if(value)context.res.setHeader('X-Cardea-Proof',value);context.res.end(allow);};
    assert.deepEqual(await hook(directory,executable),reject);
   });
   await t.test('legacy or malformed connection key never downgrades to unsigned transport',async()=>{
    const before=requests;
    for(const key of [undefined,null,token.slice(1),'é'.repeat(64)]){save({...connection,permissionKey:key});assert.deepEqual(await hook(directory,executable),reject);}
    save({...connection,schema:1});assert.deepEqual(await hook(directory,executable),reject);
    assert.equal(requests,before);save(connection);
   });
   await t.test('a valid proof cannot turn an HTTP error into a decision',async()=>{
    reply=({res,body,nonce})=>{res.statusCode=403;res.setHeader('X-Cardea-Proof',sign(permissionKey,nonce,body,403,allow));res.end(allow);};
    assert.deepEqual(await hook(directory,executable),reject);
   });
   await t.test('oversized signed responses produce no decision',async()=>{
    reply=({res,body,nonce})=>{const response=allow.slice(0,-1)+',"padding":"'+'x'.repeat(8192)+'"}';res.setHeader('X-Cardea-Proof',sign(permissionKey,nonce,body,200,response));res.end(response);};
    assert.deepEqual(await hook(directory,executable),reject);
   });
   await t.test('chunked UTF-8 is verified after complete byte assembly',async()=>{
    const response=JSON.stringify({hookSpecificOutput:{hookEventName:'PermissionRequest',decision:{behavior:'deny',message:'Prüfung'}}});
    reply=({res,body,nonce})=>{res.setHeader('X-Cardea-Proof',sign(permissionKey,nonce,body,200,response));const bytes=Buffer.from(response),split=bytes.indexOf(Buffer.from('ü'))+1;res.write(bytes.subarray(0,split));setTimeout(()=>res.end(bytes.subarray(split)),10);};
    assert.deepEqual(await hook(directory,executable),{code:0,stdout:response,stderr:''});
   });
   await t.test('unverified identity receives no permission, event or quota metadata',async()=>{
    const before=posts;
    for(const proof of [()=>null,({nonce})=>identify(token,nonce),()=>priorIdentityProof,()=> 'ab'.repeat(32)]){
     identityReply=context=>{const value=proof(context);if(value)context.res.setHeader('X-Cardea-Proof',value);context.res.end('{}');};
     for(const event of ['PermissionRequest','UserPromptSubmit','Quota'])assert.deepEqual(await hook(directory,executable,event),reject);
    }
    assert.equal(posts,before);identityReply=null;
   });
   await t.test('closing a proven identity socket cannot reconnect with credentials',async()=>{
    const before=posts;
    identityReply=({res,nonce})=>{res.setHeader('X-Cardea-Proof',identify(permissionKey,nonce));res.setHeader('Connection','close');res.end('{}');};
    assert.deepEqual(await hook(directory,executable),reject);assert.equal(posts,before);identityReply=null;
   });
   await t.test('identity proof has a fixed deadline even for a trickling peer',async()=>{
    const before=posts,start=Date.now();
    identityReply=({res,nonce})=>{res.setHeader('X-Cardea-Proof',identify(permissionKey,nonce));res.write('{');const timer=setInterval(()=>res.write(' '),40);res.once('close',()=>clearInterval(timer));};
    assert.deepEqual(await hook(directory,executable),reject);assert.ok(Date.now()-start<4000);assert.equal(posts,before);identityReply=null;
   });
  }finally{await new Promise(resolve=>server.close(resolve));removeFixture(directory);}
 });
}

test('receiver rejects missing challenges before creating pending permissions and rotates its proof key',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-permission-'));
 const store=new DeckStore();let receiver;
 try{
  receiver=await startReceiver(store,{directory});
  const first=JSON.parse(fs.readFileSync(path.join(directory,'connection.json'),'utf8'));
  assert.ok(first.permissionKey!==first.token);assert.match(first.permissionKey,/^[a-f0-9]{64}$/);
  for(const nonce of [undefined,'x']){
   const response=await fetch(`http://127.0.0.1:${first.port}/permission`,{method:'POST',headers:{'X-Cardea-Token':first.token,...(nonce?{'X-Cardea-Nonce':nonce}:{})},body:JSON.stringify({event:'PermissionRequest',sessionId:'invalid',eventId:'invalid',at:Date.now()})});
   assert.equal(response.status,400);
  }
  assert.equal(store.sessions.size,0);assert.equal(receiver.broker.pending.size,0);
  await receiver.close();receiver=await startReceiver(store,{directory});
  const next=JSON.parse(fs.readFileSync(path.join(directory,'connection.json'),'utf8'));
  assert.ok(first.permissionKey!==next.permissionKey&&next.permissionKey!==next.token);
 }finally{await receiver?.close();removeFixture(directory);}
});

test('a missing packaged auth helper is a silent no-decision outcome',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-permission-'));
 try{
  for(const name of ['bridge.cjs','runtime.cjs','receiver-client.cjs'])fs.copyFileSync(fileURLToPath(new URL('../hooks/'+name,import.meta.url)),path.join(directory,name));
  assert.deepEqual(await hook(directory,path.join(directory,'bridge.cjs')),{code:0,stdout:'',stderr:''});
 }finally{removeFixture(directory);}
});

test('cleanup cannot remove a newer receiver connection',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-permission-'));
 const first=await startReceiver(new DeckStore(),{directory}),next=await startReceiver(new DeckStore(),{directory});
 try{
  first.removeConnection();assert.ok(fs.existsSync(path.join(directory,'connection.json')));
  const saved=JSON.parse(fs.readFileSync(path.join(directory,'connection.json'),'utf8'));assert.ok(saved.token===next.token);
 }finally{await first.close();await next.close();assert.equal(fs.existsSync(path.join(directory,'connection.json')),false);removeFixture(directory);}
});
