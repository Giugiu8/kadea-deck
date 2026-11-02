// Original Cardea Deck icons. One 86-unit grid, rounded 3-unit strokes.
export const iconPaths = Object.freeze({
  start: '<path d="m25 37 17-14 17 14M30 34v23h24V34M39 57V44h8v13"/>',
  chats: '<path d="M23 25h35v24H39L29 58v-9h-6zM62 35h6v24H57l-8 7v-7h-8"/>',
  controls: '<path d="M25 28h34M25 44h34M25 60h34"/><circle cx="36" cy="28" r="5"/><circle cx="49" cy="44" r="5"/><circle cx="35" cy="60" r="5"/>',
  pc: '<rect x="23" y="25" width="40" height="28" rx="3"/><path d="M43 53v11M32 65h22"/>',
  plus: '<path d="M43 25v36M25 43h36"/>',
  check: '<path d="m25 43 12 12 25-27"/>',
  close: '<path d="m28 28 30 30m0-30-30 30"/>',
  stop: '<rect x="28" y="28" width="30" height="30" rx="4"/>',
  mic: '<rect x="36" y="23" width="14" height="28" rx="7"/><path d="M28 43v2a15 15 0 0 0 30 0v-2M43 60v8M34 69h18"/>',
  model: '<path d="m43 21 22 12v25L43 70 21 58V33zM21 33l22 12 22-12M43 45v25"/>',
  arrow: '<path d="M24 44h36M47 29l15 15-15 15"/>',
  eye: '<path d="M19 44s9-17 24-17 24 17 24 17-9 17-24 17-24-17-24-17z"/><circle cx="43" cy="44" r="7"/>',
  globe: '<circle cx="43" cy="44" r="22"/><ellipse cx="43" cy="44" rx="10" ry="22"/><path d="M21 44h44"/>',
  music: '<path d="M35 59V29l27-6v29M35 38l27-6"/><ellipse cx="28" cy="60" rx="7" ry="5"/><ellipse cx="55" cy="53" rx="7" ry="5"/>',
  shield: '<path d="m43 22 21 8-3 23-18 15-18-15-3-23zM32 44l8 8 16-18"/>',
  notes: '<path d="m43 20 21 24-10 25-29-8-7-24zM43 20l-5 30 16 19M18 37l20 13 26-6"/>',
  folder: '<path d="M20 30h19l7 7h22v27H20z"/>',
  discord: '<path d="m27 31 8-5 5 5h9l5-5 8 5 8 28-14 7-6-8H36l-6 8-14-7z"/><circle cx="34" cy="45" r="2"/><circle cx="52" cy="45" r="2"/>',
  previous: '<path d="M56 26 31 44l25 18zM24 26v36"/>',
  next: '<path d="m29 26 25 18-25 18zM61 26v36"/>',
  play: '<path d="m24 25 25 19-25 19zM58 26v36M66 26v36"/>',
  clock: '<circle cx="43" cy="44" r="21"/><path d="M43 29v16l-9 9"/>',
  spinner: '<path d="M43 23a21 21 0 1 1-18 10"/>',
  warning: '<path d="m43 23 24 42H19zM43 38v12M43 57h.01"/>',
  pen: '<path d="M39 27H25v37h37V50M39 49l3-12 20-20 9 9-20 20z"/>',
  approve: '<circle cx="43" cy="44" r="23"/><path d="m31 44 8 8 16-18"/>',
  decline: '<circle cx="43" cy="44" r="23"/><path d="m35 36 16 16m0-16-16 16"/>',
  linkoff: '<path d="m22 23 43 43M31 48l-5 5a10 10 0 0 0 14 14l9-9M54 38l7-7a10 10 0 0 0-14-14l-8 8"/>',
  apps: '<rect x="24" y="25" width="15" height="15" rx="4"/><rect x="48" y="25" width="15" height="15" rx="4"/><rect x="24" y="49" width="15" height="15" rx="4"/><rect x="48" y="49" width="15" height="15" rx="4"/>',

  chatplus: '<path d="M21 24h44v29H42L29 65V53h-8zM43 31v16M35 39h16"/>',
  question: '<path d="M21 23h44v31H42L29 65V54h-8zM37 34a7 7 0 0 1 13 3c0 5-7 5-7 10M43 49h.01"/>',
  read: '<path d="M24 23h29l10 10v32H24zM51 23v12h12M33 48l8 8 13-14"/>',
  gauge: '<path d="M24 60a25 25 0 1 1 38 0M43 24v5M23 43h5M58 43h5M43 49l12-15"/><circle cx="43" cy="49" r="4"/><path d="M33 65h20"/>',
  open: '<path d="M37 25H24v39h39V51M46 22h20v20M66 22 40 48"/>',
});
export function iconSvg(name,color='#f4f7ff',transform=''){
  if(!Object.hasOwn(iconPaths,name))throw Error(`Unknown Cardea icon: ${name}`);
  return `<g${transform?` transform="${transform}"`:''} fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${iconPaths[name]}</g>`;
}
