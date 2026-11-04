// Decides which pending Claude requests a Stream Deck key may answer at all.
// Everything else returns no decision, so Claude shows its normal dialog.
import fs from 'node:fs';
import path from 'node:path';
import rules from '../hooks/approval-rules.cjs';
export const {DEFAULT_ALLOWLIST,eligibleTool,machinePolicyFile}=rules;
const {readMachinePolicy,machineBlocks}=rules;
const CONFIG='config.json';
function readJson(file){try{const stat=fs.statSync(file);if(stat.size>64*1024)return null;const value=JSON.parse(fs.readFileSync(file,'utf8').replace(/^﻿/,''));return value&&typeof value==='object'&&!Array.isArray(value)?value:null;}catch{return null;}}
export function readConfig(directory){return(directory&&readJson(path.join(directory,CONFIG)))||{};}
export function writeConfig(directory,patch){
 const file=path.join(directory,CONFIG),temp=`${file}.${process.pid}.tmp`,next={...readConfig(directory),...patch,schema:1};
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 try{fs.writeFileSync(temp,JSON.stringify(next,null,2)+'\n',{mode:0o600});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
 return next;
}
// A machine policy can only narrow the user's choice. If it is present but damaged, approvals are off.
export function loadPolicy({directory,machineFile=machinePolicyFile()}={}){
 const user=readConfig(directory),machine=readMachinePolicy(machineFile);
 const requested=Array.isArray(user.allowlist)?user.allowlist:[...DEFAULT_ALLOWLIST];
 const allowlist=requested.filter(name=>eligibleTool(name)&&!machineBlocks(machine,name));
 const lockedOff=!machine.valid||machine.approvalsAllowed===false;
 return{enabled:user.approvalsEnabled===true&&!lockedOff,lockedOff,allowlist};
}
export function evaluateRequest(policy,tool,summary){
 if(!policy?.enabled)return{approvable:false,reason:'approvals_off'};
 if(!eligibleTool(tool)||!policy.allowlist.includes(tool))return{approvable:false,reason:'not_allowlisted'};
 if(!summary||typeof summary.text!=='string'||!summary.text)return{approvable:false,reason:'no_visible_content'};
 if(summary.blocked)return{approvable:false,reason:String(summary.blocked).slice(0,40)};
 return{approvable:true,reason:'allowlisted'};
}
