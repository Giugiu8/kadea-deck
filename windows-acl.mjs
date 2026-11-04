// Private runtime files on Windows: exactly one ACE, for the current user, no inheritance.
// POSIX mode bits do not express this on NTFS. Uses icacls only, so it keeps working where
// PowerShell runs in Constrained Language Mode. Any doubt is a failure, never "good enough".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const tool=name=>path.join(process.env.SystemRoot||'C:\\Windows','System32',name);
const run=(name,args)=>execFileSync(tool(name),args,{encoding:'utf8',windowsHide:true,timeout:8000,stdio:['ignore','pipe','pipe']});
const MARKER='.cardea-runtime';
let cachedSid=null;
export function currentUserSid(){
 if(cachedSid)return cachedSid;
 const match=/"(S-1-[0-9-]+)"\s*$/.exec(run('whoami.exe',['/user','/fo','csv','/nh']).trim());
 if(!match)throw Error('acl_failed');
 return cachedSid=match[1];
}
// One SDDL string per entry, as Windows itself reports it.
export function readAcls(target,{recursive=false}={}){
 const scratch=path.join(os.tmpdir(),`cardea-acl-${randomUUID()}.txt`);
 try{
  run('icacls.exe',[target,'/save',scratch,...(recursive?['/T','/C','/L']:[]),'/Q']);
  const lines=fs.readFileSync(scratch,'utf16le').replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean),entries=[];
  for(let i=0;i+1<lines.length;i+=2)entries.push({name:lines[i],sddl:lines[i+1]});
  return entries;
 }finally{fs.rmSync(scratch,{force:true});}
}
export function parseAces(sddl){
 const dacl=/^D:([A-Z]*)((?:\([^)]*\))*)/.exec(sddl);if(!dacl)throw Error('acl_failed');
 return{protected:dacl[1].includes('P'),aces:[...dacl[2].matchAll(/\(([^)]*)\)/g)].map(([,ace])=>{const parts=ace.split(';');return{type:parts[0],flags:parts[1],rights:parts[2],sid:parts[5]};})};
}
// Windows prints a built-in account by its short name even when it is the current user.
export const sameAccount=(name,sid)=>name===sid||(name==='LA'&&sid.endsWith('-500'))||(name==='LG'&&sid.endsWith('-501'));
const onlyUser=(sddl,sid)=>{const{aces}=parseAces(sddl);return aces.length>0&&aces.every(ace=>sameAccount(ace.sid,sid)&&ace.type==='A');};
export function isPrivateToCurrentUser(target,{recursive=false}={}){
 if(process.platform!=='win32')return true;
 const sid=currentUserSid(),entries=readAcls(target,{recursive});
 return entries.length>0&&entries.every(entry=>onlyUser(entry.sddl,sid))&&parseAces(entries[0].sddl).protected;
}
function setExact(target,grant,sid){
 // Reset drops every explicit entry, whatever account it names. Removing them one by one would need
 // a numeric SID, and domain-relative SDDL names such as DA or LA have no fixed one. /grant:r alone
 // would leave them in place.
 run('icacls.exe',[target,'/reset','/L','/Q']);
 run('icacls.exe',[target,'/inheritance:r','/grant:r',`*${sid}:${grant}`,'/L','/Q']);
}
function refuseLink(target){if(fs.lstatSync(target).isSymbolicLink())throw Error('linked_path');}
// icacls /T walks through junctions, so a link in here could change permissions anywhere.
function refuseLinksInside(directory){
 for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
  const child=path.join(directory,entry.name);
  if(entry.isSymbolicLink()||fs.lstatSync(child).isSymbolicLink())throw Error('linked_path');
  if(entry.isDirectory())refuseLinksInside(child);
 }
}
// The runtime path can come from an environment variable. Removing inheritance from one of these
// would lock other software and users out of it.
// Real paths: short names such as RUNNER~1 and links in a parent folder must not change the verdict.
// A folder that does not exist yet is judged by the real path of its nearest existing parent.
const real=value=>{const absolute=path.resolve(value);try{return fs.realpathSync.native(absolute);}catch{const parent=path.dirname(absolute);return parent===absolute?absolute:path.join(real(parent),path.basename(absolute));}};
export function refuseSystemLocation(directory,env=process.env){
 const resolved=real(directory),folded=resolved.toLowerCase(),separator=path.sep;
 // Only inside the user's profile: nobody else can have created the folder there and kept ownership of it.
 const homes=[env.USERPROFILE,os.homedir()].filter(Boolean).map(value=>real(value).toLowerCase()+separator);
 if(!homes.some(home=>folded.startsWith(home)))throw Error('protected_path');
 if(path.parse(resolved).root.toLowerCase()===folded+separator||path.parse(resolved).root.toLowerCase()===folded)throw Error('protected_path');
 const inside=folded.endsWith(separator)?folded:folded+separator;
 for(const name of ['USERPROFILE','SystemRoot','WINDIR','ProgramFiles','ProgramFiles(x86)','ProgramData','APPDATA','LOCALAPPDATA','TEMP','PUBLIC']){
  const value=env[name];if(!value)continue;
  const other=real(value).toLowerCase();
  if(other===folded||(other+separator).startsWith(inside))throw Error('protected_path');
 }
 for(const value of [os.homedir(),os.tmpdir()]){const other=real(value).toLowerCase();if(other===folded||(other+separator).startsWith(inside))throw Error('protected_path');}
}
// Failures throw: the caller must then not publish secrets into this location.
export function restrictFile(target){
 if(process.platform!=='win32')return false;
 refuseLink(target);const sid=currentUserSid();
 // Normally it inherited the private entry from its folder, and only needs a look.
 if(onlyUser(readAcls(target)[0].sddl,sid))return true;
 setExact(target,'F',sid);
 if(!isPrivateToCurrentUser(target))throw Error('acl_failed');
 return true;
}
export function restrictDirectory(directory){
 if(process.platform!=='win32')return false;
 refuseSystemLocation(directory);refuseLink(directory);refuseLinksInside(directory);
 // Stripping inheritance from someone else's folder would lock people out: it must be empty, ours by
 // name, or marked by an earlier run.
 const marker=path.join(directory,MARKER);
 if(path.basename(directory)!=='.cardeadeck'&&!fs.existsSync(marker)&&fs.readdirSync(directory).length)throw Error('protected_path');
 // Already private: nothing to do, and no moment in which it would inherit anything.
 if(isPrivateToCurrentUser(directory,{recursive:true})){if(!fs.existsSync(marker))fs.writeFileSync(marker,'');return true;}
 const sid=currentUserSid();setExact(directory,'(OI)(CI)F',sid);
 // Older files may carry explicit entries: reset them to inherit the private parent.
 if(fs.readdirSync(directory).length)run('icacls.exe',[path.join(directory,'*'),'/reset','/T','/C','/L','/Q']);
 fs.writeFileSync(marker,'');
 if(!isPrivateToCurrentUser(directory,{recursive:true}))throw Error('acl_failed');
 return true;
}
