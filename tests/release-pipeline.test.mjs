// Release workflow rules, byte-identical rebuilds and the release verifier's SBOM check.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {reproducibleFiles,pluginFiles} from '../plugin-files.mjs';
import {checkSbom} from '../verify-release.mjs';
import {compareProfile,compareSbom,readZip} from '../reproduce.mjs';
import zlib from 'node:zlib';
const root=path.resolve('.');
const workflow=name=>fs.readFileSync(path.join(root,'.github/workflows',name),'utf8');
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for(const name of fs.readdirSync(path.join(root,'.github/workflows')))test(`${name} pins every action to a full commit SHA`,()=>{
 const uses=[...workflow(name).matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)(.*)$/gm)];assert.ok(uses.length>=2);
 for(const[,target,rest]of uses){assert.match(target,/^[\w.-]+\/[\w.-]+@[a-f0-9]{40}$/,target);assert.match(rest,/#\s*v\d/,'Version comment for '+target);}
 assert.ok(!/pull_request_target/.test(workflow(name)));
});
test('the release runs only on tags, with least privilege per job, attestation and SBOM',()=>{
 const text=workflow('release.yml');
 assert.match(text,/on:\n\s+push:\n\s+tags:\n\s+- 'v\*'\n/);assert.ok(!/\n\s+branches:/.test(text));assert.match(text,/^permissions: \{\}$/m);
 const job=name=>{const start=text.indexOf(`\n  ${name}:\n`);assert.ok(start>0,name);const rest=text.slice(start+1),next=rest.slice(3).search(/\n  [a-z]+:\n/);return next<0?rest:rest.slice(0,next+3);};
 assert.ok(!/id-token|attestations: write|contents: write/.test(job('build')),'Building runs repository and package-manager code: no signing rights');assert.match(job('build'),/contents: read/);
 assert.match(job('attest'),/id-token: write/);assert.match(job('attest'),/attestations: write/);assert.ok(!/actions\/checkout|setup-node|npm |choco|run:/.test(job('attest')),'The job with signing rights runs no code from the repository');
 assert.match(job('attest'),/attest-build-provenance@/);assert.match(job('attest'),/attest-sbom@/);
 assert.ok(!/id-token/.test(job('publish')));assert.match(job('publish'),/contents: write/);assert.ok(!/actions\/checkout/.test(job('publish')),'Publishing runs no repository code');
 assert.match(job('publish'),/needs: \[build, reproduce, attest\]/);assert.match(job('attest'),/needs: \[build, reproduce\]/);
 assert.ok(!/Cardea-Deck-\*/.test(job('reproduce')),'Each file is named: a wildcard could skip one');assert.match(job('reproduce'),/sha256sum -c/);assert.match(job('reproduce'),/diff expected-files/);assert.match(job('reproduce'),/\.cdx\.json"$/m);assert.match(job('reproduce'),/advanced-portable\.zip"$/m);assert.match(job('reproduce'),/reproduce\.mjs release-files\/Remove-Claude-Hooks\.ps1/);assert.match(job('reproduce'),/ubuntu/);
 assert.ok(!/cache: npm/.test(text),'No dependency cache in a release');assert.match(text,/does not match package version/);
});
function buildCopy(dir,out){
 const copy=path.join(dir,'a different path with spaces');
 for(const name of ['src','hooks','pi','assets'])fs.cpSync(path.join(root,name),path.join(copy,name),{recursive:true});
 for(const name of fs.readdirSync(root))if(/\.(mjs|json)$/.test(name))fs.copyFileSync(path.join(root,name),path.join(copy,name));
 // Real folders, as in a fresh clone: a link would put its target's path into the bundle's comments.
 for(const name of ['esbuild','@esbuild','@elgato/streamdeck','@elgato/utils','@elgato/schemas','ws','zod'])fs.cpSync(path.join(root,'node_modules',name),path.join(copy,'node_modules',name),{recursive:true});
 execFileSync(process.execPath,[path.join(copy,'build.mjs'),'--code-only','--out',out],{cwd:copy,windowsHide:true,stdio:'pipe'});
}
const inTemp=fn=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-repro-'));try{return fn(dir);}finally{assert.ok(path.basename(dir).startsWith('cardea-repro-'));fs.rmSync(dir,{recursive:true,force:true});}};
test('a rebuild from another location is byte-identical to the build, for all code',()=>inTemp(dir=>{
 const out=path.join(dir,'out');buildCopy(dir,out);
 assert.ok(reproducibleFiles.includes('bin/plugin.mjs')&&reproducibleFiles.includes('hooks/bridge.cjs')&&reproducibleFiles.includes('pi/index.js')&&reproducibleFiles.includes('manifest.json'));
 for(const name of reproducibleFiles)assert.equal(sha(path.join(out,name)),sha(path.join(root,'dist/de.cardea.deck.sdPlugin',name)),name);
 const bundle=fs.readFileSync(path.join(out,'bin/plugin.mjs'),'utf8');assert.ok(!bundle.includes(dir)&&!bundle.includes(root),'No build path in the bundle');
}));
test('every packaged file that can execute is covered by the comparison',()=>{
 for(const name of pluginFiles)if(/\.(mjs|cjs|js|html|exe|dll|ps1)$/.test(name))assert.ok(reproducibleFiles.includes(name),name);
});
test('reproduce.mjs accepts a matching plugin and reports a changed file',()=>inTemp(dir=>{
 const copy=path.join(dir,'released');fs.cpSync(path.join(root,'dist/de.cardea.deck.sdPlugin'),copy,{recursive:true,filter:source=>path.basename(source)!=='logs'});
 const run=()=>spawnSync(process.execPath,['reproduce.mjs',copy],{cwd:root,encoding:'utf8',windowsHide:true});
 const good=run();assert.equal(good.status,0,good.stdout+good.stderr);assert.match(good.stdout,/All \d+ checks match/);
 fs.appendFileSync(path.join(copy,'bin/plugin.mjs'),'// added after the build\n');
 const bad=run();assert.equal(bad.status,1);assert.match(bad.stdout,/DIFFERENT .*bin\/plugin\.mjs/);
 fs.unlinkSync(path.join(copy,'hooks/bridge.cjs'));assert.match(run().stdout,/DIFFERENT .*hooks\/bridge\.cjs.*\(missing\)/);
 fs.copyFileSync(path.join(root,'dist/de.cardea.deck.sdPlugin/hooks/bridge.cjs'),path.join(copy,'hooks/bridge.cjs'));fs.copyFileSync(path.join(root,'dist/de.cardea.deck.sdPlugin/bin/plugin.mjs'),path.join(copy,'bin/plugin.mjs'));
 fs.writeFileSync(path.join(copy,'hooks/planted.cjs'),'// x');const planted=run();assert.equal(planted.status,1);assert.match(planted.stdout,/DIFFERENT .*hooks\/planted\.cjs/);fs.unlinkSync(path.join(copy,'hooks/planted.cjs'));
 fs.writeFileSync(path.join(copy,'stray.js'),'// x');assert.equal(run().status,1,'Anything the release does not account for counts');fs.unlinkSync(path.join(copy,'stray.js'));
 assert.equal(spawnSync(process.execPath,['reproduce.mjs',copy,'extra'],{cwd:root,encoding:'utf8',windowsHide:true}).status,2,'One file at a time');
 fs.copyFileSync(path.join(root,'dist/de.cardea.deck.sdPlugin/manifest.json'),path.join(copy,'package.json'));assert.equal(run().status,1,'Any listed file counts');
}));
test('line endings are fixed for every checkout, so hashes do not depend on Git settings',()=>{
 assert.match(fs.readFileSync(path.join(root,'.gitattributes'),'utf8'),/^\* text=auto eol=lf$/m);
});
test('the SBOM check wants the runtime dependencies and rejects build-only tools',()=>{
 const good={bomFormat:'CycloneDX',components:[{name:'@elgato/streamdeck'},{name:'ws'}]};
 assert.equal(checkSbom(good),2);
 assert.throws(()=>checkSbom({bomFormat:'other',components:good.components}),/SBOM/);
 assert.throws(()=>checkSbom({bomFormat:'CycloneDX',components:[{name:'ws'}]}),/SBOM/);
 assert.throws(()=>checkSbom({bomFormat:'CycloneDX',components:[...good.components,{name:'esbuild'}]}),/SBOM/);
});
test('the profile comparison sees a key that was pointed somewhere else',()=>{
 const profile=fs.readFileSync(path.join(root,'dist/de.cardea.deck.sdPlugin/profiles/Cardea Deck.streamDeckProfile')),version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
 assert.ok(readZip(profile).size>4);assert.equal(compareProfile(profile,version),null);assert.equal(compareProfile(null,version),'profile is missing');
});

