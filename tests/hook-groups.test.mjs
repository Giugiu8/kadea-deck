// Status hooks and the approval hook are separate groups; approval needs explicit consent.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {mergeHooks,installedGroups,statusEvents,approvalEvent,owned} from '../claude-hooks.mjs';
import {createIntegrations,APPROVAL_CONSENT} from '../src/integrations.mjs';
import {readConfig} from '../src/approval-policy.mjs';
import {DeckStore} from '../src/store.mjs';

const options={node:'C:\\tools\\node.exe',plugin:'C:\\p\\de.cardea.deck.sdPlugin'};
const foreign={env:{KEEP:'1'},hooks:{Stop:[{hooks:[{type:'command',command:'echo mine'}]}],PermissionRequest:[{hooks:[{type:'command',command:'echo my-approver'}]}]},statusLine:{type:'command',command:'echo status'}};
const ownOn=(settings,event)=>(settings.hooks?.[event]??[]).flatMap(group=>group.hooks).filter(hook=>owned(hook));

test('default merge adds status hooks and never the approval hook',()=>{
 const merged=mergeHooks({},options);
 for(const event of statusEvents)assert.equal(ownOn(merged,event).length,1,event);
 assert.equal(merged.hooks[approvalEvent],undefined);assert.ok(merged.statusLine);
 const groups=installedGroups(merged,options);assert.equal(groups.status,true);assert.equal(groups.approval,false);
});
test('the approval hook is added only when asked for, alone or with status',()=>{
 const only=mergeHooks({},{...options,status:false,approval:true});
 assert.deepEqual(Object.keys(only.hooks),[approvalEvent]);assert.equal(only.statusLine,undefined);
 const both=mergeHooks({},{...options,approval:true});
 assert.equal(ownOn(both,approvalEvent).length,1);assert.equal(ownOn(both,approvalEvent)[0].timeout,60);assert.equal(ownOn(both,'Stop')[0].timeout,2);
});
test('each group can be removed alone and foreign entries in the same events stay',()=>{
 const both=mergeHooks(foreign,{...options,approval:true});
 const noApproval=mergeHooks(both,{remove:'approval'});
 assert.equal(ownOn(noApproval,approvalEvent).length,0);assert.equal(ownOn(noApproval,'Stop').length,1);
 assert.deepEqual(noApproval.hooks[approvalEvent],foreign.hooks[approvalEvent]);
 const noStatus=mergeHooks(both,{remove:'status'});
 assert.equal(ownOn(noStatus,'Stop').length,0);assert.equal(ownOn(noStatus,approvalEvent).length,1);
 assert.deepEqual(noStatus.statusLine,foreign.statusLine);
 assert.deepEqual(mergeHooks(both,{remove:true}),foreign);
 assert.throws(()=>mergeHooks(both,{remove:'everything'}),/Invalid hook group/);
});
test('our own status line goes with the status group, not with the approval group',()=>{
 const both=mergeHooks({},{...options,approval:true});
 assert.ok(mergeHooks(both,{remove:'approval'}).statusLine);
 assert.equal(mergeHooks(both,{remove:'status'}).statusLine,undefined);
});

