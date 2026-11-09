import {LIVE_SOURCES,IMAGE_PRODUCTS,parseNhc,parseJtwcFeed,parseJtwcWarning,parseFloaters,mergeStorms,imageUrl,oceanQueries,parseOcean,structureUrl,parseStructure} from '../live-storms-model.js';
import {guidanceUrl,environmentPlan,parseEnvironment,marinePlan,parseMarine} from '../storm-forecast-model.js';
import {buildCalibratedForecast} from '../storm-forecast-calibrated.js';
import {PRIMARY_PRODUCTS} from '../live-storms-primary.js';
import {createPrimaryService} from '../live-storms-upstream.js';
const json=(body,status=200,ttl=60)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':status===200?`public, max-age=${ttl}`:'no-store','Vercel-CDN-Cache-Control':status===200?`public, max-age=${ttl}`:'no-store','X-Content-Type-Options':'nosniff'}});
export function createLiveStormsHandler({read=fetch,now=()=>new Date()}={}){
  const cache=new Map(),pending=new Map();
  async function cached(key,ttl,load){const value=cache.get(key);if(value&&+now()-value.at<ttl)return value.data;if(pending.has(key))return pending.get(key);const job=load().then(data=>{if(cache.size>100)cache.delete(cache.keys().next().value);cache.set(key,{at:+now(),data});return data;}).finally(()=>pending.delete(key));pending.set(key,job);return job;}
  async function text(url,max=1000000,headers={}){const r=await read(url,{redirect:'error',signal:AbortSignal.timeout(12000),headers:{Accept:'application/json,text/plain,application/rss+xml,text/html',...headers}});if(!r.ok)throw Error('Source unavailable');const reader=r.body?.getReader();if(!reader)throw Error('Source unavailable');let size=0,parts=[];try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('Source too large');}parts.push(value);}}finally{reader.releaseLock();}const bytes=new Uint8Array(size);let i=0;for(const part of parts){bytes.set(part,i);i+=part.length;}return new TextDecoder().decode(bytes);}
  async function currentStructure(storm){return cached('structure:'+storm.id+':'+storm.validAt,300000,async()=>({...parseStructure(await text(structureUrl(storm),500000),storm),stormId:storm.id,retrievedAt:now().toISOString()}));}
  async function binary(url,max=3500000,timeout=20000){
    const response=await read(url,{redirect:'error',signal:AbortSignal.timeout(timeout)});if(!response.ok)throw Error('Primary source unavailable.');
    const reader=response.body.getReader(),parts=[];let size=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('Primary subset is too large.');}parts.push(value);}}finally{reader.releaseLock();}
    const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}return bytes;
  }
  const primary=createPrimaryService({text,binary,cached,now});
  async function infraredRaster(storm,animated){return cached('raster:'+storm.id+':'+animated,240000,async()=>{
    const image=imageUrl(storm,'spectrum',animated);if(!image)throw Error('Infrared source unavailable');const r=await read(image,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'image/gif'}});
    if(!r.ok||!/^image\/gif(?:;|$)/i.test(r.headers.get('Content-Type')||''))throw Error('Infrared source unavailable');const reader=r.body?.getReader();if(!reader)throw Error('Infrared source unavailable');const parts=[];let size=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4000000){await reader.cancel();throw Error('Infrared image too large');}parts.push(value);}}finally{reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}if(!/^GIF8[79]a$/.test(new TextDecoder().decode(bytes.slice(0,6))))throw Error('Invalid infrared image');return bytes;
  });}
  async function forecast(storm){return cached('forecast:'+storm.id+':'+storm.validAt,1800000,async()=>{
    const [deck,structure]=await Promise.allSettled([text(guidanceUrl(storm),3100000,{Range:'bytes=-3000000'}),storm.pressureMb===null?currentStructure(storm):Promise.resolve(null)]);
    if(deck.status!=='fulfilled')throw Error('Guidance unavailable');
    const anchor=storm.pressureMb??(structure.status==='fulfilled'&&structure.value.pressureMatchesAdvisory?structure.value.pressureMb:null);
    const result=buildCalibratedForecast(storm,deck.value,{pressureMb:anchor,asOf:now()});
    if(result.points.length<3)throw Error('Insufficient future guidance');return result;
  });}
  async function catalog(){return cached('catalog',300000,async()=>{
    const [nhc,jtwc,imagery]=await Promise.allSettled([text(LIVE_SOURCES.nhc).then(s=>parseNhc(JSON.parse(s))),text(LIVE_SOURCES.jtwc).then(parseJtwcFeed),text(LIVE_SOURCES.imagery).then(parseFloaters)]);
    const statuses=[{id:'nhc',name:'NHC / CPHC',url:LIVE_SOURCES.nhc,available:nhc.status==='fulfilled'},{id:'jtwc',name:'JTWC',url:LIVE_SOURCES.jtwc,available:jtwc.status==='fulfilled'},{id:'imagery',name:'NOAA imagery',url:LIVE_SOURCES.imagery,available:imagery.status==='fulfilled'}];
    let warnings=[];if(jtwc.status==='fulfilled'){
      const products=jtwc.value.products.filter(p=>!['AL','EP','CP'].includes(p.id.slice(0,2))||nhc.status!=='fulfilled');
      // Limit concurrent source requests; a failed warning cannot blank the others.
      for(let i=0;i<products.length;i+=4){const batch=await Promise.allSettled(products.slice(i,i+4).map(async p=>parseJtwcWarning(await text(p.url,200000),p)));warnings.push(...batch.filter(r=>r.status==='fulfilled').map(r=>r.value));if(batch.some(r=>r.status==='rejected'))statuses[1].partial=true;}
    }
    if(nhc.status!=='fulfilled'&&jtwc.status!=='fulfilled')throw Error('Advisory sources are temporarily unavailable.');
    return {checkedAt:now().toISOString(),refreshSeconds:300,sources:statuses,storms:mergeStorms(nhc.status==='fulfilled'?nhc.value:[],warnings,imagery.status==='fulfilled'?imagery.value:[],now())};
  });}
  return {async fetch(request){
    if(request.method!=='GET')return json({message:'Use GET to view current storms.'},405);
    const url=new URL(request.url),view=url.searchParams.get('view')||'storms',allowed=['view','storm','product','animated','run','scan','part','quality','schema','frames','skip'];
    if([...url.searchParams.keys()].some(k=>!allowed.includes(k))||allowed.some(k=>url.searchParams.getAll(k).length>1)||!['storms','ocean','imagery','infrared','structure','forecast','environment','charts','grid','sst-grid'].includes(view))return json({message:'Choose a current storm product.'},400);
    if(url.searchParams.has('quality')&&(!['charts','grid'].includes(view)||url.searchParams.get('quality')!=='high'))return json({message:'Choose a supported chart quality.'},400);
    if(url.searchParams.has('schema')&&(view!=='environment'||url.searchParams.get('schema')!=='2'))return json({message:'Choose a supported environmental schema.'},400);
    const frames=url.searchParams.get('frames'),skip=url.searchParams.get('skip');
    if((frames!==null&&(!['charts','grid'].includes(view)||! /^(?:[2-9]|[1-5]\d|60)$/.test(frames)))||(skip!==null&&(!frames||! /^[0-5]$/.test(skip))))return json({message:'Choose 2–60 loop frames and skip 0–5.'},400);
    if((url.searchParams.has('scan')&&view!=='grid')||(url.searchParams.has('part')&&view!=='sst-grid'))return json({message:'Choose a valid primary data request.'},400);
    if(url.searchParams.has('run')&&(view!=='environment'||! /^[0-9a-f]{8}$/.test(url.searchParams.get('run'))))return json({message:'Choose a current forecast run.'},400);
    try{
      const data=await catalog();if(view==='storms')return json(data);
      const id=url.searchParams.get('storm')||'';if(!/^(AL|EP|CP|WP|IO|SH)\d{6}$/.test(id))return json({message:'Choose a storm from the current list.'},400);
      const storm=data.storms.find(s=>s.id===id);if(!storm)return json({message:'This storm is no longer in the current advisory feed. Refresh the storm list.'},404);
      if(view==='charts'||view==='grid'){
        const product=url.searchParams.get('product')||'spectrum';if(!PRIMARY_PRODUCTS.some(p=>p.id===product)||!['0','1',null].includes(url.searchParams.get('animated')))return json({message:'Choose a supported satellite band.'},400);
        const loopOptions=frames?{frames:+frames,skip:+(skip||0)}:{};
        if(view==='grid'){const scan=url.searchParams.get('scan')||'';if(!/^\d{14}$/.test(scan))return json({message:'Choose an available scan.'},400);return json(await primary.grid(storm,product,scan,loopOptions),200,600);}
        return json(await primary.charts(storm,product,url.searchParams.get('animated')==='1',loopOptions),200,120);
      }
      if(view==='sst-grid'){
        const part=url.searchParams.get('part')||'0';if(!/^[01]$/.test(part))return json({message:'Choose a valid ocean tile.'},400);
        return new Response(await primary.ocean(storm,+part),{headers:{'Content-Type':'application/x-netcdf','Cache-Control':'public, max-age=1800','Vercel-CDN-Cache-Control':'public, max-age=1800','X-Content-Type-Options':'nosniff'}});
      }
      if(view==='infrared'){
        if(!['0','1',null].includes(url.searchParams.get('animated')))return json({message:'Choose a still image or loop.'},400);
        if(!storm.hasImagery)return json({message:'NOAA unenhanced infrared is unavailable for this storm. Choose another satellite product.'},404);
        return new Response(await infraredRaster(storm,url.searchParams.get('animated')==='1'),{headers:{'Content-Type':'image/gif','Cache-Control':'public, max-age=240','Vercel-CDN-Cache-Control':'public, max-age=240','X-Content-Type-Options':'nosniff'}});
      }
      if(view==='forecast')return json(await forecast(storm),200,300);
      if(view==='environment'){
        let guidance;try{guidance=await forecast(storm);}catch(error){
          if(url.searchParams.has('run'))throw error;
          // A new or poorly covered storm still has a current environment, even
          // when no forecast can be built. Never invent a future path for it.
          guidance={runId:'current:'+storm.validAt,points:[{...storm,hours:0}]};
        }
        if(url.searchParams.has('run')&&url.searchParams.get('run')!==guidance.runId)return json({message:'Model guidance has updated. Reload the forecast to sample its new path.'},409);
        return json(await cached('environment:'+id+':'+guidance.runId,3600000,async()=>{
        const plan=environmentPlan(guidance),waterPlan=marinePlan(guidance);
        const [air,water]=await Promise.all([text(plan.url,1500000).then(JSON.parse).then(p=>parseEnvironment(p,plan,now())).catch(()=>null),text(waterPlan.url,200000).then(JSON.parse).then(p=>parseMarine(p,waterPlan)).catch(()=>null)]);
        const rows=plan.steps.map((p,i)=>({...p,...(air?.rows[i]||{shearKt:null,shearTowards:null,humidityPct:null,flow500Kt:null,flow500Towards:null,samples:0,totalSamples:8}),...(water?.[i]||{temperatureC:null,sstValidAt:p.validAt,oceanStatus:'unavailable'})}));
        return {stormId:id,runId:guidance.runId,initializedAt:storm.validAt,retrievedAt:now().toISOString(),airAvailable:!!air,oceanAvailable:!!water&&rows.some(r=>r.temperatureC!==null),source:air?.source||'NOAA GFS via Open-Meteo',sourceUrl:'https://open-meteo.com/en/docs/gfs-api',oceanSource:'E.U. Copernicus Marine / Météo-France via Open-Meteo',oceanSourceUrl:'https://open-meteo.com/en/docs/marine-weather-api',modelCycle:null,ringKm:500,method:air?.method||'GFS environmental fields are temporarily unavailable.',rows};
      }),200,600);}
      if(view==='structure')return json(await currentStructure(storm));
      if(view==='ocean')return json(await cached('ocean:'+id+':'+storm.validAt,1800000,async()=>{const query=oceanQueries(storm),grids=await Promise.all(query.urls.map(u=>text(u,1500000).then(JSON.parse)));return {...parseOcean(grids,storm),bounds:query.bounds,stormId:id,positionAt:storm.validAt,retrievedAt:now().toISOString()};}),200,600);
      const product=url.searchParams.get('product')||'bd',animated=url.searchParams.get('animated')==='1';if(!IMAGE_PRODUCTS.some(p=>p.id===product)||!['0','1',null].includes(url.searchParams.get('animated')))return json({message:'Choose an available satellite product.'},400);
      const image=imageUrl(storm,product,animated);if(!image)return json({message:'This satellite product is not available for the selected storm.'},404);
      return json(await cached('image:'+image,240000,async()=>{const response=await read(image,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok||!/^image\//i.test(response.headers.get('Content-Type')||''))throw Error('Satellite image unavailable');const stamp=response.headers.get('Last-Modified');return {stormId:id,imageUrl:image,product,animated,updatedAt:Number.isFinite(Date.parse(stamp))?new Date(stamp).toISOString():null,checkedAt:now().toISOString(),source:storm.hasImagery?'NOAA NESDIS / OSPO':'JTWC',sourceUrl:storm.hasImagery?`https://ospo.noaa.gov/products/ocean/tropical/floaters/${storm.designation}/${storm.designation}_floater.html`:storm.sourceUrl};}));
    }catch{return json({message:view==='charts'||view==='grid'?'Calibrated primary satellite data are temporarily unavailable for this region. The original NOAA display remains available.':view==='forecast'||view==='environment'?'Recent matching model guidance is unavailable for this storm. The official advisory remains available; no forecast has been invented.':view==='structure'?'A matching recent operational ATCF structure record is unavailable. Published advisory values are still shown.':view==='ocean'||view==='sst-grid'?'The daily ocean analysis is temporarily unavailable. Satellite imagery and storm advisories remain available.':view==='imagery'||view==='infrared'?'The selected satellite image is temporarily unavailable. Try another product.':'Current advisory feeds are temporarily unavailable. Try refreshing shortly.'},503);}
  }};
}
export default createLiveStormsHandler();