function zipOf(items){
 const locals=[],central=[];let offset=0;
 for(const[name,text,{extra=Buffer.alloc(0),localName=name}={}]of items){
  const data=Buffer.from(text),raw=Buffer.from(name),local=Buffer.from(localName),head=Buffer.alloc(30),dir=Buffer.alloc(46);
  head.writeUInt32LE(0x04034b50,0);head.writeUInt32LE(data.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(local.length,26);head.writeUInt16LE(0,28);
  dir.writeUInt32LE(0x02014b50,0);dir.writeUInt32LE(data.length,20);dir.writeUInt32LE(data.length,24);dir.writeUInt16LE(raw.length,28);dir.writeUInt16LE(extra.length,30);dir.writeUInt32LE(offset,42);
  locals.push(head,local,data);central.push(dir,raw,extra);offset+=30+local.length+data.length;
 }
 const body=Buffer.concat(locals),table=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(items.length,8);end.writeUInt16LE(items.length,10);end.writeUInt32LE(table.length,12);end.writeUInt32LE(body.length,16);
 return Buffer.concat([body,table,end]);
}
test('an archive with ambiguous names is refused',()=>{
 assert.equal(readZip(zipOf([['a/hooks/x.cjs','1']])).size,1);
 for(const[label,items]of [['case collision',[['hooks/x.cjs','1'],['Hooks/x.cjs','2']]],['duplicate',[['hooks/x.cjs','1'],['hooks/x.cjs','2']]],['dot segment',[['hooks/./x.cjs','1']]],['trailing dot',[['hooks./x.cjs','1']]],['parent',[['../x.cjs','1']]],['absolute',[['/x.cjs','1']]],['stream',[['x.cjs:y','1']]],['names disagree',[['hooks/x.cjs','1',{localName:'hooks/y.cjs'}]]],['unicode path field',[['hooks/x.cjs','1',{extra:Buffer.from([0x75,0x70,0,0])}]]]])assert.throws(()=>readZip(zipOf(items)),/Zip|Unsafe/,label);
});
test('a tampered release is caught at every place it could hide',()=>inTemp(dir=>{
 const dist=path.join(root,'dist/de.cardea.deck.sdPlugin'),version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,zipped=fs.readFileSync(path.join(dist,'profiles/Cardea Deck.streamDeckProfile'));
 const entries=readZip(zipped),names=[...entries.keys()],top=names.find(n=>/\.sdProfile\/manifest\.json$/.test(n)),manifest=JSON.parse(entries.get(top)),base=top.slice(0,-'manifest.json'.length);
 const build=change=>{const next=new Map(entries);change(next);return zipOf([...next].map(([n,d])=>[n,d]));};
 const pageFile=base+'Profiles/'+manifest.Pages.Pages[3]+'/manifest.json',page=()=>JSON.parse(entries.get(pageFile));
 assert.equal(compareProfile(build(()=>{}),version),null,'The untampered profile passes');
 assert.match(compareProfile(build(m=>{const p=page();p.Controllers[0].Actions['0,1'].Settings.path='C:/evil.exe';m.set(pageFile,JSON.stringify(p));}),version),/differ/);
 assert.match(compareProfile(build(m=>{const p=page();p.Controllers[1]={Type:'Encoder',Actions:{x:{UUID:'com.elgato.streamdeck.system.open',Settings:{path:'C:/evil.exe'}}}};m.set(pageFile,JSON.stringify(p));}),version),/differ/);
 assert.match(compareProfile(build(m=>{const p=page();p.Controllers[0].Actions['0,1'].Plugin={UUID:'evil'};m.set(pageFile,JSON.stringify(p));}),version),/differ/);
 assert.match(compareProfile(build(m=>{m.set(base+'Profiles/EXTRA/manifest.json','{}');}),version),/unexpected/);
 assert.match(compareProfile(build(m=>{m.set(top,JSON.stringify({...manifest,Pages:{...manifest.Pages,Current:'EXTRA'}}));}),version),/pages/);
 assert.match(compareProfile(build(m=>{m.set(top,JSON.stringify({...manifest,AppIdentifier:'*'}));}),version),/settings/);
 const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json')));const good=Object.entries(lock.packages).filter(([n,e])=>n&&!e.dev).map(([n,e])=>({name:n.split('node_modules/').at(-1),version:e.version}));
 assert.equal(compareSbom({bomFormat:'CycloneDX',components:good}),null);assert.ok(compareSbom({bomFormat:'CycloneDX',components:good.slice(1)}));assert.ok(compareSbom({bomFormat:'CycloneDX',components:[...good,{name:'x',version:'1'}]}));
 assert.ok(dir);
}));

test('a plugin archive is not mistaken for the portable download, and passes when untampered',()=>inTemp(dir=>{
 const dist=path.join(root,'dist/de.cardea.deck.sdPlugin'),items=[];
 for(const name of pluginFiles)items.push(['de.cardea.deck.sdPlugin/'+name,fs.readFileSync(path.join(dist,name))]);
 const file=path.join(dir,'test.streamDeckPlugin');fs.writeFileSync(file,zipOf(items));
 const run=()=>spawnSync(process.execPath,['reproduce.mjs',file],{cwd:root,encoding:'utf8',windowsHide:true});
 const good=run();assert.equal(good.status,0,good.stdout+good.stderr);
 fs.writeFileSync(file,zipOf([...items,['de.cardea.deck.sdPlugin/hooks/planted.cjs','// x']]));assert.equal(run().status,1);
 fs.writeFileSync(file,zipOf([...items,['de.cardea.deck.sdPlugin/Hooks/bridge.cjs','// evil']]));assert.notEqual(run().status,0,'Case variants of a listed name');
}));
test('the SBOM source covers every package that really ends up in the bundle',()=>{
 const bundle=fs.readFileSync(path.join(root,'dist/de.cardea.deck.sdPlugin/bin/plugin.mjs'),'utf8'),inBundle=new Set([...bundle.matchAll(/^\/\/ node_modules\/((?:@[^/]+\/)?[^/]+)\//gm)].map(match=>match[1]));
 assert.ok(inBundle.has('@elgato/schemas')&&inBundle.has('ws'));
 const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'))),runtime=new Set(Object.entries(lock.packages).filter(([name,entry])=>name&&!entry.dev).map(([name])=>name.split('node_modules/').at(-1)));
 for(const name of inBundle)assert.ok(runtime.has(name),name);
});
