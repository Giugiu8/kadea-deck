import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {profileTemplate,profileId} from '../profile.mjs';
import {mergeHooks,statusEvents,owned} from '../setup-hooks.mjs';
import {createPlan,applyPlan,uninstall,verifyBundle} from '../setup.mjs';
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const foreign={env:{CUSTOM_SETTING:'fixture'},hooks:{PreToolUse:[{matcher:'Read',hooks:[{type:'command',command:'echo custom-hook'}]}]},statusLine:{type:'command',command:'echo custom-status'}};
function fixture(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-setup-'));try{
 const home=path.join(dir,'user'),appData=path.join(home,'AppData/Roaming'),directory=path.join(dir,'download'),settings=path.join(home,'.claude/settings.json');write(settings,foreign);
 const profile=profileTemplate();const base=path.join(directory,'profile-template',profileId);write(path.join(base,'manifest.json'),profile.manifest);profile.pages.forEach((p,i)=>write(path.join(base,'Profiles',profile.ids[i],'manifest.json'),p));write(path.join(base,'Profiles',profile.manifest.Pages.Default,'manifest.json'),{Controllers:[{Type:'Keypad',Actions:{}}]});
 const plugin=path.join(directory,'de.cardea.deck.sdPlugin');write(path.join(plugin,'manifest.json'),{UUID:'de.cardea.deck',Version:'0.7.0.0'});write(path.join(plugin,'bin/plugin.mjs'),'// fixture');write(path.join(plugin,'hooks/bridge.cjs'),'// fixture');write(path.join(plugin,'hooks/statusline.cjs'),'// fixture');
 for(const name of ['permission-auth.cjs','receiver-client.cjs','runtime.cjs','tool-summary.cjs'])write(path.join(plugin,'hooks',name),'// fixture');
 write(path.join(appData,'Elgato/StreamDeck/ProfilesV3/existing.sdProfile/manifest.json'),{Device:{Model:'20GBA9901',UUID:'fixture-device'}});
 const files={};function walk(root){for(const e of fs.readdirSync(root,{withFileTypes:true})){const file=path.join(root,e.name);if(e.isDirectory())walk(file);else files[path.relative(directory,file).replaceAll('\\','/')]=createHash('sha256').update(fs.readFileSync(file)).digest('hex');}}walk(directory);write(path.join(directory,'integrity.json'),{schema:1,version:'0.7.0',files});
 return fn({dir,home,appData,directory,settings,plan:()=>createPlan({directory,home,appData})});
 }finally{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('cardea-setup-'));fs.rmSync(dir,{recursive:true,force:true});}}
