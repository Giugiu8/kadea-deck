// AppData is virtualized separately by the Codex/Claude MSIX apps. A rendezvous
// shared with native Stream Deck must live outside those per-app overlays.
const path=require('node:path'),os=require('node:os');
function runtimeDirectory(env=process.env){
  return env.CARDEA_DECK_HOME||path.join(env.USERPROFILE||os.homedir(),'.cardeadeck');
}
module.exports={runtimeDirectory};
