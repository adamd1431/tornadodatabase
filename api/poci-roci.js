import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import manifest from '../ibtracs-data/index.json' with {type:'json'};
import {AGENCIES,columnMap,rawValue,numberValue,position,designation} from '../ibtracs-model.js';
import {validateAnalysisTime,pressureDataUrl,parsePressureAscii,extractPociRoci} from '../poci-roci-model.js';
const years=new Map(),fields=new Map(),col=columnMap(manifest.columns),SOURCE='https://www.psl.noaa.gov/mddb2/makePlot.html?variableID=142214';
async function yearData(year){if(!years.has(year)){years.set(year,readFile(join(process.cwd(),'ibtracs-data',`${year}.json.gz`)).then(b=>JSON.parse(gunzipSync(b))).catch(e=>{years.delete(year);throw e;}));if(years.size>4)years.delete(years.keys().next().value);}return years.get(year);}
export function observationAt(storm,records,at,agency='USA'){
  const raw=at.replace('T',' ').replace('Z',''),exact=records.find(r=>rawValue(r,col,'ISO_TIME')===raw);
  if(exact){const p=position(exact,col,agency);return p?{...p,at,agency,interpolated:false,windKnots:numberValue(exact,col,agency+'_WIND'),pressureMb:numberValue(exact,col,agency+'_PRES'),reportedPociMb:numberValue(exact,col,agency+'_POCI'),reportedRociNmi:numberValue(exact,col,agency+'_ROCI')}:null;}
  const when=Date.parse(at),ordered=records.map(r=>({r,time:Date.parse(rawValue(r,col,'ISO_TIME').replace(' ','T')+'Z')})),after=ordered.findIndex(r=>r.time>when);if(after<1)return null;
  const a=ordered[after-1],b=ordered[after];if(b.time-a.time>43200000)return null;const p=position(a.r,col,agency),q=position(b.r,col,agency);if(!p||!q||p.source!==q.source)return null;
  const t=(when-a.time)/(b.time-a.time),dlon=((q.lon-p.lon+540)%360)-180;return {lat:p.lat+(q.lat-p.lat)*t,lon:((p.lon+dlon*t+540)%360)-180,source:p.source,at,interpolated:true,bracket:[new Date(a.time).toISOString(),new Date(b.time).toISOString()],windKnots:null,pressureMb:null};
}
async function pressureField(t){
  if(!fields.has(t.at)){fields.set(t.at,fetch(pressureDataUrl(t.at.slice(0,10),t.at.slice(11,13)+'00'),{headers:{'User-Agent':'TornadoDatabase/1.0 (https://tornadodatabase.vercel.app; historical pressure analysis)'},signal:AbortSignal.timeout(30000)}).then(async r=>{if(!r.ok)throw Error('NOAA pressure data could not be loaded.');return parsePressureAscii(await r.text(),t.at);}).catch(e=>{fields.delete(t.at);throw e;}));if(fields.size>8)fields.delete(fields.keys().next().value);}return fields.get(t.at);
}
export async function analyzeTime(date,time,{sid,agency='USA',readField=pressureField,readYear=yearData}={}){
  if(!AGENCIES.some(a=>a.id===agency))throw Error('Invalid reporting agency.');
  const t=validateAnalysisTime(date,time),raw=t.at.replace('T',' ').replace('Z',''),active=manifest.storms.filter(s=>s.start<=raw&&s.end>=raw&&!s.types.every(type=>/spur/i.test(type)));
  if(sid&&!active.some(s=>s.id===sid))throw Error('The selected cyclone has no track at this date and time.');
  const seasons=[...new Set(active.map(s=>s.season))],data=await Promise.all(seasons.map(readYear)),rows=new Map(data.flatMap(y=>y.storms).map(s=>[s.id,s.records]));
  const fixes=active.flatMap(storm=>{const fix=observationAt(storm,rows.get(storm.id)||[],t.at,agency);return fix&&Math.abs(fix.lat)<=65?[{storm,fix}]:[];});
  const result={at:t.at,dataset:'NOAA / CIRES / DOE 20CRv3 ensemble-mean MSLP',sourcePage:SOURCE,dataUrl:pressureDataUrl(date,time),gridDegrees:1,contourIntervalMb:2,results:[],note:'Reanalysis-derived estimates. The 1° ensemble-mean grid can smooth or miss a cyclone. These are not JTWC-reported POCI / ROCI.'};
  if(!fixes.length)return result;
  const grid=await readField(t),analyses=fixes.map(({storm,fix})=>({sid:storm.id,name:storm.name,season:storm.season,designation:storm.atcf.map(a=>designation(a,storm)).join(' / '),track:fix,...extractPociRoci(grid,fix)}));
  const centers=new Map();for(const a of analyses)if(a.status==='estimated'){const key=a.center.lat+','+a.center.lon;if(!centers.has(key))centers.set(key,[]);centers.get(key).push(a);}
  for(const shared of centers.values())if(shared.length>1)for(const a of shared){a.status='unresolved';delete a.pociMb;delete a.rociNmi;delete a.contour;a.message='Multiple active cyclone tracks map to the same grid minimum. Individual POCI / ROCI cannot be separated at this resolution.';}
  result.results=analyses.filter(a=>!sid||a.sid===sid).sort((a,b)=>(b.track.windKnots??0)-(a.track.windKnots??0)||a.name.localeCompare(b.name));return result;
}
export default {async fetch(request){
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed.',{status:405});
  const p=new URL(request.url).searchParams,date=p.get('date'),time=p.get('time')||'0000',sid=p.get('sid')||undefined,agency=p.get('agency')||'USA';
  try{validateAnalysisTime(date,time);if(sid&&!/^\d{7}[NS]\d{5}$/.test(sid))throw Error('Invalid cyclone identifier.');if(!AGENCIES.some(a=>a.id===agency))throw Error('Invalid reporting agency.');}catch(error){return Response.json({error:error.message},{status:400,headers:{'Cache-Control':'no-store'}});}
  try{const data=await analyzeTime(date,time,{sid,agency});return new Response(request.method==='HEAD'?null:JSON.stringify(data),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'}});}catch(error){return Response.json({error:/selected cyclone/.test(error.message)?error.message:'NOAA pressure data is temporarily unavailable. Please retry.'},{status:/selected cyclone/.test(error.message)?400:502,headers:{'Cache-Control':'no-store'}});}
}};
