// Kept separate so the retired product spelling is used only during upgrade.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {hookOwner} from './claude-hooks.mjs';

const legacyPluginId='de.cardea.kadeadeck';
const legacyPluginFolder=legacyPluginId+'.sdPlugin';
const legacyRuntimeName='.kadeadeck';
const profileName='83F6A461-7D15-4BBF-B345-C10B99A70961.sdProfile';
export const runtimeMetadataFiles=['state.json','codex-client.json','codex-attempts.json','statusline.json'];
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const factoryArtwork=readJson(fileURLToPath(new URL('./migration-artwork.json',import.meta.url)));
const exists=file=>{try{fs.lstatSync(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const assertPath=(root,target)=>{
 root=path.resolve(root);target=path.resolve(target);const relative=path.relative(root,target);
 if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Legacy installation path is outside its expected root');
 let current=target;
 while(true){if(exists(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('Linked legacy installation path is unsafe');if(current===root)break;const parent=path.dirname(current);if(parent===current)throw Error('Invalid legacy installation root');current=parent;}
 return target;
};
const json=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));

export function inspectLegacy({home,appData,newRuntime,newReceipt,newPlugin,profile,lockedNewRuntime=false}){
 const oldRuntime=assertPath(home,path.join(home,legacyRuntimeName));
 const oldReceipt=assertPath(oldRuntime,path.join(oldRuntime,'install.json'));
 const pluginRoot=path.join(appData,'Elgato/StreamDeck/Plugins');
 const oldPlugin=assertPath(pluginRoot,path.join(pluginRoot,legacyPluginFolder));
 const profilesRoot=path.join(appData,'Elgato/StreamDeck/ProfilesV3');
 const expectedProfile=assertPath(profilesRoot,path.join(profilesRoot,profileName));
 if(!fs.existsSync(oldReceipt)){
  if(fs.existsSync(oldPlugin))throw Error('Unmanaged legacy plugin found; preserve it and inspect it before upgrading');
  return null;
 }
 if(fs.existsSync(newReceipt)||fs.existsSync(newPlugin))throw Error('Both old and new Cardea Deck installations exist; resolve the duplicate installation before setup');
 const record=json(oldReceipt);
 if(record.schema!==1||record.plugin!==oldPlugin||record.profile!==expectedProfile)throw Error('Legacy installation receipt does not match this PC');
 if(!fs.statSync(oldReceipt).isFile()||!fs.existsSync(oldPlugin)||!fs.statSync(oldPlugin).isDirectory())throw Error('Managed legacy plugin is missing or invalid');
 if(!fs.existsSync(expectedProfile)||!fs.statSync(expectedProfile).isDirectory()||path.resolve(profile)!==expectedProfile)throw Error('Managed legacy profile is missing or unexpected');
 for(const name of runtimeMetadataFiles){const file=path.join(oldRuntime,name);if(exists(file)&&(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink()))throw Error('Legacy runtime metadata must be a regular file');}
 if(!lockedNewRuntime&&fs.existsSync(newRuntime)){
  const entries=fs.readdirSync(newRuntime);
  if(entries.length)throw Error('A new Cardea Deck runtime already exists beside the legacy install; resolve the ambiguous state first');
 }
 return{pluginId:legacyPluginId,plugin:oldPlugin,runtime:oldRuntime,receipt:oldReceipt,profile:expectedProfile};
}

const legacyCommand=command=>hookOwner(command)==='legacy';
export function removeLegacyHooks(input){
 const settings=structuredClone(input);
 if(settings.hooks!=null&&(typeof settings.hooks!=='object'||Array.isArray(settings.hooks)))throw Error('Invalid hooks settings');
 for(const [event,groups]of Object.entries(settings.hooks??{})){
  if(!Array.isArray(groups))throw Error('Invalid hook groups');
  settings.hooks[event]=groups.map(group=>{if(!Array.isArray(group.hooks))throw Error('Invalid hook group');return{...group,hooks:group.hooks.filter(h=>!legacyCommand(h.command))};}).filter(group=>group.hooks.length);
  if(!settings.hooks[event].length)delete settings.hooks[event];
 }
 if(legacyCommand(settings.statusLine?.command))delete settings.statusLine;
 return settings;
}

const replaceLegacy=value=>{
 if(typeof value==='string'&&(value===legacyPluginId||value.startsWith(legacyPluginId+'.')))return value.replace(legacyPluginId,'de.cardea.deck');
 if(Array.isArray(value))return value.map(replaceLegacy);
 if(value&&typeof value==='object')for(const key of Object.keys(value))value[key]=replaceLegacy(value[key]);
 return value;
};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const stable=value=>JSON.stringify(canonical(value));
const safeImage=(root,pageId,name)=>{
 if(typeof name!=='string'||!name||path.isAbsolute(name))return null;
 const page=path.join(root,'Profiles',pageId),file=path.resolve(page,name),relative=path.relative(page,file);
 if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))return null;
 let current=file;while(current!==page){if(exists(current)&&fs.lstatSync(current).isSymbolicLink())return null;current=path.dirname(current);}
 return file;
};
function refreshFactoryArtwork(profile,template,artwork){
 if(!template||!artwork?.hashes||!fs.existsSync(path.join(template,'manifest.json')))return;
 const oldRoot=readJson(path.join(profile,'manifest.json')),newRoot=readJson(path.join(template,'manifest.json'));
 const oldPages=oldRoot.Pages?.Pages,newPages=newRoot.Pages?.Pages;if(!Array.isArray(oldPages)||!Array.isArray(newPages))return;
 for(let index=0;index<Math.min(oldPages.length,newPages.length);index++){
  const oldId=oldPages[index],newId=newPages[index],oldFile=path.join(profile,'Profiles',oldId,'manifest.json'),newFile=path.join(template,'Profiles',newId,'manifest.json');
  if(!fs.existsSync(oldFile)||!fs.existsSync(newFile))continue;
  const oldPage=readJson(oldFile),newPage=readJson(newFile),oldActions=oldPage.Controllers?.[0]?.Actions,newActions=newPage.Controllers?.[0]?.Actions;
  if(!oldActions||!newActions)continue;
  for(const [position,oldAction]of Object.entries(oldActions)){
   const newAction=newActions[position];if(!newAction||oldAction.UUID!==newAction.UUID||stable(oldAction.Settings)!==stable(newAction.Settings))continue;
   for(let stateIndex=0;stateIndex<Math.min(oldAction.States?.length??0,newAction.States?.length??0);stateIndex++){
    const oldImage=oldAction.States[stateIndex]?.Image,newImage=newAction.States[stateIndex]?.Image;
    if(!oldImage||!newImage)continue;
    const destination=safeImage(profile,oldId,oldImage),source=safeImage(template,newId,newImage);if(!destination||!source||!exists(destination)||!exists(source))continue;
    if(!fs.lstatSync(destination).isFile()||!fs.lstatSync(source).isFile())continue;
    const oldHash=createHash('sha256').update(fs.readFileSync(destination)).digest('hex');if(!Object.hasOwn(artwork.hashes,oldHash))continue;
    fs.copyFileSync(source,destination);
   }
  }
 }
}
export function rewriteLegacyProfile(profile,{template=null,artwork=factoryArtwork}={}){
 const walk=directory=>{
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
   const file=path.join(directory,entry.name);
   if(entry.isSymbolicLink())throw Error('Linked legacy profile entry is unsafe');
   if(entry.isDirectory())walk(file);
   else if(entry.isFile()&&entry.name.toLowerCase().endsWith('.json')){
    const original=fs.readFileSync(file,'utf8'),updated=JSON.stringify(replaceLegacy(JSON.parse(original.replace(/^\uFEFF/,''))));
    if(updated!==JSON.stringify(JSON.parse(original.replace(/^\uFEFF/,''))))fs.writeFileSync(file,updated+'\n');
   }
  }
 };
 walk(profile);
 const rootFile=path.join(profile,'manifest.json');if(exists(rootFile)){const root=readJson(rootFile);if(root.Name==='Kadea Deck'){root.Name='Cardea Deck';fs.writeFileSync(rootFile,JSON.stringify(root)+'\n');}}
 const profiles=path.join(profile,'Profiles');if(exists(profiles))for(const entry of fs.readdirSync(profiles,{withFileTypes:true}))if(entry.isDirectory()){
  const pageFile=path.join(profiles,entry.name,'manifest.json');if(!exists(pageFile))continue;const page=readJson(pageFile);if(page.Name==='Aktionen'){page.Name='Controls';fs.writeFileSync(pageFile,JSON.stringify(page)+'\n');}
 }
 refreshFactoryArtwork(profile,template,artwork);
}

export function legacyConnectionFile(runtime){return path.join(runtime,'connection.json');}
