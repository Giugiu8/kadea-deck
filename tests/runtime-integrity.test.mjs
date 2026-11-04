// Integrity check of installed plugin files and Windows permissions of the runtime folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {buildIntegrityManifest,verifyPluginFiles} from '../src/integrity.mjs';
import {currentUserSid,isPrivateToCurrentUser,parseAces,readAcls,restrictDirectory,restrictFile} from '../windows-acl.mjs';
import {DeckStore} from '../src/store.mjs';
import {startReceiver} from '../src/receiver.mjs';
function temp(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-integrity-'));return Promise.resolve(fn(dir)).finally(()=>{assert.ok(path.basename(dir).startsWith('cardea-integrity-'));fs.rmSync(dir,{recursive:true,force:true});});}
const files=['bin/plugin.mjs','hooks/bridge.cjs','manifest.json'];
function plugin(dir){for(const name of files){fs.mkdirSync(path.dirname(path.join(dir,name)),{recursive:true});fs.writeFileSync(path.join(dir,name),'// '+name);}fs.writeFileSync(path.join(dir,'integrity.json'),JSON.stringify(buildIntegrityManifest(dir,files,'0.0.0')));}
test('unchanged plugin files pass',()=>temp(dir=>{plugin(dir);assert.equal(verifyPluginFiles(dir),null);}));
test('a changed, missing or unlisted required file fails',()=>temp(dir=>{
 plugin(dir);fs.appendFileSync(path.join(dir,'hooks/bridge.cjs'),'x');assert.deepEqual(verifyPluginFiles(dir),{reason:'file_changed',file:'hooks/bridge.cjs'});
 plugin(dir);fs.unlinkSync(path.join(dir,'bin/plugin.mjs'));assert.deepEqual(verifyPluginFiles(dir),{reason:'file_missing',file:'bin/plugin.mjs'});
 plugin(dir);const manifest=JSON.parse(fs.readFileSync(path.join(dir,'integrity.json')));delete manifest.files['hooks/bridge.cjs'];fs.writeFileSync(path.join(dir,'integrity.json'),JSON.stringify(manifest));assert.equal(verifyPluginFiles(dir).reason,'manifest_incomplete');
}));
test('a missing or malformed manifest fails closed and cannot point outside the plugin',()=>temp(dir=>{
 plugin(dir);const file=path.join(dir,'integrity.json');
 fs.unlinkSync(file);assert.equal(verifyPluginFiles(dir).reason,'manifest_unreadable');
 fs.writeFileSync(file,'{broken');assert.equal(verifyPluginFiles(dir).reason,'manifest_unreadable');
 fs.writeFileSync(file,JSON.stringify({schema:2,files:{}}));assert.equal(verifyPluginFiles(dir).reason,'manifest_invalid');
 plugin(dir);const manifest=JSON.parse(fs.readFileSync(file));manifest.files['../outside']='0'.repeat(64);fs.writeFileSync(file,JSON.stringify(manifest));assert.equal(verifyPluginFiles(dir).reason,'manifest_invalid');
}));
test('the built plugin carries a complete manifest that matches its files',()=>{
 const dist=path.resolve('dist/de.cardea.deck.sdPlugin');assert.equal(verifyPluginFiles(dist),null);
 const names=Object.keys(JSON.parse(fs.readFileSync(path.join(dist,'integrity.json'))).files);
 for(const name of ['bin/plugin.mjs','hooks/bridge.cjs','hooks/tool-summary.cjs','pi/index.js','manifest.json'])assert.ok(names.includes(name),name);
 assert.ok(!names.includes('integrity.json'));assert.ok(!names.some(name=>name.endsWith('.exe')),'The plugin ships no executable of its own');
});

const icacls=(...args)=>execFileSync(path.join(process.env.SystemRoot,'System32/icacls.exe'),args,{windowsHide:true,stdio:'pipe'});
const single=(target,flags)=>{const{protected:isProtected,aces}=parseAces(readAcls(target)[0].sddl);assert.equal(aces.length,1);assert.equal(aces[0].sid,currentUserSid());assert.equal(aces[0].type,'A');assert.equal(aces[0].rights,'FA');if(flags)assert.equal(aces[0].flags,flags);return isProtected;};
test('a directory ends with exactly one entry for the current user, including foreign and older ones',()=>temp(dir=>{
 const runtime=path.join(dir,'run');fs.mkdirSync(path.join(runtime,'backups'),{recursive:true});fs.writeFileSync(path.join(runtime,'old.json'),'x');fs.writeFileSync(path.join(runtime,'backups/settings.json'),'x');
 icacls(runtime,'/grant','*S-1-1-0:(OI)(CI)R','*S-1-5-32-545:(OI)(CI)R','/Q');icacls(path.join(runtime,'old.json'),'/grant','*S-1-5-11:F','/Q');
 assert.equal(isPrivateToCurrentUser(runtime),false);
 assert.equal(restrictDirectory(runtime),true);
 assert.equal(single(runtime,'OICI'),true,'Inheritance from the parent is cut');
 for(const child of ['old.json','backups/settings.json']){const{aces}=parseAces(readAcls(path.join(runtime,child))[0].sddl);assert.deepEqual(aces.map(a=>a.sid),[currentUserSid()],child);}
 assert.equal(isPrivateToCurrentUser(runtime,{recursive:true}),true);
 fs.writeFileSync(path.join(runtime,'new.json'),'y');assert.deepEqual(parseAces(readAcls(path.join(runtime,'new.json'))[0].sddl).aces.map(a=>a.sid),[currentUserSid()],'New files inherit the private entry');
 assert.equal(fs.readFileSync(path.join(runtime,'old.json'),'utf8'),'x','The owner can still read');fs.rmSync(path.join(runtime,'new.json'));
}));
test('a single file ends with exactly one entry',()=>temp(dir=>{
 const file=path.join(dir,'secret.json');fs.writeFileSync(file,'x');icacls(file,'/grant','*S-1-1-0:R','/Q');
 assert.equal(restrictFile(file),true);assert.equal(single(file),true);
}));
test('a linked runtime directory is refused',()=>temp(dir=>{
 const real=path.join(dir,'real'),link=path.join(dir,'link');fs.mkdirSync(real);fs.symlinkSync(real,link,'junction');
 assert.throws(()=>restrictDirectory(link),/linked_path/);
}));
test('SDDL parsing maps aliases and rejects anything it cannot name',()=>{
 assert.deepEqual(parseAces('D:PAI(A;OICI;FA;;;S-1-5-21-1)(A;ID;FR;;;WD)').aces.map(a=>a.sid),['S-1-5-21-1','S-1-1-0']);
 assert.equal(parseAces('D:PAI(A;;FA;;;SY)').protected,true);assert.equal(parseAces('D:AI(A;;FA;;;SY)').protected,false);
 assert.throws(()=>parseAces('D:(A;;FA;;;ZZ)'),/acl_failed/);assert.throws(()=>parseAces('garbage'),/acl_failed/);
});
test('the receiver publishes its keys only into a private folder and file',()=>temp(async dir=>{
 const runtime=path.join(dir,'.cardeadeck');fs.mkdirSync(runtime);icacls(runtime,'/grant','*S-1-1-0:(OI)(CI)R','/Q');
 const receiver=await startReceiver(new DeckStore(),{directory:runtime});
 try{
  const file=path.join(runtime,'connection.json');
  assert.equal(single(file),true,'connection.json has its own protected entry');single(runtime,'OICI');
  assert.deepEqual(fs.readdirSync(runtime).filter(name=>name.endsWith('.tmp')),[]);
  assert.match(JSON.parse(fs.readFileSync(file,'utf8')).permissionKey,/^[a-f0-9]{64}$/);
 }finally{await receiver.close();}
}));
test('if permissions cannot be set, no keys are published and no service starts',()=>temp(async dir=>{
 const runtime=path.join(dir,'.cardeadeck'),failing={restrictDirectory(){throw Error('denied');},restrictFile(){throw Error('denied');}};
 await assert.rejects(startReceiver(new DeckStore(),{directory:runtime,acl:failing}),/acl_failed/);
 assert.equal(fs.existsSync(path.join(runtime,'connection.json')),false);
 const lateFailure={restrictDirectory(){},restrictFile(){throw Error('denied');}};
 await assert.rejects(startReceiver(new DeckStore(),{directory:runtime,acl:lateFailure}),/acl_failed/);
 assert.deepEqual(fs.readdirSync(runtime),[],'No temporary key file remains');
}));
