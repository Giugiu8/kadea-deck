import fs from 'node:fs';import path from 'node:path';
const home=process.env.USERPROFILE,appData=process.env.APPDATA;
const result={pluginInstalled:false,receiverHealthy:false};
try{const manifest=JSON.parse(fs.readFileSync(path.join(appData,'Elgato/StreamDeck/Plugins/de.cardea.kadeadeck.sdPlugin/manifest.json'),'utf8'));result.pluginInstalled=true;result.version=manifest.Version;}catch{}
try{const c=JSON.parse(fs.readFileSync(path.join(home,'.kadeadeck/connection.json'),'utf8'));if(c.schema!==1||!Number.isInteger(c.port)||c.port<1||c.port>65535||!/^[a-f0-9]{64}$/.test(c.token))throw Error('invalid');const r=await fetch('http://127.0.0.1:'+c.port+'/status',{headers:{'X-Kadea-Token':c.token},signal:AbortSignal.timeout(3000)});if(!r.ok)throw Error('offline');const s=await r.json();Object.assign(result,{receiverHealthy:s.schema===1&&s.persistenceOk===true,claudeHasEvents:s.sourceHasEvents,codexConnected:s.codex?.connected,codexKnown:s.codex?.known,codexLive:s.codex?.live});}catch{}
console.log(JSON.stringify(result,null,2));
