import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
export const USAGE='https://claude.ai/settings/usage';
export const NEEDS_INPUT='claude://code/needs-input?source=desktop_action';
export const NEW_CHAT='claude://code/new?source=desktop_action';
export function allowedUrl(url){return url===USAGE||url===NEEDS_INPUT||url===NEW_CHAT||/^claude:\/\/claude\.ai\/epitaxy\/[a-zA-Z0-9_-]{1,180}$/.test(url)||/^codex:\/\/threads\/(?:new|[a-f0-9-]{36})$/i.test(url);}
export const shellPath=(env=process.env)=>path.join(env.WINDIR||env.SystemRoot||'C:\\Windows','explorer.exe');
// Windows' own signed shell hands the URL to its registered handler, so the plugin ships
// no executable of its own. explorer.exe exits non-zero even on success: only a failure
// to start it counts. The caller reports a request, never a read receipt.
export function openUrl(url,{shell=shellPath()}={}){
  if(!allowedUrl(url))return Promise.resolve(false);
  return new Promise(resolve=>execFile(shell,[url],{windowsHide:false,timeout:10_000},error=>resolve(!error||typeof error.code==='number')));
}
const metadataCaches=new WeakMap();
export async function refreshDesktopMetadata(store,root,{io=fs}={}){
  const wanted=new Set(store.list({includeEnded:true,includeArchived:true}).filter(s=>!s.ended||s.unread||s.requestId).map(s=>s.id));if(!wanted.size)return;
  let roots=metadataCaches.get(store);if(!roots){roots=new Map();metadataCaches.set(store,roots);}let cache=roots.get(root);if(!cache){cache=new Map();roots.set(root,cache);}const present=new Set();
  let examined=0;
  async function visit(dir,depth){
    if(depth>3||examined>=6000||!wanted.size)return;
    let entries;try{entries=await io.readdir(dir,{withFileTypes:true});}catch{return;}
    for(const entry of entries){
      if(examined>=6000||!wanted.size)return;
      const p=path.join(dir,entry.name);
      if(entry.isDirectory())await visit(p,depth+1);
      else if(entry.isFile()&&entry.name.startsWith('local_')&&entry.name.endsWith('.json')){
        examined++;present.add(p);try{
          const info=await io.stat(p);if(info.size>512_000){cache.delete(p);continue;}
          let saved=cache.get(p);
          if(!saved||saved.mtime!==info.mtimeMs||saved.size!==info.size){
            let meta=null;try{const raw=JSON.parse(await io.readFile(p,'utf8'));if(typeof raw.cliSessionId==='string'&&/^[a-zA-Z0-9_-]{1,160}$/.test(raw.cliSessionId)&&typeof raw.sessionId==='string'&&/^[a-zA-Z0-9_-]{1,180}$/.test(raw.sessionId))meta={cliSessionId:raw.cliSessionId,sessionId:raw.sessionId,title:typeof raw.title==='string'?raw.title.slice(0,120):'',isArchived:raw.isArchived===true};}catch{}
            saved={mtime:info.mtimeMs,size:info.size,meta};if(cache.size>=6000)cache.delete(cache.keys().next().value);cache.set(p,saved);
          }
          const meta=saved.meta;
          if(meta&&wanted.has(meta.cliSessionId)&&/^[a-zA-Z0-9_-]{1,180}$/.test(meta.sessionId??'')){
            store.annotate(meta.cliSessionId,{desktopId:meta.sessionId,title:typeof meta.title==='string'?meta.title:'',archived:meta.isArchived===true});wanted.delete(meta.cliSessionId);
          }
        }catch{cache.delete(p);/* Only metadata fields are used; no conversations are imported. */}
      }
    }
  }
  await visit(root,0);
  for(const file of cache.keys())if(!present.has(file))cache.delete(file);
}
