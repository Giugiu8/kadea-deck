// JSON-only merge. Existing hooks and custom status lines are never executed.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const events=['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','PostToolUseFailure','PermissionRequest','Notification','Stop','StopFailure','SessionEnd','SubagentStart','SubagentStop'];
export const owned=command=>typeof command==='string'&&command.replaceAll('\\','/').toLowerCase().includes('/de.cardea.kadeadeck.sdplugin/hooks/');
export function mergeHooks(input,{node,plugin,remove=false}={}){
 const settings=structuredClone(input);if(settings.hooks!=null&&(typeof settings.hooks!=='object'||Array.isArray(settings.hooks)))throw Error('Invalid hooks settings');
 settings.hooks??={};
 for(const [event,groups]of Object.entries(settings.hooks)){
  if(!Array.isArray(groups))throw Error('Invalid hook groups');
  settings.hooks[event]=groups.map(group=>{if(!Array.isArray(group.hooks))throw Error('Invalid hook group');return{...group,hooks:group.hooks.filter(h=>!owned(h.command))};}).filter(g=>g.hooks.length);
  if(!settings.hooks[event].length)delete settings.hooks[event];
 }
 if(owned(settings.statusLine?.command))delete settings.statusLine;
 if(!remove){
  for(const value of [node,plugin])if(typeof value!=='string'||/["\r\n%]/.test(value)||!path.isAbsolute(value))throw Error('Unsupported hook executable path');
  const hooks=path.join(plugin,'hooks');
  for(const event of events){settings.hooks[event]??=[];settings.hooks[event].push({hooks:[{type:'command',command:`"${node}" "${path.join(hooks,'bridge.cjs')}" ${event}`,timeout:event==='PermissionRequest'?60:2}]});}
  if(!settings.statusLine)settings.statusLine={type:'command',command:`"${node}" "${path.join(hooks,'statusline.cjs')}"`};
 }
 return settings;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,input,output,node,plugin]=process.argv.slice(2);if(!['install','remove'].includes(mode)||!input||!output)throw Error('Expected install/remove input output node plugin');
 const settings=fs.existsSync(input)?JSON.parse(fs.readFileSync(input,'utf8').replace(/^\uFEFF/,'')):{};
 fs.writeFileSync(output,JSON.stringify(mergeHooks(settings,{node,plugin,remove:mode==='remove'}),null,2)+'\n',{mode:0o600});
}
