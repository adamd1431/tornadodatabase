import fs from 'node:fs/promises';import zlib from 'node:zlib';import path from 'node:path';import {fileURLToPath}from 'node:url';
import {columnMap,peakRecords,recordTime}from '../ibtracs-model.js';
import {estimateIntensity,INTENSITY_VERSION}from '../satellite-intensity-model.js';
import {parseAdtHistory}from '../satellite-dvorak-model.js';
import {causalThermalHistory}from '../satellite-intensity-structure.js';
import {ownerPeakReference,hourlyScanTimes,summarizeHourlyPeaks,compareOwnerPeak}from '../satellite-intensity-peak.js';
const root=fileURLToPath(new URL('..',import.meta.url));process.chdir(root);
const cache=path.join(root,'.cache/intensity-training'),native=path.join(cache,'hourly');await fs.mkdir(native,{recursive:true});
const network=globalThis.fetch;
// Public source archive snapshots are reused; no intensity labels enter context.
globalThis.fetch=async(input,init)=>{const url=new URL(input,'https://tornadodatabase.vercel.app/');if(url.pathname==='/api/satellite-dvorak'&&url.searchParams.get('view')==='thermal'){try{const text=await fs.readFile(path.join(cache,url.searchParams.get('atcf')+'.txt'),'utf8'),thermalHistory=causalThermalHistory(parseAdtHistory(text),url.searchParams.get('time'));return Response.json({thermalHistory});}catch{}}
 return network(url,init);};
const {loadHistoricScan,stormRecords,reportedEnvironment}=await import('../satellite-intensity-data.js');
const manifest=JSON.parse(await fs.readFile('ibtracs-data/index.json','utf8')),col=columnMap(manifest.columns),bundle=JSON.parse(await fs.readFile('intensity-data/tree-model.json','utf8'));
let ownerRows;
if(process.argv.includes('--fetch')){const source=await fs.readFile('supabase.js','utf8'),base=source.match(/const supabaseUrl = "([^"]+)"/)[1],key=source.match(/const supabaseKey = "([^"]+)"/)[1],u=new URL('/rest/v1/tropical_cyclones',base);u.search=new URLSearchParams({select:'id,status,name,year,owner_estimated_winds_mph,owner_estimated_pressure_mb',status:'eq.approved',year:'in.(2015,2025)',limit:'500'});const r=await network(u,{headers:{apikey:key,Authorization:'Bearer '+key}});if(!r.ok)throw Error('Public owner estimates unavailable: '+r.status);ownerRows=await r.json();await fs.writeFile(path.join(cache,'owner-references.json'),JSON.stringify({fetchedAt:new Date().toISOString(),rows:ownerRows}));}
else ownerRows=JSON.parse(await fs.readFile(path.join(cache,'owner-references.json'),'utf8')).rows;
const cases=[];
for(const atcf of ['EP202015','AL082025','AL132025']){
 const storm=manifest.storms.find(s=>s.atcf.includes(atcf)),snapshot=JSON.parse(zlib.gunzipSync(await fs.readFile(`ibtracs-data/${storm.season}.json.gz`))),raw=snapshot.storms.find(s=>s.id===storm.id).records,peak=peakRecords(raw,col,'USA').wind,reference=ownerPeakReference(ownerRows,storm),records=await stormRecords(storm,manifest),results=[];
 const times=hourlyScanTimes(peak.time,{hours:12,start:recordTime(raw[0],col),end:recordTime(raw.at(-1),col)});
 for(const requestedAt of times){const file=path.join(native,atcf+'-'+requestedAt.replace(/[^0-9]/g,'').slice(0,12)+'.json.gz');let scan;
  try{try{scan=JSON.parse(zlib.gunzipSync(await fs.readFile(file)));}catch{if(!process.argv.includes('--fetch'))throw Error('Scan not cached');const anchor=path.join(cache,'native',atcf+'-peak.json.gz');if(Date.parse(requestedAt)===Date.parse(peak.time))scan=JSON.parse(zlib.gunzipSync(await fs.readFile(anchor)));else scan=await loadHistoricScan(storm,requestedAt);await fs.writeFile(file,zlib.gzipSync(JSON.stringify(scan,(_,v)=>ArrayBuffer.isView(v)?Array.from(v):v),{level:9}));}
   // Earlier local caches serialized typed arrays as numeric-keyed objects.
   for(const key of ['temperature','latitude','longitude'])if(!Array.isArray(scan.grid[key])&&!ArrayBuffer.isView(scan.grid[key]))scan.grid[key]=Float32Array.from(Object.values(scan.grid[key]));
   const analysis=estimateIntensity(scan.grid,{...scan.center,atcf,autoCenter:true,thermalHistory:scan.thermalHistory||causalThermalHistory(parseAdtHistory(await fs.readFile(path.join(cache,atcf+'.txt'),'utf8')),scan.grid.timestamp),environment:reportedEnvironment(records,scan.grid.timestamp)},bundle);
   const r={requestedAt,acquiredAt:scan.grid.timestamp,windKt:analysis.windKt,pressureMb:analysis.pressureMb,method:analysis.windMethod,features:analysis.features,eye:analysis.eye,structure:analysis.structure};results.push(r);console.log(`${atcf} ${r.acquiredAt}: ${r.windKt.toFixed(1)} kt / ${r.pressureMb.toFixed(1)} mb`);
  }catch(error){if(/quota|transaction limit|data limit/i.test(error.message))throw error;results.push({requestedAt,error:error.message});console.log(atcf+' '+requestedAt+': '+error.message);}
 }
 const summary=summarizeHourlyPeaks(results);cases.push({name:storm.name,atcf,sid:storm.id,anchor:peak.time,windowHours:12,reference,results,summary,comparison:compareOwnerPeak(summary,reference)});
 await fs.writeFile(path.join(cache,'hourly-checks.json'),JSON.stringify({version:INTENSITY_VERSION+'-hourly',trainingDigest:bundle.trainingDigest,generatedAt:new Date().toISOString(),ownerReferenceFetchedAt:JSON.parse(await fs.readFile(path.join(cache,'owner-references.json'),'utf8')).fetchedAt,referenceKind:'Your saved website peak estimates',scope:'Three development/training cases; selected maxima are not independent accuracy validation.',cases},null,2));
 console.log(JSON.stringify({name:storm.name,reference,peak:summary.windPeak&&{at:summary.windPeak.acquiredAt,wind:summary.windPeak.windKt,pressure:summary.windPeak.pressureMb},minimum:summary.pressurePeak&&{at:summary.pressurePeak.acquiredAt,pressure:summary.pressurePeak.pressureMb},edge:summary.edgePeak}));
}

if(process.argv.includes('--publish')){
 const report=JSON.parse(await fs.readFile(path.join(cache,'hourly-checks.json'),'utf8'));
 try{const previous=JSON.parse(await fs.readFile(path.join(cache,'si2-hourly.json'),'utf8'));for(const c of report.cases){const p=previous.cases.find(r=>r.atcf===c.atcf);if(p?.summary?.windPeak&&p.summary.pressurePeak)c.previous={version:'SI-2',windPeakAt:p.summary.windPeak.acquiredAt,windKt:p.summary.windPeak.windKt,pressurePeakAt:p.summary.pressurePeak.acquiredAt,pressureMb:p.summary.pressurePeak.pressureMb};}}catch{}
 await fs.writeFile(path.join(root,'intensity-data/hourly-checks.json'),JSON.stringify(report,null,2)+'\n');
}
