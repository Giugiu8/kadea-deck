// Fresh profile template: no source profile, device serial, app paths or chat data.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {renderCardPng} from './render-png.mjs';
export const profileId='83F6A461-7D15-4BBF-B345-C10B99A70961.sdProfile';
export function profileTemplate({version='0.8.0',uuid=randomUUID}={}){
 const ids=Array.from({length:4},()=>uuid().toUpperCase()),defaultId=uuid().toUpperCase();
 const names=['Claude','Codex','Controls','Apps'];
 const own=(kind,settings={})=>action(`de.cardea.deck.${kind}`,'de.cardea.deck','Cardea Deck',settings,version+'.0');
 function action(id,plugin,name,settings={},v='1.0.0.0'){return{ActionID:uuid(),Name:name,UUID:id,Plugin:{UUID:plugin,Name:name,Version:v},LinkedTitle:false,Resources:null,Settings:settings,State:0,States:[{ShowTitle:false}]};}
 const native=(kind,settings={})=>action('com.elgato.openai-codex.'+kind,'com.elgato.openai-codex','Codex',settings);
 const core=(kind,settings={})=>action('com.elgato.streamdeck.'+kind,'com.elgato.streamdeck.'+kind,kind,settings);
 const website=url=>core('system.website',{path:url,openInBrowser:false});
 const newClaude=()=>website('claude://code/new?source=desktop_action');
 const newCodex=()=>native('new-task',{destination:'app-default'});
 const pages=names.map(Name=>({Name,Icon:'',Controllers:[{Type:'Keypad',Actions:{}}]}));
 const a=pages.map(p=>p.Controllers[0].Actions),slots=['0,0','1,0','2,0','0,1','1,1','2,1'];
 slots.forEach((pos,slot)=>{a[0][pos]=own('session',{slot,page:'claude'});a[1][pos]=own('codex-session',{slot});});
 for(let p=0;p<2;p++){a[p]['3,0']=own(p?'codex-permission':'permission',{decision:'allow'});a[p]['4,0']=own(p?'codex-permission':'permission',{decision:'deny'});}
 a[0]['3,1']=newClaude();a[0]['4,1']=own('ack');a[1]['3,1']=newCodex();a[1]['4,1']=native('dictate');
 [own('codex-stop'),native('settings-v2',{target:'selected'}),native('dictate'),native('usage'),newCodex(),own('target'),own('open'),own('summary',{mode:'page'}),own('quota'),newClaude()].forEach((action,i)=>a[2][`${i%5},${Math.floor(i/5)}`]=action);
 const links=[['Browser','globe','https://www.google.com'],['GitHub','model','https://github.com'],['Documentation','notes','https://learn.microsoft.com'],['Bitwarden','shield','https://vault.bitwarden.com'],['Music','music','https://music.youtube.com']];
 links.forEach(([name,,url],i)=>a[3][`${i},0`]=website(url));
 // Empty Open actions are intentionally configured in Stream Deck on each PC.
 for(let col=0;col<5;col++)a[3][`${col},1`]=core('system.open',{path:''});
 for(let p=0;p<4;p++){for(let col=0;col<4;col++)a[p][`${col},2`]=core('profile.rotate',{PageIndex:col+1});a[p]['4,2']=p===0?own('quota'):native('usage');}
 return{manifest:{AppIdentifier:null,Device:{Model:'20GBA9901',UUID:''},Name:'Cardea Deck',Pages:{Current:ids[0],Default:defaultId,Pages:ids},Version:'3.0'},ids,pages,links};
}
function renderProfile(destination,version,render){
 const profile=profileTemplate({version});fs.mkdirSync(destination,{recursive:true});
 for(let p=0;p<4;p++){
  const directory=path.join(destination,'Profiles',profile.ids[p]);fs.mkdirSync(path.join(directory,'Images'),{recursive:true});const actions=profile.pages[p].Controllers[0].Actions;
  const image=(pos,card,name)=>{render(card,path.join(directory,'Images',name+'.png'));actions[pos].States=[{Image:'Images/'+name+'.png',ShowTitle:false}];};
  for(let col=0;col<4;col++)image(`${col},2`,{kind:'nav',title:['Claude','Codex','Controls','Apps'][col],icon:['chats','model','controls','apps'][col],brand:['claude','codex'][col],active:p===col},'nav-'+col);
  if(p===0)image('3,1',{kind:'action',title:'New chat',icon:'chatplus'},'new');
  if(p===2)image('4,1',{kind:'action',title:'New chat',icon:'chatplus',caption:'CLAUDE'},'new');
  if(p===3){profile.links.forEach(([title,icon],i)=>image(`${i},0`,{kind:'app',title,icon},'app-'+i));for(let col=0;col<5;col++)image(`${col},1`,{kind:'action',title:'Choose app',icon:'plus'},'custom-'+col);}
  fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(profile.pages[p]));
 }
 const pinned=path.join(destination,'Profiles',profile.manifest.Pages.Default);fs.mkdirSync(pinned,{recursive:true});fs.writeFileSync(path.join(pinned,'manifest.json'),JSON.stringify({Name:'Default',Icon:'',Controllers:[{Type:'Keypad',Actions:{}}]}));
 fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify(profile.manifest));return profile;
}
export function writeProfile(destination,version,{render=renderCardPng}={}){
 destination=path.resolve(destination);const parent=path.dirname(destination);
 if(path.basename(parent)!=='profile-template'||path.basename(destination)!==profileId)throw Error('Expected own generated profile-template output');
 fs.mkdirSync(parent,{recursive:true});
 for(let current=parent;;current=path.dirname(current)){if(fs.lstatSync(current).isSymbolicLink())throw Error('Linked generated profile path');if(path.dirname(current)===current)break;}
 if(fs.existsSync(destination)){
  if(fs.lstatSync(destination).isSymbolicLink())throw Error('Linked generated profile path');
  const old=JSON.parse(fs.readFileSync(path.join(destination,'manifest.json'),'utf8'));
  if(old.Name!=='Cardea Deck'||old.Device?.Model!=='20GBA9901'||old.Version!=='3.0')throw Error('Refuse to replace an unrecognized profile');
 }
 const staging=fs.mkdtempSync(path.join(parent,'.cardea-profile-')),retired=path.join(parent,'.cardea-profile-retired-'+randomUUID());let moved=false,installed=false;
 const remove=file=>{
  if(path.dirname(file)!==parent||!path.basename(file).startsWith('.cardea-profile-')||fs.lstatSync(file).isSymbolicLink()||path.dirname(fs.realpathSync(file)).toLowerCase()!==fs.realpathSync(parent).toLowerCase())throw Error('Unexpected generated profile cleanup path');
  fs.rmSync(file,{recursive:true,force:true});
 };
 try{
  const profile=renderProfile(staging,version,render);
  if(fs.existsSync(destination)){fs.renameSync(destination,retired);moved=true;}
  fs.renameSync(staging,destination);installed=true;
  return profile;
 }catch(error){if(moved&&!installed)fs.renameSync(retired,destination);throw error;}
 finally{if(fs.existsSync(staging))remove(staging);if(installed&&moved&&fs.existsSync(retired))remove(retired);}
}
export function packProfile(profileDirectory,destination){
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-profile-pack-')),temporary=destination+'.'+randomUUID()+'.tmp';
 try{
  fs.cpSync(profileDirectory,path.join(scratch,profileId),{recursive:true});fs.mkdirSync(path.dirname(destination),{recursive:true});
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:CARDEA_PROFILE_SOURCE,$env:CARDEA_PROFILE_DEST,[IO.Compression.CompressionLevel]::Optimal,$false)'],{windowsHide:true,env:{...process.env,CARDEA_PROFILE_SOURCE:scratch,CARDEA_PROFILE_DEST:temporary}});
  fs.renameSync(temporary,destination);
 }finally{
  if(fs.existsSync(temporary))fs.unlinkSync(temporary);
  if(path.dirname(scratch)!==os.tmpdir()||!path.basename(scratch).startsWith('cardea-profile-pack-'))throw Error('Unexpected profile pack path');fs.rmSync(scratch,{recursive:true,force:true});
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.dirname(fileURLToPath(import.meta.url)),{version}=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
 writeProfile(path.join(root,'dist/profile-template',profileId),version);console.log('Generated a clean four-page MK.2 profile template.');
}
