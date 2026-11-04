import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {DeckStore} from '../src/store.mjs';
import {startReceiver} from '../src/receiver.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
async function diagnose(home,powershell=false){
 const command=powershell?'powershell.exe':process.execPath;
 const args=powershell?['-NoProfile','-NonInteractive','-File',path.join(root,'Doctor.ps1')]:[path.join(root,'doctor.mjs')];
 const child=spawn(command,args,{env:{...process.env,USERPROFILE:home,APPDATA:path.join(home,'AppData/Roaming')},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 const [code]=await once(child,'close');assert.equal(code,0,stderr);assert.equal(stderr,'');return{value:JSON.parse(stdout),text:stdout};
}
test('Node and PowerShell diagnostics authenticate the receiver and never print keys',{timeout:45_000},async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-doctor-')),runtime=path.join(directory,'.cardeadeck');
 const receiver=await startReceiver(new DeckStore(),{directory:runtime});let substitute,closed=false;
 try{
  const connection=fs.readFileSync(path.join(runtime,'connection.json'),'utf8'),saved=JSON.parse(connection);
  for(const powershell of [false,true]){
   const result=await diagnose(directory,powershell);assert.equal(result.value.receiverAuthenticated,true);assert.equal(result.value.receiverHealthy,true);
   assert.ok(!result.text.includes(saved.token)&&!result.text.includes(saved.permissionKey));
  }
  await receiver.close();closed=true;fs.writeFileSync(path.join(runtime,'connection.json'),connection);
  let requests=0;
  substitute=http.createServer((req,res)=>{requests++;assert.equal(req.url,'/identity');assert.equal(req.headers['x-cardea-token'],undefined);req.resume();res.end('{}');});
  await new Promise(resolve=>substitute.listen(saved.port,'127.0.0.1',resolve));
  for(const powershell of [false,true]){
   const result=await diagnose(directory,powershell);assert.equal(result.value.receiverHealthy,false);assert.equal(result.value.receiverAuthenticated,false);
   assert.ok(!result.text.includes(saved.token)&&!result.text.includes(saved.permissionKey));
  }
  assert.equal(requests,2);
 }finally{
  if(!closed)await receiver.close();if(substitute)await new Promise(resolve=>substitute.close(resolve));
  assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('cardea-doctor-'));fs.rmSync(directory,{recursive:true,force:true});
 }
});
