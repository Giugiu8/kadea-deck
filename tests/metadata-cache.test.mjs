import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import promises from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {DeckStore} from '../src/store.mjs';import {refreshDesktopMetadata} from '../src/desktop.mjs';
test('unchanged metadata is parsed once while archive changes and new targets remain visible',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-metadata-cache-'));let reads=0;const io={...promises,readFile:async(...args)=>{reads++;return promises.readFile(...args);}};
 const store=new DeckStore();store.event({event:'UserPromptSubmit',sessionId:'synthetic',eventId:'one',at:Date.now()});const file=path.join(dir,'local_fixture.json');
 try{
  fs.writeFileSync(file,JSON.stringify({cliSessionId:'synthetic',sessionId:'local_123',title:'Synthetic',isArchived:false,private:'MUST_NOT_RETAIN'}));
  await refreshDesktopMetadata(store,dir,{io});await refreshDesktopMetadata(store,dir,{io});assert.equal(reads,1);
  fs.writeFileSync(file,JSON.stringify({cliSessionId:'synthetic',sessionId:'local_123',title:'Synthetic changed',isArchived:true}));
  await refreshDesktopMetadata(store,dir,{io});assert.equal(reads,2);assert.equal(store.get('synthetic').archived,true);assert.equal(store.get('synthetic').title,'Synthetic changed');
  assert.ok(!JSON.stringify([...store.sessions.values()]).includes('MUST_NOT_RETAIN'));
 }finally{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('cardea-metadata-cache-'));fs.rmSync(dir,{recursive:true,force:true});}
});
