// Reduces a PermissionRequest's tool input to one short display line for the key.
// It stays in memory: never written to state, logs or backups.
// "blocked" means the key must not offer this request, because what it would show could differ
// from what runs. The rule is an allowlist: anything this code cannot show reliably goes to the dialog.
const path=require('node:path');
const MAX=240;
// Longest text the key can show whole (see detailLines in src/cards.mjs).
const DISPLAY=52;
// Inputs longer than this are never offered, and are not looked at beyond it.
const SCAN=4096;
// Characters whose shape and width on the key are known: no controls, no invisible or combining marks,
// no right-to-left text, no look-alike alphabets, no wide characters.
const PLAIN=/^[\u0020-\u007e\u00a1-\u00ac\u00ae-\u024f]*$/;
const plain=value=>PLAIN.test(value)&&value===value.trim()&&!value.includes('  ');
const INVISIBLE=/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]+/g;
const tidy=value=>value.replace(INVISIBLE,' ').replace(/\s+/g,' ').trim();
const SECRETS=[
 [/((?:^|[\s"'])--?(?:password|passwd|pwd|token|secret|api[-_]?key|auth)(?:=|\s+))("[^"]*"|'[^']*'|\S+)/gi,'$1***'],
 [/(\b[A-Za-z0-9_]*(?:token|secret|password|passwd|api[-_]?key)[A-Za-z0-9_]*=)("[^"]*"|'[^']*'|[^\s&]+)/gi,'$1***'],
 [/(\bbearer\s+)\S+/gi,'$1***'],
 [/(\/\/[^\s/:@]+:)[^\s/@]+@/g,'$1***@'],
];
const redact=text=>SECRETS.reduce((value,[pattern,replacement])=>value.replace(pattern,replacement),text);
const text_=value=>typeof value==='string'?value:'';
// A UNC, device or URL path reaches other machines and can hand over Windows credentials.
const networkPath=value=>/^\s*[\\/]{2}/.test(value)||/^\s*[a-z][a-z0-9+.-]*:[\\/]{2}/i.test(value)||/^\s*file:/i.test(value);
// Forms whose real target cannot be told from the text. Windows ignores dots and spaces at the end of a
// name, a colon after the drive selects a hidden stream, and ~, % and $ may be expanded by something else.
function unusualPath(value){
 if(/[~%$*?"<>|]/.test(value)||/^[\\/]/.test(value)||/^[A-Za-z]:(?![\\/])/.test(value)||value.indexOf(':',2)>=0||value.lastIndexOf(':')>1)return true;
 // Reserved device names, with or without an extension, are no files.
 return value.split(/[\\/]/).some(part=>part!=='.'&&part!=='..'&&(/[. ]$/.test(part)||/^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(part)));
}
// The absolute path this resolves to, or a reason why that cannot be known.
function locate(value,cwd){
 if(value.length>SCAN)return{blocked:'incomplete_display',text:tidy(value.slice(-SCAN))};
 if(networkPath(value))return{blocked:'network_path',text:tidy(value)};
 if(!plain(value))return{blocked:'unusual_characters',text:tidy(value)};
 if(unusualPath(value))return{blocked:'unusual_path',text:value};
 if(/^[A-Za-z]:[\\/]/.test(value)){const text=path.win32.normalize(value);return text.length>MAX?{blocked:'incomplete_display',text}:{text};}
 const base=text_(cwd);
 if(!/^[A-Za-z]:[\\/]/.test(base)||base.length>SCAN)return{blocked:'relative_path',text:tidy(value)};
 // The session folder ends up on the key too, so it has to pass the same checks.
 if(!plain(base))return{blocked:'unusual_characters',text:tidy(path.win32.resolve(base,value))};
 if(unusualPath(base))return{blocked:'unusual_path',text:tidy(path.win32.resolve(base,value))};
 return{text:path.win32.resolve(base,value)};
}
// Fields of the tools a key can answer that do not widen what the key shows. Anything else, such as a
// Grep glob or context option, means the key would not be telling the whole story.
const KNOWN_INPUT={Read:['file_path','offset','limit'],LS:['path'],Glob:['pattern','path'],Grep:['pattern','path','output_mode','head_limit','offset','-i','-n','case_insensitive']};
const onlyKnownInput=(tool,input)=>!Object.hasOwn(KNOWN_INPUT,tool)||Object.entries(input).every(([key,value])=>KNOWN_INPUT[tool].includes(key)&&(['string','number','boolean'].includes(typeof value))&&(typeof value!=='string'||['file_path','path','pattern','output_mode'].includes(key)));
const FIELDS={
 Bash:['text','command'],PowerShell:['text','command'],
 Read:['path','file_path'],Write:['path','file_path'],Edit:['path','file_path'],MultiEdit:['path','file_path'],
 NotebookRead:['path','notebook_path'],NotebookEdit:['path','notebook_path'],LS:['path','path'],
 WebFetch:['text','url'],WebSearch:['text','query'],Task:['text','description'],Agent:['text','description'],
};
function summarizeSearch(tool,input,cwd){
 const given=text_(input.path),pattern=text_(input.pattern);
 const folder=given?locate(given,cwd):locate(text_(cwd)||'.',cwd);
 const shownPattern=pattern.length>SCAN?tidy(pattern.slice(0,SCAN)):tidy(pattern);
 // A network target wins over every other reason.
 let blocked=tool==='Glob'&&networkPath(pattern)?'network_path':folder.blocked;
 if(!blocked&&pattern.length>SCAN)blocked='incomplete_display';
 if(!blocked&&!plain(pattern))blocked='unusual_characters';
 // A file pattern is a path too. This keeps it inside the folder the key names.
 if(!blocked&&tool==='Glob'){
  if(networkPath(pattern))blocked='network_path';
  else if(/^[A-Za-z]:|^[\\/~]|[%$]/.test(pattern)||pattern.split(/[\\/]/).includes('..')||/\{[^}]*(?:\.\.|[\\/:])/.test(pattern))blocked='unusual_path';
 }
 // The folder comes first: a long pattern must not push it off the key.
 const place=folder.text.length>28?'…'+folder.text.slice(-27):folder.text,shown=redact(shownPattern);
 // Redaction must not hide what a search looks for, and all of the pattern must fit.
 if(!blocked&&shown!==shownPattern)blocked='incomplete_display';
 const text=[place,shown].filter(Boolean).join(' : ');
 if(!blocked&&text.length>DISPLAY)blocked='incomplete_display';
 return{kind:'text',text,...(blocked?{blocked}:{})};
}
function summarizeUnknown(input){
 // Tools this code knows nothing about: everything in the input must be visible, or none of it counts.
 const entries=Object.entries(input);if(!entries.length)return null;
 let blocked;
 const shown=[];
 for(const[key,value]of entries){
  if(typeof value!=='string'||value.length>SCAN||key.length>SCAN){blocked??='incomplete_display';if(typeof value==='string')shown.push(`${tidy(key.slice(0,SCAN))}="${tidy(value.slice(0,SCAN))}"`);continue;}
  if(networkPath(value))blocked??='network_path';
  else if(!plain(key)||!plain(value))blocked??='unusual_characters';
  else if(value.includes('"'))blocked??='incomplete_display';
  shown.push(`${tidy(key)}="${tidy(value)}"`);
 }
 const raw=shown.join(' ');if(!raw)return null;
 const text=redact(raw);
 if(text!==raw||text.length>DISPLAY)blocked??='incomplete_display';
 return{kind:'text',text:text.length>MAX?text.slice(0,MAX)+'…':text,...(blocked?{blocked}:{})};
}
function summarizeTool(tool,input,cwd){
 if(!input||typeof input!=='object'||Array.isArray(input))return null;
 let summary;
 if(tool==='Grep'||tool==='Glob')summary=summarizeSearch(tool,input,cwd);
 else if(typeof tool==='string'&&Object.hasOwn(FIELDS,tool)){
  const[kind,field]=FIELDS[tool],value=text_(input[field]);if(!value.trim())return null;
  if(kind==='path'){const place=locate(value,cwd);summary={kind,text:place.text,...(place.blocked?{blocked:place.blocked}:{})};}
  else summary={kind,text:redact(tidy(value.slice(0,SCAN))),...(!plain(value)||value.length>SCAN?{blocked:'unusual_characters'}:{})};
 }
 else summary=summarizeUnknown(input);
 if(!summary?.text)return null;
 if(!summary.blocked&&!onlyKnownInput(tool,input))summary.blocked='incomplete_display';
 if(summary.text.length>MAX)summary.text=summary.kind==='path'?'…'+summary.text.slice(-MAX):summary.text.slice(0,MAX)+'…';
 return summary;
}
module.exports={summarizeTool,plain,MAX,DISPLAY};
