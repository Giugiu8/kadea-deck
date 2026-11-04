// Original Cardea Deck graphics. Shared by the design preview and the plugin renderer.
import {statusStyles} from './status-style.mjs';
import {brandImages} from '../assets/brands.mjs';
import {iconSvg as icon} from './icons.mjs';
export const palette = Object.freeze({
  bg: '#0b1018', card: '#121b29', line: '#2b3a50', white: '#f4f7ff', muted: '#a6b2c6',
  working: statusStyles.working.color, attention: statusStyles.attention.color, unread: statusStyles.unread.color, error: statusStyles.error.color,
  idle: statusStyles.idle.color, unknown: statusStyles.unknown.color, claude: '#e7a27e', codex: '#72d9c3',
});
export const xml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

const text = (x,y,value,size=12,fill=palette.white,weight=500,more='') => `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" ${more}>${xml(value)}</text>`;
// Shared with the offline PNG exporter: no second set of logo coordinates.
export function brandBox(card){return card.kind==='nav'?{x:44,y:28,size:56}:{x:36,y:24,size:72};}
function brandSvg(card){
  const image=brandImages[card.brand];if(!image||card.omitBrandImage)return '';
  const {x,y,size}=brandBox(card);return `<image href="${image}" x="${x}" y="${y}" width="${size}" height="${size}"/>`;
}
// Paths keep their end (the file name), commands their start. Cutting is always visible.
export function detailLines(summary,{perLine=20,rows=3}={}){
  const text=String(summary?.text??'');if(!text)return[];const room=perLine*rows;
  const fitted=text.length<=room?text:summary.kind==='path'?'…'+text.slice(-(room-1)):text.slice(0,room-1)+'…';
  const lines=[];for(let i=0;i<fitted.length&&lines.length<rows;i+=perLine)lines.push(fitted.slice(i,i+perLine));return lines;
}
export function cardSvg(card) {
  const color = palette[card.state] ?? palette.idle;
  const selected = Boolean(card.selected || card.active);
  let body = '';
  if (card.kind === 'nav') {
    const c=card.active?palette.white:palette.muted;
    body+=`<rect x="2" y="2" width="140" height="140" rx="12" fill="${card.active?'#223249':'#121b29'}" stroke="${card.active?'#d7e2f2':'#28364a'}" stroke-width="${card.active?2:1}"/>`;
    body += brandImages[card.brand]?brandSvg(card):icon(card.icon,palette[card.brand]??palette.white,'translate(20 4) scale(1.2)');
    body += text(72,119,card.title,17,c,600,'text-anchor="middle"');
    if (card.active) body += '<rect x="50" y="132" width="44" height="4" rx="2" fill="#f4f7ff"/>';
  } else if (card.kind === 'quota') {
    body += text(16,29,card.kicker,13,palette.white,600);
    body += text(16,67,card.value,32,palette.white,600);
    body += text(16,94,card.subtitle,12,palette.muted);
    body += `<rect x="16" y="113" width="112" height="6" rx="3" fill="${palette.line}"/><rect x="16" y="113" width="${112*Math.max(0,Math.min(1,card.progress ?? 0))}" height="6" rx="3" fill="white"/>`;
  } else if (card.kind === 'summary') {
    body += text(16,29,card.kicker,12,palette.muted,600);
    body += text(16,76,card.title,34,palette.white,600);
    body += text(16,100,card.subtitle,12,palette.muted);
    body += text(16,124,card.footer,10,color,600);
  } else if (card.kind === 'approval') {
    const ink=card.decision==='deny'?palette.error:palette.unread;
    body+=`<rect x="2" y="2" width="140" height="140" rx="12" fill="${card.decision==='deny'?'#351c29':'#103025'}" stroke="${ink}" stroke-width="2"/>`;
    body+=text(72,23,String(card.tool??'').slice(0,18),14,palette.white,700,'text-anchor="middle"');
    detailLines(card.summary).forEach((line,i)=>{body+=`<text x="10" y="${46+i*17}" fill="${palette.white}" font-size="12.5" font-family="Cascadia Mono,Consolas,monospace">${xml(line)}</text>`;});
    body+=text(72,114,card.title,17,ink,700,'text-anchor="middle"');
    body+=text(72,131,card.hint??'',11,palette.muted,500,'text-anchor="middle"');
  } else if (card.kind === 'action' || card.kind === 'app') {
    const ink=card.disabled?'#8190a6':card.icon==='check'?palette.unread:card.icon==='close'?palette.error:palette.white;
    const permission=!card.disabled&&['check','close'].includes(card.icon);
    body+=`<rect x="2" y="2" width="140" height="140" rx="12" fill="${permission?(card.icon==='check'?'#103025':'#351c29'):card.disabled?'#101722':'#142034'}" stroke="${permission?ink:card.disabled?'#283346':'#304563'}" stroke-width="${permission?2:1}"/>`;
    const brand=brandImages[card.brand];
    if(brand)body+=brandSvg(card);
    else body += icon(card.icon==='check'?'approve':card.icon==='close'?'decline':card.icon,ink,'translate(16 5) scale(1.3)');
    body += text(72,126,card.title,card.title.length>13?14:16,ink,600,'text-anchor="middle"');
    // The provider belongs to the page, not to every single key.
    if(card.caption)body+=text(72,18,String(card.caption).slice(0,20),11,palette.muted,500,'text-anchor="middle"');
    else if(card.kicker&&card.showProvider)body+=text(72,18,card.kicker,11,palette.muted,600,'text-anchor="middle"');
  } else {
    const state=card.empty?'empty':card.state,s=statusStyles[state]??statusStyles.unknown;
    body+=`<rect x="2" y="2" width="140" height="140" rx="12" fill="${s.surface}" stroke="${s.color}" stroke-width="${selected?3:1.5}"/>`;
    body+=icon(s.icon,s.color,'translate(-3 -8) scale(.77)');
    const hint=card.hint??(card.state==='unknown'?'Unknown':card.subtitle??'');
    body+=text(128,29,hint.length>13?hint.slice(0,12)+'…':hint,11,palette.muted,500,'text-anchor="end"');
    const titleLines=Array.isArray(card.title)?card.title:[card.title];
    titleLines.slice(0,3).forEach((line,i)=>{body+=text(12,61+i*20,line,17.5,palette.white,600);});
    const signal=['working','attention','unread','error'].includes(state);
    body+=`<rect x="5" y="108" width="134" height="33" rx="6" fill="${signal?s.color:'#243044'}"/>`;
    body+=text(72,state==='unread'?134:133,s.label,state==='unread'?26:22,signal?'#0b1018':palette.idle,750,'text-anchor="middle" letter-spacing=".2"');
    if(selected)body+='<path d="M120 9h15v15" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"/>';
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144" font-family="Segoe UI Variable,Segoe UI,Arial,sans-serif"><rect width="144" height="144" fill="${palette.bg}"/>${body}</svg>`;
}
