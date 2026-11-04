import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {writeProfile,profileId} from '../profile.mjs';

test('rebuilding a generated profile replaces obsolete pages and leaves a complete previous build on failure',()=>{
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-profile-build-'));
 const destination=path.join(scratch,'profile-template',profileId);
 const render=(_card,file)=>fs.writeFileSync(file,'synthetic image');
 try{
  writeProfile(destination,'0.8.0',{render});
  const first=JSON.parse(fs.readFileSync(path.join(destination,'manifest.json'),'utf8'));
  writeProfile(destination,'0.8.0',{render});
  const next=JSON.parse(fs.readFileSync(path.join(destination,'manifest.json'),'utf8'));
  assert.equal(fs.readdirSync(path.join(destination,'Profiles')).length,5,'Four current pages and one empty pinned page only');
  for(const old of first.Pages.Pages)assert.equal(fs.existsSync(path.join(destination,'Profiles',old)),false);
  assert.throws(()=>writeProfile(destination,'0.8.0',{render(){throw Error('render failed');}}),/render failed/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(destination,'manifest.json'),'utf8')),next);
  assert.deepEqual(fs.readdirSync(path.dirname(destination)),[profileId]);
 }finally{
  assert.equal(path.dirname(scratch),os.tmpdir());assert.ok(path.basename(scratch).startsWith('cardea-profile-build-'));fs.rmSync(scratch,{recursive:true,force:true});
 }
});
