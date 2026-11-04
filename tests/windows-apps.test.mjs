import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';
import {selectCodexPackage,discoverCodex} from '../src/windows-apps.mjs';
const installed={Name:'OpenAI.Codex',PackageFamilyName:'OpenAI.Codex_2p2nqsd0c76g0',SignatureKind:'Store',IsDevelopmentMode:false,InstallLocation:'D:\\WindowsApps\\OpenAI.Codex_2.0.0.0_x64__2p2nqsd0c76g0',Version:'2.0.0.0'};
const io={exists:()=>true,realpath:value=>value};
test('Codex launch target must come from the exact Store package and remain inside its installation',()=>{
 assert.equal(selectCodexPackage([installed],io),path.join(installed.InstallLocation,'app/resources/codex.exe'));
 for(const change of[{SignatureKind:'Developer'},{IsDevelopmentMode:true},{PackageFamilyName:'OpenAI.Codex_otherpublisher'},{Name:'OtherApp'}])assert.equal(selectCodexPackage([{...installed,...change}],io),null);
 assert.equal(selectCodexPackage([installed],{...io,realpath:value=>value.endsWith('codex.exe')?'C:\\elsewhere\\codex.exe':value}),null);
 const newer={...installed,Version:'10.0.0.0',InstallLocation:'D:\\WindowsApps\\newer'};assert.equal(selectCodexPackage([installed,newer],io),path.join(newer.InstallLocation,'app/resources/codex.exe'));
});
test('asynchronous discovery has a bounded hidden PowerShell invocation and fails closed',async()=>{
 let options;assert.equal(await discoverCodex((_exe,_args,opts,done)=>{options=opts;done(Error('missing'));}),null);assert.equal(options.windowsHide,true);assert.equal(options.timeout,10_000);
});
