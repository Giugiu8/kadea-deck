import fs from 'node:fs';import path from 'node:path';import {execFile} from 'node:child_process';
export function selectCodexPackage(packages,{exists=fs.existsSync,realpath=fs.realpathSync.native}={}){
 const trusted=(Array.isArray(packages)?packages:[packages]).filter(p=>p?.Name==='OpenAI.Codex'&&p.PackageFamilyName==='OpenAI.Codex_2p2nqsd0c76g0'&&p.SignatureKind==='Store'&&p.IsDevelopmentMode===false&&typeof p.InstallLocation==='string'&&path.isAbsolute(p.InstallLocation));
 trusted.sort((a,b)=>String(b.Version).localeCompare(String(a.Version),undefined,{numeric:true}));
 for(const item of trusted){
  const executable=path.join(item.InstallLocation,'app/resources/codex.exe');if(!exists(executable))continue;
  try{const root=realpath(item.InstallLocation),file=realpath(executable),relative=path.relative(root,file);if(relative.toLowerCase()!==path.join('app','resources','codex.exe').toLowerCase())continue;return file;}catch{}
 }
 return null;
}
export async function discoverCodex(execute=execFile){
 const script="@(Get-AppxPackage -Name OpenAI.Codex | Where-Object { $_.PackageFamilyName -eq 'OpenAI.Codex_2p2nqsd0c76g0' -and $_.SignatureKind.ToString() -eq 'Store' -and -not $_.IsDevelopmentMode } | ForEach-Object { [pscustomobject]@{Name=$_.Name;PackageFamilyName=$_.PackageFamilyName;SignatureKind=$_.SignatureKind.ToString();IsDevelopmentMode=$_.IsDevelopmentMode;InstallLocation=$_.InstallLocation;Version=$_.Version.ToString()} }) | ConvertTo-Json -Compress";
 try{
  const output=await new Promise((resolve,reject)=>execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:10_000,maxBuffer:64*1024,encoding:'utf8'},(error,stdout)=>error?reject(error):resolve(stdout)));
  return selectCodexPackage(JSON.parse(output||'[]'));
 }catch{return null;}
}
