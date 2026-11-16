import manifest from '../ibtracs-data/index.json' with {type:'json'};
import {parseReconMessages,reconSupported,reconDateValid,reconDates} from '../recon-import-model.js';
const UA='TornadoDatabase/1.0 (aircraft reconnaissance archive lookup)';
const directoryLinks=html=>[...html.matchAll(/href=["']([^"']+)["']/gi)].map(m=>m[1]);
export function createReconHandler({read=fetch,storms=manifest.storms}={}){
  const pending=new Map(),cache=new Map();
  async function text(url,deadline=Infinity){let item=cache.get(url);if(item&&item.until>Date.now())return item.data;const remaining=Math.min(12000,deadline-Date.now());if(remaining<=0)throw Error('Archive lookup timed out');const response=await read(url,{headers:{'User-Agent':UA},signal:AbortSignal.timeout(Math.ceil(remaining)),redirect:'error'});if(response.status===404)return null;if(!response.ok)throw Error('Aircraft archive unavailable');if(+response.headers.get('Content-Length')>4000000)throw Error('Archive too large');const data=await response.text();if(data.length>4000000)throw Error('Archive too large');cache.set(url,{until:Date.now()+(url.includes('/'+new Date().getUTCFullYear()+'/')?120000:3600000),data});if(cache.size>160)cache.delete(cache.keys().next().value);return data;}
  async function lookup(storm,date){
    const rows=[],sources=[],failures=[],deadline=Date.now()+45000,load=url=>text(url,deadline);
    for(const atcf of storm.atcf.filter(id=>/^(AL|EP|CP)\d{6}$/.test(id))){
      const year=+atcf.slice(-4),context={atcf,date,start:storm.start,end:storm.end};
      // NCAR's per-cyclone files provide one small request for older storms.
      if(year<=2021){try{const base=`https://hurricanes.ral.ucar.edu/structure/vortex/vdm_data/${year}/`,listing=await load(base),files=directoryLinks(listing||'').filter(name=>new RegExp('^vortex_'+atcf+'_[A-Z0-9_-]+\\.txt$').test(name)&&!name.includes('_INVEST.')).sort();if(files.length){const sourceUrl=base+files[0],raw=await load(sourceUrl);if(raw){rows.push(...parseReconMessages(raw,{...context,sourceUrl}));sources.push(sourceUrl);if(rows.length)continue;}}}catch{failures.push('NCAR');}}
      try{
        const product=atcf.startsWith('AL')?'REPNT2':'REPPN2',base=`https://www.nhc.noaa.gov/archive/recon/${date.slice(0,4)}/${product}/`,listing=await load(base),time=Date.parse(date+'T00:00:00Z');
        const files=directoryLinks(listing||'').filter(name=>new RegExp('^'+product+'-[A-Z0-9]{4}\\.\\d{12}\\.txt$').test(name)).filter(name=>{const t=name.match(/\.(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})\.txt$/),stamp=Date.UTC(+t[1],+t[2]-1,+t[3],+t[4],+t[5]);return stamp>=time-3600000&&stamp<time+90000000;}).sort();
        if(files.length>120)throw Error('Too many aircraft messages for one date');
        const loaded=new Array(files.length);let next=0;
        await Promise.all(Array.from({length:Math.min(6,files.length)},async()=>{while(next<files.length){if(Date.now()>=deadline){failures.push('NHC timeout');break;}const index=next++;try{const sourceUrl=base+files[index],raw=await load(sourceUrl);if(raw)loaded[index]=parseReconMessages(raw,{...context,sourceUrl});}catch{failures.push('NHC message');}}}));
        for(const records of loaded)if(records?.length)rows.push(...records);if(listing!==null)sources.push(base);
      }catch{failures.push('NHC');}
    }
    const unique=new Map();for(const row of rows)unique.set(row.atcf+'|'+row.fixAt+'|'+row.mission.replace(/\s+CC[A-Z]?\b/g,''),row);
    const records=[...unique.values()].sort((a,b)=>a.windAt.localeCompare(b.windAt));records.forEach((r,i)=>r.id=r.atcf+'-'+r.fixAt+'-'+i);
    return {sid:storm.id,name:storm.name,date,status:records.length?'found':failures.length?'unavailable':'not-found',records,sources,partial:records.length>0&&failures.length>0,message:records.length?`${records.length} paired aircraft observations found.${failures.length?' Some archive requests failed; this list may be incomplete.':''}`:failures.length?'An aircraft archive could not be read completely. Try again; no best-track surface winds have been substituted.':'No paired flight-level wind / RMW messages were found on this date. Choose another date or enter verified recon values manually.'};
  }
  return {async fetch(request){
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
    const query=new URL(request.url).searchParams,sid=query.get('sid'),date=query.get('date'),storm=storms.find(s=>s.id===sid);
    if(!storm||!reconDateValid(date)||!reconDates(storm).includes(date))return Response.json({message:'Choose a cyclone and a date within its recorded lifetime.'},{status:400});
    if(!reconSupported(storm))return Response.json({sid,date,status:'unsupported',records:[],message:'Automatic aircraft imports currently cover Atlantic, Eastern Pacific and Central Pacific recon archives from 1989 onward. No recon values have been substituted for this cyclone.'});
    const recent=Date.parse(date+'T00:00:00Z')>Date.now()-172800000,key=sid+'|'+date;let item=pending.get(key);if(!item||item.until<Date.now()){item={until:Date.now()+(recent?60000:300000),data:lookup(storm,date).catch(()=>({sid,date,status:'unavailable',records:[],message:'Aircraft observations are temporarily unavailable. Try again.'}))};pending.set(key,item);if(pending.size>60)pending.delete(pending.keys().next().value);}
    const result=await item.data;if(result.status==='unavailable')pending.delete(key);
    return new Response(request.method==='HEAD'?null:JSON.stringify(result),{status:result.status==='unavailable'?503:200,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':result.status==='unavailable'?'no-store':recent?'public, max-age=60, s-maxage=120':'public, max-age=300, s-maxage=1800','X-Content-Type-Options':'nosniff'}});
  }};
}
export default createReconHandler();
