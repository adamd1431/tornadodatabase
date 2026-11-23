import {observationAt as sharedObservationAt,analyzePressureTime} from '../pressure-analysis-model.js';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import manifest from '../ibtracs-data/index.json' with {type:'json'};
import {AGENCIES,columnMap} from '../ibtracs-model.js';
import {validateAnalysisTime} from '../poci-roci-model.js';
import {noaaPressureSubsetUrl} from '../noaa-pressure-chart.js';
import {parseNoaaPressureSubset} from '../noaa-pressure-subset.js';
const years=new Map(),fields=new Map(),col=columnMap(manifest.columns);
let noaaRetryAt=0;
function noaaLimited(){return Object.assign(Error('NOAA is temporarily limiting pressure-data requests. Please try again in a minute.'),{rateLimited:true});}
async function yearData(year){if(!years.has(year)){years.set(year,readFile(join(process.cwd(),'ibtracs-data',`${year}.json.gz`)).then(b=>JSON.parse(gunzipSync(b))).catch(e=>{years.delete(year);throw e;}));if(years.size>4)years.delete(years.keys().next().value);}return years.get(year);}
async function pressureField(t){
  if(!fields.has(t.at)){if(Date.now()<noaaRetryAt)throw noaaLimited();fields.set(t.at,fetch(noaaPressureSubsetUrl(t.at.slice(0,10),t.at.slice(11,13)+'00'),{headers:{'User-Agent':'TornadoDatabase/1.0 (https://tornadodatabase.vercel.app; historical pressure analysis)'},signal:AbortSignal.timeout(30000)}).then(async r=>{if(r.status===429){const seconds=Number(r.headers.get('Retry-After'));noaaRetryAt=Date.now()+Math.max(60,Math.min(300,seconds||60))*1000;throw noaaLimited();}if(!r.ok)throw Error('NOAA pressure data could not be loaded.');if(Number(r.headers.get('Content-Length'))>4000000)throw Error('NOAA returned an oversized pressure subset.');return parseNoaaPressureSubset(new Uint8Array(await r.arrayBuffer()),t.at);}).catch(e=>{fields.delete(t.at);throw e;}));if(fields.size>8)fields.delete(fields.keys().next().value);}return fields.get(t.at);
}
export function observationAt(storm,records,at,agency='USA'){return sharedObservationAt(storm,records,at,agency,col);}
export function analyzeTime(date,time,options={}){return analyzePressureTime(manifest,date,time,{readField:pressureField,readYear:yearData,...options});}
export default {async fetch(request){
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed.',{status:405});
  const p=new URL(request.url).searchParams,date=p.get('date'),time=p.get('time')||'0000',sid=p.get('sid')||undefined,agency=p.get('agency')||'USA',interval=Number(p.get('interval')||5);
  try{validateAnalysisTime(date,time);if(sid&&!/^\d{7}[NS]\d{5}$/.test(sid))throw Error('Invalid cyclone identifier.');if(!AGENCIES.some(a=>a.id===agency))throw Error('Invalid reporting agency.');if(![2,5].includes(interval))throw Error('Choose a 5-mb or 2-mb contour interval.');}catch(error){return Response.json({error:error.message},{status:400,headers:{'Cache-Control':'no-store'}});}
  try{const data=await analyzeTime(date,time,{sid,agency,interval});return new Response(request.method==='HEAD'?null:JSON.stringify(data),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400','X-Content-Type-Options':'nosniff'}});}catch(error){if(!error.rateLimited&&!/selected cyclone/.test(error.message))console.warn('NOAA pressure analysis failed',date,time,error);return Response.json({error:error.rateLimited||/selected cyclone/.test(error.message)?error.message:'NOAA pressure data is temporarily unavailable. Please retry.'},{status:error.rateLimited?503:/selected cyclone/.test(error.message)?400:502,headers:{'Cache-Control':'no-store',...(error.rateLimited?{'Retry-After':String(Math.max(1,Math.ceil((noaaRetryAt-Date.now())/1000)))}:{})}});}
}};
