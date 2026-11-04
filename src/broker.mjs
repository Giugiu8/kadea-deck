import { randomUUID } from 'node:crypto';
export class PermissionBroker {
  constructor(store,{timeoutMs=55_000,clock=Date.now,log=null}={}){
    this.log=log;this.store=store;this.timeoutMs=timeoutMs;this.clock=clock;this.pending=new Map();
    this.onChange=()=>{for(const [id,p]of this.pending){const s=store.get(p.sessionId);if(!s||s.ended||s.turn!==p.turn||s.requestId!==id)this.finish(id,null,'cancelled');}};
    store.on('change',this.onChange);
  }
  hold(sessionId,response,send=answer=>response.end(JSON.stringify(answer)),{tool,summary=null}={}){
    const s=this.store.get(sessionId);if(!s||s.state==='ended'){this.log?.record({sessionId,tool,decision:'cancelled',reason:'session_ended'});send({});return null;}
    // A newer request retires the old held transport, never answers it implicitly.
    for(const [id,p]of this.pending)if(p.sessionId===sessionId)this.finish(id,null,'cancelled');
    const id=randomUUID(),p={id,sessionId,turn:s.turn,tool:s.tool,logTool:tool??s.tool,summary,response,send,expires:this.clock()+this.timeoutMs};
    this.pending.set(id,p);this.store.beginPermission(sessionId,id,p.tool);
    p.timer=setTimeout(()=>this.finish(id,null,'timeout'),this.timeoutMs);p.timer.unref();
    response.once('close',()=>this.finish(id,null,'cancelled'));return id;
  }
  answer({sessionId,requestId},decision){
    if(!['allow','deny'].includes(decision))return false;
    const p=this.pending.get(requestId),s=this.store.get(sessionId);
    if(!p||p.sessionId!==sessionId||!s||s.turn!==p.turn||s.requestId!==requestId||p.expires<=this.clock()||p.response.destroyed||p.response.writableEnded)return false;
    this.finish(requestId,decision);return true;
  }
  summary(requestId){return this.pending.get(requestId)?.summary??null;}
  finish(id,decision,outcome='cancelled'){
    const p=this.pending.get(id);if(!p)return;this.pending.delete(id);clearTimeout(p.timer);
    this.log?.record({sessionId:p.sessionId,tool:p.logTool,decision:decision??outcome});
    const current=this.store.get(p.sessionId);
    const valid=current&&current.turn===p.turn&&current.requestId===id&&current.state!=='ended';
    const answer=valid&&decision?{hookSpecificOutput:{hookEventName:'PermissionRequest',decision:{behavior:decision,...(decision==='deny'?{message:'In Cardea Deck abgelehnt.'}:{})}}}:{};
    if(valid)this.store.finishPermission(p.sessionId,id,decision);
    if(!p.response.destroyed&&!p.response.writableEnded)p.send(answer);
  }
  close(){this.store.off('change',this.onChange);for(const id of [...this.pending.keys()])this.finish(id,null,'cancelled');}
}