function fixture(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-groups-')),home=path.join(dir,'user'),appData=path.join(home,'AppData/Roaming'),plugin=path.join(appData,'Elgato/StreamDeck/Plugins/de.cardea.deck.sdPlugin'),node=path.join(dir,'node.exe');
 const put=(file,data)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof data==='string'?data:JSON.stringify(data));};
 put(node,'synthetic');put(path.join(plugin,'manifest.json'),{UUID:'de.cardea.deck'});
 for(const name of ['approval-rules','bridge','runtime','statusline','permission-auth','receiver-client','tool-summary'])put(path.join(plugin,'hooks',name+'.cjs'),'// fixture');
 const settings=path.join(home,'.claude/settings.json');put(settings,foreign);
 const manager=extra=>createIntegrations({home,appData,plugin,node,configDir:'',managedDirectory:path.join(dir,'managed'),machineFile:path.join(dir,'machine.json'),...extra});
 const read=()=>JSON.parse(fs.readFileSync(settings));
 try{return fn({dir,home,plugin,node,put,settings,read,manager,runtime:path.join(home,'.cardeadeck')});}
 finally{assert.ok(path.basename(dir).startsWith('cardea-groups-'));fs.rmSync(dir,{recursive:true,force:true});}
}
test('Set up Claude installs status only and records no consent',()=>fixture(f=>{
 const m=f.manager();m.update('setupClaude');
 assert.equal(ownOn(f.read(),approvalEvent).length,0);assert.equal(ownOn(f.read(),'Stop').length,1);
 const status=m.status();assert.equal(status.claude,'installed');assert.equal(status.approvals,'off');assert.notEqual(readConfig(f.runtime).approvalsEnabled,true);
}));
test('enabling approvals requires the exact consent value and leaves settings unchanged without it',()=>fixture(f=>{
 const m=f.manager(),before=fs.readFileSync(f.settings);
 for(const consent of [undefined,true,'yes'])assert.throws(()=>m.update('enableApprovals',{consent}),/consent_required/);
 assert.deepEqual(fs.readFileSync(f.settings),before);
 assert.equal(m.update('enableApprovals',{consent:APPROVAL_CONSENT}).approvals,'on');
 assert.equal(ownOn(f.read(),approvalEvent).length,1);assert.equal(readConfig(f.runtime).approvalsEnabled,true);assert.ok(readConfig(f.runtime).approvalsConsentAt);
 assert.equal(ownOn(f.read(),'Stop').length,0,'Enabling approvals does not add status hooks by itself');
}));
test('consent survives Set up Claude; disabling removes the hook and the consent',()=>fixture(f=>{
 const m=f.manager();m.update('setupClaude');m.update('enableApprovals',{consent:APPROVAL_CONSENT});
 m.update('setupClaude');assert.equal(ownOn(f.read(),approvalEvent).length,1);
 const off=m.update('disableApprovals');assert.equal(off.approvals,'off');assert.equal(off.claude,'installed');
 assert.equal(ownOn(f.read(),approvalEvent).length,0);assert.equal(ownOn(f.read(),'Stop').length,1);assert.equal(readConfig(f.runtime).approvalsEnabled,false);
}));
test('removing status keeps a consented approval hook; removing all clears everything',()=>fixture(f=>{
 const m=f.manager();m.update('setupClaude');m.update('enableApprovals',{consent:APPROVAL_CONSENT});
 const kept=m.update('removeStatus');assert.equal(kept.claude,'not_set_up');assert.equal(kept.approvals,'on');assert.equal(ownOn(f.read(),'Stop').length,0);
 m.update('removeClaude');assert.deepEqual(f.read(),foreign);assert.equal(readConfig(f.runtime).approvalsEnabled,false);
}));
test('an approval hook from an older version is inactive until consent and removed by setup',()=>fixture(f=>{
 f.put(f.settings,mergeHooks(foreign,{node:f.node,plugin:f.plugin,approval:true}));
 const m=f.manager();assert.equal(m.status().approvals,'hook_inactive');
 m.update('setupClaude');assert.equal(ownOn(f.read(),approvalEvent).length,0);assert.equal(m.status().approvals,'off');
 assert.deepEqual(f.read().hooks[approvalEvent],foreign.hooks[approvalEvent],'A foreign approver stays');
}));
test('status-only operation reports waiting for input without the approval hook',()=>{
 const store=new DeckStore({clock:()=>5000}),base={sessionId:'status-only',cwd:'G:\\Project'};let id=0;
 const send=(event,at,extra={})=>assert.equal(store.event({...base,event,at,eventId:'e'+(++id),...extra}),true);
 send('SessionStart',1000);assert.equal(store.get('status-only').state,'idle');
 send('UserPromptSubmit',1100);assert.equal(store.get('status-only').state,'working');
 send('PreToolUse',1200,{tool:'Bash',toolUseId:'t1'});assert.equal(store.get('status-only').state,'working');
 send('Notification',1300,{notificationType:'permission_prompt'});assert.equal(store.get('status-only').state,'attention');assert.equal(store.get('status-only').requestId,null);
 send('PostToolUse',1400,{tool:'Bash',toolUseId:'t1'});assert.equal(store.get('status-only').state,'working');
 send('Stop',1500);assert.equal(store.get('status-only').state,'unread');
});
test('portable setup adds the approval hook only with the flag and uninstall withdraws consent',async()=>{
 const {createPlan,applyPlan,uninstall}=await import('../setup.mjs'),{profileTemplate,profileId}=await import('../profile.mjs'),{createHash}=await import('node:crypto');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-groups-')),write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));};
 const home=path.join(dir,'user'),appData=path.join(home,'AppData/Roaming'),directory=path.join(dir,'download'),settings=path.join(home,'.claude/settings.json'),runtime=path.join(home,'.cardeadeck');
 try{
  write(settings,foreign);const profile=profileTemplate(),base=path.join(directory,'profile-template',profileId);write(path.join(base,'manifest.json'),profile.manifest);profile.pages.forEach((p,i)=>write(path.join(base,'Profiles',profile.ids[i],'manifest.json'),p));write(path.join(base,'Profiles',profile.manifest.Pages.Default,'manifest.json'),{Controllers:[{Type:'Keypad',Actions:{}}]});
  const plugin=path.join(directory,'de.cardea.deck.sdPlugin');write(path.join(plugin,'manifest.json'),{UUID:'de.cardea.deck',Version:'0.9.0.0'});write(path.join(plugin,'bin/plugin.mjs'),'// fixture');for(const name of ['approval-rules','bridge','runtime','statusline','permission-auth','receiver-client','tool-summary'])write(path.join(plugin,'hooks',name+'.cjs'),'// fixture');
  write(path.join(appData,'Elgato/StreamDeck/ProfilesV3/existing.sdProfile/manifest.json'),{Device:{Model:'20GBA9901',UUID:'fixture-device'}});
  const files={};(function walk(root){for(const e of fs.readdirSync(root,{withFileTypes:true})){const file=path.join(root,e.name);if(e.isDirectory())walk(file);else files[path.relative(directory,file).replaceAll('\\','/')]=createHash('sha256').update(fs.readFileSync(file)).digest('hex');}})(directory);write(path.join(directory,'integrity.json'),{schema:1,version:'0.9.0',files});
  const read=()=>JSON.parse(fs.readFileSync(settings));
  applyPlan(createPlan({directory,home,appData}));assert.equal(ownOn(read(),approvalEvent).length,0);assert.equal(ownOn(read(),'Stop').length,1);assert.equal(readConfig(runtime).approvalsEnabled,false);
  applyPlan(createPlan({directory,home,appData,approvals:true}));assert.equal(ownOn(read(),approvalEvent).length,1);assert.equal(readConfig(runtime).approvalsEnabled,true);assert.ok(readConfig(runtime).approvalsConsentAt);
  applyPlan(createPlan({directory,home,appData}));assert.equal(ownOn(read(),approvalEvent).length,0,'An upgrade without the flag drops the hook');assert.equal(readConfig(runtime).approvalsEnabled,false);
  applyPlan(createPlan({directory,home,appData,approvals:true}));uninstall({home,appData});assert.deepEqual(read(),foreign);assert.equal(readConfig(runtime).approvalsEnabled,false);
 }finally{assert.ok(path.basename(dir).startsWith('cardea-groups-'));fs.rmSync(dir,{recursive:true,force:true});}
});
test('standalone recovery removes one group at a time',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-groups-')),file=path.join(dir,'.claude/settings.json');fs.mkdirSync(path.dirname(file));
 const run=group=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',path.resolve('Remove-Claude-Hooks.ps1'),'-Group',group],{env:{...process.env,USERPROFILE:dir},windowsHide:true,encoding:'utf8'});
 const plugin=path.join(dir,'de.cardea.deck.sdPlugin'),both=mergeHooks(foreign,{node:options.node,plugin,approval:true,status:true});
 const read=()=>JSON.parse(fs.readFileSync(file));
 try{
  fs.writeFileSync(file,JSON.stringify(both));fs.mkdirSync(path.join(dir,'.cardeadeck'));fs.writeFileSync(path.join(dir,'.cardeadeck/config.json'),JSON.stringify({schema:1,approvalsEnabled:true}));
  run('Approval');assert.equal(ownOn(read(),approvalEvent).length,0);assert.equal(ownOn(read(),'Stop').length,1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'.cardeadeck/config.json'))).approvalsEnabled,false,'Consent is withdrawn with the hook');
  run('Status');assert.deepEqual(read().hooks,foreign.hooks);assert.deepEqual(read().statusLine,foreign.statusLine);
  fs.writeFileSync(file,JSON.stringify(both));run('Status');assert.equal(ownOn(read(),approvalEvent).length,1);assert.equal(ownOn(read(),'Stop').length,0);
  // A lock from a process that is gone must not block recovery.
  fs.writeFileSync(file,JSON.stringify(both));fs.writeFileSync(path.join(dir,'.cardeadeck/integrations.lock'),JSON.stringify({pid:999999,at:1}));run('All');assert.deepEqual(read().hooks,foreign.hooks);
  // Consent is withdrawn even when no settings file is left.
  fs.unlinkSync(file);fs.writeFileSync(path.join(dir,'.cardeadeck/config.json'),JSON.stringify({schema:1,approvalsEnabled:true}));run('All');assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'.cardeadeck/config.json'))).approvalsEnabled,false);
 }finally{assert.ok(path.basename(dir).startsWith('cardea-groups-'));fs.rmSync(dir,{recursive:true,force:true});}
});
