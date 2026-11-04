// Detects damaged or edited plugin code at runtime. integrity.json lies in the same user-writable folder
// as the files, so this cannot stop software running under the same account; it catches corruption,
// partial updates and casual edits. See THREAT-MODEL.md. Images and the profile are not checked:
// they do not run, and Stream Deck may handle them itself after installation.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {checkedFiles,integrityFile} from '../plugin-files.mjs';
const CODE_FOLDERS=['bin','hooks','pi'];
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
// Returns null when every listed file matches, otherwise a short reason without file contents.
export function verifyPluginFiles(directory,{required=checkedFiles}={}){
 let manifest;
 try{manifest=JSON.parse(fs.readFileSync(path.join(directory,integrityFile),'utf8'));}catch{return{reason:'manifest_unreadable'};}
 if(manifest?.schema!==1||!manifest.files||typeof manifest.files!=='object'||Array.isArray(manifest.files))return{reason:'manifest_invalid'};
 const root=path.resolve(directory);
 for(const name of required)if(!Object.hasOwn(manifest.files,name))return{reason:'manifest_incomplete',file:name};
 for(const[name,expected]of Object.entries(manifest.files)){
  const file=path.resolve(root,name);
  if(!file.startsWith(root+path.sep)||typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected))return{reason:'manifest_invalid',file:name};
  let actual;try{actual=sha256(fs.readFileSync(file));}catch{return{reason:'file_missing',file:name};}
  if(actual!==expected)return{reason:'file_changed',file:name};
 }
 return null;
}
// Nothing loads files outside the list, and Stream Deck may leave old ones behind on update, so these are
// reported rather than treated as damage. reproduce.mjs does fail on them.
export function unexpectedPluginFiles(directory,known=checkedFiles){
 const root=path.resolve(directory),found=[];
 for(const folder of CODE_FOLDERS){
  let entries;try{entries=fs.readdirSync(path.join(root,folder),{recursive:true,withFileTypes:true});}catch{continue;}
  for(const entry of entries){
   if(entry.isDirectory())continue;
   const name=path.relative(root,path.join(entry.parentPath??entry.path,entry.name)).replaceAll('\\','/');
   if(!known.includes(name))found.push(name);
  }
 }
 return found;
}
export function buildIntegrityManifest(directory,files,version){
 const hashes={};for(const name of[...files].sort())hashes[name]=sha256(fs.readFileSync(path.join(directory,name)));
 return{schema:1,version,files:hashes};
}
