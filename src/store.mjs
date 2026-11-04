import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
export const EVENTS = new Set(['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','PostToolUseFailure','PermissionRequest','Notification','Stop','StopFailure','SessionEnd','SubagentStart','SubagentStop']);
export const clean = (value,max=180) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g,'').slice(0,max).toWellFormed() : '';
const sidPattern = /^[a-zA-Z0-9_-]{1,160}$/;
const project = cwd => clean(cwd.split(/[\\/]/).filter(Boolean).at(-1) || 'Claude',32);
export class DeckStore extends EventEmitter {
  constructor({file,clock=Date.now,staleMs=15*60_000}={}) {
    super();this.file=file;this.clock=clock;this.staleMs=staleMs;this.sessions=new Map();this.selected=null;this.connected=false;this.quota=null;this.seenEvents=new Map();
    if(file)try {
      const stat=fs.statSync(file);if(stat.size>2_000_000)throw Error('state too large');
      const saved=JSON.parse(fs.readFileSync(file,'utf8'));
      if(saved.schema===1)for(const s of saved.sessions??[])if(sidPattern.test(s.id)&&Number.isFinite(s.at)) {
        this.sessions.set(s.id,{id:s.id,cwd:clean(s.cwd,500),project:clean(s.project,32),title:clean(s.title,120),desktopId:clean(s.desktopId,160),archived:s.archived===true,firstSeenAt:Number.isFinite(s.firstSeenAt)?s.firstSeenAt:s.at,state:['ended','unread','idle'].includes(s.state)?s.state:'unknown',at:s.at,observedAt:s.observedAt??s.at,turn:Number(s.turn)||0,unread:!!s.unread,ended:!!s.ended||s.state==='ended',turnClosed:false,recoveredClosed:!!s.turnClosed,requestId:null,pendingTool:'',tool:'',subagents:0});
      }
      if(this.sessions.has(saved.selected))this.selected=saved.selected;
    }catch{/* Missing/corrupt state is unknown, never a fabricated connected state. */}
  }
  changed() {
    let saved=true;
    try{if(this.file){fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});const tmp=`${this.file}.${process.pid}.tmp`;fs.writeFileSync(tmp,JSON.stringify({schema:1,selected:this.selected,sessions:[...this.sessions.values()]}),{mode:0o600});fs.renameSync(tmp,this.file);}this.persistenceError=null;}
    catch(error){saved=false;this.persistenceError=error.code||'WRITE_FAILED';}
    this.emit('change');return saved;
  }
  event(input) {
    const now=this.clock();
    if(!input||!sidPattern.test(input.sessionId??'')||!EVENTS.has(input.event)||!Number.isFinite(input.at)||input.at>now+60_000||input.at<now-24*3600_000)return false;
    const eventId=clean(input.eventId,100);if(!eventId||this.seenEvents.has(eventId))return false;
    this.seenEvents.set(eventId,now);if(this.seenEvents.size>6000)this.seenEvents.delete(this.seenEvents.keys().next().value);
    const previous=this.sessions.get(input.sessionId);
    if(previous&&(input.at<previous.at||((previous.ended||previous.state==='ended')&&(input.event!=='SessionStart'||input.source!=='resume'))))return false;
    const toolId=clean(input.toolUseId,160);
    const continuation=previous?.turnClosed&&input.event==='PreToolUse'&&toolId&&toolId!==previous.lastToolId;
    if(previous?.turnClosed&&!continuation&&['PreToolUse','PostToolUse','PostToolUseFailure','PermissionRequest'].includes(input.event))return false;
    const cwd=clean(input.cwd,500);
    const s=previous??{id:input.sessionId,project:project(cwd),cwd,title:'',desktopId:'',archived:false,firstSeenAt:now,state:'idle',turn:0,unread:false,ended:false,turnClosed:false,requestId:null,pendingTool:'',subagents:0};
    if(continuation||(s.recoveredClosed&&['PreToolUse','PostToolUse','PermissionRequest'].includes(input.event))){s.turn++;s.turnClosed=false;s.recoveredClosed=false;s.unread=false;}
    const passiveIdle=input.event==='Notification'&&input.notificationType==='idle_prompt';
    if(!passiveIdle||!previous){s.at=input.at;s.observedAt=now;}
    s.tool=clean(input.tool,40);if(toolId)s.lastToolId=toolId;if(cwd){s.cwd=cwd;s.project=project(cwd);}
    switch(input.event){
      case 'SessionStart':if(input.source==='compact'&&previous&&!s.ended)break;s.state=s.unread?'unread':'idle';s.ended=false;s.requestId=null;s.subagents=0;break;
      case 'UserPromptSubmit':s.turn++;s.turnClosed=false;s.recoveredClosed=false;s.unread=false;s.requestId=null;s.state='working';break;
      case 'PermissionRequest':s.state='attention';break;
      case 'Notification':if(['permission_prompt','elicitation_dialog','elicitation_url_dialog'].includes(input.notificationType))s.state='attention';break;
      case 'PreToolUse':case 'PostToolUse':if(!s.requestId)s.state='working';break;
      case 'PostToolUseFailure':case 'StopFailure':s.state='error';s.requestId=null;break;
      case 'Stop':s.state='unread';s.turnClosed=true;s.unread=true;s.requestId=null;break;
      case 'SessionEnd':s.ended=true;s.state=s.unread?'unread':'ended';s.requestId=null;break;
      case 'SubagentStart':s.subagents++;break;
      case 'SubagentStop':s.subagents=Math.max(0,s.subagents-1);break;
    }
    this.sessions.set(s.id,s);this.connected=true;
    if(!this.selected)this.selected=s.id;
    // Ended tombstones outlive ordinary event admission, without deleting concurrent writers.
    for(const [id,v]of this.sessions)if(v.state==='ended'&&now-v.at>48*3600_000)this.sessions.delete(id);
    this.changed();return true;
  }
  annotate(id,meta) {
    const s=this.sessions.get(id);if(!s)return;
    const title=clean(meta.title,120),desktopId=clean(meta.desktopId,160),archived=typeof meta.archived==='boolean'?meta.archived:s.archived;
    if(title===s.title&&desktopId===s.desktopId&&archived===s.archived)return;
    s.title=title;s.desktopId=desktopId;s.archived=archived;if(archived&&!s.requestId&&this.selected===id)this.selected=null;this.changed();
  }
  select(id){if(!this.sessions.has(id))return false;this.selected=id;this.changed();return true;}
  acknowledge(id,turn){const s=this.sessions.get(id);if(!s||s.turn!==turn||!s.unread)return false;const previous=s.state;s.unread=false;if(s.state==='unread')s.state=s.ended?'ended':'idle';if(!this.changed()){s.unread=true;s.state=previous;this.emit('change');return false;}return true;}
  isStale(s){return ['working','attention'].includes(s.state)&&this.clock()-(s.observedAt??s.at)>this.staleMs;}
  state(s){return s.state==='working'&&this.isStale(s)?'unknown':s.state;}
  list({includeEnded=false,includeArchived=false}={}) {
    const rank={attention:0,error:1,unread:2,working:3,idle:4,unknown:5,ended:6};
    return [...this.sessions.values()].filter(s=>(includeEnded||s.state!=='ended')&&(includeArchived||!s.archived||s.requestId)).map(s=>({...s,state:this.state(s),stale:this.isStale(s)})).sort((a,b)=>(rank[a.state]??5)-(rank[b.state]??5)||a.firstSeenAt-b.firstSeenAt||a.id.localeCompare(b.id));
  }
  get(id=this.selected){const s=this.sessions.get(id);return s?{...s,state:this.state(s),stale:this.isStale(s)}:null;}
  beginPermission(id,requestId,tool){const s=this.sessions.get(id);if(!s||s.state==='ended')return false;s.requestId=requestId;s.pendingTool=clean(tool??s.tool,40);s.state='attention';this.changed();return true;}
  finishPermission(id,requestId,decision){const s=this.sessions.get(id);if(!s||s.requestId!==requestId)return false;s.requestId=null;s.pendingTool='';s.state=['allow','deny'].includes(decision)?'working':'attention';s.observedAt=this.clock();if(s.archived&&this.selected===id)this.selected=null;this.changed();return true;}
  setQuota(input){
    const now=this.clock(),limits={};
    for(const name of ['five_hour','seven_day']){const q=input?.[name];if(q&&Number.isFinite(q.used_percentage)&&q.used_percentage>=0&&q.used_percentage<=100&&Number.isFinite(q.resets_at))limits[name]={used:q.used_percentage,resetAt:q.resets_at*1000};}
    if(!Object.keys(limits).length)return false;this.quota={observedAt:now,limits};this.emit('change');return true;
  }
  quotaView(name='seven_day'){const q=this.quota?.limits[name];return q?{...q,remainingMs:Math.max(0,q.resetAt-this.clock()),stale:this.clock()-this.quota.observedAt>10*60_000}:null;}
}
