import net from 'node:net';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import {MetadataJson} from './codex-json.mjs';
const methods=new Set(['initialize','thread-owner-discovery','thread-follower-command-approval-decision','thread-follower-file-approval-decision','thread-follower-interrupt-turn']);
export class CodexFrames {
 constructor(onMessage,{maxFrame=128*1024*1024,metadataOptions={}}={}){this.onMessage=onMessage;this.maxFrame=maxFrame;this.metadataOptions=metadataOptions;this.header=Buffer.alloc(4);this.headerBytes=0;this.remaining=0;this.parser=null;this.maxObservedFrame=0;}
 push(bytes){
  let offset=0;
  while(offset<bytes.length){
   if(!this.remaining){const count=Math.min(4-this.headerBytes,bytes.length-offset);bytes.copy(this.header,this.headerBytes,offset,offset+count);offset+=count;this.headerBytes+=count;if(this.headerBytes<4)break;
    this.remaining=this.header.readUInt32LE();this.headerBytes=0;
    if(!this.remaining||this.remaining>this.maxFrame)throw Error('codex-frame-limit');this.maxObservedFrame=Math.max(this.maxObservedFrame,this.remaining);this.parser=new MetadataJson(this.metadataOptions);this.decoder=new StringDecoder('utf8');
   }
   const count=Math.min(this.remaining,bytes.length-offset);this.parser.write(this.decoder.write(bytes.subarray(offset,offset+count)));offset+=count;this.remaining-=count;
   if(!this.remaining){this.parser.write(this.decoder.end());const message=this.parser.end();this.parser=null;this.onMessage(message);}
  }
 }
}
export class CodexPipe extends EventEmitter {
 constructor({connect=()=>net.createConnection('\\\\.\\pipe\\codex-ipc'),timeout=5000}={}){super();this.connectSocket=connect;this.timeout=timeout;this.clientId='initializing-client';this.pending=new Map();this.connected=false;this.generation=0;this.disposed=false;}
 start(){
  if(this.socket||this.disposed)return;this.generation++;const generation=this.generation,socket=this.connectSocket();this.socket=socket;this.frames=new CodexFrames(m=>this.message(m));
  const fail=()=>{if(this.socket!==socket)return;socket.destroy();this.socket=null;this.connected=false;this.clientId='initializing-client';for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('codex-disconnected'));}this.pending.clear();this.emit('connection',false);if(!this.disposed)this.retry=setTimeout(()=>this.start(),5000).unref();};
  socket.on('error',fail);socket.on('close',fail);
  socket.on('data',data=>{try{this.frames.push(data);}catch{this.emit('fault','protocol');fail();}});
  socket.on('connect',async()=>{try{const m=await this.request('initialize',0,{clientType:'codex-stream-deck'});if(this.generation!==generation||m.resultType!=='success'||!m.result?.clientId)throw Error('codex-init');this.clientId=m.result.clientId;this.connected=true;this.emit('connection',true);}catch{fail();}});
 }
 send(envelope){if(!this.socket?.writable)throw Error('codex-unavailable');const bytes=Buffer.from(JSON.stringify(envelope));if(bytes.length>8192)throw Error('codex-write-limit');const header=Buffer.alloc(4);header.writeUInt32LE(bytes.length);this.socket.write(Buffer.concat([header,bytes]));}
 request(method,version,params,{target=null,beforeWrite=null}={}){
  if(!methods.has(method)||this.pending.size>=16)return Promise.reject(Error('codex-method'));
  return new Promise((resolve,reject)=>{const id=randomUUID();const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('codex-timeout'));},this.timeout).unref();this.pending.set(id,{resolve,reject,timer,method,target});
   try{if(beforeWrite&&!beforeWrite())throw Error('codex-target-changed');this.send({type:'request',requestId:id,sourceClientId:this.clientId,version,method,params,timeoutMs:this.timeout,...target?{targetClientId:target}:{}});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}
  });
 }
 following(task,owner,following=true){this.send({type:'broadcast',sourceClientId:this.clientId,version:1,method:'thread-stream-following-changed',targetClientIds:[owner],params:{conversationId:task.id,hostId:task.hostId,following}});}
 message(m){
  if(m.type==='response'){
   const p=this.pending.get(m.requestId);if(!p)return;clearTimeout(p.timer);this.pending.delete(m.requestId);
   const routingError=m.resultType==='error'&&['request-version-mismatch','no-handler-for-request','no-client-found','no-client-found: thread stream owner became unavailable'].includes(m.error);
   if(m.method!=null&&m.method!==p.method||p.target&&m.handledByClientId!==p.target&&!(m.handledByClientId==null&&routingError)){this.emit('fault',{methodMismatch:m.method!=null&&m.method!==p.method,peerMissing:m.handledByClientId==null,peerMismatch:m.handledByClientId!=null&&m.handledByClientId!==p.target});p.reject(Error('codex-correlation'));return;}p.resolve(m);return;
  }
  if(m.type==='client-discovery-request'){this.send({type:'client-discovery-response',requestId:m.requestId,response:{canHandle:false}});return;}
  if(m.type==='broadcast'&&(!m.targetClientIds||m.targetClientIds.includes(this.clientId)))this.emit('broadcast',m);
 }
 close(){this.disposed=true;clearTimeout(this.retry);this.socket?.destroy();}
}
