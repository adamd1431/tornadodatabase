import {selectLoopFrames} from './satellite-loop-model.js';
export const PUBLISHED_ROOT='https://cyclonicwx.com';
const products={spectrum:'ir',wv:'wv',vis:'vis'};
const attr=(s,name)=>s.match(new RegExp(`\\b${name}\\s*=\\s*['\"]([^'\"]*)['\"]`,'i'))?.[1]||'';
const escape=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const plain=s=>s.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
function identity(storm){if(!/^(AL|EP|CP|WP|IO|SH)\d{6}$/.test(storm.id)||!/^\d{2}[WABSPCLE]$/.test(storm.designation))throw Error('Invalid current storm.');return storm.id.toLowerCase();}
export function verifyPublishedStorm(text,storm,now=new Date()){
  const key=identity(storm),blocks=[...text.matchAll(/<div\b[^>]*\bclass=['"][^'"]*\bstormdivs\b[^'"]*['"][^>]*>/gi)],index=blocks.findIndex(m=>attr(m[0],'id')===key.slice(0,4));
  if(index<0)throw Error('No matching published storm.');const section=text.slice(blocks[index].index,blocks[index+1]?.index||text.length),heading=plain(section.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||'');
  if(!new RegExp(`\\b${escape(key)}(?:sst|track\\.png)\\b`,'i').test(section)||!new RegExp(`\\b${escape(storm.name)}\\b`,'i').test(heading))throw Error('The published storm identity or season does not match.');
  const stamp=plain(section).match(/Updated\s+([A-Za-z]+\s+\d{1,2},\s+\d{4}\s+at\s+\d{2}:\d{2})\s+UTC/i)?.[1],at=Date.parse((stamp||'').replace(' at ',' ')+' UTC');
  if(!Number.isFinite(at)||Math.abs(at-Date.parse(storm.validAt))>12*3600000||+now-at>36*3600000||at>+now+3*3600000)throw Error('Published storm data are stale.');
}
export function publishedFrames(text,storm,product,now=new Date()){
  identity(storm);const code=products[product];if(!code)throw Error('Unsupported published satellite band.');
  const title=plain(text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'');if(!new RegExp(`\\b${escape(storm.name)}\\b`,'i').test(title))throw Error('The satellite page belongs to another storm.');
  const raw=text.match(/\b(?:var|let|const)\s+imgUrls\s*=\s*(\[[^;]*?\])\s*;/)?.[1];let paths;
  try{paths=raw?JSON.parse(raw.replace(/,\s*\]$/,']')):[];}catch{throw Error('The published image inventory is unreadable.');}
  if(!Array.isArray(paths)||paths.length>1500)throw Error('The published image inventory is too large.');
  const pattern=new RegExp(`^/data/sat/([a-z0-9]+)_${escape(storm.designation)}_${code}_(\\d{12})\\.png$`),frames=[];
  for(const path of new Set(paths)){
    if(typeof path!=='string')continue;const match=path.match(pattern);if(!match)continue;const s=match[2],iso=`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:00.000Z`,at=Date.parse(iso),age=+now-at;
    if(!Number.isFinite(at)||new Date(at).toISOString()!==iso||age< -15*60000||age>24*3600000)continue;
    frames.push({filename:path.split('/').at(-1),imageUrl:PUBLISHED_ROOT+path,validAt:iso});
  }
  frames.sort((a,b)=>Date.parse(a.validAt)-Date.parse(b.validAt));
  if(!frames.length||+now-Date.parse(frames.at(-1).validAt)>2*3600000)throw Error('No recent published satellite scans are available.');return frames;
}
export function createPublishedService({text,binary,cached,now}){
  async function inventory(storm,product){
    const code=products[product];identity(storm);if(!code)throw Error('Unsupported published satellite band.');
    return cached(`published-inventory:${storm.id}:${storm.validAt}:${product}`,120000,async()=>{
      const index=await cached('published-storms',120000,()=>text(PUBLISHED_ROOT+'/storms/',1000000));verifyPublishedStorm(index,storm,now());
      const page=await text(PUBLISHED_ROOT+`/floater/${storm.designation}/${code}/`,600000);return publishedFrames(page,storm,product,now());
    });
  }
  return {
    async loop(storm,product,count=30,skip=0){const frames=selectLoopFrames(await inventory(storm,product),count,skip);return {stormId:storm.id,kind:'published',provider:'CyclonicWx',source:'CyclonicWx',sourceUrl:PUBLISHED_ROOT+`/floater/${storm.designation}/${products[product]}/`,method:'Original published PNG frames. Captions, source attribution and image pixels are retained.',frames,requestedFrames:count,skip};},
    async image(storm,product,filename){
      const frame=(await inventory(storm,product)).find(f=>f.filename===filename);if(!frame)throw Error('This image is not in the matching published inventory.');
      const bytes=await binary(frame.imageUrl,3000000,15000),signature=[137,80,78,71,13,10,26,10];if(signature.some((n,i)=>bytes[i]!==n))throw Error('The publisher did not return a PNG image.');return bytes;
    }
  };
}
