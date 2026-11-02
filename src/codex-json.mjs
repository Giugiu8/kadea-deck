// Streaming JSON projection for the local desktop pipe. Unknown values (notably
// conversation history and tool arguments) are drained without retaining them.
// No eval, complete frame buffers, transcript objects or raw-message logging.
const scalarKeys=new Set(['id','type','method','requestId','sourceClientId','version','handledByClientId','resultType','error']);
const stateKeys=new Set(['title','hasUnreadTurn','latestTurnStartMessageId']);
const requestKeys=new Set(['requestId','id','type','kind','method','requestType','turnId','itemId','callId']);
const safeKey=k=>!['__proto__','prototype','constructor'].includes(k);
export function statePath(p){
 if(!p.length)return true;
 if(stateKeys.has(p[0]))return p.length===1;
 if(p[0]==='threadRuntimeStatus')return p.length===1||p.length===2&&['type','activeFlags'].includes(p[1])||p.length===3&&p[1]==='activeFlags'&&(typeof p[2]==='number'||/^(?:\d+|-)$/.test(p[2]));
 if(p[0]==='requests')return p.length<=2||p.length===3&&requestKeys.has(p[2])||p.length<=4&&['decisions','options','availableDecisions'].includes(p[2])||p[2]==='params'&&(p.length===3||p.length===4&&requestKeys.has(p[3])||p.length<=5&&['decisions','options','availableDecisions'].includes(p[3]));
 return false;
}
export class MetadataJson {
 constructor({maxString=4096,maxNodes=8192,onKey=null}={}){this.maxString=maxString;this.maxNodes=maxNodes;this.onKey=onKey;this.nodes=0;this.frames=[];this.mode='normal';this.token='';this.keepToken=false;this.root=undefined;this.done=false;this.escaped=false;this.unicode=0;}
 allow(p){
  if(!p.length)return true;
  if(scalarKeys.has(p[0]))return p.length===1;
  if(p[0]==='targetClientIds')return p.length<=2;
  if(p[0]==='result')return p.length===1||p.length===2&&['clientId','supportsUntrustedAppInput','applied','nextCursor','data'].includes(p[1])||p[1]==='data'&&(p.length===3||p.length===4&&['id','name','title','cwd','updatedAt','createdAt','source'].includes(p[3]));
  if(p[0]!=='params')return false;
  if(p.length===1||p.length===2&&['conversationId','hostId','change'].includes(p[1]))return true;
  if(p[1]!=='change')return false;
  if(p.length===3&&['type','revision','baseRevision','conversationState','patches'].includes(p[2]))return true;
  if(p[2]==='conversationState')return statePath(p.slice(3));
  if(p[2]==='patches'){
   if(p.length<=4)return true;
   if(['op','path','from'].includes(p[4]))return p.length===5||p.length===6&&typeof p[5]==='number';
   if(p[4]==='value'){
    const patch=this.frames.find(f=>f.path.length===4&&f.path[2]==='patches'&&f.path[3]===p[3])?.value;
    const raw=patch?.path;
    const parts=Array.isArray(raw)?raw:typeof raw==='string'&&raw.startsWith('/')?raw.slice(1).split('/').map(s=>s.replaceAll('~1','/').replaceAll('~0','~')):null;
    // A missing/out-of-order path cannot authorize retention of a patch value.
    return !!parts&&parts.every(safeKey)&&statePath([...parts,...p.slice(5)]);
   }
  }
  return false;
 }
 location(){const f=this.frames.at(-1);return f?[...f.path,f.type==='array'?f.index:f.key]:[];}
 expectValue(){const f=this.frames.at(-1);if(this.done||f&&!['value','valueOrEnd'].includes(f.expect))throw Error('json-value-order');}
 attach(value,keep){
  const f=this.frames.at(-1);
  if(!f){if(keep)this.root=value;this.done=true;return;}
  if(keep&&f.keep){if(++this.nodes>this.maxNodes)throw Error('metadata-node-limit');if(f.type==='array')f.value[f.index]=value;else if(safeKey(f.key))f.value[f.key]=value;}
  f.expect='commaOrEnd';if(f.type==='array')f.index++;
 }
 finishToken(){
  if(this.mode==='string'){
   const f=this.frames.at(-1),key=f?.type==='object'&&['key','keyOrEnd'].includes(f.expect);
   if(key){f.key=f.keep?JSON.parse('"'+this.token+'"'):'';if(f.keep)this.onKey?.(f.path,f.key);f.expect='colon';}
   else this.attach(this.keepToken?JSON.parse('"'+this.token+'"'):undefined,this.keepToken);
  }else{
   if(!/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(this.token))throw Error('json-scalar');
   const v=JSON.parse(this.token);if(typeof v==='number'&&!Number.isFinite(v))throw Error('json-number');this.attach(v,this.keepToken);
  }
  this.mode='normal';this.token='';this.keepToken=false;
 }
 write(chunk){
  for(let i=0;i<chunk.length;i++){
   const c=chunk[i];
   if(this.mode==='string'){
    if(c<' ')throw Error('json-control-character');
    if(c==='"'&&!this.escaped&&!this.unicode){this.finishToken();continue;}
    if(this.keepToken){this.token+=c;if(this.token.length>this.maxString)throw Error('metadata-string-limit');}
    if(this.unicode){if(!/[a-fA-F0-9]/.test(c))throw Error('json-unicode');this.unicode--;}
    else if(this.escaped){if(c==='u')this.unicode=4;else if(!'"\\/bfnrt'.includes(c))throw Error('json-escape');this.escaped=false;}
    else if(c==='\\')this.escaped=true;continue;
   }
   if(this.mode==='scalar'){
    if(/[ \t\r\n,\]}]/.test(c)){this.finishToken();i--;continue;}
    this.token+=c;if(this.token.length>64)throw Error('json-scalar-limit');continue;
   }
   if(/[ \t\r\n]/.test(c))continue;
   const f=this.frames.at(-1);
   if(c==='"'){
    const key=f?.type==='object'&&['key','keyOrEnd'].includes(f.expect);if(!key)this.expectValue();
    this.mode='string';this.escaped=false;this.keepToken=key?f.keep:this.allow(this.location());continue;
   }
   if(c==='{'||c==='['){
    this.expectValue();if(this.frames.length>=64)throw Error('json-depth-limit');const p=this.location(),keep=this.allow(p);
    this.frames.push({type:c==='{'?'object':'array',path:p,keep,value:keep?(c==='{'?Object.create(null):[]):undefined,expect:c==='{'?'keyOrEnd':'valueOrEnd',key:'',index:0});continue;
   }
   if(c==='}'||c===']'){
    if(!f||(c==='}')!==(f.type==='object')||!['commaOrEnd','keyOrEnd','valueOrEnd'].includes(f.expect))throw Error('json-close');
    this.frames.pop();this.attach(f.value,f.keep);continue;
   }
   if(c===':'){if(!f||f.expect!=='colon')throw Error('json-colon');f.expect='value';continue;}
   if(c===','){if(!f||f.expect!=='commaOrEnd')throw Error('json-comma');f.expect=f.type==='object'?'key':'value';continue;}
   if(/[tfn\-0-9]/.test(c)){this.expectValue();this.mode='scalar';this.token=c;this.keepToken=this.allow(this.location());continue;}
   throw Error('json-token');
  }
 }
 end(){if(this.mode==='scalar')this.finishToken();if(this.mode!=='normal'||this.frames.length||!this.done)throw Error('json-incomplete');return this.root;}
}
