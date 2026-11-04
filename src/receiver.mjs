import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes,timingSafeEqual } from 'node:crypto';
import { PermissionBroker } from './broker.mjs';
import { evaluateRequest,loadPolicy } from './approval-policy.mjs';
import { DecisionLog } from './decision-log.mjs';
import permissionAuth from '../hooks/permission-auth.cjs';
import { restrictDirectory,restrictFile } from '../windows-acl.mjs';
const {isHexKey,permissionProof,identityProof}=permissionAuth;
export async function startReceiver(store,{directory,timeoutMs,getDiagnostics=()=>({}),acl={restrictDirectory,restrictFile},holdable=()=>true,policy=()=>loadPolicy({directory}),log=new DecisionLog({directory})}={}){
  const token=randomBytes(32).toString('hex'),permissionKey=randomBytes(32).toString('hex'),broker=new PermissionBroker(store,{timeoutMs,log,authorize:request=>evaluateRequest(policy(),request.logTool,request.summary).approvable});
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
    if(req.headers.origin){res.writeHead(403).end('{}');return;}
    if(req.url==='/health'&&req.method==='GET'){res.end('{"app":"Cardea Deck","schema":1}');return;}
    if(req.url==='/identity'&&req.method==='GET'){
      const challenge=req.headers['x-cardea-nonce'];
      if(!isHexKey(challenge)){res.writeHead(400).end('{}');return;}
      res.setHeader('X-Cardea-Proof',identityProof(permissionKey,challenge));res.end('{}');return;
    }
    const key=req.headers['x-cardea-token'];
    if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key)||!timingSafeEqual(Buffer.from(key),Buffer.from(token))){res.writeHead(403).end('{}');return;}
    if(req.url==='/status'&&req.method==='GET'){res.end(JSON.stringify({schema:1,sourceHasEvents:store.connected,sessionCount:store.sessions.size,pendingRequests:broker.pending.size,persistenceOk:!store.persistenceError,decisionLogOk:log.ok,approvalsEnabled:policy().enabled===true,...getDiagnostics()}));return;}
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
      if(req.url==='/permission'){
        const send=answer=>{
          const body=JSON.stringify(answer);
          res.setHeader('X-Cardea-Proof',permissionProof(permissionKey,nonce,requestBody,200,body));
          res.end(body);
        };
        const tool=typeof data.tool==='string'?data.tool.slice(0,201):'',decided=evaluateRequest(policy(),tool,data.summary),verdict=decided.approvable&&!holdable(data.sessionId)?{approvable:false,reason:'no_key_shown'}:decided;
        // Not answerable by key: no decision at once, so Claude opens its normal dialog.
        if(!verdict.approvable){log.record({sessionId:data.sessionId,tool,decision:'deferred',reason:verdict.reason});send({});return;}
        broker.hold(data.sessionId,res,send,{tool,summary:data.summary});return;
      }
      res.end('{}');
    }catch{if(!res.writableEnded)res.writeHead(400).end('{}');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  if(directory){
    // The keys are published only once Windows confirms that nobody else can read them.
    const file=path.join(directory,'connection.json'),temp=`${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    try{
      fs.mkdirSync(directory,{recursive:true,mode:0o700});acl.restrictDirectory(directory);
      fs.writeFileSync(temp,'',{mode:0o600,flag:'wx'});acl.restrictFile(temp);
      fs.writeFileSync(temp,JSON.stringify({schema:2,port,token,permissionKey,pid:process.pid}));fs.renameSync(temp,file);
    }catch(error){
      fs.rmSync(temp,{force:true});broker.close();await new Promise(resolve=>server.close(resolve));
      throw Object.assign(Error('acl_failed'),{cause:error});
    }
  }
  function removeConnection(){if(directory){const f=path.join(directory,'connection.json');try{const saved=JSON.parse(fs.readFileSync(f,'utf8'));if(saved.token===token)fs.unlinkSync(f);}catch{}}}
  return {port,token,broker,log,policy,removeConnection,async close(){broker.close();removeConnection();await new Promise(resolve=>server.close(resolve));}};
}
