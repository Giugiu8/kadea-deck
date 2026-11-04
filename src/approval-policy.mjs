// Decides which pending Claude requests a Stream Deck key may answer at all.
// Everything else returns no decision, so Claude shows its normal dialog.
import fs from 'node:fs';
import path from 'node:path';
export const DEFAULT_ALLOWLIST=Object.freeze(['Read','Grep','Glob','LS']);
// Never answerable by key, even if a configuration lists them.
export const RISKY_TOOLS=new Set(['Bash','BashOutput','KillShell','KillBash','PowerShell','Write','Edit','MultiEdit','NotebookEdit','WebFetch','WebSearch','Task','Agent','Skill','SlashCommand']);
const validName=value=>typeof value==='string'&&/^[A-Za-z0-9_.-]{1,200}$/.test(value);
const CONFIG='config.json';
export const machinePolicyFile=(env=process.env)=>path.join(env.ProgramData||'C:\ProgramData','CardeaDeck','policy.json');
function readJson(file){try{const stat=fs.statSync(file);if(stat.size>64*1024)return null;const value=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));return value&&typeof value==='object'&&!Array.isArray(value)?value:null;}catch{return null;}}
export function readConfig(directory){return(directory&&readJson(path.join(directory,CONFIG)))||{};}
export function writeConfig(directory,patch){
 const file=path.join(directory,CONFIG),temp=`${file}.${process.pid}.tmp`,next={...readConfig(directory),...patch,schema:1};
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 try{fs.writeFileSync(temp,JSON.stringify(next,null,2)+'\n',{mode:0o600});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
 return next;
}
// A missing or unreadable machine policy leaves the user's own choice in place.
// A machine policy can only narrow it: an administrator's "no" cannot be overridden.
export function loadPolicy({directory,machineFile=machinePolicyFile()}={}){
 const user=readConfig(directory),machine=readJson(machineFile)??{};
 const requested=Array.isArray(user.allowlist)?user.allowlist.filter(validName):[...DEFAULT_ALLOWLIST];
 const allowlist=Array.isArray(machine.allowlist)?requested.filter(name=>machine.allowlist.includes(name)):requested;
 return{enabled:user.approvalsEnabled===true&&machine.approvalsAllowed!==false,lockedOff:machine.approvalsAllowed===false,allowlist:allowlist.filter(name=>!RISKY_TOOLS.has(name))};
}
export function evaluateRequest(policy,tool,summary){
 if(!policy?.enabled)return{approvable:false,reason:'approvals_off'};
 if(!validName(tool)||RISKY_TOOLS.has(tool)||!policy.allowlist.includes(tool))return{approvable:false,reason:'not_allowlisted'};
 if(!summary||typeof summary.text!=='string'||!summary.text)return{approvable:false,reason:'no_visible_content'};
 return{approvable:true,reason:'allowlisted'};
}
