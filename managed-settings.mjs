// Prints a block for Claude Code's managed settings, so hooks need no change to ~/.claude/settings.json.
// Usage: node managed-settings.mjs --node <node.exe> --hooks <folder> [--approvals] [--status-line]
//        [--shell-form] [--allow-user-hooks]
// It only prints. Deploying the file stays with the administrator.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {approvalEvent,statusEvents} from './claude-hooks.mjs';
export const DEFAULT_NODE='C:\\Program Files\\nodejs\\node.exe';
export const DEFAULT_HOOKS='C:\\Program Files\\Cardea Deck\\hooks';
const checked=value=>{if(typeof value!=='string'||/["\r\n%$`!&|<>^]/.test(value)||!path.win32.isAbsolute(value))throw Error('Unsupported path: '+value);return value;};
export function managedBlock({node=DEFAULT_NODE,hooks=DEFAULT_HOOKS,approvals=false,statusLine=false,shellForm=false,onlyManaged=true}={}){
 checked(node);checked(hooks);
 const bridge=path.win32.join(hooks,'bridge.cjs');
 // Exec form runs without any shell, so it also works on PCs without Git Bash.
 const entry=(event,timeout)=>[{hooks:[shellForm?{type:'command',command:`"${node}" "${bridge}" ${event}`,timeout}:{type:'command',command:node,args:[bridge,event],timeout}]}];
 const block={...(onlyManaged?{allowManagedHooksOnly:true}:{}),hooks:{}};
 for(const event of statusEvents)block.hooks[event]=entry(event,2);
 if(approvals)block.hooks[approvalEvent]=entry(approvalEvent,60);
 if(statusLine)block.statusLine={type:'command',command:`"${node}" "${path.win32.join(hooks,'statusline.cjs')}"`};
 return block;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
 try{console.log(JSON.stringify(managedBlock({node:value('--node'),hooks:value('--hooks'),approvals:args.includes('--approvals'),statusLine:args.includes('--status-line'),shellForm:args.includes('--shell-form'),onlyManaged:!args.includes('--allow-user-hooks')}),null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
