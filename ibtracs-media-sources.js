import {keyText,bareName} from './ibtracs-model.js';
import {normalizeSource,safeSourceImage} from './ibtracs-media-model.js';
export const SOURCE_AGENT='TornadoDatabase/1.0 (https://tornadodatabase.vercel.app; cyclone archive)';
const wiki='https://en.wikipedia.org/w/api.php';
const unescape=s=>String(s||'').replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):+n)).replace(/&(?:amp|quot|apos|lt|gt|nbsp);/g,v=>({'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' '}[v]));
export const plain=s=>unescape(String(s||'').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
async function get(url,read){const r=await read(url,{headers:{'User-Agent':SOURCE_AGENT,Accept:'application/json,text/html;q=0.9'},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Source temporarily unavailable ('+r.status+').');return r;}
export function wikiImageNames(parsed,storm){
  const html=typeof parsed.text==='string'?parsed.text:parsed.text?.['*']??'',name=keyText(storm.name),title=parsed.title||'',years=[storm.season,+storm.start?.slice(0,4),+storm.end?.slice(0,4)].filter(Boolean);
  const titleName=title.replace(/^(?:Severe Tropical Cyclone|Tropical Cyclone|Tropical Storm|Hurricane|Typhoon|Cyclone)\s+/i,'').replace(/\s*\(\d{4}\)$/,'');
  const formed=html.match(/(?:Formed|Formation)[\s\S]{0,300}?class="infobox-data"[^>]*>([\s\S]{0,900}?)<\/td>/i)?.[1]||'';
  const description=(parsed.properties||[]).filter(p=>['wikibase-shortdesc','defaultsort'].includes(p.name)).map(p=>p['*']).join(' '),explicit=title.match(/\((\d{4})\)$/)?.[1];
  if(keyText(titleName)!==name||!years.some(y=>explicit?+explicit===y:new RegExp('\\b'+y+'\\b').test(plain(formed)+' '+description)))return null;
  const photo=[unescape(html.match(/class="infobox-image"[\s\S]{0,800}?href="\/wiki\/File:([^"]+)"/)?.[1]||''),parsed.properties?.find(p=>p.name==='page_image_free')?.['*'],...(parsed.images||[]).filter(file=>keyText(file).startsWith(name)&&years.some(y=>file.includes(String(y))))].find(file=>file&&!/(track|path|summary|season)/i.test(file));
  const track=(parsed.images||[]).find(file=>{const s=keyText(file);return s.startsWith(name)&&years.some(y=>s.includes(String(y)))&&/track|path/i.test(file)&&!/(summary|season)/i.test(file);});
  return {photo:photo?decodeURIComponent(photo).replace(/_/g,' '):null,track:track?track.replace(/_/g,' '):null};
}
export async function wikipediaSources(storm,read=fetch){
  if(['UNNAMED','NOTNAMED','NONAME','UNKNOWN','MISSING'].includes(keyText(storm.name)))return [];
  const type=storm.basins.includes('WP')?'Typhoon':storm.basins.some(b=>['EP','NA','SA'].includes(b))?'Hurricane':'Cyclone',name=storm.name.toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase());
  let selected,names,article;for(const title of [...new Set([`${type} ${name} (${storm.season})`,`${type} ${name}`,`Tropical Storm ${name} (${storm.season})`])]){
    const parsed=(await (await get(wiki+'?'+new URLSearchParams({action:'parse',page:title,redirects:'1',prop:'text|images|properties|sections',format:'json'}),read)).json()).parse;
    if(!parsed)continue;
    if((names=wikiImageNames(parsed,storm))){selected=parsed;article='https://en.wikipedia.org/wiki/'+encodeURIComponent(parsed.title.replace(/ /g,'_'));break;}
    // Many individual storm pages redirect to their own section in a season
    // article. Select that exact heading, never the season's lead image.
    const years=[storm.season,+storm.start.slice(0,4),+storm.end.slice(0,4)];
    if(!/season/i.test(parsed.title)||!years.some(y=>parsed.title.includes(String(y))||new RegExp((y-1)+'[–-]'+String(y).slice(-2)+'\\b').test(parsed.title)))continue;
    const section=parsed.sections?.find(s=>keyText(bareName(plain(s.line).replace(/^(?:(?:very|extremely|severe|super|intense|tropical|subtropical|cyclonic)\s+)*(?:cyclone|storm|typhoon|hurricane|depression)\s+/i,'')))===keyText(storm.name));if(!section)continue;
    const part=(await (await get(wiki+'?'+new URLSearchParams({action:'parse',page:parsed.title,section:section.index,prop:'text|images',format:'json'}),read)).json()).parse;
    if(part&&(names=wikiImageNames({...part,title:`${type} ${name} (${storm.season})`,properties:[]},storm))){selected=part;article='https://en.wikipedia.org/wiki/'+encodeURIComponent(parsed.title.replace(/ /g,'_'))+'#'+encodeURIComponent(section.anchor);break;}
  }
  if(!selected)return [];
  const wanted=Object.entries(names).filter(([,file])=>file);if(!wanted.length)return [];
  const data=await (await get(wiki+'?'+new URLSearchParams({action:'query',titles:wanted.map(([,file])=>'File:'+file).join('|'),prop:'imageinfo',iiprop:'url|mime|extmetadata',iiurlwidth:'1200',formatversion:'2',format:'json'}),read)).json();
  const sources=[];for(const [kind,file]of wanted){
    const page=data.query?.pages?.find(p=>keyText(p.title)===keyText('File:'+file)),info=page?.imageinfo?.[0];if(!info)continue;
    const meta=info.extmetadata||{},url=safeSourceImage(info.url)?info.url:info.thumbmime==='image/png'?info.thumburl:null;if(!safeSourceImage(url))continue;
    sources.push({...normalizeSource({kind,sid:storm.id,url,sourcePage:info.descriptionurl||'https://en.wikipedia.org/wiki/File:'+encodeURIComponent(file.replace(/ /g,'_')),title:file,author:plain(meta.Artist?.value||meta.Credit?.value),license:plain(meta.LicenseShortName?.value),licenseUrl:meta.LicenseUrl?.value}),preview:safeSourceImage(info.thumburl)||url,article});
  }return sources;
}
export function ncicsSatelliteSource(html,storm){
  for(const match of html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)){
    const url=new URL(unescape(match[1]),'https://ncics.org/ibtracs/').href;if(!safeSourceImage(url)||!new URL(url).pathname.includes('/'+storm.id+'.'))continue;
    const time=new URL(url).pathname.match(/\.(\d{4})\.(\d{2})\.(\d{2})\.(\d{2})(\d{2})\./);
    return normalizeSource({kind:'satellite',sid:storm.id,url,sourcePage:'https://ncics.org/ibtracs/index.php?name=v04r01-'+storm.id,title:'IBTrACS / HURSAT · '+storm.name+' '+storm.season,author:'NOAA / NCICS · HURSAT',license:'Source archive image',at:time?`${time[1]}-${time[2]}-${time[3]}T${time[4]}:${time[5]}:00Z`:''});
  }return null;
}
export async function gatherIbtracsMedia(storm,read=fetch){
  const jobs=await Promise.allSettled([wikipediaSources(storm,read),get('https://ncics.org/ibtracs/index.php?name=v04r01-'+storm.id,read).then(r=>r.text()).then(html=>ncicsSatelliteSource(html,storm))]);
  const items=[],warnings=[];jobs.forEach((job,i)=>{if(job.status==='fulfilled'){if(i===0)items.push(...job.value);else if(job.value)items.push(job.value);}else warnings.push((i===0?'Wikipedia':'IBTrACS satellite archive')+' is temporarily unavailable.');});
  return {sid:storm.id,items,warnings};
}
