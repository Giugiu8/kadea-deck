let socket,context,actionId,nonce,settings={},busy=false;const $=id=>document.getElementById(id);
const messages={ready:'',working:'Setting up…',done:'Settings saved.',codex_missing:'Codex Store app was not found. Install it and try again.',plugin_location:'Use a normal installed plugin for setup. Development links need manual configuration.',linked_path:'Linked settings paths require manual configuration.',incomplete_plugin:'Plugin files are missing. Reinstall the plugin.',runtime_missing:'Stream Deck runtime is missing. Restart Stream Deck.',custom_config:'A custom Claude config directory needs manual setup.',legacy_present:'An older Cardea installation is present. Remove its hooks with the old uninstaller before setup.',busy:'Another setup is running. Try again shortly.',settings_changed:'Claude settings changed during setup. Nothing was overwritten; try again.',invalid_settings:'Claude settings could not be read. Check the settings file before setup.',failed:'Setup could not finish. Your existing settings were preserved.'};
function send(cmd){if(!socket||socket.readyState!==1||busy)return;socket.send(JSON.stringify({event:'sendToPlugin',action:actionId,context,payload:cmd==='status'?{cmd}:{cmd,nonce}}));}
window.connectElgatoStreamDeckSocket=(port,uuid,event,info,actionInfo)=>{
 if(!/^\d+$/.test(String(port))||Number(port)<1||Number(port)>65535)return;
 const action=JSON.parse(actionInfo);context=action.context;actionId=action.action;settings=action.payload?.settings??{};
 const kind=actionId.split('.').at(-1);$('slot-field').hidden=!['session','codex-session'].includes(kind);$('decision-field').hidden=!kind.includes('permission');$('window-field').hidden=kind!=='quota';$('setup-buttons').hidden=['permission','codex-permission','codex-stop'].includes(kind);
 $('slot').value=(Number(settings.slot)||0)+1;$('decision').value=settings.decision==='deny'?'deny':'allow';$('window').value=settings.window==='five_hour'?'five_hour':'seven_day';
 socket=new WebSocket('ws://127.0.0.1:'+port);socket.onopen=()=>{socket.send(JSON.stringify({event,uuid}));send('status');};
 socket.onclose=()=>{for(const id of['setupClaude','connectCodex','removeClaude'])$(id).disabled=true;$('status').textContent='Stream Deck disconnected. Select this key again.';};
 socket.onmessage=e=>{
  let m;try{m=JSON.parse(e.data);}catch{return;}
  if(m.event==='didReceiveSettings'){settings=m.payload.settings??settings;return;}
  const p=m.payload;if(m.event!=='sendToPropertyInspector'||m.context!==context||p?.type!=='integrationStatus')return;
  nonce=p.nonce;busy=p.busy===true;
  const claude=p.claude==='installed'?(p.sourceHasEvents?'Claude: hooks installed; source active.':'Claude: hooks installed. Start a new chat.'):p.claude==='not_set_up'?'Claude: not set up.':p.claude==='repair_needed'?'Claude: setup needs repair.':messages[p.claude]||'Claude: unavailable.';
  $('status').textContent=[messages[p.message]||'',claude,p.codexConnected?'Codex: connected.':p.codexConfigured?'Codex: configured; source not connected.':'Codex: not connected.',p.customStatusLine?'Custom status line preserved; Claude quota may be unavailable.':''].filter(Boolean).join(' ');
  for(const id of['setupClaude','connectCodex','removeClaude'])$(id).disabled=busy||typeof nonce!=='string';
 };
};
for(const id of['setupClaude','connectCodex','removeClaude'])$(id).onclick=()=>send(id);
for(const id of['slot','decision','window'])$(id).onchange=()=>{if(!socket||socket.readyState!==1)return;settings={...settings,[id]:id==='slot'?Math.max(0,Math.min(5,Number($(id).value)-1)):$(id).value};socket.send(JSON.stringify({event:'setSettings',context,payload:settings}));};
