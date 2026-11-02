// Assemble only an explicit public allowlist. Never export a user profile/runtime.
import fs from 'node:fs';import path from 'node:path';import {execFileSync}from'node:child_process';import {createHash}from'node:crypto';import{fileURLToPath}from'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),{version}=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Expected numeric semantic version');
const node=(...args)=>execFileSync(process.execPath,args,{cwd:root,windowsHide:true,stdio:'inherit'});
node('build.mjs');node('--test','tests/*.test.mjs');node('profile.mjs');
node('node_modules/@elgato/cli/bin/streamdeck.mjs','validate','dist/de.cardea.deck.sdPlugin');
const release=path.join(root,'release');fs.mkdirSync(release,{recursive:true});
const bundle=fs.mkdtempSync(path.join(release,'.staging-'));
try{
 const plugin='de.cardea.deck.sdPlugin';
 // A development build may be running on this PC. Never package its logs or
 // diagnostic files: include only the known build outputs.
 const pluginFiles=['manifest.json','package.json','bin/plugin.mjs','bin/open.exe','hooks/bridge.cjs','hooks/runtime.cjs','hooks/statusline.cjs','pi/index.html','imgs/key.png','imgs/key@2x.png','imgs/plugin.png','imgs/plugin@2x.png'];
 for(const rel of pluginFiles){const destination=path.join(bundle,plugin,rel);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(path.join(root,'dist',plugin,rel),destination);}
 fs.cpSync(path.join(root,'dist/profile-template'),path.join(bundle,'profile-template'),{recursive:true});
 const files=['setup.mjs','setup-hooks.mjs','migration.mjs','migration-artwork.json','Setup.ps1','Uninstall.ps1','host.ps1','Doctor.ps1','doctor.mjs','Install.cmd','Uninstall.cmd','LICENSE','README.md','SECURITY.md','CHANGELOG.md'];
 for(const file of files)fs.copyFileSync(path.join(root,file),path.join(bundle,file));fs.cpSync(path.join(root,'docs'),path.join(bundle,'docs'),{recursive:true});
 let notices='Cardea Deck runtime dependency licenses\n\n';const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json')));const dependencies=[];
 for(const [rel,entry]of Object.entries(lock.packages)){if(!rel||entry.dev||!fs.existsSync(path.join(root,rel)))continue;const directory=path.join(root,rel),pkg=JSON.parse(fs.readFileSync(path.join(directory,'package.json')));const license=fs.readdirSync(directory).find(n=>/^licen[sc]e(?:\.txt|\.md)?$/i.test(n));if(!license)throw Error('Missing dependency license: '+pkg.name);notices+='\n--- '+pkg.name+' '+pkg.version+' ---\n'+fs.readFileSync(path.join(directory,license),'utf8')+'\n';dependencies.push({name:pkg.name,version:pkg.version,license:pkg.license});}
 fs.writeFileSync(path.join(bundle,'THIRD-PARTY-NOTICES.txt'),notices);fs.writeFileSync(path.join(bundle,plugin,'THIRD-PARTY-NOTICES.txt'),notices);fs.copyFileSync(path.join(root,'LICENSE'),path.join(bundle,plugin,'LICENSE'));
 fs.writeFileSync(path.join(bundle,'DEPENDENCIES.json'),JSON.stringify(dependencies,null,2)+'\n');
 let commit;try{commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}).trim();}catch{commit='uncommitted';}
 fs.writeFileSync(path.join(bundle,'build-info.json'),JSON.stringify({version,sourceCommit:commit,platform:'windows',device:'Stream Deck MK.2'},null,2));
 const hashes={};function walk(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())walk(file);else hashes[path.relative(bundle,file).replaceAll('\\','/')]=createHash('sha256').update(fs.readFileSync(file)).digest('hex');}}walk(bundle);
 fs.writeFileSync(path.join(bundle,'integrity.json'),JSON.stringify({schema:1,version,files:hashes},null,2));
 const archive=path.join(release,`Cardea-Deck-${version}-windows.zip`);
 if(fs.existsSync(archive))fs.unlinkSync(archive);
 execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:CARDEA_RELEASE_SOURCE,$env:CARDEA_RELEASE_DEST,[IO.Compression.CompressionLevel]::Optimal,$false)'],{windowsHide:true,stdio:'inherit',env:{...process.env,CARDEA_RELEASE_SOURCE:bundle,CARDEA_RELEASE_DEST:archive}});
 node('node_modules/@elgato/cli/bin/streamdeck.mjs','pack','--force','--no-update-check','--no-file-list','--output',release,path.join(bundle,plugin));
 const pluginDownload=`Cardea-Deck-${version}.streamDeckPlugin`;fs.copyFileSync(path.join(release,'de.cardea.deck.streamDeckPlugin'),path.join(release,pluginDownload));
 const artifacts=[path.basename(archive),pluginDownload];fs.writeFileSync(path.join(release,'SHA256SUMS.txt'),artifacts.map(name=>createHash('sha256').update(fs.readFileSync(path.join(release,name))).digest('hex')+'  '+name).join('\n')+'\n');
 console.log('Release assets prepared in release/. No local configuration exported.');
}finally{
 if(path.dirname(bundle)!==release||!path.basename(bundle).startsWith('.staging-'))throw Error('Unexpected release staging path');fs.rmSync(bundle,{recursive:true,force:true});
}
