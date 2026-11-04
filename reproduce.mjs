// Rebuilds everything that executes and compares it, byte for byte, with a released plugin.
// Usage: node reproduce.mjs <Cardea-Deck-x.y.z.streamDeckPlugin | unpacked folder>
// Exit code 0: identical. 1: a difference. 2: wrong usage or the rebuild failed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {reproducibleFiles} from './plugin-files.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),PLUGIN='de.cardea.deck.sdPlugin';
const sha256=file=>{try{return createHash('sha256').update(fs.readFileSync(file)).digest('hex');}catch{return null;}};
function releasedHashes(target){
 if(fs.statSync(target).isDirectory()){
  const base=fs.existsSync(path.join(target,PLUGIN))?path.join(target,PLUGIN):target;
  return Object.fromEntries(reproducibleFiles.map(name=>[name,sha256(path.join(base,name))]));
 }
 return import('./verify-release.mjs').then(({inspectZip})=>{const entries=new Map(inspectZip(target).map(entry=>[entry.name.replace(new RegExp(`^${PLUGIN.replaceAll('.','\\.')}/`),''),entry.sha256]));return Object.fromEntries(reproducibleFiles.map(name=>[name,entries.get(name)??null]));});
}
export async function reproduce(target){
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-reproduce-'));
 try{
  execFileSync(process.execPath,[path.join(root,'build.mjs'),'--code-only','--out',scratch],{cwd:root,stdio:'pipe',windowsHide:true});
  const released=await releasedHashes(target);
  return reproducibleFiles.map(name=>{const rebuilt=sha256(path.join(scratch,name));return{name,rebuilt,released:released[name],match:!!rebuilt&&rebuilt===released[name]};});
 }finally{if(path.basename(scratch).startsWith('cardea-reproduce-'))fs.rmSync(scratch,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const target=process.argv[2];
 if(!target||!fs.existsSync(target)){console.error('Usage: node reproduce.mjs <plugin file or unpacked folder>');process.exit(2);}
 try{
  const results=await reproduce(path.resolve(target));
  for(const r of results)console.log(`${r.match?'same     ':'DIFFERENT'}  ${r.rebuilt??'(not built)'}  ${r.name}${r.match?'':`  released: ${r.released??'(missing)'}`}`);
  const different=results.filter(r=>!r.match).length;
  console.log(different?`${different} of ${results.length} files differ.`:`All ${results.length} executable files match this checkout.`);
  process.exit(different?1:0);
 }catch(error){console.error('Rebuild failed: '+error.message);process.exit(2);}
}
