import test from 'node:test';import assert from 'node:assert/strict';
import {registerIntegrationUi} from '../src/integration-ui.mjs';
function fixture({connectCodex=async()=>true}={}){
 const handlers={},sent=[],writes=[],action={id:'selected',manifestId:'de.cardea.deck.session'};
 const ui={action,onDidAppear(fn){handlers.appear=fn;},onDidDisappear(fn){handlers.disappear=fn;},onSendToPlugin(fn){handlers.message=fn;},async sendToPropertyInspector(p){sent.push(p);}};
 const manager={status:()=>({claude:'not_set_up'}),update:cmd=>writes.push(cmd)};
 registerIntegrationUi({ui,manager,connectCodex,uuid:()=> 'nonce-1'});handlers.appear({action});
 const send=payload=>handlers.message({action,payload});return{handlers,sent,writes,ui,action,send};
}
test('only a selected non-approval inspector with a fresh token can change integration settings',async()=>{
 const f=fixture();for(const payload of[{cmd:'setupClaude'},{cmd:'approve',nonce:'nonce-1'},{cmd:'setupClaude',nonce:'old'},{cmd:'setupClaude',nonce:'nonce-1',path:'C:/elsewhere'}])await f.send(payload);
 assert.deepEqual(f.writes,[]);await f.send({cmd:'setupClaude',nonce:'nonce-1'});assert.deepEqual(f.writes,['setupClaude']);
 f.action.manifestId='de.cardea.deck.permission';await f.send({cmd:'removeClaude',nonce:'nonce-1'});assert.equal(f.writes.length,1);
 f.handlers.disappear();await f.send({cmd:'setupClaude',nonce:'nonce-1'});assert.equal(f.writes.length,1);
});
test('native UI disconnect during discovery cancels persistence and prevents duplicate operations',async()=>{
 let finish,mayPersist;const pending=new Promise(resolve=>finish=resolve);
 const f=fixture({connectCodex:async stillCurrent=>{await pending;mayPersist=stillCurrent();return mayPersist;}});
 const first=f.send({cmd:'connectCodex',nonce:'nonce-1'});await Promise.resolve();await f.send({cmd:'setupClaude',nonce:'nonce-1'});assert.equal(f.writes.length,0);
 f.handlers.disappear();f.ui.action=null;finish();await first;assert.equal(mayPersist,false);
});
