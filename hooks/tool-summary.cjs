// Reduces a PermissionRequest's tool input to one short display line for the key.
// It is held in memory only: never written to state, logs or backups.
const MAX=240;
// Control and direction-override characters could disguise what a key displays.
const INVISIBLE=/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]+/g;
const SECRETS=[
 [/((?:^|[\s"'])--?(?:password|passwd|pwd|token|secret|api[-_]?key|auth)(?:=|\s+))("[^"]*"|'[^']*'|\S+)/gi,'$1***'],
 [/(\b[A-Za-z0-9_]*(?:token|secret|password|passwd|api[-_]?key)[A-Za-z0-9_]*=)("[^"]*"|'[^']*'|[^\s&]+)/gi,'$1***'],
 [/(\bbearer\s+)\S+/gi,'$1***'],
 [/(\/\/[^\s/:@]+:)[^\s/@]+@/g,'$1***@'],
];
const clean=value=>typeof value==='string'?value.replace(INVISIBLE,' ').replace(/\s+/g,' ').trim():'';
const redact=text=>SECRETS.reduce((value,[pattern,replacement])=>value.replace(pattern,replacement),text);
// Which input field describes the action. Paths keep their end, text its start.
const FIELDS={
 Bash:['text','command'],PowerShell:['text','command'],
 Read:['path','file_path'],Write:['path','file_path'],Edit:['path','file_path'],MultiEdit:['path','file_path'],
 NotebookRead:['path','notebook_path'],NotebookEdit:['path','notebook_path'],LS:['path','path'],
 WebFetch:['text','url'],WebSearch:['text','query'],Task:['text','description'],Agent:['text','description'],
};
function summarizeTool(tool,input){
 if(!input||typeof input!=='object'||Array.isArray(input))return null;
 let kind='text',text='';
 if(tool==='Grep'||tool==='Glob')text=[clean(input.pattern),clean(input.path)].filter(Boolean).join(' in ');
 else if(typeof tool==='string'&&Object.hasOwn(FIELDS,tool)){const[fieldKind,field]=FIELDS[tool];kind=fieldKind;text=clean(input[field]);}
 else text=Object.entries(input).filter(([,value])=>typeof value==='string'&&clean(value)).slice(0,3).map(([key,value])=>`${clean(key)}=${clean(value)}`).join(' ');
 text=redact(text);
 if(!text)return null;
 if(text.length>MAX)text=kind==='path'?'…'+text.slice(-MAX):text.slice(0,MAX)+'…';
 return{kind,text};
}
module.exports={summarizeTool,MAX};
