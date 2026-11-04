import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {createIntegrations} from '../src/integrations.mjs';
function fixture(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-integrations-')),home=path.join(dir,'user'),appData=path.join(home,'AppData/Roaming'),plugin=path.join(appData,'Elgato/StreamDeck/Plugins/de.cardea.deck.sdPlugin'),node=path.join(dir,'node.exe');
 const put=(file,data)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof data==='string'?data:JSON.stringify(data));};
 put(node,'synthetic executable');put(path.join(plugin,'manifest.json'),{UUID:'de.cardea.deck',Version:'0.8.0.0'});
 for(const name of ['bridge','runtime','statusline','permission-auth','receiver-client'])put(path.join(plugin,'hooks',name+'.cjs'),'// fixture');
 const settings=path.join(home,'.claude/settings.json'),foreign={env:{TOKEN:'SYNTHETIC_PRIVATE'},hooks:{Stop:[{hooks:[{type:'command',command:'echo preserved'}]}]},statusLine:{type:'command',command:'echo preserved status'}};put(settings,foreign);
 try{return fn({dir,home,appData,plugin,node,put,settings,foreign,create:options=>createIntegrations({home,appData,plugin,node,...options})});}
 finally{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('cardea-integrations-'));fs.rmSync(dir,{recursive:true,force:true});}
}
test('native integration setup preserves foreign settings, is idempotent and removes only own entries',()=>fixture(f=>{
 const manager=f.create();assert.equal(manager.status().claude,'not_set_up');
 manager.update('setupClaude');const first=fs.readFileSync(f.settings);assert.equal(manager.status().claude,'installed');
 assert.deepEqual(JSON.parse(first).env,f.foreign.env);assert.deepEqual(JSON.parse(first).statusLine,f.foreign.statusLine);
 manager.update('setupClaude');assert.deepEqual(fs.readFileSync(f.settings),first);
 assert.equal(fs.readdirSync(path.join(f.home,'.cardeadeck/backups')).length,1);
 manager.update('removeClaude');assert.deepEqual(JSON.parse(fs.readFileSync(f.settings)),f.foreign);
 assert.ok(!JSON.stringify(manager.status()).includes('SYNTHETIC_PRIVATE'));
}));
test('settings changed after preparation are preserved and linked paths are refused',()=>fixture(f=>{
 const manager=f.create({beforeWrite(){f.put(f.settings,{...f.foreign,concurrent:true});}});
 assert.throws(()=>manager.update('setupClaude'),/settings_changed/);assert.equal(JSON.parse(fs.readFileSync(f.settings)).concurrent,true);
 const outside=path.join(f.dir,'other');fs.mkdirSync(outside);fs.renameSync(path.join(f.home,'.claude'),path.join(outside,'saved'));fs.symlinkSync(path.join(outside,'saved'),path.join(f.home,'.claude'),'junction');
 assert.throws(()=>f.create().update('setupClaude'),/linked_path/);
}));
test('old hook paths are detected but are never silently combined with new approvals',()=>fixture(f=>{
 f.put(f.settings,{hooks:{PermissionRequest:[{hooks:[{type:'command',command:'"node" "C:/plugins/de.cardea.kadeadeck.sdPlugin/hooks/bridge.cjs" PermissionRequest'}]}]}});
 const before=fs.readFileSync(f.settings);assert.equal(f.create().status().claude,'legacy_present');assert.throws(()=>f.create().update('setupClaude'),/legacy_present/);assert.deepEqual(fs.readFileSync(f.settings),before);
}));
test('unrecognized commands and non-installed plugin locations cannot write settings',()=>fixture(f=>{
 const before=fs.readFileSync(f.settings);assert.throws(()=>f.create().update('approve'),/invalid_command/);
 const elsewhere=path.join(f.dir,'de.cardea.deck.sdPlugin');fs.cpSync(f.plugin,elsewhere,{recursive:true});assert.throws(()=>f.create({plugin:elsewhere}).update('setupClaude'),/plugin_location/);assert.deepEqual(fs.readFileSync(f.settings),before);
}));
test('invalid UTF-8 is rejected instead of rewriting foreign settings',()=>fixture(f=>{
 const invalid=Buffer.concat([Buffer.from('{"env":{"VALUE":"'),Buffer.from([0xff]),Buffer.from('"}}')]);fs.writeFileSync(f.settings,invalid);
 assert.throws(()=>f.create().update('setupClaude'),/invalid_settings/);assert.deepEqual(fs.readFileSync(f.settings),invalid);
}));
test('custom Claude configuration does not block the independent Codex connection',()=>fixture(f=>{
 const manager=f.create({configDir:path.join(f.dir,'custom-claude')}),before=fs.readFileSync(f.settings);
 assert.equal(manager.status().claude,'custom_config');assert.throws(()=>manager.update('setupClaude'),/custom_config/);
 manager.saveCodex(f.node);assert.equal(manager.codexEnabled(),true);assert.deepEqual(fs.readFileSync(f.settings),before);
}));
