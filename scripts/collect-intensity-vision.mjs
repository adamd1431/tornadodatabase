import fs from 'node:fs/promises';import zlib from 'node:zlib';import crypto from 'node:crypto';import {fileURLToPath}from 'node:url';
import {columnMap,numberValue,recordTime}from '../ibtracs-model.js';import {estimateIntensity}from '../satellite-intensity-model.js';
import {infraredMorphology}from '../satellite-intensity-vision.js';import {parseAdtHistory}from '../satellite-dvorak-model.js';import {causalThermalHistory}from '../satellite-intensity-structure.js';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const cache='.cache/intensity-training',network=globalThis.fetch,archive=new Map();
globalThis.fetch=async(input,init={})=>{const url=new URL(input,'https://tornadodatabase.vercel.app/');
  if(url.pathname==='/api/satellite-dvorak'&&url.searchParams.get('view')==='thermal'){const atcf=url.searchParams.get('atcf');if(!archive.has(atcf))try{archive.set(atcf,parseAdtHistory(await fs.readFile(cache+'/'+atcf+'.txt','utf8')));}catch{archive.set(atcf,[]);}return Response.json({thermalHistory:causalThermalHistory(archive.get(atcf),url.searchParams.get('time'))});}
  if(url.pathname.startsWith('/ibtracs-data/'))return new Response(await fs.readFile('.'+url.pathname));
  return network(url,{...init,signal:init.signal||AbortSignal.timeout(45000)});
};
const {loadHistoricScan,stormRecords,reportedEnvironment}=await import('../satellite-intensity-data.js');
const manifest=JSON.parse(await fs.readFile('ibtracs-data/index.json')),col=columnMap(manifest.columns),protocol=JSON.parse(await fs.readFile(process.argv.includes('--offline')?'intensity-data/native-vision-protocol.json':cache+'/native-vision-plan.json')),bundle=JSON.parse(await fs.readFile('intensity-data/tree-model.json'));bundle.westernPacific=JSON.parse(await fs.readFile('intensity-data/pacific-tree-model.json'));
if(!process.argv.includes('--offline'))await fs.writeFile('intensity-data/native-vision-protocol.json',JSON.stringify(protocol,null,2)+'\n');
const records=new Map(),examples=[],failures=[];let done=0;
async function collect(item){
  const file=cache+'/hourly/'+item.storm+'-'+item.requestedAt.replace(/[^0-9]/g,'').slice(0,12)+'.json.gz';let scan;
  try{
    try{scan=JSON.parse(zlib.gunzipSync(await fs.readFile(file)));}catch{if(process.argv.includes('--offline'))throw Error('The frozen scan is not cached; offline collection cannot fetch it.');const storm=manifest.storms.find(s=>s.atcf.includes(item.storm));scan=await loadHistoricScan(storm,item.requestedAt);await fs.writeFile(file,zlib.gzipSync(JSON.stringify(scan,(_,v)=>ArrayBuffer.isView(v)?Array.from(v):v),{level:9}));}
    for(const k of ['temperature','latitude','longitude'])if(!Array.isArray(scan.grid[k])&&!ArrayBuffer.isView(scan.grid[k]))scan.grid[k]=Float32Array.from(Object.values(scan.grid[k]));
    if(!records.has(item.storm))records.set(item.storm,stormRecords(manifest.storms.find(s=>s.atcf.includes(item.storm)),manifest));const track=await records.get(item.storm);
    const result=estimateIntensity(scan.grid,{...scan.center,atcf:item.storm,autoCenter:true,thermalHistory:scan.thermalHistory,environment:reportedEnvironment(track,scan.grid.timestamp)},bundle),shape=infraredMorphology(scan.grid,result.eye);if(!shape.features)throw Error(shape.reason);
    const time=Date.parse(scan.grid.timestamp);
    function label(key){const exact=track.find(r=>Date.parse(r.timestamp)===time);if(exact)return exact[key];const hi=track.findIndex(r=>Date.parse(r.timestamp)>time);if(hi<1)return null;const a=track[hi-1],b=track[hi],ta=Date.parse(a.timestamp),tb=Date.parse(b.timestamp);return tb-ta>21600000||![a[key],b[key]].every(v=>typeof v==='number'&&Number.isFinite(v))?null:a[key]+(b[key]-a[key])*(time-ta)/(tb-ta);}
    const windKt=label('windKt'),pressureMb=label('pressureMb');if(windKt===null||windKt<35||windKt>220)throw Error('No time-matched wind label.');
    const bytes=await fs.readFile(file);examples.push({...item,acquiredAt:scan.grid.timestamp,x:[...result.features,...shape.features],baseWind:result.windKt,basePressure:result.pressureMb,windKt,pressureMb:pressureMb>=800&&pressureMb<=1050?pressureMb:null,source:scan.source,sourceUrl:scan.sourceUrl,scanDigest:crypto.createHash('sha256').update(bytes).digest('hex')});
  }catch(error){if(/quota|transaction limit|data limit/i.test(error.message))throw error;failures.push({...item,error:error.message});}
  done++;if(done%10===0||done===protocol.plan.length)console.log(`${done}/${protocol.plan.length} images checked; ${examples.length} usable, ${failures.length} unavailable or rejected`);
}
for(let i=0;i<protocol.plan.length;i+=4){const results=await Promise.allSettled(protocol.plan.slice(i,i+4).map(collect));for(const r of results)if(r.status==='rejected')throw r.reason;await fs.writeFile(cache+'/native-vision-progress.json',JSON.stringify({schema:1,protocolDigest:protocol.digest,completed:done,total:protocol.plan.length,examples,failures}));}
const unique=[...new Map(examples.sort((a,b)=>a.storm.localeCompare(b.storm)||a.acquiredAt.localeCompare(b.acquiredAt)).map(r=>[r.storm+'|'+r.acquiredAt,r])).values()];
const output={schema:1,protocolDigest:protocol.digest,baseVersion:'SI-5',baseDigest:bundle.westernPacific.trainingDigest,completed:done,requested:protocol.plan.length,examples:unique,failures};
output.digest=crypto.createHash('sha256').update(JSON.stringify(output)).digest('hex');await fs.writeFile('intensity-data/native-vision-training.json',JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify({completed:done,usable:unique.length,rejected:failures.length,digest:output.digest}));
