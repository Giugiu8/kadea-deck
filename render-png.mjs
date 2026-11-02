// ImageMagick's Windows SVG reader drops embedded PNGs. Use the same logo bytes
// and geometry as the live SVG, with a temporary folder per render.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {cardSvg,brandBox} from './src/cards.mjs';
import {brandImages} from './assets/brands.mjs';
export function renderCardPng(card,destination){
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'cardea-render-'));
 const run=args=>execFileSync('magick',args,{windowsHide:true});
 try{
  const svg=path.join(scratch,'card.svg');
  fs.writeFileSync(svg,cardSvg({...card,omitBrandImage:true}));run([svg,destination]);
  if(brandImages[card.brand]){
   const {x,y,size}=brandBox(card),original=path.join(scratch,'original.png'),sized=path.join(scratch,'sized.png');
   fs.writeFileSync(original,Buffer.from(brandImages[card.brand].split(',')[1],'base64'));
   run([original,'-resize',`${size}x${size}`,'-background','none','-gravity','center','-extent',`${size}x${size}`,sized]);
   run([destination,sized,'-geometry',`+${x}+${y}`,'-compose','Over','-composite',destination]);
  }
 }finally{
  // mkdtemp returned this literal absolute path, wholly inside the temp folder.
  if(path.dirname(scratch)!==os.tmpdir()||!path.basename(scratch).startsWith('cardea-render-'))throw Error('Unexpected render scratch path');
  fs.rmSync(scratch,{recursive:true,force:true});
 }
}
