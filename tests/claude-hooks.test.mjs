import test from 'node:test';import assert from 'node:assert/strict';
import {mergeHooks,owned} from '../setup-hooks.mjs';
test('foreign wrappers mentioning our hook path are never owned or removed',()=>{
 const commands=['echo "C:/plugins/de.cardea.deck.sdPlugin/hooks/bridge.cjs"','"echo" "C:/plugins/de.cardea.deck.sdPlugin/hooks/bridge.cjs" Stop','"node" "C:/plugins/de.cardea.deck.sdPlugin/hooks/bridge.cjs" Stop && echo foreign','"node" "C:/plugins/de.cardea.deck.sdPlugin/hooks/other.cjs" Stop'];
 const settings={hooks:{Stop:[{hooks:commands.map(command=>({type:'command',command}))}]}};
 for(const command of commands)assert.equal(owned(command),false);
 assert.deepEqual(mergeHooks(settings,{remove:true}),settings);
});
