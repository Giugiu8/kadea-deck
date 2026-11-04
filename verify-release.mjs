import fs from 'node:fs';import path from 'node:path';import {createHash}from'node:crypto';import{execFileSync}from'node:child_process';import{fileURLToPath}from'node:url';
import{pluginFiles}from'./plugin-files.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
export function inspectZip(file){
 const script="Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead($env:CARDEA_VERIFY_ARCHIVE); try {@($z.Entries | Where-Object {$_.Name} | ForEach-Object {$stream=$_.Open();$hash=[Security.Cryptography.SHA256]::Create();try {@{name=$_.FullName.Replace('\\','/');bytes=$_.Length;sha256=([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}}finally{$stream.Dispose();$hash.Dispose()}}) | ConvertTo-Json -Compress}finally{$z.Dispose()}";
 const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,encoding:'utf8',maxBuffer:1024*1024,env:{...process.env,CARDEA_VERIFY_ARCHIVE:file}});
 const entries=JSON.parse(output);for(const entry of entries)if(entry.name.startsWith('/')||entry.name.includes(':')||entry.name.split('/').includes('..'))throw Error('Unsafe archive path');return entries;
}
// The SBOM describes what ships: runtime dependencies, not build tools.
export function checkSbom(sbom){
 const names=new Set((sbom?.components??[]).map(component=>component.name));
 if(sbom?.bomFormat!=='CycloneDX'||!names.has('@elgato/streamdeck')||names.has('esbuild')||names.has('@elgato/cli'))throw Error('Invalid SBOM');
 return names.size;
}
export function verifyRelease(directory=path.join(root,'release')){
 const {version}=JSON.parse(fs.readFileSync(path.join(root,'package.json'))),pluginName=`Cardea-Deck-${version}.streamDeckPlugin`,portableName=`Cardea-Deck-${version}-advanced-portable.zip`;
 const entries=inspectZip(path.join(directory,pluginName)),expected=new Set([...pluginFiles,'LICENSE','THIRD-PARTY-NOTICES.txt']);
 for(const entry of entries){const name=entry.name.replace(/^de\.cardea\.deck\.sdPlugin\//,'');if(!expected.delete(name))throw Error('Unexpected or duplicate plugin file: '+name);}
 if(expected.size||entries.reduce((sum,e)=>sum+e.bytes,0)>8*1024*1024)throw Error('Incomplete or oversized plugin');
 const portable=inspectZip(path.join(directory,portableName));if(portable.length>100||portable.filter(e=>/\.(png|jpe?g|svg)$/i.test(e.name)).length>40)throw Error('Portable archive accumulated generated assets');
 if(portable.some(e=>/(?:^|\/)(?:node_modules|\.git|logs)(?:\/|$)|(?:^|\/)(?:connection|state|codex-client|codex-attempts)\.json$|\.log$/i.test(e.name)))throw Error('Private or development file in portable archive');
 for(const name of pluginFiles){
  const entry=entries.find(e=>e.name.replace(/^de\.cardea\.deck\.sdPlugin\//,'')===name),file=path.join(root,'dist/de.cardea.deck.sdPlugin',name);
  if(entry.sha256!==createHash('sha256').update(fs.readFileSync(file)).digest('hex'))throw Error('Packaged runtime differs from checked build');
 }
 const recovery='Remove-Claude-Hooks.ps1',digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 if(digest(path.join(directory,recovery))!==digest(path.join(root,recovery)))throw Error('Recovery helper differs from checked source');
 const sbomName=`Cardea-Deck-${version}.cdx.json`,sbomComponents=checkSbom(JSON.parse(fs.readFileSync(path.join(directory,sbomName),'utf8')));
 const checksums=new Set([pluginName,portableName,recovery,sbomName]);
 for(const line of fs.readFileSync(path.join(directory,'SHA256SUMS.txt'),'utf8').trim().split(/\r?\n/)){
  const match=/^([a-f0-9]{64})  (.+)$/.exec(line);if(!match||!checksums.delete(match[2])||digest(path.join(directory,match[2]))!==match[1])throw Error('Release checksum mismatch');
 }
 if(checksums.size)throw Error('Missing release checksum');
 return{version,plugin:pluginName,pluginFiles:entries.length,pluginBytes:fs.statSync(path.join(directory,pluginName)).size,portableFiles:portable.length,portableImages:portable.filter(e=>/\.(png|jpe?g|svg)$/i.test(e.name)).length,sbomComponents};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(verifyRelease(),null,2));
