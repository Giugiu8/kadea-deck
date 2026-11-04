import {randomUUID} from 'node:crypto';
import {APPROVAL_CONSENT,CODEX_CONSENT} from './integrations.mjs';
const ERRORS=['plugin_location','linked_path','incomplete_plugin','runtime_missing','custom_config','legacy_present','busy','settings_changed','invalid_settings','consent_required','locked_off','managed','acl_failed','protected_path'];
export function registerIntegrationUi({ui,manager,connectCodex,diagnostics=()=>({}),blocked=()=>null,uuid=randomUUID}){
 let token=null,context=null,busy=false,refreshTimer=null,appearances=0;
 const current=action=>action?.id===context&&ui.action?.id===context;
 const allowed=action=>!['de.cardea.deck.permission','de.cardea.deck.codex-permission','de.cardea.deck.codex-stop'].includes(action?.manifestId);
 const send=async(message='ready')=>{if(!context||ui.action?.id!==context)return;try{await ui.sendToPropertyInspector({type:'integrationStatus',nonce:token,busy,message,...manager.status(),...diagnostics(),blocked:blocked()});}catch{}};
 ui.onDidAppear(ev=>{appearances=context===ev.action.id?appearances+1:1;context=ev.action.id;token=uuid();void send();});
 ui.onDidDisappear(ev=>{if(ev.action.id!==context)return;if(--appearances<=0){context=null;token=null;appearances=0;}});
 ui.onSendToPlugin(async ev=>{
  const p=ev.payload;if(!current(ev.action)||!p||typeof p!=='object'||Array.isArray(p))return;
  if(p.cmd==='status'&&Object.keys(p).length===1){await send();return;}
  // Approvals need the extra consent field that only the ticked inspector checkbox sends.
  const consenting=p.cmd==='enableApprovals'||p.cmd==='enableCodexApprovals',expected=p.cmd==='enableCodexApprovals'?CODEX_CONSENT:APPROVAL_CONSENT;
  if(!allowed(ev.action)||busy||p.nonce!==token||Object.keys(p).length!==(consenting?3:2)||(consenting&&p.consent!==expected)||!['setupClaude','enableApprovals','disableApprovals','removeStatus','removeClaude','connectCodex','enableCodexApprovals','disableCodexApprovals'].includes(p.cmd))return;
  // Only damaged files stop everything; a folder that cannot be private still allows Codex and a retry.
  if(blocked()==='integrity_failed'&&!['removeStatus','removeClaude','disableApprovals','disableCodexApprovals'].includes(p.cmd)){await send(blocked());return;}
  busy=true;const started=token;await send('working');let result='done';
  try{
   if(token!==started||!current(ev.action))return;
   if(p.cmd==='connectCodex'){const ok=await connectCodex(()=>current(ev.action)&&token===started);result=ok?'done':'codex_missing';}
   else manager.update(p.cmd,consenting?{consent:p.consent}:{});
  }catch(error){result=ERRORS.includes(error.message)?error.message:'failed';}
  finally{busy=false;await send(token===started&&current(ev.action)?result:'ready');}
 });
 return{refresh(){if(!context||refreshTimer)return;refreshTimer=setTimeout(()=>{refreshTimer=null;void send();},250);refreshTimer.unref();}};
}
