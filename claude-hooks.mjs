// Pure settings transformations. Safe to bundle; no CLI entry point or I/O.
import path from 'node:path';
export const events=['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','PostToolUseFailure','PermissionRequest','Notification','Stop','StopFailure','SessionEnd','SubagentStart','SubagentStop'];
export function hookOwner(command){
 if(typeof command!=='string')return null;
 const parts=/^"([^"\r\n]+)"\s+"([^"\r\n]+)"(?:\s+([A-Za-z]+))?$/.exec(command);if(!parts||!['node','node.exe'].includes(parts[1].replaceAll('\\','/').split('/').at(-1).toLowerCase()))return null;
 const script=parts[2].replaceAll('\\','/').toLowerCase(),match=/\/(de\.cardea\.(deck|kadeadeck))\.sdplugin\/hooks\/(bridge|statusline)\.cjs$/.exec(script);
 if(!match||(match[3]==='bridge'?!events.includes(parts[3]):parts[3]!==undefined))return null;
 return match[2]==='deck'?'cardea':'legacy';
}
export const owned=command=>hookOwner(command)==='cardea';
export function mergeHooks(input,{node,plugin,remove=false}={}){
 const settings=structuredClone(input);if(!settings||typeof settings!=='object'||Array.isArray(settings))throw Error('Invalid settings');
 if(settings.hooks!=null&&(typeof settings.hooks!=='object'||Array.isArray(settings.hooks)))throw Error('Invalid hooks settings');settings.hooks??={};
 for(const[event,groups]of Object.entries(settings.hooks)){
  if(!Array.isArray(groups))throw Error('Invalid hook groups');
  settings.hooks[event]=groups.map(group=>{if(!group||!Array.isArray(group.hooks)||group.hooks.some(h=>!h||typeof h!=='object'||Array.isArray(h)))throw Error('Invalid hook group');return{...group,hooks:group.hooks.filter(h=>h.type!=='command'||!owned(h.command))};}).filter(g=>g.hooks.length);
  if(!settings.hooks[event].length)delete settings.hooks[event];
 }
 if(settings.statusLine?.type==='command'&&owned(settings.statusLine.command))delete settings.statusLine;
 if(!remove){
  for(const value of[node,plugin])if(typeof value!=='string'||/["\r\n%$`!&|<>^]/.test(value)||!path.isAbsolute(value))throw Error('Unsupported hook executable path');
  const hooks=path.join(plugin,'hooks');
  for(const event of events){settings.hooks[event]??=[];settings.hooks[event].push({hooks:[{type:'command',command:`"${node}" "${path.join(hooks,'bridge.cjs')}" ${event}`,timeout:event==='PermissionRequest'?60:2}]});}
  if(!settings.statusLine)settings.statusLine={type:'command',command:`"${node}" "${path.join(hooks,'statusline.cjs')}"`};
 }
 if(remove&&!Object.keys(settings.hooks).length)delete settings.hooks;
 return settings;
}
