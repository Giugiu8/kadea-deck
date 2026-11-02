import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mergeHooks,owned} from './setup-hooks.mjs';
const uuid='de.cardea.kadeadeck.sdPlugin',profileId='83F6A461-7D15-4BBF-B345-C10B99A70961.sdProfile';
const read=f=>fs.readFileSync(f,'utf8');
const json=f=>JSON.parse(read(f).replace(/^\uFEFF/,''));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=f=>fs.existsSync(f)?hash(fs.readFileSync(f)):null;
export function localPath(root,target){
 root=path.resolve(root);target=path.resolve(target);const rel=path.relative(root,target);
 if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('Path escapes the expected installation directory');
 let current=target;while(true){if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('Linked installation path: keep the existing development install and use a separate PC');if(current===root)break;const parent=path.dirname(current);if(parent===current)throw Error('Invalid installation root');current=parent;}return target;
}
export function verifyBundle(directory){
 const integrity=json(path.join(directory,'integrity.json'));
 if(integrity.schema!==1||!integrity.files||Object.keys(integrity.files).length<5)throw Error('Invalid release integrity manifest');
 for(const [rel,expected]of Object.entries(integrity.files)){const file=localPath(directory,path.join(directory,rel));if(!/^[a-f0-9]{64}$/.test(expected)||digest(file)!==expected)throw Error('Download verification failed: extract a fresh release archive');}
 return integrity.version;
}
export function createPlan({directory,home,appData,node=process.execPath,deviceId=null,codexExecutable=null}={}){
 const version=verifyBundle(directory),pluginRoot=path.join(appData,'Elgato/StreamDeck/Plugins'),profilesRoot=path.join(appData,'Elgato/StreamDeck/ProfilesV3');
 const plugin=localPath(pluginRoot,path.join(pluginRoot,uuid)),profile=localPath(profilesRoot,path.join(profilesRoot,profileId));
 const runtime=localPath(home,path.join(home,'.kadeadeck')),receipt=localPath(runtime,path.join(runtime,'install.json'));
 if(!fs.existsSync(receipt)&&(fs.existsSync(plugin)||fs.existsSync(profile)))throw Error('An unmanaged Kadea Deck installation already exists; preserve it and inspect it before upgrading');
 if(fs.existsSync(receipt)){const previous=json(receipt);if(previous.schema!==1||previous.plugin!==plugin||previous.profile!==profile)throw Error('Installation receipt does not match this PC');}
 const devices=new Set();if(fs.existsSync(profilesRoot))for(const entry of fs.readdirSync(profilesRoot,{withFileTypes:true}))if(entry.isDirectory()&&!entry.isSymbolicLink())try{const m=json(path.join(profilesRoot,entry.name,'manifest.json'));if(m.Device?.Model==='20GBA9901'&&typeof m.Device.UUID==='string'&&m.Device.UUID)devices.add(m.Device.UUID);}catch{}
 if(deviceId&&!devices.has(deviceId))throw Error('Requested MK.2 device is not known to Stream Deck');
 if(!deviceId&&devices.size!==1)throw Error('Connect one Stream Deck MK.2 and open Stream Deck once. Multiple devices require --device-id.');
 deviceId??=[...devices][0];
 const settings=localPath(home,path.join(home,'.claude/settings.json')),settingsHash=digest(settings);
 const input=settingsHash?json(settings):{};const merged=mergeHooks(input,{node,plugin});
 const sourcePlugin=path.join(directory,uuid),sourceProfile=path.join(directory,'profile-template',profileId);
 if(json(path.join(sourcePlugin,'manifest.json')).UUID!=='de.cardea.kadeadeck')throw Error('Unexpected plugin identity');
 if(codexExecutable&&!/^[A-Z]:[\\/]Program Files[\\/]WindowsApps[\\/]OpenAI\.Codex_[^\\/]+[\\/]app[\\/]resources[\\/]codex\.exe$/i.test(codexExecutable))throw Error('Unsupported Codex executable path');
 return{version,directory,home,appData,runtime,receipt,plugin,profile,settings,settingsHash,merged,deviceId,sourcePlugin,sourceProfile,codexExecutable};
}
function atomic(file,content){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temp,content,{mode:0o600,flag:'wx'});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}}
// Retire beside each target, so redirected AppData never requires a cross-volume
// rename. A private copy and location record are also retained in the backup.
function preserve(target,backup,undo,retire=false){
 const item={target,saved:path.join(backup,String(undo.length)),exists:fs.existsSync(target)};
 if(item.exists)fs.cpSync(target,item.saved,{recursive:true});
 // A failed backup has not changed the target and must never be restored.
 undo.push(item);
 if(item.exists&&retire){const retired=target+'.kadea-backup-'+randomUUID();fs.renameSync(target,retired);item.retired=retired;}
 return item;
}
function rollback(undo){
 for(const item of [...undo].reverse()){
  if(item.written&&digest(item.target)!==item.written)continue;
  if(item.retired){if(fs.existsSync(item.target))fs.renameSync(item.target,item.target+'.kadea-failed-'+randomUUID());fs.renameSync(item.retired,item.target);}
  else if(item.exists)fs.cpSync(item.saved,item.target,{recursive:true});
  else if(fs.existsSync(item.target))fs.renameSync(item.target,item.target+'.kadea-failed-'+randomUUID());
 }
}
export function applyPlan(plan,{host=()=>{}}={}){
 const {runtime}=plan;fs.mkdirSync(runtime,{recursive:true,mode:0o700});const lock=path.join(runtime,'install.lock');const handle=fs.openSync(lock,'wx');
 const backup=path.join(runtime,'backups',randomUUID()),undo=[];let stopped=false;
 try{
  fs.mkdirSync(backup,{recursive:true,mode:0o700});
  if(digest(plan.settings)!==plan.settingsHash)throw Error('Claude settings changed after preparation; run Setup again');
  stopped=true;host('Stop');
  // Recheck after closing the host, before any configuration is written.
  if(digest(plan.settings)!==plan.settingsHash)throw Error('Claude settings changed during setup');
  preserve(plan.plugin,backup,undo,true);fs.mkdirSync(path.dirname(plan.plugin),{recursive:true});fs.cpSync(plan.sourcePlugin,plan.plugin,{recursive:true});
  if(!fs.existsSync(plan.profile)){preserve(plan.profile,backup,undo);fs.mkdirSync(path.dirname(plan.profile),{recursive:true});fs.cpSync(plan.sourceProfile,plan.profile,{recursive:true});const file=path.join(plan.profile,'manifest.json'),top=json(file);top.Device.UUID=plan.deviceId;atomic(file,JSON.stringify(top));}
  const settingsUndo=preserve(plan.settings,backup,undo);atomic(plan.settings,JSON.stringify(plan.merged,null,2)+'\n');settingsUndo.written=digest(plan.settings);
  if(plan.codexExecutable){const file=path.join(runtime,'codex-client.json');preserve(file,backup,undo);atomic(file,JSON.stringify({enabled:true,executable:plan.codexExecutable}));}
  preserve(plan.receipt,backup,undo);atomic(plan.receipt,JSON.stringify({schema:1,version:plan.version,plugin:plan.plugin,profile:plan.profile,backup,installedAt:new Date().toISOString()}));
  atomic(path.join(backup,'locations.json'),JSON.stringify(undo));
  return{version:plan.version,backup,customStatusLinePreserved:!!plan.merged.statusLine&&!owned(plan.merged.statusLine.command)};
 }catch(error){
  rollback(undo);
  throw error;
 }finally{try{if(stopped)host('Start');}finally{fs.closeSync(handle);fs.unlinkSync(lock);}}
}
export function uninstall({home,appData,node=process.execPath,host=()=>{}}){
 const runtime=localPath(home,path.join(home,'.kadeadeck')),receipt=path.join(runtime,'install.json'),record=json(receipt);
 const plugin=localPath(path.join(appData,'Elgato/StreamDeck/Plugins'),record.plugin),profile=localPath(path.join(appData,'Elgato/StreamDeck/ProfilesV3'),record.profile);
 if(record.schema!==1||path.basename(plugin)!==uuid||path.basename(profile)!==profileId)throw Error('Unexpected installation receipt');
 const settings=localPath(home,path.join(home,'.claude/settings.json')),before=digest(settings),output=mergeHooks(before?json(settings):{},{node,plugin,remove:true});
 const lock=path.join(runtime,'install.lock'),handle=fs.openSync(lock,'wx'),archive=path.join(runtime,'uninstalled-'+randomUUID()),undo=[];let stopped=false;
 try{fs.mkdirSync(archive,{recursive:true,mode:0o700});stopped=true;host('Stop');if(digest(settings)!==before)throw Error('Claude settings changed; retry uninstall');const item=preserve(settings,archive,undo);atomic(settings,JSON.stringify(output,null,2)+'\n');item.written=digest(settings);
  for(const target of [plugin,profile,receipt])preserve(target,archive,undo,true);
  atomic(path.join(archive,'locations.json'),JSON.stringify(undo));return archive;
 }catch(error){rollback(undo);throw error;}finally{try{if(stopped)host('Start');}finally{fs.closeSync(handle);fs.unlinkSync(lock);}}
}
function hostControl(directory,mode){if(!['Stop','Start'].includes(mode))throw Error('Unknown host action');const script='& {\n'+read(path.join(directory,'host.ps1'))+'\n} -Mode '+mode;execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:'pipe'});}
function discoverCodex(){try{return execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$p=Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1; if($p){$e=Join-Path $p.InstallLocation 'app/resources/codex.exe'; if(Test-Path -LiteralPath $e){Write-Output $e}}"],{encoding:'utf8',windowsHide:true}).trim()||null;}catch{return null;}}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.platform!=='win32'||Number(process.versions.node.split('.')[0])<22)throw Error('Windows and Node.js 22 or later are required');
  const directory=path.dirname(fileURLToPath(import.meta.url)),home=process.env.USERPROFILE,appData=process.env.APPDATA;if(!home||!appData)throw Error('Windows user profile is unavailable');
  const host=mode=>hostControl(directory,mode);
  if(process.argv.includes('--uninstall')){uninstall({home,appData,host});console.log('Removed own hooks and archived the plugin/profile. Local state and backups retained.');}
  else{const i=process.argv.indexOf('--device-id'),plan=createPlan({directory,home,appData,deviceId:i>=0?process.argv[i+1]:null,codexExecutable:discoverCodex()});if(process.argv.includes('--check'))console.log(`Ready: Kadea Deck ${plan.version}, MK.2, existing Claude settings preserved. Codex app: ${!!plan.codexExecutable}. Nothing changed.`);else{applyPlan(plan,{host});console.log(`Installed Kadea Deck ${plan.version}. Select the Kadea Deck profile in Stream Deck. Customize Apps on page 4. Run Doctor.ps1 for diagnostics.`);}}
 }catch(error){console.error('Kadea Deck: '+error.message);process.exitCode=1;}
}
