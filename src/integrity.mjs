// Detects damaged or edited plugin files at runtime. integrity.json lies in the same user-writable
// folder as the files, so this cannot stop software running under the same account; it catches
// corruption, partial updates and casual edits. See THREAT-MODEL.md.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pluginFiles,integrityFile} from '../plugin-files.mjs';
const MANIFEST=integrityFile;
const EXPECTED=pluginFiles.filter(name=>name!==integrityFile);
// Folders whose content can execute. Stream Deck may leave the old helper behind on update; nothing runs it.
const CODE_FOLDERS=['bin','hooks','pi'],LEGACY=new Set(['bin/open.exe']);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
// Returns null when every listed file matches, otherwise a short reason without file contents.
export function verifyPluginFiles(directory,{required=EXPECTED}={}){
 let manifest;
 try{manifest=JSON.parse(fs.readFileSync(path.join(directory,MANIFEST),'utf8'));}catch{return{reason:'manifest_unreadable'};}
 if(manifest?.schema!==1||!manifest.files||typeof manifest.files!=='object'||Array.isArray(manifest.files))return{reason:'manifest_invalid'};
 const root=path.resolve(directory);
 for(const name of required)if(!Object.hasOwn(manifest.files,name))return{reason:'manifest_incomplete',file:name};
 for(const[name,expected]of Object.entries(manifest.files)){
  const file=path.resolve(root,name);
  if(!file.startsWith(root+path.sep)||typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected))return{reason:'manifest_invalid',file:name};
  let actual;try{actual=sha256(fs.readFileSync(file));}catch{return{reason:'file_missing',file:name};}
  if(actual!==expected)return{reason:'file_changed',file:name};
 }
 for(const folder of CODE_FOLDERS){
  let names;try{names=fs.readdirSync(path.join(root,folder),{recursive:true,withFileTypes:true});}catch{continue;}
  for(const entry of names){
   const name=path.relative(root,path.join(entry.parentPath??entry.path,entry.name)).replaceAll('\\','/');
   if(entry.isDirectory()||Object.hasOwn(manifest.files,name)||LEGACY.has(name))continue;
   return{reason:'unexpected_file',file:name};
  }
 }
 return null;
}
export function buildIntegrityManifest(directory,files,version){
 const hashes={};for(const name of[...files].sort())hashes[name]=sha256(fs.readFileSync(path.join(directory,name)));
 return{schema:1,version,files:hashes};
}
