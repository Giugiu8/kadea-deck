import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {writeProfile,packProfile,profileId} from './profile.mjs';
import {pluginFiles,integrityFile} from './plugin-files.mjs';
import {buildIntegrityManifest} from './src/integrity.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const require=createRequire(path.join(root,'package.json'));
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const {build}=require('esbuild');
// Reproduction check: rebuild only what executes, into a chosen folder, without image tools.
const flag=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const codeOnly=process.argv.includes('--code-only');
const out=flag('--out')?path.resolve(flag('--out')):path.join(root,'dist/de.cardea.deck.sdPlugin');
fs.mkdirSync(path.join(out,'bin'),{recursive:true});fs.mkdirSync(path.join(out,'imgs'),{recursive:true});fs.mkdirSync(path.join(out,'hooks'),{recursive:true});
// Stream Deck's bundled Node can fail to create this through a cross-drive
// development junction. Create it through the real build path before launch.
fs.mkdirSync(path.join(out,'logs'),{recursive:true});
// absWorkingDir keeps the bundle's path comments relative, so the checkout location cannot change its bytes.
await build({absWorkingDir:root,entryPoints:['src/plugin.mjs'],bundle:true,platform:'node',format:'esm',target:'node20',charset:'utf8',legalComments:'inline',outfile:path.join(out,'bin/plugin.mjs'),banner:{js:"import { createRequire } from 'node:module'; const require=createRequire(import.meta.url);"}});
for(const name of pluginFiles)if(name.startsWith('hooks/'))fs.copyFileSync(path.join(root,name),path.join(out,name));
const {cardSvg}=await import('./src/cards.mjs');
if(!codeOnly){
const svg=path.join(root,'dist/card-source.svg');fs.writeFileSync(svg,cardSvg({kind:'nav',title:'Cardea',icon:'start',active:true}));
execFileSync('magick',[svg,path.join(out,'imgs/key.png')],{windowsHide:true});
execFileSync('magick',[svg,'-resize','288x288',path.join(out,'imgs/key@2x.png')],{windowsHide:true});
execFileSync('magick',[svg,'-resize','256x256',path.join(out,'imgs/plugin.png')],{windowsHide:true});
execFileSync('magick',[svg,'-resize','512x512',path.join(out,'imgs/plugin@2x.png')],{windowsHide:true});
if(fs.existsSync(path.join(out,'imgs/key.svg')))fs.unlinkSync(path.join(out,'imgs/key.svg'));
}
const labels={session:'Claude chat',summary:'Claude overview',target:'Select Claude target',permission:'Claude approval',ack:'Mark result as read',quota:'Claude usage',open:'Open Claude','codex-session':'Codex chat status','codex-permission':'Codex approval','codex-stop':'Stop Codex (hold)'};
if(!codeOnly){const generatedProfile=path.join(root,'dist/profile-template',profileId);writeProfile(generatedProfile,version);packProfile(generatedProfile,path.join(out,'profiles/Cardea Deck.streamDeckProfile'));}
const manifest={UUID:'de.cardea.deck',Name:'Cardea Deck',Author:'Cardea',Description:'Unified Claude and Codex chat cards with local controls.',Version:`${version}.0`,SDKVersion:2,Icon:'imgs/plugin',Category:'Cardea Deck',CategoryIcon:'imgs/plugin',CodePath:'bin/plugin.mjs',Nodejs:{Version:'20'},OS:[{Platform:'windows',MinimumVersion:'10'}],Software:{MinimumVersion:'7.1'},Actions:Object.entries(labels).map(([key,Name])=>({UUID:`de.cardea.deck.${key}`,Name,Icon:'imgs/key',Tooltip:Name,PropertyInspectorPath:'pi/index.html',Controllers:['Keypad'],States:[{Image:'imgs/key',ShowTitle:false}]}))};
manifest.Profiles=[{Name:'profiles/Cardea Deck',DeviceType:0,Readonly:false,AutoInstall:true,DontAutoSwitchWhenInstalled:true}];
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
fs.writeFileSync(path.join(out,'package.json'),JSON.stringify({name:'cardea-deck',private:true,type:'module',version}));
fs.mkdirSync(path.join(out,'pi'),{recursive:true});fs.writeFileSync(path.join(out,'pi/index.html'),fs.readFileSync(path.join(root,'pi/index.html'),'utf8').replaceAll('__VERSION__',version));
for(const name of['index.js','style.css'])fs.copyFileSync(path.join(root,'pi',name),path.join(out,'pi',name));
// Written last: the running plugin checks every packaged file against this list.
if(!codeOnly)fs.writeFileSync(path.join(out,integrityFile),JSON.stringify(buildIntegrityManifest(out,pluginFiles.filter(name=>name!==integrityFile),version),null,2)+'\n');
console.log(`Built ${out}`);
