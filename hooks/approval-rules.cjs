// Which tools a key may ever answer, and what an administrator allows. Used by the hook as well as the
// plugin, so a hook in a protected folder also holds against a replaced receiver in the user's folder.
const fs=require('node:fs'),path=require('node:path');
// An allowlist of exact names: a tool that is new or unknown here stays in Claude's dialog.
const DEFAULT_ALLOWLIST=Object.freeze(['Read','Grep','Glob','LS']);
// The most the key can show of a tool's name without cutting it.
const TOOL_LABEL=17;
const isMcpTool=name=>typeof name==='string'&&name.length<=TOOL_LABEL&&/^mcp__[A-Za-z0-9-]+__[A-Za-z0-9_.-]+$/.test(name);
// Read-only built-ins, or one exact MCP tool that a person named on purpose.
const eligibleTool=name=>DEFAULT_ALLOWLIST.includes(name)||isMcpTool(name);
const machinePolicyFile=(env=process.env)=>path.join(env.ProgramData||'C:\\ProgramData','CardeaDeck','policy.json');
// A policy that is present but damaged means off: an administrator's restriction must not vanish with a typo.
function readMachinePolicy(file=machinePolicyFile()){
 let raw;
 try{if(fs.statSync(file).size>64*1024)return{present:true,valid:false};raw=fs.readFileSync(file,'utf8');}
 catch(error){return error.code==='ENOENT'?{present:false,valid:true}:{present:true,valid:false};}
 try{
  const value=JSON.parse(raw.replace(/^\uFEFF/,''));
  if(!value||typeof value!=='object'||Array.isArray(value))return{present:true,valid:false};
  if(value.approvalsAllowed!==undefined&&typeof value.approvalsAllowed!=='boolean')return{present:true,valid:false};
  if(value.allowlist!==undefined&&(!Array.isArray(value.allowlist)||value.allowlist.some(name=>typeof name!=='string')))return{present:true,valid:false};
  return{present:true,valid:true,approvalsAllowed:value.approvalsAllowed,allowlist:value.allowlist};
 }catch{return{present:true,valid:false};}
}
const machineBlocks=(policy,tool)=>!policy.valid||policy.approvalsAllowed===false||(Array.isArray(policy.allowlist)&&!policy.allowlist.includes(tool));
// The hook's own last word before it prints an allow, whatever the receiver answered.
function hookMayAllow(tool,summary,policy=readMachinePolicy()){
 return eligibleTool(tool)&&!!summary?.text&&!summary.blocked&&!machineBlocks(policy,tool);
}
module.exports={DEFAULT_ALLOWLIST,TOOL_LABEL,eligibleTool,machinePolicyFile,readMachinePolicy,machineBlocks,hookMayAllow};
