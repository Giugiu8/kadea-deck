// The shipped hook finds its folder only through the user profile. Fixtures keep their files elsewhere,
// so each gets a temporary profile whose .cardeadeck links to the fixture.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const homes=new Map();
export function hookHome(runtime){
 const target=path.resolve(runtime);
 if(!homes.has(target)){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-hook-home-'));
  fs.symlinkSync(target,path.join(home,'.cardeadeck'),'junction');
  homes.set(target,home);
 }
 return homes.get(target);
}
process.on('exit',()=>{for(const home of homes.values())try{fs.rmSync(home,{recursive:true,force:true});}catch{}});
