import {randomUUID} from 'node:crypto';
export function registerIntegrationUi({ui,manager,connectCodex,diagnostics=()=>({}),uuid=randomUUID}){
 let token=null,context=null,busy=false,refreshTimer=null,appearances=0;
 const current=action=>action?.id===context&&ui.action?.id===context;
 const allowed=action=>!['de.cardea.deck.permission','de.cardea.deck.codex-permission','de.cardea.deck.codex-stop'].includes(action?.manifestId);
 const send=async(message='ready')=>{if(!context||ui.action?.id!==context)return;try{await ui.sendToPropertyInspector({type:'integrationStatus',nonce:token,busy,message,...manager.status(),...diagnostics()});}catch{}};
 ui.onDidAppear(ev=>{appearances=context===ev.action.id?appearances+1:1;context=ev.action.id;token=uuid();void send();});
 ui.onDidDisappear(ev=>{if(ev.action.id!==context)return;if(--appearances<=0){context=null;token=null;appearances=0;}});
 ui.onSendToPlugin(async ev=>{
  const p=ev.payload;if(!current(ev.action)||!p||typeof p!=='object'||Array.isArray(p))return;
  if(p.cmd==='status'&&Object.keys(p).length===1){await send();return;}
  if(!allowed(ev.action)||busy||p.nonce!==token||Object.keys(p).length!==2||!['setupClaude','removeClaude','connectCodex'].includes(p.cmd))return;
  busy=true;const started=token;await send('working');let result='done';
  try{
   if(token!==started||!current(ev.action))return;
   if(p.cmd==='connectCodex'){const ok=await connectCodex(()=>current(ev.action)&&token===started);result=ok?'done':'codex_missing';}
   else manager.update(p.cmd);
  }catch(error){result=['plugin_location','linked_path','incomplete_plugin','runtime_missing','custom_config','legacy_present','busy','settings_changed','invalid_settings'].includes(error.message)?error.message:'failed';}
  finally{busy=false;await send(token===started&&current(ev.action)?result:'ready');}
 });
 return{refresh(){if(!context||refreshTimer)return;refreshTimer=setTimeout(()=>{refreshTimer=null;void send();},250);refreshTimer.unref();}};
}
