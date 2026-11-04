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
 assert.match(job('build'),/id-token: write/);assert.match(job('build'),/attestations: write/);assert.match(job('build'),/contents: read/);assert.ok(!/contents: write/.test(job('build')));
 assert.ok(!/id-token/.test(job('publish')));assert.match(job('publish'),/contents: write/);assert.ok(!/actions\/checkout/.test(job('publish')),'Publishing runs no repository code');
 assert.match(job('publish'),/needs: \[build, reproduce\]/);assert.match(job('reproduce'),/node reproduce\.mjs unpacked/);assert.match(job('reproduce'),/ubuntu/);
 assert.match(job('build'),/attest-build-provenance@/);assert.match(job('build'),/attest-sbom@/);
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
 const good=run();assert.equal(good.status,0,good.stdout+good.stderr);assert.match(good.stdout,/All \d+ executable files match/);
 fs.appendFileSync(path.join(copy,'bin/plugin.mjs'),'// added after the build\n');
 const bad=run();assert.equal(bad.status,1);assert.match(bad.stdout,/DIFFERENT .*bin\/plugin\.mjs/);
 fs.unlinkSync(path.join(copy,'hooks/bridge.cjs'));assert.match(run().stdout,/DIFFERENT .*hooks\/bridge\.cjs.*\(missing\)/);
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
