export const IMPORT_KINDS={photo:{category:'photos',label:'Wikipedia picture · thumbnail'},track:{category:'track',label:'Wikipedia track'},satellite:{category:'satellite',label:'IBTrACS satellite imagery'}};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function safeSourceImage(value){
  try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash)return null;
    if(['upload.wikimedia.org','thumb.wikimedia.org'].includes(u.hostname)&&/^\/wikipedia\/(?:commons|en)\//.test(u.pathname)&&/\.(?:png|jpe?g|webp|gif|avif)$/i.test(u.pathname))return u.href;
    if(u.hostname==='ncics.org'&&/^\/ibtracs\/hursat\/\d{4}\/\d{7}[NS]\d{5}\.[^/]+\.png$/.test(u.pathname))return u.href;
  }catch{}return null;
}
export function safeSourcePage(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&((['en.wikipedia.org','commons.wikimedia.org'].includes(u.hostname)&&u.pathname.startsWith('/wiki/'))||(u.hostname==='ncics.org'&&u.pathname==='/ibtracs/index.php'))?u.href:null;}catch{return null;}}
export function normalizeSource(source){
  if(!source||!Object.hasOwn(IMPORT_KINDS,source.kind)||!/^\d{7}[NS]\d{5}$/.test(source.sid)||!safeSourceImage(source.url)||!safeSourcePage(source.sourcePage))throw Error('Invalid source image.');
  if(source.kind==='satellite'?new URL(source.url).hostname!=='ncics.org'||!new URL(source.url).pathname.includes('/'+source.sid+'.'):!['upload.wikimedia.org','thumb.wikimedia.org'].includes(new URL(source.url).hostname))throw Error('Source does not match its image category.');
  const clean={kind:source.kind,sid:source.sid,url:safeSourceImage(source.url),sourcePage:safeSourcePage(source.sourcePage)};
  for(const key of ['title','author','license','licenseUrl','at'])clean[key]=String(source[key]||'').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,key==='author'?400:700);
  if(clean.licenseUrl&&!/^https:\/\/(?:creativecommons\.org|commons\.wikimedia\.org|en\.wikipedia\.org)\//.test(clean.licenseUrl))clean.licenseUrl='';
  return clean;
}
function encode(value){return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function decode(value){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))));}
export function importedSourcePath(userId,cycloneId,source){if(!uuid.test(userId)||!uuid.test(cycloneId))throw Error('Invalid cyclone import destination.');return `${userId}/${cycloneId}/ibtracs-source/${encode(normalizeSource(source))}.png`;}
export function sourceFromImportPath(value){
  if(typeof value!=='string'||value.length>7000)return null;
  const m=value.match(/^([a-f0-9-]{36})\/([a-f0-9-]{36})\/ibtracs-source\/([A-Za-z0-9_-]+)\.png$/);if(!m||!uuid.test(m[1])||!uuid.test(m[2]))return null;
  try{return {...normalizeSource(decode(m[3])),userId:m[1],cycloneId:m[2]};}catch{return null;}
}
export function sourceFromImportUrl(value){try{const u=new URL(value);return u.origin==='https://tornadodatabase.vercel.app'&&!u.search&&!u.hash?sourceFromImportPath(decodeURIComponent(u.pathname.replace(/^\/storage\/v1\/object\/public\/cyclone-uploads\//,''))):null;}catch{return null;}}
export function importedSourceUrl(path){if(!sourceFromImportPath(path))throw Error('Invalid source path.');return 'https://tornadodatabase.vercel.app/storage/v1/object/public/cyclone-uploads/'+path;}
export function sourceCredit(source){return [source.author,source.license].filter(Boolean).join(' · ')|| (source.kind==='satellite'?'NOAA / NCICS · HURSAT':'Wikipedia / Wikimedia Commons');}
