import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import{execFileSync}from'node:child_process';
const plugin=path.resolve('dist/de.cardea.deck.sdPlugin');
test('built plugin includes a compact current profile, native setup UI and exactly matching auth helpers',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(plugin,'manifest.json'))),version=JSON.parse(fs.readFileSync('package.json')).version;
 assert.equal(manifest.Version,version+'.0');assert.deepEqual(manifest.Profiles,[{Name:'profiles/Cardea Deck',DeviceType:0,Readonly:false,AutoInstall:true,DontAutoSwitchWhenInstalled:true}]);
 for(const name of['bridge','runtime','statusline','permission-auth','receiver-client'])assert.deepEqual(fs.readFileSync(path.join(plugin,'hooks',name+'.cjs')),fs.readFileSync(path.join('hooks',name+'.cjs')),'Rebuild dist before running artifact checks');
 for(const name of['index.js','style.css'])assert.ok(fs.existsSync(path.join(plugin,'pi',name)));
 const script="Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead($env:CARDEA_TEST_ARCHIVE); try {$entries=@($z.Entries | Where-Object {$_.Name} | ForEach-Object {$_.FullName.Replace('\\','/')}); $entry=$z.Entries | Where-Object {$_.FullName -match '\\.sdProfile[/\\\\]manifest\\.json$'}; $r=[IO.StreamReader]::new($entry.Open()); try {$manifest=$r.ReadToEnd() | ConvertFrom-Json}finally{$r.Dispose()}; @{entries=$entries;manifest=$manifest} | ConvertTo-Json -Depth 12 -Compress}finally{$z.Dispose()}";
 const data=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,encoding:'utf8',env:{...process.env,CARDEA_TEST_ARCHIVE:path.join(plugin,'profiles/Cardea Deck.streamDeckProfile')}}));
 assert.equal(data.entries.filter(name=>name.endsWith('.png')).length,28);assert.ok(data.entries.length<=40);assert.equal(data.manifest.AppIdentifier,null);assert.equal(data.manifest.Device.UUID,'');assert.equal(data.manifest.Pages.Pages.length,4);
 const expected=new Set([...data.manifest.Pages.Pages,data.manifest.Pages.Default]);const actual=new Set(data.entries.map(name=>name.match(/\/Profiles\/([^/]+)\//)?.[1]).filter(Boolean));assert.deepEqual(actual,expected);
 assert.ok(!data.entries.some(name=>/node_modules|connection\.json|state\.json|\.log$|\.DS_Store/.test(name)));
});
