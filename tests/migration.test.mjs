import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createPlan,applyPlan,createHostController} from '../setup.mjs';
import {rewriteLegacyProfile} from '../migration.mjs';

const legacyId='de.cardea.kadeadeck',legacyFolder=legacyId+'.sdPlugin',profileId='83F6A461-7D15-4BBF-B345-C10B99A70961.sdProfile';
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function fixture(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-migration-'));
 try{
  const home=path.join(dir,'user'),appData=path.join(home,'AppData/Roaming'),directory=path.join(dir,'download');
  const oldRuntime=path.join(home,'.kadeadeck'),oldPlugin=path.join(appData,'Elgato/StreamDeck/Plugins',legacyFolder),profile=path.join(appData,'Elgato/StreamDeck/ProfilesV3',profileId);
  const settings=path.join(home,'.claude/settings.json'),profileManifest={AppIdentifier:'*',Device:{Model:'20GBA9901',UUID:'fixture-device'},Name:'Kadea Deck',Pages:{Current:'page-a',Default:'page-default',Pages:['page-a']},Version:'3.0'};
  const action={ActionID:'fixture-action-guid',Name:'My custom key',UUID:legacyId+'.session',Plugin:{UUID:legacyId,Name:'Personal label',Version:'0.6.0.0'},Settings:{slot:0},States:[{Image:'Images/factory.png'}]};
  write(path.join(profile,'manifest.json'),profileManifest);write(path.join(profile,'Profiles/page-a/manifest.json'),{Name:'Aktionen',Controllers:[{Type:'Keypad',Actions:{'0,0':action,'1,0':{ActionID:'foreign-guid',UUID:'com.elgato.system.website',Plugin:{UUID:'com.elgato.system',Name:'Browser'},Settings:{path:'https://example.com'}}}}]});write(path.join(profile,'Profiles/page-a/Images/factory.png'),'fixture-old-factory-art');
  write(path.join(oldPlugin,'manifest.json'),{UUID:legacyId,Version:'0.6.0.0'});write(path.join(oldPlugin,'bin/plugin.mjs'),'old own plugin');
  write(path.join(oldRuntime,'state.json'),{schema:1,sessions:[{id:'retained'}]});write(path.join(oldRuntime,'codex-client.json'),{enabled:true,executable:'C:\\fixture\\codex.exe'});write(path.join(oldRuntime,'codex-attempts.json'),{schema:1,attempts:[{id:'ambiguous-send-ledger'}]});write(path.join(oldRuntime,'statusline.json'),{enabled:true,custom:'retained'});write(path.join(oldRuntime,'connection.json'),{schema:1,port:1,token:'must-not-copy'});
  write(path.join(oldRuntime,'install.json'),{schema:1,plugin:oldPlugin,profile});
  const settingsObject={env:{USER_SETTING:'keep'},hooks:{PreToolUse:[{matcher:'Read',hooks:[{type:'command',command:'echo foreign'},{type:'command',command:`"node" "${oldPlugin}/hooks/bridge.cjs" PreToolUse`}]}]},statusLine:{type:'command',command:'echo custom status line'}};write(settings,settingsObject);
  const newPlugin=path.join(directory,'de.cardea.deck.sdPlugin');write(path.join(newPlugin,'manifest.json'),{UUID:'de.cardea.deck',Version:'0.7.0.0'});write(path.join(newPlugin,'bin/plugin.mjs'),'new own plugin');write(path.join(newPlugin,'hooks/bridge.cjs'),'new hook');write(path.join(newPlugin,'hooks/statusline.cjs'),'new status line');
  const template=path.join(directory,'profile-template',profileId),templateRoot={...profileManifest,Name:'Cardea Deck',Pages:{Current:'template-page',Default:'template-default',Pages:['template-page']}};
  const templateAction={...action,UUID:'de.cardea.deck.session',Plugin:{...action.Plugin,UUID:'de.cardea.deck',Version:'0.7.0.0'},States:[{Image:'Images/new-factory.png'}]};
  write(path.join(template,'manifest.json'),templateRoot);write(path.join(template,'Profiles/template-page/manifest.json'),{Name:'Controls',Controllers:[{Type:'Keypad',Actions:{'0,0':templateAction}}]});write(path.join(template,'Profiles/template-page/Images/new-factory.png'),'fixture-new-factory-art');
  const files={};function walk(root){for(const entry of fs.readdirSync(root,{withFileTypes:true})){const file=path.join(root,entry.name);if(entry.isDirectory())walk(file);else files[path.relative(directory,file).replaceAll('\\','/')]=createHash('sha256').update(fs.readFileSync(file)).digest('hex');}}walk(directory);write(path.join(directory,'integrity.json'),{schema:1,version:'0.7.0',files});
  return fn({dir,home,appData,directory,oldRuntime,oldPlugin,profile,settings,settingsObject,plan:codexExecutable=>createPlan({directory,home,appData,codexExecutable})});
 }finally{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('cardea-migration-'));fs.rmSync(dir,{recursive:true,force:true});}
}

