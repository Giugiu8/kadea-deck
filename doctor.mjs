import fs from 'node:fs';import path from 'node:path';import{createRequire}from'node:module';import{fileURLToPath}from'node:url';
const home=process.env.USERPROFILE,appData=process.env.APPDATA;
const result={pluginInstalled:false,receiverHealthy:false,receiverAuthenticated:false};
try{const manifest=JSON.parse(fs.readFileSync(path.join(appData,'Elgato/StreamDeck/Plugins/de.cardea.deck.sdPlugin/manifest.json'),'utf8'));result.pluginInstalled=true;result.version=manifest.Version;}catch{}
try{
 const directory=path.dirname(fileURLToPath(import.meta.url)),require=createRequire(import.meta.url);
 const source=path.join(directory,'hooks/receiver-client.cjs'),packaged=path.join(directory,'de.cardea.deck.sdPlugin/hooks/receiver-client.cjs');
 const {requestReceiver}=require(fs.existsSync(source)?source:packaged);
 const c=JSON.parse(fs.readFileSync(path.join(home,'.cardeadeck/connection.json'),'utf8'));
 const response=await requestReceiver(c,{route:'/status',method:'GET'});if(response?.status!==200)throw Error('offline');
 const s=JSON.parse(response.body);Object.assign(result,{receiverAuthenticated:true,receiverHealthy:s.schema===1&&s.persistenceOk===true,claudeHasEvents:s.sourceHasEvents,codexConnected:s.codex?.connected,codexKnown:s.codex?.known,codexLive:s.codex?.live});
}catch{}
console.log(JSON.stringify(result,null,2));
