// Only these public build outputs may enter a plugin archive. Runtime logs and
// local connection/settings/state files must never be copied from dist.
export const pluginFiles=['manifest.json','package.json','bin/plugin.mjs','hooks/approval-rules.cjs','hooks/bridge.cjs','hooks/runtime.cjs','hooks/statusline.cjs','hooks/permission-auth.cjs','hooks/receiver-client.cjs','hooks/tool-summary.cjs','pi/index.html','pi/index.js','pi/style.css','profiles/Cardea Deck.streamDeckProfile','imgs/key.png','imgs/key@2x.png','imgs/plugin.png','imgs/plugin@2x.png','integrity.json'];
export const integrityFile='integrity.json';
// What a rebuild must reproduce byte for byte, and what the running plugin checks. Images and the zipped
// profile are data whose bytes depend on the local ImageMagick and zip timestamps; reproduce.mjs compares
// the profile's key assignments instead.
export const reproducibleFiles=pluginFiles.filter(name=>/^(?:bin|hooks|pi)\/|^(?:manifest|package|integrity)\.json$/.test(name));
export const checkedFiles=reproducibleFiles.filter(name=>name!==integrityFile);
