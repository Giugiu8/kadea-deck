const http=require('node:http'),{randomBytes}=require('node:crypto');
const {isHexKey,verifyIdentityProof,verifyPermissionProof}=require('./permission-auth.cjs');
function validConnection(c){
 return c?.schema===2&&Number.isInteger(c.port)&&c.port>0&&c.port<=65535&&isHexKey(c.token)&&isHexKey(c.permissionKey)&&c.token!==c.permissionKey;
}
function exchange(c,agent,{route,method,headers={},body='',socket=null,timeoutMs}){
 return new Promise(resolve=>{
  let timer,settled=false,assigned;
  const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value);};
  const req=http.request({host:'127.0.0.1',port:c.port,path:route,method,agent,headers},res=>{
   let size=0,parts=[];
   res.on('data',part=>{size+=part.length;if(size>8192){finish(null);req.destroy();}else parts.push(part);});
   res.on('error',()=>finish(null));
   res.on('end',()=>finish({status:res.statusCode,headers:res.headers,body:Buffer.concat(parts).toString('utf8'),socket:assigned}));
  });
  timer=setTimeout(()=>{finish(null);req.destroy();},timeoutMs);
  req.on('error',()=>finish(null));
  req.once('socket',current=>{
   assigned=current;
   // Never reconnect with credentials after proving a different TCP socket.
   // In particular, an identity-check/crash/rebind race must send no metadata.
   if(socket&&current!==socket){finish(null);req.destroy();return;}
   req.end(body);
  });
 });
}
async function requestReceiver(c,{route,method='POST',body='',permission=false}={}){
 if(!validConnection(c))return null;
 const agent=new http.Agent({keepAlive:true,maxSockets:1}),challenge=randomBytes(32).toString('hex');
 try{
  const identity=await exchange(c,agent,{route:'/identity',method:'GET',headers:{'X-Cardea-Nonce':challenge},timeoutMs:900});
  if(!identity||identity.status!==200||identity.body!=='{}'||!verifyIdentityProof(c.permissionKey,challenge,identity.headers['x-cardea-proof']))return null;
  const nonce=permission?randomBytes(32).toString('hex'):null;
  const result=await exchange(c,agent,{route,method,body,socket:identity.socket,timeoutMs:permission?58_000:900,
   headers:{'X-Cardea-Token':c.token,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),...(permission?{'X-Cardea-Nonce':nonce}:{})}});
  if(permission&&(!result||!verifyPermissionProof(c.permissionKey,nonce,body,result.status,result.body,result.headers['x-cardea-proof'])))return null;
  return result;
 }finally{agent.destroy();}
}
module.exports={validConnection,requestReceiver};
