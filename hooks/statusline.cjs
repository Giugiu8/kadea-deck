// Installed only when no custom status line exists. Quota metadata stays local.
const path=require('node:path'),{spawn}=require('node:child_process');
let input='',bytes=0;process.stdin.on('data',b=>{bytes+=b.length;if(bytes<2_000_000)input+=b;});
process.stdin.on('end',()=>{
 try{
  if(bytes>=2_000_000)return;
  const data=JSON.parse(input);
  const bridge=spawn(process.execPath,[path.join(__dirname,'bridge.cjs'),'Quota'],{windowsHide:true,stdio:['pipe','ignore','ignore']});bridge.on('error',()=>{});bridge.stdin.on('error',()=>{});bridge.stdin.end(input);
  process.stdout.write(`${typeof data.model?.display_name==='string'?data.model.display_name:'Claude Code'}`);
 }catch{}
});
