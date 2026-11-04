// Only these public build outputs may enter a plugin archive. Runtime logs and
// local connection/settings/state files must never be copied from dist.
export const pluginFiles=['manifest.json','package.json','bin/plugin.mjs','bin/open.exe','hooks/bridge.cjs','hooks/runtime.cjs','hooks/statusline.cjs','hooks/permission-auth.cjs','hooks/receiver-client.cjs','pi/index.html','pi/index.js','pi/style.css','profiles/Cardea Deck.streamDeckProfile','imgs/key.png','imgs/key@2x.png','imgs/plugin.png','imgs/plugin@2x.png'];
