// Reduces a PermissionRequest's tool input to one short display line for the key.
// It is held in memory only: never written to state, logs or backups.
const path=require('node:path');
const MAX=240;
// Longest text the key can show whole (see detailLines in src/cards.mjs).
const DISPLAY=52;
// Longer inputs are cut before any matching, so their size cannot slow the hook down.
const SCAN=4096;
// Control and direction-override characters could disguise what a key displays.
const INVISIBLE=/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]+/g;
const SECRETS=[
 [/((?:^|[\s"'])--?(?:password|passwd|pwd|token|secret|api[-_]?key|auth)(?:=|\s+))("[^"]*"|'[^']*'|\S+)/gi,'$1***'],
 [/(\b[A-Za-z0-9_]*(?:token|secret|password|passwd|api[-_]?key)[A-Za-z0-9_]*=)("[^"]*"|'[^']*'|[^\s&]+)/gi,'$1***'],
 [/(\bbearer\s+)\S+/gi,'$1***'],
 [/(\/\/[^\s/:@]+:)[^\s/@]+@/g,'$1***@'],
];
const bounded=value=>typeof value==='string'?(value.length>SCAN?value.slice(0,SCAN):value):'';
const boundedEnd=value=>typeof value==='string'?(value.length>SCAN?value.slice(-SCAN):value):'';
const clean=value=>value.replace(INVISIBLE,' ').replace(/\s+/g,' ').trim();
const redact=text=>SECRETS.reduce((value,[pattern,replacement])=>value.replace(pattern,replacement),text);
// A UNC or device path reaches other machines and can hand over Windows credentials.
const networkPath=value=>/^[\\/]{2}/.test(value.trim())||/^file:/i.test(value.trim());
// "x\secret\decoy.txt\.." must show what it resolves to.
const resolved=value=>{const trimmed=value.trim();return path.win32.isAbsolute(trimmed)?path.win32.normalize(trimmed):trimmed;};
const FIELDS={
 Bash:['text','command'],PowerShell:['text','command'],
 Read:['path','file_path'],Write:['path','file_path'],Edit:['path','file_path'],MultiEdit:['path','file_path'],
 NotebookRead:['path','notebook_path'],NotebookEdit:['path','notebook_path'],LS:['path','path'],
 WebFetch:['text','url'],WebSearch:['text','query'],Task:['text','description'],Agent:['text','description'],
};
// blocked: the key must not offer this request, whatever the allowlist says.
function summarizeTool(tool,input){
 if(!input||typeof input!=='object'||Array.isArray(input))return null;
 let kind='text',text='',raw=[],blocked;
 if(tool==='Grep'||tool==='Glob'){
  // The folder comes first: a long pattern must not push it off the key.
  const folder=boundedEnd(input.path),pattern=bounded(input.pattern);
  raw=[folder,pattern];
  if(networkPath(folder)||(tool==='Glob'&&networkPath(pattern)))blocked='network_path';
  const shown=clean(resolved(folder));
  text=[shown.length>28?'…'+shown.slice(-27):shown,clean(pattern)].filter(Boolean).join(' : ');
 }else if(typeof tool==='string'&&Object.hasOwn(FIELDS,tool)){
  const[fieldKind,field]=FIELDS[tool];kind=fieldKind;
  const value=kind==='path'?boundedEnd(input[field]):bounded(input[field]);raw=[value];
  if(kind==='path'&&networkPath(value))blocked='network_path';
  text=clean(kind==='path'?resolved(value):value);
 }else{
  // Tools this code knows nothing about: everything in the input must be visible, or none of it counts.
  const entries=Object.entries(input);raw=entries.flatMap(([key,value])=>[key,bounded(value)]);
  text=entries.filter(([,value])=>typeof value==='string').map(([key,value])=>clean(bounded(key))+'='+clean(bounded(value))).join(' ');
  if(entries.some(([,value])=>typeof value!=='string')||text.length>DISPLAY)blocked='incomplete_display';
 }
 if(!blocked&&raw.some(value=>value.search(INVISIBLE)>=0))blocked='hidden_characters';
 text=redact(text);
 if(!text)return null;
 if(text.length>MAX)text=kind==='path'?'…'+text.slice(-MAX):text.slice(0,MAX)+'…';
 return{kind,text,...(blocked?{blocked}:{})};
}
module.exports={summarizeTool,MAX,DISPLAY};
