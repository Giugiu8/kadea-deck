// Pure settings transformations. Safe to bundle; no CLI entry point or I/O.
import path from 'node:path';
export const statusEvents=['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','PostToolUseFailure','Notification','Stop','StopFailure','SessionEnd','SubagentStart','SubagentStop'];
export const approvalEvent='PermissionRequest';
export const events=[...statusEvents,approvalEvent];
export function hookOwner(command){
 if(typeof command!=='string')return null;
 const parts=/^"([^"\r\n]+)"\s+"([^"\r\n]+)"(?:\s+([A-Za-z]+))?$/.exec(command);if(!parts||!['node','node.exe'].includes(parts[1].replaceAll('\\','/').split('/').at(-1).toLowerCase()))return null;
 const script=parts[2].replaceAll('\\','/').toLowerCase(),match=/\/(de\.cardea\.(deck|kadeadeck))\.sdplugin\/hooks\/(bridge|statusline)\.cjs$/.exec(script);
 if(!match||(match[3]==='bridge'?!events.includes(parts[3]):parts[3]!==undefined))return null;
 return match[2]==='deck'?'cardea':'legacy';
}
export const owned=command=>hookOwner(command)==='cardea';
// status/approval say which groups must exist afterwards; they are independent and
// approval is never implied. remove: true drops both, 'status' or 'approval' only one.
export function mergeHooks(input,{node,plugin,status=true,approval=false,remove=false}={}){
 const settings=structuredClone(input);if(!settings||typeof settings!=='object'||Array.isArray(settings))throw Error('Invalid settings');
 if(settings.hooks!=null&&(typeof settings.hooks!=='object'||Array.isArray(settings.hooks)))throw Error('Invalid hooks settings');settings.hooks??={};
 if(![true,false,'status','approval'].includes(remove))throw Error('Invalid hook group');
 const dropStatus=remove!=='approval',dropApproval=remove!=='status';
 for(const[event,groups]of Object.entries(settings.hooks)){
  if(!Array.isArray(groups))throw Error('Invalid hook groups');
  settings.hooks[event]=groups.map(group=>{if(!group||!Array.isArray(group.hooks)||group.hooks.some(h=>!h||typeof h!=='object'||Array.isArray(h)))throw Error('Invalid hook group');return{...group,hooks:group.hooks.filter(h=>{if(h.type!=='command'||!owned(h.command))return true;return event===approvalEvent?!dropApproval:!dropStatus;})};}).filter(g=>g.hooks.length);
  if(!settings.hooks[event].length)delete settings.hooks[event];
 }
 if(dropStatus&&settings.statusLine?.type==='command'&&owned(settings.statusLine.command))delete settings.statusLine;
 if(remove===false&&(status||approval)){
  for(const value of[node,plugin])if(typeof value!=='string'||/["\r\n%$`!&|<>^]/.test(value)||!path.isAbsolute(value))throw Error('Unsupported hook executable path');
  const hooks=path.join(plugin,'hooks'),add=(event,timeout)=>{settings.hooks[event]??=[];settings.hooks[event].push({hooks:[{type:'command',command:`"${node}" "${path.join(hooks,'bridge.cjs')}" ${event}`,timeout}]});};
  if(status){for(const event of statusEvents)add(event,2);if(!settings.statusLine)settings.statusLine={type:'command',command:`"${node}" "${path.join(hooks,'statusline.cjs')}"`};}
  if(approval)add(approvalEvent,60);
 }
 if(!Object.keys(settings.hooks).length)delete settings.hooks;
 return settings;
}
export function installedGroups(settings,{node,plugin}){
 const expected=mergeHooks({},{node,plugin,status:true,approval:true});
 const has=event=>settings.hooks?.[event]?.some(group=>group.hooks?.some(h=>h.command===expected.hooks[event][0].hooks[0].command));
 const anyOwn=event=>(settings.hooks?.[event]??[]).some(group=>Array.isArray(group.hooks)&&group.hooks.some(h=>hookOwner(h?.command)==='cardea'));
 return{status:statusEvents.every(has),approval:!!has(approvalEvent),statusPresent:statusEvents.some(anyOwn),approvalPresent:anyOwn(approvalEvent)};
}
