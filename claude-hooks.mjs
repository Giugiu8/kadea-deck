// Pure settings transformations. Safe to bundle; no CLI entry point or I/O.
import path from 'node:path';
export const statusEvents=['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','PostToolUseFailure','Notification','Stop','StopFailure','SessionEnd','SubagentStart','SubagentStop'];
export const approvalEvent='PermissionRequest';
export const events=[...statusEvents,approvalEvent];
const ownerOf=(node,script,event)=>{
 if(!['node','node.exe'].includes(String(node).replaceAll('\\','/').split('/').at(-1).toLowerCase()))return null;
 const match=/\/(de\.cardea\.(deck|kadeadeck))\.sdplugin\/hooks\/(bridge|statusline)\.cjs$/.exec(String(script).replaceAll('\\','/').toLowerCase());
 if(!match||(match[3]==='bridge'?!events.includes(event):event!==undefined))return null;
 return match[2]==='deck'?'cardea':'legacy';
};
// Takes a command string (shell form, older versions and the status line) or a hook entry (exec form).
export function hookOwner(value){
 if(value&&typeof value==='object'){
  if(value.args===undefined)return hookOwner(value.command);
  if(typeof value.command!=='string'||!Array.isArray(value.args)||value.args.length<1||value.args.length>2||value.args.some(arg=>typeof arg!=='string'))return null;
  return ownerOf(value.command,value.args[0],value.args[1]);
 }
 if(typeof value!=='string')return null;
 const parts=/^"([^"\r\n]+)"\s+"([^"\r\n]+)"(?:\s+([A-Za-z]+))?$/.exec(value)??/^([^\s"]+)\s+([^\s"]+\.cjs)(?:\s+([A-Za-z]+))?$/.exec(value);
 return parts?ownerOf(parts[1],parts[2],parts[3]):null;
}
export const owned=value=>hookOwner(value)==='cardea';
// The status line has no exec form. Without spaces this spelling runs under Git Bash and PowerShell alike;
// quoted paths need Git Bash. Paths a shell would interpret get no status line: its keys open the usage page.
export function statusLineCommand(node,script){
 const a=node.replaceAll('\\','/'),b=script.replaceAll('\\','/');
 if(/[%$`!]/.test(a+b))return null;
 return /[\s&|<>^;()']/.test(a+b)?`"${node}" "${script}"`:`${a} ${b}`;
}
// status/approval say which groups must exist afterwards; they are independent and
// approval is never implied. remove: true drops both, 'status' or 'approval' only one.
export function mergeHooks(input,{node,plugin,status=true,approval=false,remove=false}={}){
 const settings=structuredClone(input);if(!settings||typeof settings!=='object'||Array.isArray(settings))throw Error('Invalid settings');
 if(settings.hooks!=null&&(typeof settings.hooks!=='object'||Array.isArray(settings.hooks)))throw Error('Invalid hooks settings');settings.hooks??={};
 if(![true,false,'status','approval'].includes(remove))throw Error('Invalid hook group');
 const dropStatus=remove!=='approval',dropApproval=remove!=='status';
 for(const[event,groups]of Object.entries(settings.hooks)){
  if(!Array.isArray(groups))throw Error('Invalid hook groups');
  settings.hooks[event]=groups.map(group=>{if(!group||!Array.isArray(group.hooks)||group.hooks.some(h=>!h||typeof h!=='object'||Array.isArray(h)))throw Error('Invalid hook group');return{...group,hooks:group.hooks.filter(h=>{if(h.type!=='command'||!owned(h))return true;return event===approvalEvent?!dropApproval:!dropStatus;})};}).filter(g=>g.hooks.length);
  if(!settings.hooks[event].length)delete settings.hooks[event];
 }
 if(dropStatus&&settings.statusLine?.type==='command'&&owned(settings.statusLine))delete settings.statusLine;
 if(remove===false&&(status||approval)){
  for(const value of[node,plugin])if(typeof value!=='string'||/["\r\n]/.test(value)||!path.isAbsolute(value))throw Error('Unsupported hook executable path');
  const hooks=path.join(plugin,'hooks'),add=(event,timeout)=>{settings.hooks[event]??=[];settings.hooks[event].push({hooks:[{type:'command',command:node,args:[path.join(hooks,'bridge.cjs'),event],timeout}]});};
  if(status){for(const event of statusEvents)add(event,2);const line=statusLineCommand(node,path.join(hooks,'statusline.cjs'));if(!settings.statusLine&&line)settings.statusLine={type:'command',command:line};}
  if(approval)add(approvalEvent,60);
 }
 if(!Object.keys(settings.hooks).length)delete settings.hooks;
 return settings;
}
export function installedGroups(settings,{node,plugin}){
 const expected=mergeHooks({},{node,plugin,status:true,approval:true});
 const has=event=>{const want=expected.hooks[event][0].hooks[0];return settings.hooks?.[event]?.some(group=>group.hooks?.some(h=>h.command===want.command&&Array.isArray(h.args)&&h.args[0]===want.args[0]&&h.args[1]===want.args[1]));};
 const anyOwn=event=>(settings.hooks?.[event]??[]).some(group=>Array.isArray(group.hooks)&&group.hooks.some(h=>hookOwner(h)==='cardea'));
 return{status:statusEvents.every(has),approval:!!has(approvalEvent),statusPresent:statusEvents.some(anyOwn),approvalPresent:anyOwn(approvalEvent)};
}
