import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import{execFileSync}from'node:child_process';
test('standalone recovery needs no Node installation and preserves unrelated Claude settings',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-recovery-')),file=path.join(dir,'.claude/settings.json');fs.mkdirSync(path.dirname(file));
 const foreign={env:{KEEP:'synthetic',DATE:'2026-11-04T12:34:56.123Z'},empty:[],nested:{list:[{keep:true}]},hooks:{Stop:[{hooks:[{type:'command',command:'echo foreign'},{type:'command',command:'echo "C:/plugins/de.cardea.deck.sdPlugin/hooks/bridge.cjs"'}]}]},statusLine:{type:'command',command:'echo foreign status'}};
 const own={type:'command',command:'"C:/bundled/node.exe" "C:/plugins/de.cardea.deck.sdPlugin/hooks/bridge.cjs" Stop'};
 fs.writeFileSync(file,JSON.stringify({...foreign,hooks:{Stop:[{hooks:[...foreign.hooks.Stop[0].hooks,own]}]}}));
 try{
  const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',path.resolve('Remove-Claude-Hooks.ps1')],{env:{...process.env,USERPROFILE:dir},windowsHide:true,encoding:'utf8'});
  assert.deepEqual(JSON.parse(fs.readFileSync(file)),foreign);assert.match(output,/Removed only Cardea/);assert.ok(fs.existsSync(path.join(dir,'.cardeadeck/backups')));
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',path.resolve('Remove-Claude-Hooks.ps1')],{env:{...process.env,USERPROFILE:dir},windowsHide:true});assert.deepEqual(JSON.parse(fs.readFileSync(file)),foreign);
 }finally{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('cardea-recovery-'));fs.rmSync(dir,{recursive:true,force:true});}
});
