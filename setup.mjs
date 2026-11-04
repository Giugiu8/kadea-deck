import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mergeHooks,owned} from './setup-hooks.mjs';
import {restrictDirectory} from './windows-acl.mjs';
import {managedRoot,readManagedState} from './managed-state.mjs';
import {inspectLegacy,removeLegacyHooks,rewriteLegacyProfile,legacyConnectionFile,runtimeMetadataFiles} from './migration.mjs';
const uuid='de.cardea.deck.sdPlugin',profileId='83F6A461-7D15-4BBF-B345-C10B99A70961.sdProfile';
// Fatal decoding: invalid bytes in someone's settings must stop setup, not be replaced and written back.
const read=f=>new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(f));
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
export function createPlan({directory,home,appData,node=process.execPath,deviceId=null,codexExecutable=null,approvals=false,managedDirectory=managedRoot()}={}){
 if(readManagedState(managedDirectory).active)throw Error('Claude hooks on this PC are managed by your organization. Install the plugin only; see docs/MANAGED-SETTINGS.md.');
 const version=verifyBundle(directory),pluginRoot=path.join(appData,'Elgato/StreamDeck/Plugins'),profilesRoot=path.join(appData,'Elgato/StreamDeck/ProfilesV3');
 const plugin=localPath(pluginRoot,path.join(pluginRoot,uuid)),profile=localPath(profilesRoot,path.join(profilesRoot,profileId));
 const runtime=localPath(home,path.join(home,'.cardeadeck')),receipt=localPath(runtime,path.join(runtime,'install.json'));
 const migration=inspectLegacy({home,appData,newRuntime:runtime,newReceipt:receipt,newPlugin:plugin,profile});
 if(!fs.existsSync(receipt)&&!migration&&(fs.existsSync(plugin)||fs.existsSync(profile)))throw Error('An unmanaged Cardea Deck installation already exists; preserve it and inspect it before upgrading');
 if(fs.existsSync(receipt)){const previous=json(receipt);if(previous.schema!==1||previous.plugin!==plugin||previous.profile!==profile)throw Error('Installation receipt does not match this PC');}
 const devices=new Set();if(fs.existsSync(profilesRoot))for(const entry of fs.readdirSync(profilesRoot,{withFileTypes:true}))if(entry.isDirectory()&&!entry.isSymbolicLink())try{const m=json(path.join(profilesRoot,entry.name,'manifest.json'));if(m.Device?.Model==='20GBA9901'&&typeof m.Device.UUID==='string'&&m.Device.UUID)devices.add(m.Device.UUID);}catch{}
 if(deviceId&&!devices.has(deviceId))throw Error('Requested MK.2 device is not known to Stream Deck');
 if(!deviceId&&devices.size!==1)throw Error('Connect one Stream Deck MK.2 and open Stream Deck once. Multiple devices require --device-id.');
 deviceId??=[...devices][0];
 const settings=localPath(home,path.join(home,'.claude/settings.json')),settingsHash=digest(settings);
 const input=settingsHash?json(settings):{};const merged=mergeHooks(migration?removeLegacyHooks(input):input,{node,plugin,approval:approvals===true});
 const sourcePlugin=path.join(directory,uuid),sourceProfile=path.join(directory,'profile-template',profileId);
 if(json(path.join(sourcePlugin,'manifest.json')).UUID!=='de.cardea.deck')throw Error('Unexpected plugin identity');
 if(codexExecutable&&!/^[A-Z]:[\\/]Program Files[\\/]WindowsApps[\\/]OpenAI\.Codex_[^\\/]+[\\/]app[\\/]resources[\\/]codex\.exe$/i.test(codexExecutable))throw Error('Unsupported Codex executable path');
 return{version,directory,home,appData,runtime,receipt,plugin,profile,settings,settingsHash,merged,deviceId,sourcePlugin,sourceProfile,codexExecutable,migration,approvals:approvals===true};
}
function atomic(file,content){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temp,content,{mode:0o600,flag:'wx'});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}}
// Retire beside each target, so redirected AppData never requires a cross-volume
// rename. A private copy and location record are also retained in the backup.
function preserve(target,backup,undo,retire=false){
 const item={target,saved:path.join(backup,String(undo.length)),exists:fs.existsSync(target)};
 if(item.exists)fs.cpSync(target,item.saved,{recursive:true});
 // A failed backup has not changed the target and must never be restored.
 undo.push(item);
 if(item.exists&&retire){const retired=target+'.cardea-backup-'+randomUUID();fs.renameSync(target,retired);item.retired=retired;}
 return item;
}
function retireWithoutCopy(target,undo){
 const item={target,exists:fs.existsSync(target)};undo.push(item);
 if(item.exists){item.retired=target+'.cardea-backup-'+randomUUID();fs.renameSync(target,item.retired);}
 return item;
}
function retireRuntime(runtime,undo){
 const retired=runtime+'.cardea-backup-'+randomUUID();fs.mkdirSync(retired,{mode:0o700});
 const item={target:runtime,runtimeRetired:retired,entries:[]};undo.push(item);
 for(const name of fs.readdirSync(runtime)){
  if(name==='install.lock')continue;
  const from=path.join(runtime,name),to=path.join(retired,name);item.entries.push(name);fs.renameSync(from,to);
 }
 return item;
}
function rollback(undo){
 for(const item of [...undo].reverse()){
  if(item.written&&digest(item.target)!==item.written)continue;
  if(item.runtimeRetired){for(const name of [...item.entries].reverse()){const from=path.join(item.runtimeRetired,name),to=path.join(item.target,name);if(!fs.existsSync(from))continue;if(fs.existsSync(to))fs.renameSync(to,to+'.cardea-failed-'+randomUUID());fs.renameSync(from,to);}try{fs.rmdirSync(item.runtimeRetired);}catch{}continue;}
  if(item.retired){if(fs.existsSync(item.target))fs.renameSync(item.target,item.target+'.cardea-failed-'+randomUUID());fs.renameSync(item.retired,item.target);}
  else if(item.exists)fs.cpSync(item.saved,item.target,{recursive:true});
  else if(fs.existsSync(item.target))fs.renameSync(item.target,item.target+'.cardea-failed-'+randomUUID());
 }
}
export function applyPlan(plan,{host=()=>{}}={}){
 const {runtime,migration}=plan;fs.mkdirSync(runtime,{recursive:true,mode:0o700});restrictDirectory(runtime);const lock=path.join(runtime,'install.lock');
 let oldHandle=null,handle=null;const undo=[];let stopped=false;
 if(migration)oldHandle=fs.openSync(path.join(migration.runtime,'install.lock'),'wx');
 try{handle=fs.openSync(lock,'wx');}catch(error){if(oldHandle!==null){fs.closeSync(oldHandle);fs.unlinkSync(path.join(migration.runtime,'install.lock'));}throw error;}
 const backup=path.join(runtime,'backups',randomUUID());
 try{
  fs.mkdirSync(backup,{recursive:true,mode:0o700});
  if(digest(plan.settings)!==plan.settingsHash)throw Error('Claude settings changed after preparation; run Setup again');
  stopped=true;host('Stop',migration?.pluginId);
  // Recheck after closing the host, before any configuration is written.
  if(digest(plan.settings)!==plan.settingsHash)throw Error('Claude settings changed during setup');
  if(migration){const current=inspectLegacy({home:plan.home,appData:plan.appData,newRuntime:plan.runtime,newReceipt:plan.receipt,newPlugin:plan.plugin,profile:plan.profile,lockedNewRuntime:true});if(!current||current.receipt!==migration.receipt||current.plugin!==migration.plugin||current.profile!==migration.profile)throw Error('Legacy installation changed during setup; retry setup');}
  if(migration){const connection=legacyConnectionFile(migration.runtime);if(fs.existsSync(connection))retireWithoutCopy(connection,undo);}
  if(migration)preserve(migration.plugin,backup,undo,true);
  preserve(plan.plugin,backup,undo,true);fs.mkdirSync(path.dirname(plan.plugin),{recursive:true});fs.cpSync(plan.sourcePlugin,plan.plugin,{recursive:true});
  if(migration){
   const item=preserve(plan.profile,backup,undo,true);fs.cpSync(item.retired,plan.profile,{recursive:true});rewriteLegacyProfile(plan.profile,{template:plan.sourceProfile});
  }
  else if(!fs.existsSync(plan.profile)){preserve(plan.profile,backup,undo);fs.mkdirSync(path.dirname(plan.profile),{recursive:true});fs.cpSync(plan.sourceProfile,plan.profile,{recursive:true});const file=path.join(plan.profile,'manifest.json'),top=json(file);top.Device.UUID=plan.deviceId;atomic(file,JSON.stringify(top));}
  else{const file=path.join(plan.profile,'manifest.json'),top=json(file);if(top.Name==='Cardea Deck'){const item=preserve(file,backup,undo);top.Name='Cardea Deck';atomic(file,JSON.stringify(top));item.written=digest(file);}}
  if(digest(plan.settings)!==plan.settingsHash)throw Error('Claude settings changed during setup');
  const settingsUndo=preserve(plan.settings,backup,undo);atomic(plan.settings,JSON.stringify(plan.merged,null,2)+'\n');settingsUndo.written=digest(plan.settings);
  if(migration){
   for(const name of runtimeMetadataFiles){
    const source=path.join(migration.runtime,name);if(!fs.existsSync(source))continue;
    const target=path.join(runtime,name);preserve(target,backup,undo);fs.copyFileSync(source,target);fs.chmodSync(target,0o600);
   }
  }
  if(plan.codexExecutable){const file=path.join(runtime,'codex-client.json');preserve(file,backup,undo);atomic(file,JSON.stringify({enabled:true,executable:plan.codexExecutable}));}
  {const file=path.join(runtime,'config.json'),current=fs.existsSync(file)?json(file):{};preserve(file,backup,undo);atomic(file,JSON.stringify({...current,schema:1,approvalsEnabled:plan.approvals,...(plan.approvals?{approvalsConsentAt:new Date().toISOString()}:{})},null,2)+'\n');}
  preserve(plan.receipt,backup,undo);atomic(plan.receipt,JSON.stringify({schema:1,version:plan.version,plugin:plan.plugin,profile:plan.profile,backup,installedAt:new Date().toISOString()}));
  if(migration)retireRuntime(migration.runtime,undo);
  atomic(path.join(backup,'locations.json'),JSON.stringify(undo));
  return{version:plan.version,backup,customStatusLinePreserved:!!plan.merged.statusLine&&!owned(plan.merged.statusLine.command)};
 }catch(error){
  rollback(undo);
  throw error;
 }finally{try{if(stopped)host('Start',migration?.pluginId);}finally{
  fs.closeSync(handle);if(fs.existsSync(lock))fs.unlinkSync(lock);
  if(oldHandle!==null){fs.closeSync(oldHandle);const oldLock=path.join(migration.runtime,'install.lock');if(fs.existsSync(oldLock))fs.unlinkSync(oldLock);try{fs.rmdirSync(migration.runtime);}catch{}}
 }}
}
export function uninstall({home,appData,node=process.execPath,host=()=>{}}){
 const runtime=localPath(home,path.join(home,'.cardeadeck')),receipt=path.join(runtime,'install.json'),record=json(receipt);
 const plugin=localPath(path.join(appData,'Elgato/StreamDeck/Plugins'),record.plugin),profile=localPath(path.join(appData,'Elgato/StreamDeck/ProfilesV3'),record.profile);
 if(record.schema!==1||path.basename(plugin)!==uuid||path.basename(profile)!==profileId)throw Error('Unexpected installation receipt');
 const settings=localPath(home,path.join(home,'.claude/settings.json')),before=digest(settings),output=mergeHooks(before?json(settings):{},{node,plugin,remove:true});
 const lock=path.join(runtime,'install.lock'),handle=fs.openSync(lock,'wx'),archive=path.join(runtime,'uninstalled-'+randomUUID()),undo=[];let stopped=false;
 try{fs.mkdirSync(archive,{recursive:true,mode:0o700});stopped=true;host('Stop');if(digest(settings)!==before)throw Error('Claude settings changed; retry uninstall');const item=preserve(settings,archive,undo);atomic(settings,JSON.stringify(output,null,2)+'\n');item.written=digest(settings);
  {const file=path.join(runtime,'config.json');if(fs.existsSync(file)){preserve(file,archive,undo);atomic(file,JSON.stringify({...json(file),approvalsEnabled:false},null,2)+'\n');}}
  for(const target of [plugin,profile,receipt])preserve(target,archive,undo,true);
  atomic(path.join(archive,'locations.json'),JSON.stringify(undo));return archive;
 }catch(error){rollback(undo);throw error;}finally{try{if(stopped)host('Start');}finally{fs.closeSync(handle);fs.unlinkSync(lock);}}
}
export function createHostController(directory,execute=execFileSync){
 return(mode,previousPluginId)=>{
  if(!['Stop','Start'].includes(mode))throw Error('Unknown host action');
  if(previousPluginId&&!/^[a-z0-9]+(?:\.[a-z0-9]+)+$/.test(previousPluginId))throw Error('Invalid previous plugin identity');
  const script='& {\n'+read(path.join(directory,'host.ps1'))+'\n} -Mode '+mode+(previousPluginId?' -PreviousPluginId '+previousPluginId:'');
  execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:'pipe'});
 };
}
function discoverCodex(){try{return execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$p=Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1; if($p){$e=Join-Path $p.InstallLocation 'app/resources/codex.exe'; if(Test-Path -LiteralPath $e){Write-Output $e}}"],{encoding:'utf8',windowsHide:true}).trim()||null;}catch{return null;}}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.platform!=='win32'||Number(process.versions.node.split('.')[0])<22)throw Error('Windows and Node.js 22 or later are required');
  const directory=path.dirname(fileURLToPath(import.meta.url)),home=process.env.USERPROFILE,appData=process.env.APPDATA;if(!home||!appData)throw Error('Windows user profile is unavailable');
  const host=createHostController(directory);
  if(process.argv.includes('--uninstall')){uninstall({home,appData,host});console.log('Removed own hooks and archived the plugin/profile. Local state and backups retained.');}
  else{const i=process.argv.indexOf('--device-id'),plan=createPlan({directory,home,appData,deviceId:i>=0?process.argv[i+1]:null,codexExecutable:discoverCodex(),approvals:process.argv.includes('--enable-approvals')});if(process.argv.includes('--check'))console.log(`Ready: Cardea Deck ${plan.version}, MK.2, existing Claude settings preserved. Codex app: ${!!plan.codexExecutable}. Nothing changed.`);else{applyPlan(plan,{host});console.log(`Installed Cardea Deck ${plan.version}. Select the Cardea Deck profile in Stream Deck. Customize Apps on page 4. Run Doctor.ps1 for diagnostics.`);}}
 }catch(error){console.error('Cardea Deck: '+error.message);process.exitCode=1;}
}
