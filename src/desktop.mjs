import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
export const USAGE='https://claude.ai/settings/usage';
export const NEEDS_INPUT='claude://code/needs-input?source=desktop_action';
export const NEW_CHAT='claude://code/new?source=desktop_action';
export function allowedUrl(url){return url===USAGE||url===NEEDS_INPUT||url===NEW_CHAT||/^claude:\/\/claude\.ai\/epitaxy\/[a-zA-Z0-9_-]{1,180}$/.test(url)||/^codex:\/\/threads\/(?:new|[a-f0-9-]{36})$/i.test(url);}
export function openUrl(helper,url){
  if(!allowedUrl(url))return Promise.resolve(false);
  return new Promise(resolve=>execFile(helper,[url],{windowsHide:false,timeout:10_000},error=>resolve(!error)));
  // The caller reports a request, never treats ShellExecute success as a read receipt.
}
export async function refreshDesktopMetadata(store,root){
  const wanted=new Set(store.list({includeEnded:true,includeArchived:true}).map(s=>s.id));if(!wanted.size)return;
  let examined=0;
  async function visit(dir,depth){
    if(depth>3||examined>=6000||!wanted.size)return;
    let entries;try{entries=await fs.readdir(dir,{withFileTypes:true});}catch{return;}
    for(const entry of entries){
      if(examined>=6000||!wanted.size)return;
      const p=path.join(dir,entry.name);
      if(entry.isDirectory())await visit(p,depth+1);
      else if(entry.isFile()&&entry.name.startsWith('local_')&&entry.name.endsWith('.json')){
        examined++;try{
          const info=await fs.stat(p);if(info.size>512_000)continue;
          const meta=JSON.parse(await fs.readFile(p,'utf8'));
          if(wanted.has(meta.cliSessionId)&&/^[a-zA-Z0-9_-]{1,180}$/.test(meta.sessionId??'')){
            store.annotate(meta.cliSessionId,{desktopId:meta.sessionId,title:typeof meta.title==='string'?meta.title:'',archived:meta.isArchived===true});wanted.delete(meta.cliSessionId);
          }
        }catch{/* Only metadata fields are used; no conversations are imported. */}
      }
    }
  }
  await visit(root,0);
}