test('managed upgrade preserves runtime state, changes product IDs, and keeps user configuration',()=>fixture(f=>{
 const plan=f.plan(),calls=[];assert.ok(plan.migration);assert.equal(plan.migration.pluginId,legacyId);applyPlan(plan,{host:(...args)=>calls.push(args)});
 assert.deepEqual(calls,[['Stop',legacyId],['Start',legacyId]]);
 assert.deepEqual(read(path.join(plan.runtime,'state.json')),{schema:1,sessions:[{id:'retained'}]});assert.deepEqual(read(path.join(plan.runtime,'codex-attempts.json')).attempts,[{id:'ambiguous-send-ledger'}]);
 assert.deepEqual(read(path.join(plan.runtime,'codex-client.json')),{enabled:true,executable:'C:\\fixture\\codex.exe'});assert.deepEqual(read(path.join(plan.runtime,'statusline.json')),{enabled:true,custom:'retained'});
 assert.equal(fs.existsSync(path.join(plan.runtime,'connection.json')),false);assert.equal(fs.existsSync(path.join(f.oldRuntime,'connection.json')),false);
 assert.equal(fs.existsSync(f.oldPlugin),false);assert.equal(fs.existsSync(path.join(plan.runtime,'install.lock')),false);assert.equal(fs.existsSync(path.join(f.oldRuntime,'install.lock')),false);assert.equal(read(path.join(plan.plugin,'manifest.json')).UUID,'de.cardea.deck');
 const top=read(path.join(plan.profile,'manifest.json'));assert.equal(top.Name,'Cardea Deck');assert.equal(top.Device.UUID,'fixture-device');
 const page=read(path.join(plan.profile,'Profiles/page-a/manifest.json'));assert.equal(page.Name,'Controls');assert.equal(page.Controllers[0].Actions['0,0'].UUID,'de.cardea.deck.session');assert.equal(page.Controllers[0].Actions['0,0'].Plugin.UUID,'de.cardea.deck');assert.equal(page.Controllers[0].Actions['0,0'].Plugin.Name,'Personal label');assert.equal(page.Controllers[0].Actions['1,0'].Plugin.UUID,'com.elgato.system');
 const merged=read(f.settings);assert.deepEqual(merged.env,{USER_SETTING:'keep'});assert.equal(merged.statusLine.command,'echo custom status line');const commands=Object.values(merged.hooks).flat().flatMap(group=>group.hooks.map(h=>h.command));assert.ok(commands.includes('echo foreign'));assert.ok(commands.some(command=>command.replaceAll('\\','/').includes('de.cardea.deck.sdPlugin/hooks/bridge.cjs')));assert.ok(commands.every(command=>!command.toLowerCase().includes(legacyFolder.toLowerCase())));
}));

