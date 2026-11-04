// Private runtime files on Windows: exactly one ACE, for the current user, no inheritance.
// POSIX mode bits do not express this on NTFS. Uses icacls only, so it keeps working where
// PowerShell runs in Constrained Language Mode. Any doubt is a failure, never "good enough".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const tool=name=>path.join(process.env.SystemRoot||'C:\\Windows','System32',name);
const run=(name,args)=>execFileSync(tool(name),args,{encoding:'utf8',windowsHide:true,timeout:20_000,stdio:['ignore','pipe','pipe']});
// SDDL shortens well-known accounts; icacls takes only the numeric form.
const ALIASES={WD:'S-1-1-0',AN:'S-1-5-7',AU:'S-1-5-11',SY:'S-1-5-18',LS:'S-1-5-19',NS:'S-1-5-20',BA:'S-1-5-32-544',BU:'S-1-5-32-545',BG:'S-1-5-32-546',PU:'S-1-5-32-547',RD:'S-1-5-32-555',IU:'S-1-5-4',SU:'S-1-5-6',NU:'S-1-5-2',CO:'S-1-3-0',CG:'S-1-3-1',AC:'S-1-15-2-1',OW:'S-1-3-4'};
const canonical=sid=>{if(/^S-1-[0-9-]+$/.test(sid))return sid;const known=ALIASES[sid];if(!known)throw Error('acl_failed');return known;};
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
 return{protected:dacl[1].includes('P'),aces:[...dacl[2].matchAll(/\(([^)]*)\)/g)].map(([,ace])=>{const parts=ace.split(';');return{type:parts[0],flags:parts[1],rights:parts[2],sid:canonical(parts[5])};})};
}
const onlyUser=(sddl,sid)=>{const{aces}=parseAces(sddl);return aces.length>0&&aces.every(ace=>ace.sid===sid&&ace.type==='A');};
export function isPrivateToCurrentUser(target,{recursive=false}={}){
 if(process.platform!=='win32')return true;
 const sid=currentUserSid(),entries=readAcls(target,{recursive});
 return entries.length>0&&entries.every(entry=>onlyUser(entry.sddl,sid))&&parseAces(entries[0].sddl).protected;
}
function setExact(target,grant,sid){
 run('icacls.exe',[target,'/inheritance:r','/grant:r',`*${sid}:${grant}`,'/L','/Q']);
 // /grant:r replaces only this account's entry: remove every other explicit one by name.
 const[{sddl}]=readAcls(target);
 for(const foreign of new Set(parseAces(sddl).aces.map(ace=>ace.sid).filter(value=>value!==sid)))run('icacls.exe',[target,'/remove:g',`*${foreign}`,'/L','/Q']);
}
function refuseLink(target){if(fs.lstatSync(target).isSymbolicLink())throw Error('linked_path');}
// Failures throw: the caller must then not publish secrets into this location.
export function restrictFile(target){
 if(process.platform!=='win32')return false;
 refuseLink(target);setExact(target,'F',currentUserSid());
 if(!isPrivateToCurrentUser(target))throw Error('acl_failed');
 return true;
}
export function restrictDirectory(directory){
 if(process.platform!=='win32')return false;
 refuseLink(directory);const sid=currentUserSid();setExact(directory,'(OI)(CI)F',sid);
 // Older files may carry explicit entries: reset them to inherit the private parent.
 if(fs.readdirSync(directory).length)run('icacls.exe',[path.join(directory,'*'),'/reset','/T','/C','/L','/Q']);
 if(!isPrivateToCurrentUser(directory,{recursive:true}))throw Error('acl_failed');
 return true;
}
