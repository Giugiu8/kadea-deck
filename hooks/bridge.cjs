// Best effort with bounded identity/transport deadlines; failures emit no decision.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const event=process.argv[2],at=Date.now(),eventId=crypto.randomUUID();
let chunks=[],size=0;
process.stdin.on('data',b=>{size+=b.length;if(size<=2_000_000)chunks.push(b);});
process.stdin.on('error',()=>process.exit(0));
process.stdin.on('end',async()=>{
  try{
    // A partial installation must produce no decision and no stacktrace.
    const {runtimeDirectory}=require('./runtime.cjs');
    const {requestReceiver}=require('./receiver-client.cjs');
    const {summarizeTool}=require('./tool-summary.cjs');
    const {hookMayAllow}=require('./approval-rules.cjs');
    if(size>2_000_000)process.exit(0);
    const raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const directory=runtimeDirectory();
    const c=JSON.parse(fs.readFileSync(path.join(directory,'connection.json'),'utf8'));
    const permission=event==='PermissionRequest',quota=event==='Quota',summary=permission?summarizeTool(raw.tool_name,raw.tool_input,raw.cwd):null;
    // No prompt, transcript, tool output, credential or conversation history is retained/sent. Only a
    // pending approval carries a short redacted summary, which the receiver keeps in memory for its key.
    const data=quota?raw.rate_limits:{event,at,eventId,sessionId:raw.session_id,cwd:raw.cwd,tool:raw.tool_name,toolUseId:raw.tool_use_id,notificationType:raw.notification_type,source:raw.source,...(permission?{summary}:{})};
    const body=JSON.stringify(data??{});
    const response=await requestReceiver(c,{route:quota?'/quota':permission?'/permission':'/event',body,permission});
    if(permission&&response?.status===200){const d=JSON.parse(response.body);const behavior=d.hookSpecificOutput?.decision?.behavior;if(d.hookSpecificOutput?.hookEventName==='PermissionRequest'&&(behavior==='deny'||(behavior==='allow'&&hookMayAllow(raw.tool_name,summary))))process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PermissionRequest',decision:behavior==='deny'?{behavior,message:'Declined on Stream Deck.'}:{behavior}}}));}
  }catch{process.exit(0);}
  process.exit(0);
});
