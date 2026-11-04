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
import {pluginFiles,reproducibleFiles} from './plugin-files.mjs';
import {renderProfile} from './profile.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),PLUGIN='de.cardea.deck.sdPlugin',PROFILE='profiles/Cardea Deck.streamDeckProfile';
const sha256=bytes=>bytes?createHash('sha256').update(bytes).digest('hex'):null;
const read=file=>{try{return fs.readFileSync(file);}catch{return null;}};
// Uses no external tool, so the same check runs on Windows and in the Linux job.
export function readZip(buffer){
 let end=buffer.length-22;
 while(end>=0&&buffer.readUInt32LE(end)!==0x06054b50)end--;
 if(end<0)throw Error('Not a zip archive');
 if(end+22+buffer.readUInt16LE(end+20)!==buffer.length)throw Error('Zip has data after its end');
 if(buffer.readUInt16LE(end+8)!==buffer.readUInt16LE(end+10)||buffer.readUInt16LE(end+10)===0xffff)throw Error('Unsupported zip directory');
 const count=buffer.readUInt16LE(end+10),entries=new Map(),seen=new Set(),tableSize=buffer.readUInt32LE(end+12),tableStart=buffer.readUInt32LE(end+16),spans=[];let at=tableStart;
 for(let i=0;i<count;i++){
  if(buffer.readUInt32LE(at)!==0x02014b50)throw Error('Damaged zip directory');
  const flags=buffer.readUInt16LE(at+8),method=buffer.readUInt16LE(at+10),nameLength=buffer.readUInt16LE(at+28),extra=buffer.readUInt16LE(at+30),comment=buffer.readUInt16LE(at+32);let size=buffer.readUInt32LE(at+20),offset=buffer.readUInt32LE(at+42);
  // Elgato's packer writes ZIP64 fields: values too large for the normal slot live in an extra record.
  const full=buffer.readUInt32LE(at+24);for(let i=at+46+nameLength;i+4<=at+46+nameLength+extra;i+=4+buffer.readUInt16LE(i+2))if(buffer.readUInt16LE(i)===1){let field=i+4;if(full===0xffffffff)field+=8;if(size===0xffffffff){size=Number(buffer.readBigUInt64LE(field));field+=8;}if(offset===0xffffffff)offset=Number(buffer.readBigUInt64LE(field));}
  const raw=buffer.subarray(at+46,at+46+nameLength),name=raw.toString('utf8').replaceAll('\\','/'),localName=buffer.readUInt16LE(offset+26),localExtra=buffer.readUInt16LE(offset+28);
  // An extractor may read other names than this reader: anything ambiguous is refused outright.
  if(!buffer.subarray(offset+30,offset+30+localName).equals(raw))throw Error('Zip names disagree: '+name);
  for(const[from,length]of [[at+46+nameLength,extra],[offset+30+localName,localExtra]])for(let i=from;i+4<=from+length;i+=4+buffer.readUInt16LE(i+2))if(buffer.readUInt16LE(i)===0x7075)throw Error('Zip entry with a second name: '+name);
  const parts=(name.endsWith('/')?name.slice(0,-1):name).split('/');
  if(name.startsWith('/')||parts.some(part=>!part||part==='.'||part==='..'||/[. ]$/.test(part)||/[:\x00-\x1f]/.test(part)))throw Error('Unsafe zip name: '+name);
  const fold=name.toLowerCase();if(seen.has(fold))throw Error('Zip names collide: '+name);seen.add(fold);
  const start=offset+30+localName+localExtra,data=buffer.subarray(start,start+size);spans.push({offset,end:start+size,flags});
  if(!name.endsWith('/'))entries.set(name,method===0?data:zlib.inflateRawSync(data));
  at+=46+nameLength+extra+comment;
 }
 // An entry the directory does not list would still be seen by other extractors.
 if(at-tableStart!==tableSize||at!==end)throw Error('Zip directory does not match its size');
 spans.sort((a,b)=>a.offset-b.offset);let next=0;
 for(const span of spans){const gap=span.offset-next;if(gap<0||(gap>0&&!(next>0&&gap<=24)))throw Error('Zip has unlisted data');next=span.end;}
 const last=tableStart-next;if(last<0||last>24)throw Error('Zip has unlisted data');
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
// A profile decides what its keys do. Compare all of it except what is random per build (IDs) or data (image bytes).
const withoutIds=value=>Array.isArray(value)?value.map(withoutIds):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>key!=='ActionID').map(([key,item])=>[key,withoutIds(item)])):value;
function expectedProfile(version){
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-profile-'));
 try{
  const profile=renderProfile(scratch,version,()=>{}),page=id=>JSON.parse(fs.readFileSync(path.join(scratch,'Profiles',id,'manifest.json'),'utf8'));
  return{manifest:profile.manifest,pages:profile.ids.map(page),blank:page(profile.manifest.Pages.Default)};
 }finally{if(path.basename(scratch).startsWith('cardea-profile-'))fs.rmSync(scratch,{recursive:true,force:true});}
}
function checkProfileEntries(entries,version){
 const top=[...entries.keys()].filter(name=>/(?:^|\/)manifest\.json$/.test(name)&&!/\/Profiles\//i.test(name));
 if(top.length!==1)return'profile has no single manifest';
 const base=top[0].slice(0,-'manifest.json'.length),manifest=JSON.parse(entries.get(top[0])),expected=expectedProfile(version);
 const ids=manifest.Pages?.Pages??[],defaultId=manifest.Pages?.Default;
 if(ids.length!==expected.pages.length||!ids.every(id=>typeof id==='string')||typeof defaultId!=='string'||ids.includes(defaultId)||manifest.Pages.Current!==ids[0])return'profile pages differ';
 const{Pages:_a,...restA}=manifest,{Pages:_b,...restB}=expected.manifest;
 if(JSON.stringify(restA)!==JSON.stringify(restB))return'profile settings differ';
 const read=id=>{const data=entries.get(base+'Profiles/'+id+'/manifest.json');return data?JSON.parse(data):null;};
 const pages=ids.map(read),same=(a,b)=>JSON.stringify(withoutIds(a))===JSON.stringify(withoutIds(b));
 if(pages.some(page=>!page)||!pages.every((page,i)=>same(page,expected.pages[i]))||!same(read(defaultId),expected.blank))return'key assignments differ';
 // Nothing else may hide in there: only the images the keys name.
 const allowed=new Set([top[0],base+'Profiles/'+defaultId+'/manifest.json']);
 ids.forEach((id,i)=>{allowed.add(base+'Profiles/'+id+'/manifest.json');for(const action of Object.values(pages[i].Controllers?.[0]?.Actions??{}))for(const state of action.States??[])if(typeof state.Image==='string')allowed.add(base+'Profiles/'+id+'/'+state.Image);});
 const extra=[...entries.keys()].find(name=>!allowed.has(name));
 return extra?'unexpected profile file: '+extra.slice(base.length):null;
}
export function compareProfile(zipped,version){return zipped?checkProfileEntries(readZip(zipped),version):'profile is missing';}
// The runtime dependencies an SBOM names must be exactly those of the lockfile.
export function compareSbom(sbom){
 const lock=JSON.parse(read(path.join(root,'package-lock.json'))),wanted=Object.entries(lock.packages).filter(([name,entry])=>name&&!entry.dev).map(([name,entry])=>name.split('node_modules/').at(-1)+'@'+entry.version).sort();
 const found=(sbom.components??[]).map(component=>component.name+'@'+component.version).sort();
 return sbom.bomFormat==='CycloneDX'&&JSON.stringify(found)===JSON.stringify(wanted)?null:'components differ from the lockfile';
}
// Written during the release from the files compared here; none of them runs.
const GENERATED=new Set(['integrity.json','build-info.json','THIRD-PARTY-NOTICES.txt','DEPENDENCIES.json']);
export function compareRelease(target,rebuilt){
 const results=[];
 const add=(name,released,expected)=>results.push({name,rebuilt:sha256(expected),released:sha256(released),match:!!expected&&!!released&&sha256(expected)===sha256(released)});
 if(!fs.statSync(target).isDirectory()&&target.toLowerCase().endsWith('.ps1')){add(path.basename(target),read(target),read(path.join(root,path.basename(target))));return results;}
 if(!fs.statSync(target).isDirectory()&&target.toLowerCase().endsWith('.cdx.json')){const problem=compareSbom(JSON.parse(read(target)));return[{name:path.basename(target),rebuilt:null,released:sha256(read(target)),match:!problem,note:problem??undefined}];}
 const files=fs.statSync(target).isDirectory()?loadFolder(target):readZip(fs.readFileSync(target)),plugin=pluginPart(files);
 for(const name of reproducibleFiles)add(name,plugin.get(name),read(path.join(rebuilt,name)));
 // Code that nothing in the list accounts for would run unnoticed.
 const known=new Set([...pluginFiles,'LICENSE','THIRD-PARTY-NOTICES.txt']),isFolder=fs.statSync(target).isDirectory();
 for(const name of plugin.keys())if(!known.has(name)&&!(isFolder&&/^logs\//.test(name)))results.push({name,rebuilt:null,released:sha256(plugin.get(name)),match:false,note:'not in this release'});
 const version=JSON.parse(read(path.join(root,'package.json'))).version,problem=compareProfile(plugin.get(PROFILE),version);
 results.push({name:PROFILE+' (key assignments)',rebuilt:null,released:sha256(plugin.get(PROFILE)),match:!problem,note:problem??undefined});
 // The portable download also carries scripts that run directly: each must equal this checkout.
 // A plugin file holds only its plugin folder; the portable download holds more next to it.
 if([...files.keys()].some(name=>!name.startsWith(PLUGIN+'/'))&&plugin!==files){
  const template=new Map([...files].filter(([name])=>name.startsWith('profile-template/')));
  const templateProblem=checkProfileEntries(template,version);
  results.push({name:'profile-template (key assignments)',rebuilt:null,released:null,match:!templateProblem,note:templateProblem??undefined});
  for(const[name,data]of files){
   if(name.startsWith(PLUGIN+'/')||name.startsWith('profile-template/')||GENERATED.has(name))continue;
   add(name,data,read(path.join(root,name)));
  }
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
 // Exactly one file: an unmatched or extra argument must not count as a pass.
 if(process.argv.length!==3||!fs.existsSync(target)){console.error('Usage: node reproduce.mjs <one plugin file, portable zip, recovery script, SBOM or unpacked folder>');process.exit(2);}
 try{
  const results=reproduce(path.resolve(target));
  for(const r of results)console.log(`${r.match?'same     ':'DIFFERENT'}  ${r.rebuilt??r.released??'(missing)'}  ${r.name}${r.match?'':`  released: ${r.released??'(missing)'}${r.note?` (${r.note})`:''}`}`);
  const different=results.filter(r=>!r.match).length;
  console.log(different?`${different} of ${results.length} checks differ.`:`All ${results.length} checks match this checkout.`);
  process.exit(different?1:0);
 }catch(error){console.error('Rebuild failed: '+error.message);process.exit(2);}
}
