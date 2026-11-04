// Read-only view of what an organization deployed through Claude Code's managed settings files.
import fs from 'node:fs';
import path from 'node:path';
import {approvalEvent,statusEvents} from './claude-hooks.mjs';
export const managedRoot=(env=process.env)=>path.join(env.ProgramFiles||'C:\\Program Files','ClaudeCode');
// A file that exists but cannot be read still counts as present, as it does for Claude Code: this
// software must then stay out of the user's settings.
export function readManagedState(root=managedRoot()){
 const documents=[];let present=false,unreadable=false;
 const load=file=>{try{const raw=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');present=true;documents.push(JSON.parse(raw));}catch(error){if(error.code!=='ENOENT'){present=true;unreadable=true;}}};
 load(path.join(root,'managed-settings.json'));
 try{for(const name of fs.readdirSync(path.join(root,'managed-settings.d')).sort())if(name.endsWith('.json'))load(path.join(root,'managed-settings.d',name));}catch(error){if(error.code!=='ENOENT'){present=true;unreadable=true;}}
 const deployed=event=>documents.some(doc=>Array.isArray(doc?.hooks?.[event])&&doc.hooks[event].some(group=>Array.isArray(group?.hooks)&&group.hooks.some(hook=>/cardea[^"]*bridge\.cjs/i.test(JSON.stringify(hook??'')))));
 const status=statusEvents.some(deployed),approval=deployed(approvalEvent),only=documents.some(doc=>doc?.allowManagedHooksOnly===true);
 return{present,only,status,approval,unreadable,active:only||status||approval||unreadable};
}
