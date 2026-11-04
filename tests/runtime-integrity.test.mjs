// Integrity check of installed plugin files and Windows permissions of the runtime folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {buildIntegrityManifest,unexpectedPluginFiles,verifyPluginFiles} from '../src/integrity.mjs';
import {currentUserSid,isPrivateToCurrentUser,parseAces,readAcls,refuseSystemLocation,restrictDirectory,restrictFile,sameAccount} from '../windows-acl.mjs';
import {DeckStore} from '../src/store.mjs';
import {startReceiver} from '../src/receiver.mjs';
function temp(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-integrity-'));return Promise.resolve(fn(dir)).finally(()=>{assert.ok(path.basename(dir).startsWith('cardea-integrity-'));fs.rmSync(dir,{recursive:true,force:true});});}
const files=['bin/plugin.mjs','hooks/bridge.cjs','manifest.json'];
function plugin(dir){for(const name of files){fs.mkdirSync(path.dirname(path.join(dir,name)),{recursive:true});fs.writeFileSync(path.join(dir,name),'// '+name);}fs.writeFileSync(path.join(dir,'integrity.json'),JSON.stringify(buildIntegrityManifest(dir,files,'0.0.0')));}
const check=dir=>verifyPluginFiles(dir,{required:files});
test('unchanged plugin files pass',()=>temp(dir=>{plugin(dir);assert.equal(check(dir),null);}));
test('a changed, missing or unlisted required file fails',()=>temp(dir=>{
 plugin(dir);fs.appendFileSync(path.join(dir,'hooks/bridge.cjs'),'x');assert.deepEqual(check(dir),{reason:'file_changed',file:'hooks/bridge.cjs'});
 plugin(dir);fs.unlinkSync(path.join(dir,'bin/plugin.mjs'));assert.deepEqual(check(dir),{reason:'file_missing',file:'bin/plugin.mjs'});
 plugin(dir);const manifest=JSON.parse(fs.readFileSync(path.join(dir,'integrity.json')));delete manifest.files['hooks/bridge.cjs'];fs.writeFileSync(path.join(dir,'integrity.json'),JSON.stringify(manifest));assert.equal(check(dir).reason,'manifest_incomplete');
}));
test('a missing or malformed manifest fails closed and cannot point outside the plugin',()=>temp(dir=>{
 plugin(dir);const file=path.join(dir,'integrity.json');
 fs.unlinkSync(file);assert.equal(check(dir).reason,'manifest_unreadable');
 fs.writeFileSync(file,'{broken');assert.equal(check(dir).reason,'manifest_unreadable');
 fs.writeFileSync(file,JSON.stringify({schema:2,files:{}}));assert.equal(check(dir).reason,'manifest_invalid');
 plugin(dir);const manifest=JSON.parse(fs.readFileSync(file));manifest.files['../outside']='0'.repeat(64);fs.writeFileSync(file,JSON.stringify(manifest));assert.equal(check(dir).reason,'manifest_invalid');
}));
test('a shortened manifest and planted code are both caught',()=>temp(dir=>{
 plugin(dir);const file=path.join(dir,'integrity.json'),manifest=JSON.parse(fs.readFileSync(file));delete manifest.files['hooks/bridge.cjs'];fs.writeFileSync(file,JSON.stringify(manifest));
 assert.equal(verifyPluginFiles(dir).reason,'manifest_incomplete','The default list comes from the code, not from the manifest');
 plugin(dir);fs.writeFileSync(path.join(dir,'hooks/planted.cjs'),'// x');fs.writeFileSync(path.join(dir,'bin/open.exe'),'old helper');
 assert.equal(check(dir),null,'Files that nothing loads are no damage: an update may leave some behind');
 assert.deepEqual(unexpectedPluginFiles(dir,files).sort(),['bin/open.exe','hooks/planted.cjs'],'They are reported');
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
 const runtime=path.join(dir,'.cardeadeck');fs.mkdirSync(path.join(runtime,'backups'),{recursive:true});fs.writeFileSync(path.join(runtime,'old.json'),'x');fs.writeFileSync(path.join(runtime,'backups/settings.json'),'x');
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
test('SDDL parsing accepts any account name, including domain-relative ones',()=>{
 assert.deepEqual(parseAces('D:PAI(A;OICI;FA;;;S-1-5-21-1)(A;ID;FR;;;WD)(A;;FA;;;DA)(A;;FA;;;LA)').aces.map(a=>a.sid),['S-1-5-21-1','WD','DA','LA']);
 assert.equal(parseAces('D:PAI(A;;FA;;;SY)').protected,true);assert.equal(parseAces('D:AI(A;;FA;;;SY)').protected,false);
 assert.throws(()=>parseAces('garbage'),/acl_failed/);
});
test('the built-in Administrator and Guest appear under their short names and still count as the same account',()=>{
 assert.equal(sameAccount('LA','S-1-5-21-1-2-3-500'),true);assert.equal(sameAccount('LG','S-1-5-21-1-2-3-501'),true);assert.equal(sameAccount('S-1-5-21-1','S-1-5-21-1'),true);
 assert.equal(sameAccount('LA','S-1-5-21-1-2-3-1001'),false);assert.equal(sameAccount('DA','S-1-5-21-1-2-3-500'),false);assert.equal(sameAccount('WD','S-1-5-21-1'),false);
});
test('a folder with other content is not taken over, an empty or marked one is',()=>temp(dir=>{
 const documents=path.join(dir,'Documents');fs.mkdirSync(documents);fs.writeFileSync(path.join(documents,'mine.txt'),'x');
 assert.throws(()=>restrictDirectory(documents),/protected_path/);assert.equal(fs.readFileSync(path.join(documents,'mine.txt'),'utf8'),'x');
 const fresh=path.join(dir,'fresh');fs.mkdirSync(fresh);assert.equal(restrictDirectory(fresh),true);fs.writeFileSync(path.join(fresh,'state.json'),'{}');assert.equal(restrictDirectory(fresh),true,'Its own marker lets it pass again');
}));
test('a link inside the folder is refused and permissions behind it stay untouched',()=>temp(dir=>{
 const run=path.join(dir,'.cardeadeck'),victim=path.join(dir,'victim');fs.mkdirSync(path.join(run,'backups'),{recursive:true});fs.mkdirSync(victim);fs.writeFileSync(path.join(victim,'file.txt'),'x');
 icacls(path.join(victim,'file.txt'),'/grant','*S-1-1-0:R','/Q');const before=readAcls(path.join(victim,'file.txt'))[0].sddl;
 fs.symlinkSync(victim,path.join(run,'backups/link'),'junction');
 assert.throws(()=>restrictDirectory(run),/linked_path/);
 assert.equal(readAcls(path.join(victim,'file.txt'))[0].sddl,before);
}));
test('system and user folders are never restricted, whatever the runtime path says',()=>{
 const env={USERPROFILE:os.homedir(),SystemRoot:'C:\\Windows',ProgramData:'C:\\ProgramData',TEMP:os.tmpdir()};
 for(const target of ['C:\\','C:\\Users',os.homedir(),os.homedir().toUpperCase()+'\\',path.join(os.homedir(),'AppData'),'C:\\Windows','C:\\ProgramData',os.tmpdir()])assert.throws(()=>refuseSystemLocation(target,env),/protected_path/,target);
 for(const target of [path.join(os.homedir(),'.cardeadeck'),path.join(os.tmpdir(),'cardea-x')])refuseSystemLocation(target,env);
 for(const target of ['C:\\Windows2','D:\\shared\\cardea',path.join(path.dirname(os.homedir()),'other','.cardeadeck')])assert.throws(()=>refuseSystemLocation(target,env),/protected_path/,target);
 assert.throws(()=>restrictDirectory(os.homedir()),/protected_path/);
});
test('an already private folder keeps its exact entry when checked again',()=>temp(dir=>{
 const run=path.join(dir,'.cardeadeck');fs.mkdirSync(run);fs.writeFileSync(path.join(run,'a.json'),'x');restrictDirectory(run);const before=readAcls(run,{recursive:true});
 restrictDirectory(run);assert.deepEqual(readAcls(run,{recursive:true}),before);
}));
test('the receiver publishes its keys only into a private folder and file',()=>temp(async dir=>{
 const runtime=path.join(dir,'.cardeadeck');fs.mkdirSync(runtime);icacls(runtime,'/grant','*S-1-1-0:(OI)(CI)R','/Q');
 const receiver=await startReceiver(new DeckStore(),{directory:runtime});
 try{
  const file=path.join(runtime,'connection.json');
  assert.deepEqual(parseAces(readAcls(file)[0].sddl).aces.map(a=>a.sid),[currentUserSid()],'connection.json is readable by this account only');single(runtime,'OICI');
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
