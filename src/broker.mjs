import { randomUUID } from 'node:crypto';
export class PermissionBroker {
  constructor(store,{timeoutMs=55_000,clock=Date.now}={}){
    this.store=store;this.timeoutMs=timeoutMs;this.clock=clock;this.pending=new Map();
    this.onChange=()=>{for(const [id,p]of this.pending){const s=store.get(p.sessionId);if(!s||s.ended||s.turn!==p.turn||s.requestId!==id)this.finish(id,null);}};
    store.on('change',this.onChange);
  }
  hold(sessionId,response){
    const s=this.store.get(sessionId);if(!s||s.state==='ended'){response.end('{}');return null;}
    // A newer request retires the old held transport, never answers it implicitly.
    for(const [id,p]of this.pending)if(p.sessionId===sessionId)this.finish(id,null);
    const id=randomUUID(),p={id,sessionId,turn:s.turn,tool:s.tool,response,expires:this.clock()+this.timeoutMs};
    this.pending.set(id,p);this.store.beginPermission(sessionId,id,p.tool);
    p.timer=setTimeout(()=>this.finish(id,null),this.timeoutMs);p.timer.unref();
    response.once('close',()=>this.finish(id,null));return id;
  }
  answer({sessionId,requestId},decision){
    if(!['allow','deny'].includes(decision))return false;
    const p=this.pending.get(requestId),s=this.store.get(sessionId);
    if(!p||p.sessionId!==sessionId||!s||s.turn!==p.turn||s.requestId!==requestId||p.expires<=this.clock()||p.response.destroyed||p.response.writableEnded)return false;
    this.finish(requestId,decision);return true;
  }
  finish(id,decision){
    const p=this.pending.get(id);if(!p)return;this.pending.delete(id);clearTimeout(p.timer);
    const current=this.store.get(p.sessionId);
    const valid=current&&current.turn===p.turn&&current.requestId===id&&current.state!=='ended';
    const answer=valid&&decision?{hookSpecificOutput:{hookEventName:'PermissionRequest',decision:{behavior:decision,...(decision==='deny'?{message:'In Kadea Deck abgelehnt.'}:{})}}}:{};
    if(valid)this.store.finishPermission(p.sessionId,id,decision);
    if(!p.response.destroyed&&!p.response.writableEnded)p.response.end(JSON.stringify(answer));
  }
  close(){this.store.off('change',this.onChange);for(const id of [...this.pending.keys()])this.finish(id,null);}
}