test('managed migration failure restores old plugin, profile, settings, and state and releases both locks',()=>fixture(f=>{
 const plan=f.plan(),beforeProfile=fs.readFileSync(path.join(f.profile,'Profiles/page-a/manifest.json')),beforeSettings=fs.readFileSync(f.settings),calls=[];
 const original=fs.renameSync;let failed=false;fs.renameSync=(from,to)=>{if(!failed&&to===f.settings){failed=true;throw Object.assign(Error('injected migration failure'),{code:'EIO'});}return original(from,to);};
 try{assert.throws(()=>applyPlan(plan,{host:mode=>calls.push(mode)}),/injected migration failure/);}finally{fs.renameSync=original;}
 assert.deepEqual(calls,['Stop','Start']);assert.ok(fs.existsSync(f.oldPlugin));assert.ok(fs.existsSync(f.profile));assert.deepEqual(fs.readFileSync(path.join(f.profile,'Profiles/page-a/manifest.json')),beforeProfile);assert.deepEqual(fs.readFileSync(f.settings),beforeSettings);assert.deepEqual(read(path.join(f.oldRuntime,'state.json')),{schema:1,sessions:[{id:'retained'}]});assert.deepEqual(read(path.join(f.oldRuntime,'connection.json')),{schema:1,port:1,token:'must-not-copy'});assert.equal(fs.existsSync(path.join(f.oldRuntime,'install.lock')),false);assert.equal(fs.existsSync(path.join(plan.runtime,'install.lock')),false);assert.equal(fs.existsSync(plan.receipt),false);assert.equal(fs.existsSync(plan.plugin),false);
}));

test('a newly discovered Codex executable takes precedence over the retained client setting',()=>fixture(f=>{
 const discovered='C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.2.3.0_x64\\app\\resources\\codex.exe',plan=f.plan(discovered);applyPlan(plan);assert.deepEqual(read(path.join(plan.runtime,'codex-client.json')),{enabled:true,executable:discovered});
}));

test('only unchanged allowlisted factory art refreshes; edited art and personal titles remain',()=>fixture(f=>{
 const pageFile=path.join(f.profile,'Profiles/page-a/manifest.json'),page=read(pageFile),actions=page.Controllers[0].Actions;
 actions['2,0']={...actions['0,0'],ActionID:'custom-slot-id',Name:'Personal action',States:[{Image:'Images/custom.png'}]};write(pageFile,page);write(path.join(f.profile,'Profiles/page-a/Images/custom.png'),'edited-personal-art');
 const templatePageFile=path.join(f.directory,'profile-template',profileId,'Profiles/template-page/manifest.json'),templatePage=read(templatePageFile);templatePage.Controllers[0].Actions['2,0']={...templatePage.Controllers[0].Actions['0,0'],ActionID:'template-slot-id',States:[{Image:'Images/new-custom-slot.png'}]};write(templatePageFile,templatePage);write(path.join(path.dirname(templatePageFile),'Images/new-custom-slot.png'),'fresh-default-for-edited-slot');
 const factoryBytes=fs.readFileSync(path.join(f.profile,'Profiles/page-a/Images/factory.png')),factoryHash=createHash('sha256').update(factoryBytes).digest('hex');
 rewriteLegacyProfile(f.profile,{template:path.join(f.directory,'profile-template',profileId),artwork:{hashes:{[factoryHash]:[]}}});
 assert.equal(fs.readFileSync(path.join(f.profile,'Profiles/page-a/Images/factory.png'),'utf8'),'fixture-new-factory-art');assert.equal(fs.readFileSync(path.join(f.profile,'Profiles/page-a/Images/custom.png'),'utf8'),'edited-personal-art');
 const renamed=read(path.join(f.profile,'manifest.json'));renamed.Name='My stream deck';write(path.join(f.profile,'manifest.json'),renamed);const renamedPage=read(pageFile);renamedPage.Name='My tools';write(pageFile,renamedPage);
 rewriteLegacyProfile(f.profile,{template:path.join(f.directory,'profile-template',profileId),artwork:{hashes:{[factoryHash]:[]}}});assert.equal(read(path.join(f.profile,'manifest.json')).Name,'My stream deck');assert.equal(read(pageFile).Name,'My tools');
}));

