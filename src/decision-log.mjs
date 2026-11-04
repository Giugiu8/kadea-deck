// Local approval record. Only time, session, tool name and outcome: never a prompt,
// a tool input or the displayed summary. A write failure never blocks a decision.
import fs from 'node:fs';
import path from 'node:path';
export const OUTCOMES=new Set(['allow','deny','timeout','deferred','cancelled']);
const clean=(value,max)=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,'').slice(0,max):'';
export class DecisionLog{
 constructor({directory,maxBytes=256*1024,keep=3,clock=Date.now}={}){this.file=directory?path.join(directory,'decisions.jsonl'):null;this.maxBytes=maxBytes;this.keep=keep;this.clock=clock;this.ok=true;}
 rotate(incoming){
  let size=0;try{size=fs.statSync(this.file).size;}catch(error){if(error.code==='ENOENT')return;throw error;}
  if(size+incoming<=this.maxBytes)return;
  fs.rmSync(`${this.file}.${this.keep}`,{force:true});
  for(let i=this.keep-1;i>=1;i--)if(fs.existsSync(`${this.file}.${i}`))fs.renameSync(`${this.file}.${i}`,`${this.file}.${i+1}`);
  fs.renameSync(this.file,`${this.file}.1`);
 }
 record({sessionId,tool,decision,reason}){
  if(!this.file||!OUTCOMES.has(decision))return false;
  const entry={at:new Date(this.clock()).toISOString(),sessionId:clean(sessionId,160),tool:clean(tool,200),decision,...(reason?{reason:clean(reason,40)}:{})};
  const line=JSON.stringify(entry)+'\n';
  try{fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});this.rotate(Buffer.byteLength(line));fs.appendFileSync(this.file,line,{mode:0o600});this.ok=true;return true;}
  catch{this.ok=false;return false;}
 }
}
