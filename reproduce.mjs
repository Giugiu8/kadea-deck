// Rebuilds everything that executes and compares it, byte for byte, with a released file.
// Usage: node reproduce.mjs <Cardea-Deck-x.y.z.streamDeckPlugin | ...advanced-portable.zip | Remove-Claude-Hooks.ps1 | unpacked folder>
// Exit code 0: identical. 1: a difference. 2: wrong usage or the rebuild failed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {reproducibleFiles} from './plugin-files.mjs';
import {profileTemplate} from './profile.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),PLUGIN='de.cardea.deck.sdPlugin',PROFILE='profiles/Cardea Deck.streamDeckProfile';
const sha256=bytes=>bytes?createHash('sha256').update(bytes).digest('hex'):null;
const read=file=>{try{return fs.readFileSync(file);}catch{return null;}};
// Uses no external tool, so the same check runs on Windows and in the Linux job.
export function readZip(buffer){
 let end=buffer.length-22;
 while(end>=0&&buffer.readUInt32LE(end)!==0x06054b50)end--;
 if(end<0)throw Error('Not a zip archive');
 const count=buffer.readUInt16LE(end+10),entries=new Map();let at=buffer.readUInt32LE(end+16);
 for(let i=0;i<count;i++){
  if(buffer.readUInt32LE(at)!==0x02014b50)throw Error('Damaged zip directory');
  const method=buffer.readUInt16LE(at+10),size=buffer.readUInt32LE(at+20),nameLength=buffer.readUInt16LE(at+28),extra=buffer.readUInt16LE(at+30),comment=buffer.readUInt16LE(at+32),offset=buffer.readUInt32LE(at+42);
  const name=buffer.toString('utf8',at+46,at+46+nameLength).replaceAll('\\','/');
  const start=offset+30+buffer.readUInt16LE(offset+26)+buffer.readUInt16LE(offset+28),data=buffer.subarray(start,start+size);
  if(!name.endsWith('/'))entries.set(name,method===0?data:zlib.inflateRawSync(data));
  at+=46+nameLength+extra+comment;
 }
 return entries;
}
function loadFolder(directory){
 const files=new Map();
 for(const entry of fs.readdirSync(directory,{recursive:true,withFileTypes:true})){
  if(!entry.isFile())continue;
  files.set(path.relative(directory,path.join(entry.parentPath??entry.path,entry.name)).replaceAll('\\','/'),fs.readFileSync(path.join(entry.parentPath??entry.path,entry.name)));
 }
 return files;
}
const pluginPart=files=>{
 const prefix=PLUGIN+'/',inside=[...files.keys()].some(name=>name.startsWith(prefix));
 if(!inside)return files;
 return new Map([...files].filter(([name])=>name.startsWith(prefix)).map(([name,data])=>[name.slice(prefix.length),data]));
};
// What each key does. Page and action IDs are random per build, and images are data: leave them out.
function keyAssignments(pages){
 return pages.map(page=>({Name:page.Name,keys:Object.fromEntries(Object.entries(page.Controllers?.[0]?.Actions??{}).sort(([a],[b])=>a.localeCompare(b)).map(([position,action])=>[position,{UUID:action.UUID,Settings:action.Settings??{}}]))}));
}
export function compareProfile(zipped,version){
 if(!zipped)return'profile is missing';
 const entries=readZip(zipped),top=[...entries.keys()].find(name=>/\.sdProfile\/manifest\.json$/.test(name));
 if(!top)return'profile has no manifest';
 const manifest=JSON.parse(entries.get(top)),base=top.slice(0,-'manifest.json'.length);
 const pages=(manifest.Pages?.Pages??[]).map(id=>{const page=[...entries.keys()].find(name=>name.toLowerCase()===`${base}profiles/${id}/manifest.json`.toLowerCase());return page?JSON.parse(entries.get(page)):{};});
 const expected=profileTemplate({version});
 if(manifest.AppIdentifier!==null)return'profile claims an application';
 return JSON.stringify(keyAssignments(pages))===JSON.stringify(keyAssignments(expected.pages))?null:'key assignments differ';
}
export function compareRelease(target,rebuilt){
 const results=[];
 const add=(name,released,expected)=>results.push({name,rebuilt:sha256(expected),released:sha256(released),match:!!expected&&!!released&&sha256(expected)===sha256(released)});
 if(!fs.statSync(target).isDirectory()&&target.toLowerCase().endsWith('.ps1')){add(path.basename(target),read(target),read(path.join(root,path.basename(target))));return results;}
 const files=fs.statSync(target).isDirectory()?loadFolder(target):readZip(fs.readFileSync(target)),plugin=pluginPart(files);
 for(const name of reproducibleFiles)add(name,plugin.get(name),read(path.join(rebuilt,name)));
 // Code that nothing in the list accounts for would run unnoticed.
 for(const name of plugin.keys())if(/^(?:bin|hooks|pi)\//.test(name)&&!reproducibleFiles.includes(name))results.push({name,rebuilt:null,released:sha256(plugin.get(name)),match:false,note:'not in this release'});
 const version=JSON.parse(read(path.join(root,'package.json'))).version,problem=compareProfile(plugin.get(PROFILE),version);
 results.push({name:PROFILE+' (key assignments)',rebuilt:null,released:sha256(plugin.get(PROFILE)),match:!problem,note:problem??undefined});
 // The portable download also carries scripts that run directly: each must equal this checkout.
 if(plugin!==files)for(const[name,data]of files){
  if(name.startsWith(PLUGIN+'/')||!/\.(?:mjs|cjs|js|ps1|cmd|bat|exe|dll)$/i.test(name))continue;
  add(name,data,read(path.join(root,name)));
 }
 return results;
}
export function reproduce(target){
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-reproduce-'));
 try{
  execFileSync(process.execPath,[path.join(root,'build.mjs'),'--code-only','--out',scratch],{cwd:root,stdio:'pipe',windowsHide:true});
  return compareRelease(target,scratch);
 }finally{if(path.basename(scratch).startsWith('cardea-reproduce-'))fs.rmSync(scratch,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const target=process.argv[2];
 if(!target||!fs.existsSync(target)){console.error('Usage: node reproduce.mjs <plugin file, portable zip, recovery script or unpacked folder>');process.exit(2);}
 try{
  const results=reproduce(path.resolve(target));
  for(const r of results)console.log(`${r.match?'same     ':'DIFFERENT'}  ${r.rebuilt??r.released??'(missing)'}  ${r.name}${r.match?'':`  released: ${r.released??'(missing)'}${r.note?` (${r.note})`:''}`}`);
  const different=results.filter(r=>!r.match).length;
  console.log(different?`${different} of ${results.length} checks differ.`:`All ${results.length} checks match this checkout.`);
  process.exit(different?1:0);
 }catch(error){console.error('Rebuild failed: '+error.message);process.exit(2);}
}
