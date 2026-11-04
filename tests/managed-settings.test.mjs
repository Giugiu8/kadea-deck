// Organization-managed hooks: a deployable block, and no writes to the user's settings.
import {hookHome} from './support/hook-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {managedBlock} from '../managed-settings.mjs';
import {approvalEvent,mergeHooks,statusEvents} from '../claude-hooks.mjs';
import {createIntegrations,readManagedState,APPROVAL_CONSENT} from '../src/integrations.mjs';
import {readConfig} from '../src/approval-policy.mjs';
import {DeckStore} from '../src/store.mjs';
import {startReceiver} from '../src/receiver.mjs';
function temp(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-managed-'));return Promise.resolve(fn(dir)).finally(()=>{assert.ok(path.basename(dir).startsWith('cardea-managed-'));fs.rmSync(dir,{recursive:true,force:true});});}
test('the block has status hooks and the lock, and approval only on request',()=>{
 const block=managedBlock();assert.equal(block.allowManagedHooksOnly,true);assert.deepEqual(Object.keys(block.hooks),statusEvents);assert.equal(block.hooks[approvalEvent],undefined);assert.equal(block.statusLine,undefined);
 const hook=block.hooks.Stop[0].hooks[0];assert.deepEqual(hook,{type:'command',command:'C:\\Program Files\\nodejs\\node.exe',args:['C:\\Program Files\\Cardea Deck\\hooks\\bridge.cjs','Stop'],timeout:2});
 assert.equal(managedBlock({approvals:true}).hooks[approvalEvent][0].hooks[0].timeout,60);
 assert.equal(managedBlock({onlyManaged:false}).allowManagedHooksOnly,undefined);
 assert.equal(managedBlock({shellForm:true}).hooks.Stop[0].hooks[0].command,'"C:\\Program Files\\nodejs\\node.exe" "C:\\Program Files\\Cardea Deck\\hooks\\bridge.cjs" Stop');
 assert.ok(managedBlock({statusLine:true}).statusLine.command.includes('statusline.cjs'));
});
test('unsafe or relative paths are refused',()=>{
 for(const bad of ['node.exe','C:\\a"b\\node.exe','C:\\%TEMP%\\node.exe','C:\\a&b\\node.exe'])assert.throws(()=>managedBlock({node:bad}),/Unsupported path/);
});
test('another product\'s bridge in managed settings does not count as Cardea',()=>temp(dir=>{
 put(path.join(dir,'managed-settings.json'),{hooks:{Stop:[{hooks:[{type:'command',command:'node',args:['C:\\Other\\bridge.cjs','Stop']}]}]}});
 assert.equal(readManagedState(dir).active,false);
 assert.throws(()=>managedBlock({hooks:'C:\\Other\\hooks'}),/must contain/);
}));
test('the shipped template is what the generator prints for its defaults',()=>{
 assert.deepEqual(JSON.parse(fs.readFileSync('docs/managed-settings.template.json','utf8')),managedBlock());
 assert.deepEqual(JSON.parse(execFileSync(process.execPath,['managed-settings.mjs'],{encoding:'utf8',windowsHide:true})),managedBlock());
});
test('a hook in exec form, as the block defines it, reaches the receiver from another folder',()=>temp(async dir=>{
 const hooks=path.join(dir,'Program Files','Cardea Deck','hooks');fs.mkdirSync(hooks,{recursive:true});
 for(const name of fs.readdirSync('hooks'))fs.copyFileSync(path.join('hooks',name),path.join(hooks,name));
 const runtime=path.join(dir,'runtime'),store=new DeckStore(),receiver=await startReceiver(store,{directory:runtime});
 try{
  const{command,args}=managedBlock({node:process.execPath,hooks}).hooks.UserPromptSubmit[0].hooks[0];
  const child=spawn(command,args,{env:{...process.env,USERPROFILE:hookHome(runtime)},windowsHide:true,stdio:['pipe','pipe','pipe']});const ended=once(child,'close');child.stdin.end(JSON.stringify({session_id:'managed-session',cwd:'G:\\Project'}));
  assert.equal((await ended)[0],0);assert.equal(store.get('managed-session').state,'working');
 }finally{await receiver.close();}
}));
const put=(file,data)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof data==='string'?data:JSON.stringify(data));};
test('managed state is read from the main file and the drop-in folder',()=>temp(dir=>{
 assert.deepEqual(readManagedState(dir),{present:false,only:false,status:false,approval:false,unreadable:false,active:false});
 put(path.join(dir,'managed-settings.json'),{model:'x'});assert.equal(readManagedState(dir).active,false);assert.equal(readManagedState(dir).present,true);
 put(path.join(dir,'managed-settings.d/20-cardea.json'),managedBlock({approvals:true}));
 assert.deepEqual(readManagedState(dir),{present:true,only:true,status:true,approval:true,unreadable:false,active:true});
 put(path.join(dir,'managed-settings.json'),'{broken');assert.equal(readManagedState(dir).active,true,'An unreadable file counts as managed');
}));
function fixture(fn){return temp(dir=>{
 const home=path.join(dir,'user'),appData=path.join(home,'AppData/Roaming'),plugin=path.join(appData,'Elgato/StreamDeck/Plugins/de.cardea.deck.sdPlugin'),node=path.join(dir,'node.exe'),managedDirectory=path.join(dir,'ClaudeCode'),machineFile=path.join(dir,'policy.json');
 put(node,'synthetic');put(path.join(plugin,'manifest.json'),{UUID:'de.cardea.deck'});for(const name of ['approval-rules','bridge','runtime','statusline','permission-auth','receiver-client','tool-summary'])put(path.join(plugin,'hooks',name+'.cjs'),'// fixture');
 const settings=path.join(home,'.claude/settings.json');put(settings,{env:{KEEP:'1'}});
 return fn({dir,home,settings,managedDirectory,machineFile,runtime:path.join(home,'.cardeadeck'),manager:createIntegrations({home,appData,plugin,node,configDir:'',managedDirectory,machineFile})});
});}
test('with managed hooks the plugin never writes the user settings file',()=>fixture(f=>{
 put(path.join(f.managedDirectory,'managed-settings.json'),managedBlock());
 const before=fs.readFileSync(f.settings),status=f.manager.status();assert.equal(status.claude,'managed');assert.equal(status.managed,true);assert.equal(status.approvals,'not_deployed');
 assert.throws(()=>f.manager.update('setupClaude'),/managed/);
 for(const command of ['removeStatus','removeClaude'])f.manager.update(command);
 assert.throws(()=>f.manager.update('enableApprovals',{consent:APPROVAL_CONSENT}),/managed/,'No approval hook was deployed');
 assert.deepEqual(fs.readFileSync(f.settings),before);
}));
test('a deployed approval hook still needs the user opt-in, stored outside the settings file',()=>fixture(f=>{
 put(path.join(f.managedDirectory,'managed-settings.json'),managedBlock({approvals:true}));
 const before=fs.readFileSync(f.settings);assert.equal(f.manager.status().approvals,'hook_inactive');
 assert.throws(()=>f.manager.update('enableApprovals'),/consent_required/);
 assert.equal(f.manager.update('enableApprovals',{consent:APPROVAL_CONSENT}).approvals,'on');assert.equal(readConfig(f.runtime).approvalsEnabled,true);
 assert.equal(f.manager.update('disableApprovals').approvals,'hook_inactive');assert.deepEqual(fs.readFileSync(f.settings),before);
}));
test('old user entries can still be removed when hooks become managed',()=>fixture(f=>{
 fs.writeFileSync(f.settings,JSON.stringify(mergeHooks({env:{KEEP:'1'}},{node:'C:\\n\\node.exe',plugin:path.join(f.home,'AppData/Roaming/Elgato/StreamDeck/Plugins/de.cardea.deck.sdPlugin')})));
 put(path.join(f.managedDirectory,'managed-settings.json'),managedBlock());
 f.manager.update('removeClaude');assert.deepEqual(JSON.parse(fs.readFileSync(f.settings)),{env:{KEEP:'1'}});
}));
test('restricting hooks without deploying Cardea is reported and changes nothing',()=>fixture(f=>{
 put(path.join(f.managedDirectory,'managed-settings.json'),{allowManagedHooksOnly:true});
 assert.equal(f.manager.status().claude,'managed_missing');assert.throws(()=>f.manager.update('setupClaude'),/managed/);
}));
test('a machine policy can lock key approvals off, also with managed hooks',()=>fixture(f=>{
 put(path.join(f.managedDirectory,'managed-settings.json'),managedBlock({approvals:true}));put(f.machineFile,{approvalsAllowed:false});
 assert.equal(f.manager.status().approvals,'locked_off');assert.throws(()=>f.manager.update('enableApprovals',{consent:APPROVAL_CONSENT}),/locked_off/);
 assert.notEqual(readConfig(f.runtime).approvalsEnabled,true);
}));
