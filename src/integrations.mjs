import fs from 'node:fs';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {events,hookOwner,mergeHooks} from '../claude-hooks.mjs';
const fail=code=>{throw Error(code);};
const bytes=file=>{try{return fs.readFileSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
const hash=value=>value===null?null:createHash('sha256').update(value).digest('hex');
function safePath(root,target){
 root=path.resolve(root);target=path.resolve(target);const relative=path.relative(root,target);
 if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))fail('invalid_path');
 for(let current=target;;current=path.dirname(current)){
  if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())fail('linked_path');
  if(current===root)break;if(path.dirname(current)===current)fail('invalid_path');
 }
 return target;
}
function parse(value){if(value===null)return{};if(value.length>2_000_000)fail('invalid_settings');try{const result=JSON.parse(value.toString('utf8').replace(/^\uFEFF/,''));if(!result||typeof result!=='object'||Array.isArray(result))fail('invalid_settings');return result;}catch{fail('invalid_settings');}}
function legacy(settings){return Object.values(settings.hooks??{}).some(groups=>Array.isArray(groups)&&groups.some(group=>Array.isArray(group.hooks)&&group.hooks.some(hook=>hookOwner(hook?.command)==='legacy')))||hookOwner(settings.statusLine?.command)==='legacy';}
export function createIntegrations({home,appData,plugin,node=process.execPath,beforeWrite=()=>{},configDir=process.env.CLAUDE_CONFIG_DIR}={}){
 const settings=()=>safePath(home,path.join(home,'.claude/settings.json'));
 const runtime=()=>safePath(home,path.join(home,'.cardeadeck'));
 function validate(){
  if(!home||!appData||!plugin||!path.isAbsolute(home)||!path.isAbsolute(appData)||!path.isAbsolute(plugin))fail('plugin_location');
  const plugins=path.join(appData,'Elgato/StreamDeck/Plugins'),expected=path.join(plugins,'de.cardea.deck.sdPlugin');
  if(path.resolve(plugin).toLowerCase()!==path.resolve(expected).toLowerCase())fail('plugin_location');safePath(appData,plugin);
  let manifest;try{manifest=JSON.parse(fs.readFileSync(path.join(plugin,'manifest.json'),'utf8'));}catch{fail('plugin_location');}
  if(manifest.UUID!=='de.cardea.deck')fail('plugin_location');
  for(const name of['bridge','runtime','statusline','permission-auth','receiver-client']){const file=safePath(plugin,path.join(plugin,'hooks',name+'.cjs'));if(!fs.existsSync(file)||!fs.statSync(file).isFile())fail('incomplete_plugin');}
  if(!fs.existsSync(node)||!fs.statSync(node).isFile())fail('runtime_missing');
  if(configDir)fail('custom_config');settings();runtime();
 }
 function status(){
  try{
   validate();const input=parse(bytes(settings()));if(legacy(input))return{claude:'legacy_present',customStatusLine:false};
   const expected=mergeHooks({}, {node,plugin}),commands=Object.values(input.hooks??{}).flatMap(groups=>Array.isArray(groups)?groups.flatMap(g=>Array.isArray(g.hooks)?g.hooks:[]):[]);
   const own=commands.filter(h=>hookOwner(h?.command)==='cardea');
   const installed=events.every(event=>input.hooks?.[event]?.some(group=>group.hooks?.some(h=>h.command===expected.hooks[event][0].hooks[0].command)));
   return{claude:installed?'installed':own.length?'repair_needed':'not_set_up',customStatusLine:!!input.statusLine&&!hookOwner(input.statusLine.command)};
  }catch(error){return{claude:['plugin_location','linked_path','incomplete_plugin','runtime_missing','custom_config'].includes(error.message)?error.message:'invalid_settings',customStatusLine:false};}
 }
 function update(command){
  if(!['setupClaude','removeClaude'].includes(command))fail('invalid_command');validate();
  const target=settings(),root=runtime();fs.mkdirSync(root,{recursive:true,mode:0o700});
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
   const before=bytes(target),input=parse(before);if(command==='setupClaude'&&legacy(input))fail('legacy_present');
   const output=mergeHooks(input,{node,plugin,remove:command==='removeClaude'});
   if(JSON.stringify(output)===JSON.stringify(input))return status();
   const backup=safePath(home,path.join(root,'backups','integrations-'+randomUUID()));fs.mkdirSync(backup,{recursive:true,mode:0o700});
   fs.writeFileSync(path.join(backup,'record.json'),JSON.stringify({schema:1,existed:before!==null,at:new Date().toISOString()}),{mode:0o600,flag:'wx'});
   if(before!==null)fs.writeFileSync(path.join(backup,'settings.json'),before,{mode:0o600,flag:'wx'});
   fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});temp=target+'.cardea-'+randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(output,null,2)+'\n',{mode:0o600,flag:'wx'});
   beforeWrite();safePath(home,target);if(hash(bytes(target))!==hash(before))fail('settings_changed');
   fs.renameSync(temp,target);temp=null;return status();
  }finally{if(temp&&fs.existsSync(temp))fs.unlinkSync(temp);fs.closeSync(handle);fs.unlinkSync(lock);}
 }
 function codexEnabled(){try{return parse(bytes(safePath(home,path.join(runtime(),'codex-client.json')))).enabled===true;}catch{return false;}}
 function saveCodex(executable){
  validate();if(typeof executable!=='string'||!path.isAbsolute(executable)||!fs.existsSync(executable))fail('codex_missing');
  const target=safePath(home,path.join(runtime(),'codex-client.json')),before=bytes(target),input=parse(before),temp=target+'.'+randomUUID()+'.tmp';
  fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
  try{fs.writeFileSync(temp,JSON.stringify({...input,enabled:true,executable}),{mode:0o600,flag:'wx'});if(hash(bytes(target))!==hash(before))fail('settings_changed');fs.renameSync(temp,target);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
 }
 return{status,update,codexEnabled,saveCodex};
}
