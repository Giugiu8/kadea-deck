// Deliberately fail-soft: normal events cannot delay Claude; permission timeout returns no decision.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {runtimeDirectory}=require('./runtime.cjs');
const event=process.argv[2],at=Date.now(),eventId=crypto.randomUUID();
let chunks=[],size=0;
process.stdin.on('data',b=>{size+=b.length;if(size<=2_000_000)chunks.push(b);});
process.stdin.on('error',()=>process.exit(0));
process.stdin.on('end',()=>{
  try{
    if(size>2_000_000)process.exit(0);
    const raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const directory=runtimeDirectory();
    const c=JSON.parse(fs.readFileSync(path.join(directory,'connection.json'),'utf8'));
    if(c.schema!==1||!Number.isInteger(c.port)||c.port<1||c.port>65535||!/^[a-f0-9]{64}$/.test(c.token))process.exit(0);
    const permission=event==='PermissionRequest',quota=event==='Quota';
    // No prompt, transcript, tool input, output, credential or conversation history is retained/sent.
    const data=quota?raw.rate_limits:{event,at,eventId,sessionId:raw.session_id,cwd:raw.cwd,tool:raw.tool_name,toolUseId:raw.tool_use_id,notificationType:raw.notification_type,source:raw.source};
    const body=JSON.stringify(data??{});
    const req=http.request({host:'127.0.0.1',port:c.port,path:quota?'/quota':permission?'/permission':'/event',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'X-Kadea-Token':c.token}},res=>{
      let result='',bytes=0;res.on('data',b=>{bytes+=b.length;if(bytes<=8192)result+=b;});
      res.on('end',()=>{if(permission&&res.statusCode===200&&bytes<=8192){try{const d=JSON.parse(result);if(d.hookSpecificOutput?.hookEventName==='PermissionRequest'&&['allow','deny'].includes(d.hookSpecificOutput?.decision?.behavior))process.stdout.write(JSON.stringify(d));}catch{}}process.exit(0);});
    });
    req.setTimeout(permission?58_000:900,()=>{req.destroy();process.exit(0);});req.on('error',()=>process.exit(0));req.end(body);
  }catch{process.exit(0);}
});
