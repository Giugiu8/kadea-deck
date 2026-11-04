import fs from 'node:fs';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {hookOwner,installedGroups,mergeHooks} from '../claude-hooks.mjs';
import {loadPolicy,machinePolicyFile,writeConfig} from './approval-policy.mjs';
import {restrictDirectory} from '../windows-acl.mjs';
import {managedRoot,readManagedState} from '../managed-state.mjs';
export const APPROVAL_CONSENT='approve-by-key';
export const CODEX_CONSENT='approve-codex-by-key';
const COMMANDS=['setupClaude','enableApprovals','disableApprovals','removeStatus','removeClaude','enableCodexApprovals','disableCodexApprovals'];
export {managedRoot,readManagedState};
const fail=code=>{throw Error(code);};
const bytes=file=>{try{return fs.readFileSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
const hash=value=>value===null?null:createHash('sha256').update(value).digest('hex');
function safePath(root,target){
 root=path.resolve(root);target=path.resolve(target);const relative=path.relative(root,target);
 if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))fail('invalid_path');
 for(let current=target;;current=path.dirname(current)){
  try{if(fs.lstatSync(current).isSymbolicLink())fail('linked_path');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(current.toLowerCase()===root.toLowerCase())break;if(path.dirname(current)===current)fail('invalid_path');
 }
 return target;
}
function parse(value){if(value===null)return{};if(value.length>2_000_000)fail('invalid_settings');try{const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(value));if(!result||typeof result!=='object'||Array.isArray(result))fail('invalid_settings');return result;}catch{fail('invalid_settings');}}
function legacy(settings){return Object.values(settings.hooks??{}).some(groups=>Array.isArray(groups)&&groups.some(group=>Array.isArray(group.hooks)&&group.hooks.some(hook=>hookOwner(hook)==='legacy')))||hookOwner(settings.statusLine?.command)==='legacy';}
export function createIntegrations({home,appData,plugin,node=process.execPath,beforeWrite=()=>{},configDir=process.env.CLAUDE_CONFIG_DIR,managedDirectory=managedRoot(),machineFile=machinePolicyFile(),restrict=restrictDirectory}={}){
 const settings=()=>safePath(home,path.join(home,'.claude/settings.json'));
 const runtime=()=>safePath(home,path.join(home,'.cardeadeck'));
 function validate({claude=true}={}){
  if(!home||!appData||!plugin||!path.isAbsolute(home)||!path.isAbsolute(appData)||!path.isAbsolute(plugin))fail('plugin_location');
  const plugins=path.join(appData,'Elgato/StreamDeck/Plugins'),expected=path.join(plugins,'de.cardea.deck.sdPlugin');
  if(path.resolve(plugin).toLowerCase()!==path.resolve(expected).toLowerCase())fail('plugin_location');safePath(appData,plugin);
  let manifest;try{manifest=JSON.parse(fs.readFileSync(path.join(plugin,'manifest.json'),'utf8'));}catch{fail('plugin_location');}
  if(manifest.UUID!=='de.cardea.deck')fail('plugin_location');
  for(const name of['approval-rules','bridge','runtime','statusline','permission-auth','receiver-client','tool-summary']){const file=safePath(plugin,path.join(plugin,'hooks',name+'.cjs'));if(!fs.existsSync(file)||!fs.statSync(file).isFile())fail('incomplete_plugin');}
  if(!fs.existsSync(node)||!fs.statSync(node).isFile())fail('runtime_missing');
  if(claude){if(configDir)fail('custom_config');settings();}runtime();
 }
 function status(){
  try{
   validate();const input=parse(bytes(settings())),policy=loadPolicy({directory:runtime(),machineFile}),managed=readManagedState(managedDirectory),codexApprovals=policy.lockedOff?'locked_off':policy.codexEnabled?'on':'off';
   if(legacy(input))return{claude:'legacy_present',approvals:'off',codexApprovals,customStatusLine:false,allowlist:policy.allowlist};
   const custom=!!input.statusLine&&!hookOwner(input.statusLine.command);
   // Managed: the organization owns the hook entries, the user only the key-approval opt-in.
   if(managed.active)return{claude:managed.status?'managed':'managed_missing',approvals:!managed.approval?'not_deployed':policy.lockedOff?'locked_off':policy.enabled?'on':'hook_inactive',customStatusLine:custom,allowlist:policy.allowlist,codexApprovals,managed:true};
   const groups=installedGroups(input,{node,plugin});
   const approvals=policy.lockedOff?'locked_off':groups.approvalPresent?(!policy.enabled?'hook_inactive':groups.approval?'on':'repair_needed'):'off';
   return{claude:groups.status?'installed':groups.statusPresent?'repair_needed':'not_set_up',approvals,codexApprovals,customStatusLine:custom,allowlist:policy.allowlist};
  }catch(error){return{claude:['plugin_location','linked_path','incomplete_plugin','runtime_missing','custom_config'].includes(error.message)?error.message:'invalid_settings',approvals:'off',customStatusLine:false};}
 }
 function update(command,{consent}={}){
  if(!COMMANDS.includes(command))fail('invalid_command');validate();
  if(command==='enableApprovals'&&consent!==APPROVAL_CONSENT)fail('consent_required');
  if(command==='enableCodexApprovals'&&consent!==CODEX_CONSENT)fail('consent_required');
  const target=settings(),root=runtime();fs.mkdirSync(root,{recursive:true,mode:0o700});
  try{restrict(root);}catch{fail('acl_failed');}
  const policy=loadPolicy({directory:root,machineFile}),managed=readManagedState(managedDirectory);
  if(['enableApprovals','enableCodexApprovals'].includes(command)&&policy.lockedOff)fail('locked_off');
  // Codex consent is a choice of its own: it touches no Claude settings.
  if(command==='enableCodexApprovals'){writeConfig(root,{codexApprovalsEnabled:true,codexConsentAt:new Date().toISOString()});return status();}
  if(command==='disableCodexApprovals'){writeConfig(root,{codexApprovalsEnabled:false});return status();}
  if(managed.active){
   // Never write hooks into the user's file here: they would not run, or would bypass IT.
   if(command==='enableApprovals'&&managed.approval)writeConfig(root,{approvalsEnabled:true,approvalsConsentAt:new Date().toISOString()});
   else if(command==='disableApprovals')writeConfig(root,{approvalsEnabled:false});
   // Removing one's own old entries is still fine, and writes nothing if there are none.
   else if(!['removeStatus','removeClaude'].includes(command))fail('managed');
   if(!['removeStatus','removeClaude'].includes(command))return status();
  }
  const lock=safePath(home,path.join(root,'integrations.lock'));let handle;
  try{handle=fs.openSync(lock,'wx');}catch(error){
   if(error.code!=='EEXIST')throw error;
   let prior;try{prior=JSON.parse(fs.readFileSync(lock,'utf8'));}catch{fail('busy');}
   if(!Number.isInteger(prior.pid)||!Number.isFinite(prior.at))fail('busy');
   try{process.kill(prior.pid,0);fail('busy');}catch(probe){if(probe.code!=='ESRCH')fail('busy');}
   fs.unlinkSync(lock);handle=fs.openSync(lock,'wx');
  }
  let temp;
  try{
   fs.writeFileSync(handle,JSON.stringify({pid:process.pid,at:Date.now()}));
   const before=bytes(target),input=parse(before);if(['setupClaude','enableApprovals'].includes(command)&&legacy(input))fail('legacy_present');
   const present=installedGroups(input,{node,plugin});
   // Turning off takes effect before the hook entry goes; turning on only after it exists.
   if(['disableApprovals','removeClaude'].includes(command))writeConfig(root,{approvalsEnabled:false});
   const output=mergeHooks(input,{node,plugin,
    status:command==='setupClaude'||present.statusPresent,
    // A hook left by an older version without recorded consent does not survive setup.
    approval:command==='enableApprovals'||(command==='setupClaude'&&policy.enabled),
    remove:command==='removeClaude'?true:command==='removeStatus'?'status':command==='disableApprovals'?'approval':false});
   if(JSON.stringify(output)!==JSON.stringify(input)){
    const backup=safePath(home,path.join(root,'backups','integrations-'+randomUUID()));fs.mkdirSync(backup,{recursive:true,mode:0o700});
    fs.writeFileSync(path.join(backup,'record.json'),JSON.stringify({schema:1,existed:before!==null,at:new Date().toISOString()}),{mode:0o600,flag:'wx'});
    if(before!==null)fs.writeFileSync(path.join(backup,'settings.json'),before,{mode:0o600,flag:'wx'});
    fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});temp=target+'.cardea-'+randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(output,null,2)+'\n',{mode:0o600,flag:'wx'});
    beforeWrite();safePath(home,target);if(hash(bytes(target))!==hash(before))fail('settings_changed');
    fs.renameSync(temp,target);temp=null;
   }
   if(command==='enableApprovals')writeConfig(root,{approvalsEnabled:true,approvalsConsentAt:new Date().toISOString()});
   return status();
  }finally{if(temp&&fs.existsSync(temp))fs.unlinkSync(temp);fs.closeSync(handle);fs.unlinkSync(lock);}
 }
 function codexEnabled(){try{return parse(bytes(safePath(home,path.join(runtime(),'codex-client.json')))).enabled===true;}catch{return false;}}
 function saveCodex(executable){
  validate({claude:false});if(typeof executable!=='string'||!path.isAbsolute(executable)||!fs.existsSync(executable))fail('codex_missing');
  const target=safePath(home,path.join(runtime(),'codex-client.json')),before=bytes(target),input=parse(before),temp=target+'.'+randomUUID()+'.tmp';
  fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
  try{fs.writeFileSync(temp,JSON.stringify({...input,enabled:true,executable}),{mode:0o600,flag:'wx'});if(hash(bytes(target))!==hash(before))fail('settings_changed');fs.renameSync(temp,target);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
 }
 return{status,update,codexEnabled,saveCodex};
}