test('portable profile has 60 distinct actions, four pages, separate empty pinned default and Claude/Codex navigation',()=>{
 const p=profileTemplate();assert.equal(p.pages.length,4);assert.equal(p.manifest.Device.UUID,'');assert.ok(!p.ids.includes(p.manifest.Pages.Default));
 const actions=p.pages.flatMap(page=>Object.values(page.Controllers[0].Actions));assert.equal(actions.length,60);assert.equal(new Set(actions.map(a=>a.ActionID)).size,60);
 for(const page of p.pages){const a=page.Controllers[0].Actions;assert.equal(a['0,2'].Settings.PageIndex,1);assert.equal(a['1,2'].Settings.PageIndex,2);}
 assert.ok(!JSON.stringify(p).includes('Discord'));assert.equal(p.pages[0].Name,'Claude');assert.equal(p.pages[1].Name,'Codex');
});
test('hook merge is idempotent, preserves foreign settings/status line and removes only our entries',()=>{
 const plugin=path.join(os.tmpdir(),'plugins/de.cardea.deck.sdPlugin'),options={node:process.execPath,plugin};const once=mergeHooks(foreign,options),twice=mergeHooks(once,options);
 assert.deepEqual(twice,once);assert.deepEqual(once.statusLine,foreign.statusLine);assert.deepEqual(once.env,foreign.env);assert.equal(Object.values(once.hooks).flatMap(g=>g.flatMap(x=>x.hooks)).filter(h=>owned(h.command)).length,statusEvents.length);assert.equal(once.hooks.PermissionRequest,undefined);
 assert.deepEqual(mergeHooks(twice,{remove:true}),foreign);assert.throws(()=>mergeHooks({}, {...options,node:'C:\\bad%PATH%\\node.exe'}),/Unsupported/);
});
test('fresh setup plan changes nothing; install binds local device and uninstall preserves foreign settings and user state',()=>fixture(f=>{
 const plan=f.plan(),calls=[];assert.equal(fs.existsSync(plan.plugin),false);assert.deepEqual(read(f.settings),foreign);
 applyPlan(plan,{host:mode=>calls.push(mode)});assert.deepEqual(calls,['Stop','Start']);assert.equal(read(path.join(plan.profile,'manifest.json')).Device.UUID,'fixture-device');assert.equal(read(path.join(plan.runtime,'install.json')).version,'0.7.0');
 write(path.join(plan.runtime,'state.json'),{schema:1,sessions:[]});const settings=read(f.settings);settings.env.ADDED_AFTER_INSTALL='keep';write(f.settings,settings);
 const archive=uninstall({...f,host:mode=>calls.push(mode)});assert.ok(fs.existsSync(archive));assert.equal(fs.existsSync(plan.plugin),false);assert.equal(fs.existsSync(plan.profile),false);assert.equal(fs.existsSync(path.join(plan.runtime,'state.json')),true);assert.equal(read(f.settings).env.ADDED_AFTER_INSTALL,'keep');assert.deepEqual(read(f.settings).hooks,foreign.hooks);assert.deepEqual(read(f.settings).statusLine,foreign.statusLine);
}));
test('settings changed after planning abort installation without stopping the host or overwriting the edit',()=>fixture(f=>{
 const p=f.plan();write(f.settings,{...foreign,newSetting:true});const calls=[];assert.throws(()=>applyPlan(p,{host:mode=>calls.push(mode)}),/changed/);assert.deepEqual(calls,[]);assert.equal(read(f.settings).newSetting,true);assert.equal(fs.existsSync(p.plugin),false);
}));
test('failed copy rolls back files already installed and restarts host; backup is retained',()=>fixture(f=>{
 const p=f.plan(),calls=[];p.sourceProfile=path.join(f.directory,'missing-profile');assert.throws(()=>applyPlan(p,{host:mode=>calls.push(mode)}));assert.deepEqual(calls,['Stop','Start']);assert.equal(fs.existsSync(p.plugin),false);assert.deepEqual(read(f.settings),foreign);assert.equal(fs.existsSync(path.join(p.runtime,'install.lock')),false);assert.ok(fs.readdirSync(path.join(p.runtime,'backups')).length);
}));
test('upgrade preserves customized Apps page and does not duplicate hooks',()=>fixture(f=>{
 let p=f.plan();applyPlan(p);const top=read(path.join(p.profile,'manifest.json')),file=path.join(p.profile,'Profiles',top.Pages.Pages[3],'manifest.json'),page=read(file);page.Name='My work apps';write(file,page);const before=read(f.settings);p=f.plan();applyPlan(p);assert.equal(read(file).Name,'My work apps');assert.deepEqual(read(f.settings),before);
}));
test('download tampering and unmanaged installations are refused',()=>fixture(f=>{
 const p=f.plan();write(path.join(p.sourcePlugin,'bin/plugin.mjs'),'changed');assert.throws(()=>verifyBundle(f.directory),/verification failed/);
}));
test('directory junctions cannot redirect plugin installation into another checkout',()=>fixture(f=>{
 const p=f.plan(),elsewhere=path.join(f.dir,'other-source');fs.mkdirSync(elsewhere);fs.mkdirSync(path.dirname(p.plugin),{recursive:true});fs.symlinkSync(elsewhere,p.plugin,'junction');assert.throws(()=>f.plan(),/Linked installation/);assert.deepEqual(fs.readdirSync(elsewhere),[]);
}));
test('failed upgrade restores the exact old directory without leaving newly introduced files',()=>fixture(f=>{
 let p=f.plan();applyPlan(p);const old=fs.readFileSync(path.join(p.plugin,'bin/plugin.mjs'),'utf8');p=f.plan();
 // Simulate a new release file appearing after planning, then one disk error.
 write(path.join(p.sourcePlugin,'bin/new-upgrade-file.mjs'),'// new release');
 const original=fs.renameSync;let failed=false;fs.renameSync=(from,to)=>{if(!failed&&to===p.settings){failed=true;throw Object.assign(Error('injected settings write failure'),{code:'EACCES'});}return original(from,to);};
 try{assert.throws(()=>applyPlan(p),/injected/);}finally{fs.renameSync=original;}
 assert.equal(fs.readFileSync(path.join(p.plugin,'bin/plugin.mjs'),'utf8'),old);assert.equal(fs.existsSync(path.join(p.plugin,'bin/new-upgrade-file.mjs')),false);assert.equal(fs.existsSync(p.receipt),true);
}));
test('partial uninstall failure restores hooks, plugin, profile and receipt before restarting',()=>fixture(f=>{
 const p=f.plan();applyPlan(p);const before=read(f.settings),calls=[],original=fs.renameSync;let failed=false;
 fs.renameSync=(from,to)=>{if(!failed&&from===p.profile){failed=true;throw Object.assign(Error('injected profile rename failure'),{code:'EACCES'});}return original(from,to);};
 try{assert.throws(()=>uninstall({...f,host:mode=>calls.push(mode)}),/injected/);}finally{fs.renameSync=original;}
 assert.deepEqual(read(f.settings),before);for(const target of [p.plugin,p.profile,p.receipt])assert.ok(fs.existsSync(target));assert.deepEqual(calls,['Stop','Start']);assert.equal(fs.existsSync(path.join(p.runtime,'install.lock')),false);
}));
test('uninstall respects the install lock and retirement never renames across directories',()=>fixture(f=>{
 const p=f.plan();applyPlan(p);const lock=path.join(p.runtime,'install.lock');write(lock,'fixture-lock');assert.throws(()=>uninstall(f),/EEXIST/);assert.ok(fs.existsSync(p.plugin));fs.unlinkSync(lock);
 const original=fs.renameSync;fs.renameSync=(from,to)=>{if(path.dirname(from)!==path.dirname(to))throw Object.assign(Error('cross-volume rename refused'),{code:'EXDEV'});return original(from,to);};
 try{applyPlan(f.plan());uninstall(f);}finally{fs.renameSync=original;}
 assert.equal(fs.existsSync(p.plugin),false);assert.equal(fs.existsSync(p.profile),false);
}));
test('a failed uninstall backup does not mask its error or strand an earlier retired plugin',()=>fixture(f=>{
 const p=f.plan();applyPlan(p);const before=read(f.settings),calls=[],original=fs.cpSync;let failed=false;
 fs.cpSync=(from,to,options)=>{if(!failed&&from===p.profile){failed=true;throw Object.assign(Error('injected backup copy failure'),{code:'EIO'});}return original(from,to,options);};
 try{assert.throws(()=>uninstall({...f,host:mode=>calls.push(mode)}),/injected backup copy/);}finally{fs.cpSync=original;}
 assert.deepEqual(read(f.settings),before);for(const target of [p.plugin,p.profile,p.receipt])assert.ok(fs.existsSync(target));assert.deepEqual(calls,['Stop','Start']);assert.equal(fs.existsSync(path.join(p.runtime,'install.lock')),false);
}));
test('branding upgrade renames only the original profile title and preserves custom titles and Apps',()=>fixture(f=>{
 const p=f.plan();applyPlan(p);const file=path.join(p.profile,'manifest.json'),top=read(file);top.Name='Cardea Deck';write(file,top);applyPlan(f.plan());assert.equal(read(file).Name,'Cardea Deck');const custom=read(file);custom.Name='My Work Deck';write(file,custom);applyPlan(f.plan());assert.equal(read(file).Name,'My Work Deck');
}));
