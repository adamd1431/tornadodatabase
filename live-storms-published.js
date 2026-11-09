// Discover public, credited plots from their publisher's current inventory.
// Images load directly from the publisher; no image bytes are mirrored here.
export const PUBLISHED_ROOT='https://cyclonicwx.com';
export const PUBLISHED_PRODUCTS=Object.freeze([
  {id:'spectrum',code:'ir',name:'Infrared · temperature plot'},
  {id:'wv',code:'wv',name:'Water vapor · temperature plot'},
  {id:'vis',code:'vis',name:'Visible · reflectance plot'},
  {id:'rgb',code:'rgb',name:'RGB visible'},
  {id:'bd',code:'dvorak',name:'Dvorak infrared'},
  {id:'avn',code:'avn',name:'AVN infrared'}
]);
const attr=(s,name)=>s.match(new RegExp(`\\b${name}\\s*=\\s*['\"]([^'\"]*)['\"]`,'i'))?.[1]||'';
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const plain=s=>s.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
function validStamp(s){if(!/^\d{12}$/.test(s))return null;const iso=`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:00.000Z`;return Number.isFinite(Date.parse(iso))&&new Date(iso).toISOString()===iso?iso:null;}
function frame(path,designation,code,now){
  const m=path.match(new RegExp(`^/data/sat/[a-z0-9]+_${escape(designation)}_${code}_(\\d{12})\\.png$`));if(!m)return null;
  const validAt=validStamp(m[1]),age=+now-Date.parse(validAt);return validAt&&age>=-15*60000&&age<=6*3600000?{imageUrl:PUBLISHED_ROOT+path,validAt}:null;
}
function identity(storm){if(!/^(AL|EP|CP|WP|IO|SH)\d{6}$/.test(storm.id)||!/^\d{2}[WABSPCLE]$/.test(storm.designation))throw Error('Invalid current storm.');return storm.id.toLowerCase();}
export function publishedChartsFromPage(text,storm,now=new Date()){
  const key=identity(storm),short=key.slice(0,4),blocks=[...text.matchAll(/<div\b[^>]*\bclass=['"][^'"]*\bstormdivs\b[^'"]*['"][^>]*>/gi)],index=blocks.findIndex(m=>attr(m[0],'id')===short);
  if(index<0)throw Error('The publisher has no matching current storm.');
  const section=text.slice(blocks[index].index,blocks[index+1]?.index||text.length),heading=plain(section.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||'');
  // The short designation is reused yearly. Require the full season ID and name.
  if(!new RegExp(`\\b${escape(key)}(?:sst|track\\.png)\\b`,'i').test(section)||!new RegExp(`\\b${escape(storm.name)}\\b`,'i').test(heading))throw Error('The published plot belongs to another storm or season.');
  const updated=plain(section).match(/Updated\s+([A-Za-z]+\s+\d{1,2},\s+\d{4}\s+at\s+\d{2}:\d{2})\s+UTC/i)?.[1],advisory=Date.parse((updated||'').replace(' at ',' ')+' UTC');
  if(!Number.isFinite(advisory)||Math.abs(advisory-Date.parse(storm.validAt))>12*3600000||+now-advisory>36*3600000||advisory>+now+3*3600000)throw Error('The publisher inventory is stale or unmatched.');
  const paths=[...section.matchAll(/<img\b[^>]*>/gi)].map(m=>attr(m[0],'src')),satellite=paths.map(p=>frame(p,storm.designation,'ir',now)).filter(Boolean).sort((a,b)=>Date.parse(b.validAt)-Date.parse(a.validAt))[0]||null;
  const known=(folder,name)=>paths.includes(`/data/${folder}/${name}.png`)?PUBLISHED_ROOT+`/data/${folder}/${name}.png`:null;
  const sourceUrl=PUBLISHED_ROOT+'/storms/#'+short;
  return {stormId:storm.id,provider:'CyclonicWx',sourceUrl,checkedAt:new Date(now).toISOString(),publisherAdvisoryAt:new Date(advisory).toISOString(),
    satellite:satellite?{...satellite,sourceUrl:PUBLISHED_ROOT+`/floater/${storm.designation}/ir/`,frames:[satellite]}:null,
    ocean:known('sst','crw_sst_'+storm.designation),radii:known('tracks',storm.designation+'_windradii')};
}
export function publishedSatelliteFrames(text,storm,product,now=new Date()){
  identity(storm);const p=PUBLISHED_PRODUCTS.find(p=>p.id===product);if(!p)throw Error('Choose a supported published product.');
  const title=plain(text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'');if(!new RegExp(`\\b${escape(storm.name)}\\b`,'i').test(title))throw Error('This satellite page belongs to another storm.');
  const raw=text.match(/\b(?:var|let|const)\s+imgUrls\s*=\s*(\[[^;]*?\])\s*;/)?.[1];let paths=[];
  // The publisher emits a JavaScript array with a trailing comma. Remove that
  // comma only; never evaluate page code or accept executable expressions.
  if(raw){try{paths=JSON.parse(raw.replace(/,\s*\]$/,']'));}catch{throw Error('The published frame list is unreadable.');}}
  if(!Array.isArray(paths)||paths.length>1500)throw Error('The published frame list is too large.');
  if(!paths.length)paths=[...text.matchAll(/<img\b[^>]*>/gi)].filter(m=>attr(m[0],'id')==='img').map(m=>attr(m[0],'src'));
  const frames=[...new Set(paths.filter(p=>typeof p==='string'))].map(path=>frame(path,storm.designation,p.code,now)).filter(Boolean).sort((a,b)=>Date.parse(a.validAt)-Date.parse(b.validAt)).slice(-12);
  if(!frames.length)throw Error('No recent matching satellite scans were published.');
  return {...frames.at(-1),frames,sourceUrl:PUBLISHED_ROOT+`/floater/${storm.designation}/${p.code}/`};
}
