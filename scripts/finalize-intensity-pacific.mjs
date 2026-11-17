import fs from 'node:fs/promises';import zlib from 'node:zlib';import {fileURLToPath}from 'node:url';
import {columnMap,position,numberValue,recordTime}from '../ibtracs-model.js';
import {sixHourTrackMotion,nearestObservation,evaluationMetrics,predictBoosted,treeEligibility}from '../satellite-intensity-model.js';
import {pressureFromWind}from '../wind-pressure-model.js';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const cache='.cache/intensity-training',data=(await fs.readFile(cache+'/examples-pacific.jsonl','utf8')).trim().split('\n').map(JSON.parse),source=JSON.parse(await fs.readFile(cache+'/pacific-availability.json')),manifest=JSON.parse(await fs.readFile('ibtracs-data/index.json')),col=columnMap(manifest.columns),snapshots=new Map(),tracks=new Map(),bundle=JSON.parse(await fs.readFile('intensity-data/pacific-tree-model.json')),report=JSON.parse(await fs.readFile('intensity-data/pacific-benchmark.json'));
for(const r of data){
  if(!tracks.has(r.storm)){const s=manifest.storms.find(s=>s.atcf.includes(r.storm));if(!snapshots.has(s.season))snapshots.set(s.season,JSON.parse(zlib.gunzipSync(await fs.readFile(`ibtracs-data/${s.season}.json.gz`))));tracks.set(r.storm,snapshots.get(s.season).storms.find(t=>t.id===s.id).records.map(row=>{const p=position(row,col,'USA');return {timestamp:recordTime(row,col),latitude:p?.lat,longitude:p?.lon,pociMb:numberValue(row,col,'USA_POCI'),rociNmi:numberValue(row,col,'USA_ROCI')};}));}
  const track=tracks.get(r.storm),near=nearestObservation(track,r.timestamp),e={pociMb:near?.pociMb,rociNmi:near?.rociNmi,motionKt:sixHourTrackMotion(track.filter(p=>[p.latitude,p.longitude].every(Number.isFinite)),r.timestamp)};
  const ckz=wind=>{if(![e.pociMb,e.rociNmi,e.motionKt].every(v=>typeof v==='number'&&Number.isFinite(v)))return null;try{return pressureFromWind(wind,{method:'ckz-published',latitude:r.features[2],environmentMb:e.pociMb,radiusType:'roci',radiusNmi:e.rociNmi,motionKnots:e.motionKt}).pressureMb;}catch{return null;}};
  const eligible=!treeEligibility(bundle,r.features),wind=eligible?predictBoosted(bundle.wind,r.features):null,pressure=eligible?predictBoosted(bundle.pressure,r.features):null;
  r.newWind=eligible&&bundle.release.wind&&wind>=25&&wind<=220?wind:r.baselineWind;
  r.newTreePressure=eligible&&pressure>=800&&pressure<=1050?pressure:null;r.newCkz=ckz(r.newWind);r.oldPressure=ckz(r.baselineWind)??r.baselinePressure;r.eligible=eligible;
}
function score(rows,predicted,observed){return {...evaluationMetrics(rows,predicted,observed),storms:new Set(rows.filter(r=>typeof r[predicted]==='number'&&typeof r[observed]==='number').map(r=>r.storm)).size};}
function pressure(row,weight,allowTree=true){return row.newTreePressure!==null&&allowTree?row.newCkz!==null?weight*row.newTreePressure+(1-weight)*row.newCkz:row.newTreePressure:row.newCkz??row.baselinePressure;}
const validation=data.filter(r=>r.split==='validation'),trials=[0,.25,.5,.75,1].map(treeShare=>{const rows=validation.map(r=>({...r,predicted:pressure(r,treeShare)})),all=score(rows,'predicted','pressureMb'),strong=score(rows.filter(r=>r.windKt>=130),'predicted','pressureMb');return {treeShare,validation:all,strong,objective:all.mae+.35*strong.mae};});
const selected=[...trials].sort((a,b)=>a.objective-b.objective)[0];bundle.pressureBlend={treeShare:selected.treeShare,selectionSeason:2023,selection:'2023 full-pipeline MAE + 0.35 * MAE at reference wind >=130kt',trials};
const oldValidation=score(validation,'oldPressure','pressureMb');bundle.release.pressure=selected.validation.mae<oldValidation.mae;
bundle.releaseValidation={season:2023,pressureModelMae:selected.validation.mae,oldWebsitePressureMae:oldValidation.mae,pressureReleased:bundle.release.pressure};report.releaseValidation=bundle.releaseValidation;
bundle.splits=source.splits;bundle.trainingDigest=source.digest;report.datasetDigest=source.digest;report.splitYears=source.splits;report.availability=source.availability;report.pressureBlend=bundle.pressureBlend;
report.scope='Western Pacific regular-eye infrared estimator. Models fitted on 2013–2015 and 2017–2021, bias candidates on 2022, selection on 2023. 2016 diagnostic holdout. 2024 was inspected while diagnosing the pressure baseline, so 2025 is the untouched final external evaluation. Best track is not independent recon ground truth.';
report.pipelineBaselines={old:'Same image Raw-T wind, then published CKZ if reported outer structure exists, otherwise the Dvorak pressure table.',tableOnly:'Pressure-table errors remain in targets for transparency; they are not the old website pipeline.',externalEvaluation:'2025 labels were not used for training, calibration, member selection, blend selection or release decisions.'};
report.pipeline={};
// Final external season is not inspected until the validation choice is frozen.
for(const split of ['validation','test','development','external']){
  const rows=data.filter(r=>r.split===split).map(r=>({...r,newPressure:pressure(r,selected.treeShare,bundle.release.pressure)}));
  report.pipeline[split]={wind:{model:score(rows,'newWind','windKt'),old:score(rows,'baselineWind','windKt')},pressure:{model:score(rows,'newPressure','pressureMb'),old:score(rows,'oldPressure','pressureMb')},fallbackFrames:rows.filter(r=>!r.eligible).length,strong:{wind:score(rows.filter(r=>r.windKt>=130),'newWind','windKt'),pressure:score(rows.filter(r=>r.windKt>=130),'newPressure','pressureMb')}};
}
await fs.writeFile('intensity-data/pacific-tree-model.json',JSON.stringify(bundle));await fs.writeFile('intensity-data/pacific-benchmark.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({selected,pipeline:report.pipeline},null,2));
