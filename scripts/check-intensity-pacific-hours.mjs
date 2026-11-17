import fs from 'node:fs/promises';import zlib from 'node:zlib';import {fileURLToPath}from 'node:url';
import {columnMap,peakRecords,recordTime}from '../ibtracs-model.js';
import {estimateIntensity,INTENSITY_VERSION}from '../satellite-intensity-model.js';
import {parseAdtHistory}from '../satellite-dvorak-model.js';import {causalThermalHistory}from '../satellite-intensity-structure.js';
import {hourlyScanTimes,summarizeHourlyPeaks,ownerPeakReference,compareOwnerPeak,edgeExpansionTimes}from '../satellite-intensity-peak.js';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const network=fetch,cache='.cache/intensity-training',native=cache+'/hourly';await fs.mkdir(native,{recursive:true});
globalThis.fetch=async(input,init)=>{const url=new URL(input,'https://tornadodatabase.vercel.app');
  if(url.pathname==='/api/satellite-dvorak'&&url.searchParams.get('view')==='thermal'){try{return Response.json({thermalHistory:causalThermalHistory(parseAdtHistory(await fs.readFile(cache+'/'+url.searchParams.get('atcf')+'.txt','utf8')),url.searchParams.get('time'))});}catch{}}
  if(url.pathname.startsWith('/ibtracs-data/'))return new Response(await fs.readFile('.'+url.pathname));return network(url,init);
};
const {loadHistoricScan,stormRecords,reportedEnvironment}=await import('../satellite-intensity-data.js');
const manifest=JSON.parse(await fs.readFile('ibtracs-data/index.json')),col=columnMap(manifest.columns),bundle=JSON.parse(await fs.readFile('intensity-data/tree-model.json'));bundle.westernPacific=JSON.parse(await fs.readFile('intensity-data/pacific-tree-model.json'));
if(bundle.westernPacific.splits.train.includes(2016)||bundle.westernPacific.splits.validation.includes(2016)||bundle.westernPacific.splits.calibration.includes(2016))throw Error('Diagnostic season leaked into fitting.');
const source=await fs.readFile('supabase.js','utf8'),base=source.match(/const supabaseUrl = "([^"]+)"/)[1],key=source.match(/const supabaseKey = "([^"]+)"/)[1],u=new URL('/rest/v1/tropical_cyclones',base);u.search=new URLSearchParams({select:'id,status,name,year,owner_estimated_winds_mph,owner_estimated_pressure_mb',status:'eq.approved',year:'eq.2016',limit:'500'});const ownerResponse=await network(u,{headers:{apikey:key,Authorization:'Bearer '+key}});const ownerRows=ownerResponse.ok?await ownerResponse.json():[];
const report={version:INTENSITY_VERSION,trainingDigest:bundle.westernPacific.trainingDigest,referenceKind:'Your saved lifetime peak estimates, comparisons only',scope:'2016 is entirely excluded from fitting, calibration and model selection. Two user-reported diagnostic cases are not the primary independent 2024 benchmark. Every available requested hour is checked; source acquisition times and missing scenes are retained.',cases:[]};
for(const atcf of ['WP162016','WP022016']){
  const storm=manifest.storms.find(s=>s.atcf.includes(atcf)),snapshot=JSON.parse(zlib.gunzipSync(await fs.readFile(`ibtracs-data/${storm.season}.json.gz`))),raw=snapshot.storms.find(s=>s.id===storm.id).records,peak=peakRecords(raw,col,'USA').wind,records=await stormRecords(storm,manifest),reference=ownerPeakReference(ownerRows,storm),results=[];
  const limits={start:recordTime(raw[0],col),end:recordTime(raw.at(-1),col)},times=hourlyScanTimes(peak.time,{hours:12,...limits});
  console.log(atcf+' reported-peak anchor '+peak.time);
  for(let i=0;i<times.length;i++){
    const requestedAt=times[i],file=native+'/'+atcf+'-'+requestedAt.replace(/[^0-9]/g,'').slice(0,12)+'.json.gz';
    try{let scan;try{scan=JSON.parse(zlib.gunzipSync(await fs.readFile(file)));}catch{scan=await loadHistoricScan(storm,requestedAt);await fs.writeFile(file,zlib.gzipSync(JSON.stringify(scan,(_,v)=>ArrayBuffer.isView(v)?Array.from(v):v),{level:9}));}
      for(const k of ['temperature','latitude','longitude'])if(!Array.isArray(scan.grid[k])&&!ArrayBuffer.isView(scan.grid[k]))scan.grid[k]=Float32Array.from(Object.values(scan.grid[k]));
      const thermalHistory=scan.thermalHistory||causalThermalHistory(parseAdtHistory(await fs.readFile(cache+'/'+atcf+'.txt','utf8')),scan.grid.timestamp),e=reportedEnvironment(records,scan.grid.timestamp),analysis=estimateIntensity(scan.grid,{...scan.center,atcf,autoCenter:true,environment:e,thermalHistory},bundle);
      results.push({requestedAt,acquiredAt:scan.grid.timestamp,windKt:analysis.windKt,pressureMb:analysis.pressureMb,method:analysis.windMethod,treeReason:analysis.treeReason,baselineWind:analysis.members.baselineWind,baselinePressure:analysis.members.physicsPressure??analysis.members.baselinePressure,features:analysis.features});
      console.log(`${atcf} ${i+1}/${times.length} ${scan.grid.timestamp}: ${analysis.windKt.toFixed(1)} kt / ${analysis.pressureMb?.toFixed(1)} mb`);
    }catch(error){if(/quota|transaction limit|data limit/i.test(error.message))throw error;results.push({requestedAt,error:error.message});console.log(atcf+' '+requestedAt+': '+error.message);}
    if(i===times.length-1)times.push(...edgeExpansionTimes(summarizeHourlyPeaks(results),peak.time,times,limits));
  }
  const summary=summarizeHourlyPeaks(results);report.cases.push({name:storm.name,sid:storm.id,atcf,anchor:peak.time,reference,results,summary,comparison:compareOwnerPeak(summary,reference)});
  await fs.writeFile('intensity-data/pacific-hourly-checks.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({storm:atcf,requested:results.length,accepted:summary.distinct,windPeak:summary.windPeak,pressurePeak:summary.pressurePeak,comparison:compareOwnerPeak(summary,reference)}));
}
