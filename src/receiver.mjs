import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes,timingSafeEqual } from 'node:crypto';
import { PermissionBroker } from './broker.mjs';
import permissionAuth from '../hooks/permission-auth.cjs';
const {isHexKey,permissionProof,identityProof}=permissionAuth;
export async function startReceiver(store,{directory,timeoutMs,getDiagnostics=()=>({})}={}){
  const token=randomBytes(32).toString('hex'),permissionKey=randomBytes(32).toString('hex'),broker=new PermissionBroker(store,{timeoutMs});
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
    if(req.url==='/health'&&req.method==='GET'){res.end('{"app":"Cardea Deck","schema":1}');return;}
    if(req.url==='/identity'&&req.method==='GET'){
      const challenge=req.headers['x-cardea-nonce'];
      if(req.headers.origin||!isHexKey(challenge)){res.writeHead(400).end('{}');return;}
      res.setHeader('X-Cardea-Proof',identityProof(permissionKey,challenge));res.end('{}');return;
    }
    const key=req.headers['x-cardea-token'];
    if(req.headers.origin||typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key)||!timingSafeEqual(Buffer.from(key),Buffer.from(token))){res.writeHead(403).end('{}');return;}
    if(req.url==='/status'&&req.method==='GET'){res.end(JSON.stringify({schema:1,sourceHasEvents:store.connected,sessionCount:store.sessions.size,pendingRequests:broker.pending.size,persistenceOk:!store.persistenceError,...getDiagnostics()}));return;}
    if(req.method!=='POST'||!['/event','/permission','/quota'].includes(req.url)){res.writeHead(404).end('{}');return;}
    const nonce=req.headers['x-cardea-nonce'];
    if(req.url==='/permission'&&!isHexKey(nonce)){res.writeHead(400).end('{}');return;}
    let size=0,parts=[];
    try{
      for await(const part of req){size+=part.length;if(size>64*1024){res.writeHead(413).end('{}');req.destroy();return;}parts.push(part);}
      const requestBody=Buffer.concat(parts).toString('utf8'),data=JSON.parse(requestBody);
      if(req.url==='/quota'){res.writeHead(store.setQuota(data)?200:422).end('{}');return;}
      if(req.url==='/permission'&&data.event!=='PermissionRequest'){res.writeHead(422).end('{}');return;}
      const accepted=store.event(data);
      if(!accepted){res.writeHead(422).end('{}');return;}
      if(req.url==='/permission'){broker.hold(data.sessionId,res,answer=>{
        const body=JSON.stringify(answer);
        res.setHeader('X-Cardea-Proof',permissionProof(permissionKey,nonce,requestBody,200,body));
        res.end(body);
      });return;}
      res.end('{}');
    }catch{if(!res.writableEnded)res.writeHead(400).end('{}');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  if(directory){fs.mkdirSync(directory,{recursive:true,mode:0o700});fs.writeFileSync(path.join(directory,'connection.json'),JSON.stringify({schema:2,port,token,permissionKey,pid:process.pid}),{mode:0o600});}
  function removeConnection(){if(directory){const f=path.join(directory,'connection.json');try{const saved=JSON.parse(fs.readFileSync(f,'utf8'));if(saved.token===token)fs.unlinkSync(f);}catch{}}}
  return {port,token,broker,removeConnection,async close(){broker.close();removeConnection();await new Promise(resolve=>server.close(resolve));}};
}
