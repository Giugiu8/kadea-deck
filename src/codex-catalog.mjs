import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {StringDecoder} from 'node:string_decoder';
import {MetadataJson} from './codex-json.mjs';
export class CodexCatalog extends EventEmitter {
 constructor(executable,{spawnProcess=spawn}={}){super();this.executable=executable;this.spawn=spawnProcess;this.pending=new Map();this.sequence=0;}
 async start(){
  if(this.process)return;
  const child=this.spawn(this.executable,['app-server'],{windowsHide:true,stdio:['pipe','pipe','ignore']});this.process=child;let parser=new MetadataJson(),length=0;const decoder=new StringDecoder('utf8');
  const lost=()=>{if(this.process!==child)return;this.process=null;child.kill();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('codex-catalog-unavailable'));}this.pending.clear();this.emit('connection',false);};
  child.on('error',lost);child.on('close',lost);
  child.stdout.on('data',bytes=>{
   try{for(const piece of decoder.write(bytes).split(/(?<=\n)/)){
    length+=Buffer.byteLength(piece);if(length>4*1024*1024)throw Error('codex-catalog-limit');
    parser.write(piece);if(piece.endsWith('\n')){const m=parser.end();parser=new MetadataJson();length=0;const p=this.pending.get(m.id);if(p){clearTimeout(p.timer);this.pending.delete(m.id);p.resolve(m);}}
   }}catch{lost();}
  });
  try{const init=await this.request('initialize',{clientInfo:{name:'kadea-deck',version:'0.6.0'},capabilities:{experimentalApi:true}});
   if(init.error)throw Error('codex-catalog-initialize');this.process?.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  }catch(error){lost();throw error;}
 }
 request(method,params){
  if(!['initialize','thread/list'].includes(method))return Promise.reject(Error('codex-catalog-method'));
  return new Promise((resolve,reject)=>{const id=++this.sequence,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('codex-catalog-timeout'));},10_000).unref();this.pending.set(id,{resolve,reject,timer});
   if(!this.process?.stdin.writable){clearTimeout(timer);this.pending.delete(id);reject(Error('codex-catalog-unavailable'));return;}
   this.process.stdin.write(JSON.stringify({id,method,params})+'\n');
  });
 }
 async list(){await this.start();const response=await this.request('thread/list',{archived:false,limit:12,sortKey:'updated_at',sortDirection:'desc'});if(response.error||!Array.isArray(response.result?.data))throw Error('codex-catalog-invalid');
  return response.result.data.filter(x=>typeof x.id==='string'&&/^[a-zA-Z0-9_-]{1,180}$/.test(x.id)).map(x=>({id:x.id,hostId:'local',title:x.name||x.title||'Unbenannt',project:typeof x.cwd==='string'?x.cwd.split(/[\\/]/).filter(Boolean).at(-1):'Codex',updatedAt:x.updatedAt}));
 }
 close(){this.process?.kill();}
}