test('factory artwork allowlist is sourced from the two historical release archives',()=>{
 const allowlist=JSON.parse(fs.readFileSync(new URL('../migration-artwork.json',import.meta.url),'utf8'));
 assert.equal(allowlist.schema,1);assert.ok(Object.keys(allowlist.hashes).length>=80);
 for(const sources of Object.values(allowlist.hashes))assert.ok(sources.some(source=>source.startsWith('Kadea-Deck-0.6.0-windows.zip|'))||sources.some(source=>source.startsWith('Cardea-Deck-0.6.1-windows.zip|')));
});

test('the CLI host controller forwards the validated previous plugin identity',()=>{
 const calls=[],directory=path.dirname(fileURLToPath(new URL('../setup.mjs',import.meta.url))),host=createHostController(directory,(...args)=>calls.push(args));
 host('Stop',legacyId);assert.equal(calls.length,1);assert.equal(calls[0][0],'powershell.exe');assert.match(calls[0][1][3],new RegExp('-PreviousPluginId '+legacyId));assert.throws(()=>host('Stop','unsafe;command'),/Invalid previous plugin identity/);
});

test('host shutdown targets only the SDK child codex app-server before its own SDK process',()=>{
 const script=fs.readFileSync(fileURLToPath(new URL('../host.ps1',import.meta.url)),'utf8');
 const child=script.indexOf('ParentProcessId=$parentId'),appServer=script.indexOf('app-server'),sdkStop=script.indexOf('Stop-Process -Id $parentId');
 assert.ok(child>=0);assert.ok(script.includes("$_.Name -ieq 'codex.exe'"));assert.ok(script.includes("$_.ExecutablePath"));assert.ok(appServer>child&&sdkStop>appServer);
});

test('unmanaged and linked old plugin paths and ambiguous simultaneous installs are refused',()=>fixture(f=>{
 fs.unlinkSync(path.join(f.oldRuntime,'install.json'));assert.throws(()=>f.plan(),/Unmanaged legacy plugin/);write(path.join(f.oldRuntime,'install.json'),{schema:1,plugin:f.oldPlugin,profile:f.profile});
}));

test('new runtime state beside managed legacy install is ambiguous',()=>fixture(f=>{
 const newRuntime=path.join(f.home,'.cardeadeck');write(path.join(newRuntime,'state.json'),{unrelated:true});assert.throws(()=>f.plan(),/ambiguous state/);
}));

test('legacy plugin junction is refused before any mutation',()=>fixture(f=>{
 const elsewhere=path.join(f.dir,'elsewhere');fs.rmSync(f.oldPlugin,{recursive:true,force:true});fs.mkdirSync(elsewhere);fs.symlinkSync(elsewhere,f.oldPlugin,'junction');assert.throws(()=>f.plan(),/Linked legacy/);assert.deepEqual(fs.readdirSync(elsewhere),[]);
}));

test('legacy profile junction and simultaneous new plugin are refused',()=>fixture(f=>{
 const elsewhere=path.join(f.dir,'other-profile');fs.renameSync(f.profile,elsewhere);fs.symlinkSync(elsewhere,f.profile,'junction');assert.throws(()=>f.plan(),/Linked/);fs.unlinkSync(f.profile);fs.renameSync(elsewhere,f.profile);
 const current=path.join(f.appData,'Elgato/StreamDeck/Plugins','de.cardea.deck.sdPlugin');fs.mkdirSync(current);assert.throws(()=>f.plan(),/Both old and new/);
}));

test('a new lock acquired after planning still releases the old lock on refusal',()=>fixture(f=>{
 const plan=f.plan();fs.mkdirSync(plan.runtime,{recursive:true});write(path.join(plan.runtime,'install.lock'),'other installer');assert.throws(()=>applyPlan(plan),/EEXIST/);assert.equal(fs.existsSync(path.join(f.oldRuntime,'install.lock')),false);assert.equal(fs.existsSync(path.join(plan.runtime,'install.lock')),true);
}));
