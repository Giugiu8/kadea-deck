// JSON-only merge. Existing hooks and custom status lines are never executed.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mergeHooks} from './claude-hooks.mjs';
export {mergeHooks,events,owned} from './claude-hooks.mjs';
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,input,output,node,plugin]=process.argv.slice(2);if(!['install','remove'].includes(mode)||!input||!output)throw Error('Expected install/remove input output node plugin');
 const settings=fs.existsSync(input)?JSON.parse(fs.readFileSync(input,'utf8').replace(/^\uFEFF/,'')):{};
 fs.writeFileSync(output,JSON.stringify(mergeHooks(settings,{node,plugin,remove:mode==='remove'}),null,2)+'\n',{mode:0o600});
}
