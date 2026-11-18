// Offline comparison: fixed cached native scans, no new satellite requests.
// Candidates and selection years are declared before their scores are read.
import fs from 'node:fs/promises';import zlib from 'node:zlib';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
import {estimateIntensityLegacy as estimateIntensity,estimateIntensity as currentIntensity,evaluationMetrics} from '../satellite-intensity-model.js';
import {ciToWind} from '../wind-pressure-model.js';
import {fitNativeRidge} from '../satellite-intensity-ridge.js';
import {ridgeValue} from '../satellite-intensity-vision.js';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
globalThis.fetch=async url=>{const path=String(url).replace(/^https?:\/\/[^/]+\//,'').replace(/^\//,'');if(!/^ibtracs-data\/\d{4}\.json.gz$/.test(path))throw Error('Offline evaluation forbids network reads.');return new Response(await fs.readFile(path));};
const {stormRecords,reportedEnvironment}=await import('../satellite-intensity-data.js');
const input=JSON.parse(await fs.readFile('intensity-data/native-vision-training.json')),manifest=JSON.parse(await fs.readFile('ibtracs-data/index.json')),base=JSON.parse(await fs.readFile('intensity-data/tree-model.json')),wp=JSON.parse(await fs.readFile('intensity-data/pacific-tree-model.json')),bundle={...base,westernPacific:wp},tracks=new Map(),rows=[],failures=[];
const prior=rawT=>1015.8-(ciToWind(rawT)/8.354)**(1/.6143);
for(const item of input.examples){
 try{
  const file='.cache/intensity-training/hourly/'+item.storm+'-'+item.requestedAt.replace(/[^0-9]/g,'').slice(0,12)+'.json.gz',scan=JSON.parse(zlib.gunzipSync(await fs.readFile(file)));
  for(const k of ['temperature','latitude','longitude'])if(!Array.isArray(scan.grid[k])&&!ArrayBuffer.isView(scan.grid[k]))scan.grid[k]=Object.values(scan.grid[k]);
  if(!tracks.has(item.storm))tracks.set(item.storm,await stormRecords(manifest.storms.find(s=>s.atcf.includes(item.storm)),manifest));
  const environment=reportedEnvironment(tracks.get(item.storm),scan.grid.timestamp),options={...scan.center,atcf:item.storm,autoCenter:true,thermalHistory:scan.thermalHistory,environment};
  const legacy=estimateIntensity(scan.grid,options,bundle),modern=estimateIntensity(scan.grid,{...options,version:'9.1'},bundle),current=currentIntensity(scan.grid,options,bundle);
  const wind=legacy.members.treeWind===null?modern.windKt:legacy.windKt+modern.members.baselineWind-legacy.members.baselineWind;
  const pressure=legacy.members.treePressure===null?modern.pressureMb:legacy.pressureMb+prior(modern.eye.rawT)-prior(legacy.eye.rawT);
  rows.push({storm:item.storm,season:item.season,split:item.split,at:scan.grid.timestamp,windKt:item.windKt,pressureMb:item.pressureMb,legacyWind:legacy.windKt,legacyPressure:legacy.pressureMb,modernWind:modern.windKt,modernPressure:modern.pressureMb,bridgeWind:wind,bridgePressure:pressure,currentWind:current.windKt,currentPressure:current.pressureMb,legacyT:legacy.eye.rawT,modernT:modern.eye.rawT,x:[legacy.windKt,legacy.pressureMb,legacy.eye.rawT,modern.eye.rawT,modern.eye.eye,modern.eye.cloud,modern.eye.symmetry,...(modern.morphology.features||[])]});
 }catch(error){failures.push({storm:item.storm,at:item.requestedAt,error:error.message});}
 if((rows.length+failures.length)%20===0)console.log(`${rows.length+failures.length}/${input.examples.length} native scans compared`);
}
function score(used,pred,key){const m=evaluationMetrics(used,pred,key);if(!m)return null;const groups=[...new Set(used.map(r=>r.storm))].map(storm=>evaluationMetrics(used.filter(r=>r.storm===storm),pred,key)).filter(Boolean);return {...m,storms:groups.length,stormMae:groups.reduce((s,g)=>s+g.mae,0)/groups.length};}
const summary={};for(const split of ['train','validation','fresh']){const group=rows.filter(r=>r.split===split);summary[split]={};for(const candidate of ['legacy','modern','bridge','current'])summary[split][candidate]={wind:score(group,candidate+'Wind','windKt'),pressure:score(group,candidate+'Pressure','pressureMb')};}
const report={schema:1,scope:'Retrospective native-scan comparison only; 2020 candidate selection and 2012 regression check have been inspected during previous development and are not a fresh independent accuracy claim.',candidates:['legacy','modern','bridge'],selection:{season:2020,checkSeason:2012,criterion:'MAE and storm-balanced MAE must decrease, RMSE must not increase in both the selection and regression-check years. Otherwise retain the previous trained head.'},summary,failures,rows};
const fitting=rows.filter(r=>r.split==='train'),selection=rows.filter(r=>r.split==='validation'),check=rows.filter(r=>r.split==='fresh'),correction={};
for(const [target,label,baseKey] of [['wind','windKt','legacyWind'],['pressure','pressureMb','legacyPressure']]){
  const trials=[1,10,100].map(lambda=>{
    const model=fitNativeRidge(fitting.map(r=>({storm:r.storm,x:r.x,y:r[label]-r[baseKey]})),lambda);
    const predictions=selection.map(r=>({...r,prediction:r[baseKey]+ridgeValue(model,r.x)}));
    return {lambda,model,validation:score(predictions,'prediction',label)};
  }).sort((a,b)=>a.validation.mae-b.validation.mae);
  const chosen=trials[0],predictions=check.map(r=>({...r,prediction:r[baseKey]+ridgeValue(chosen.model,r.x)})),review=score(predictions,'prediction',label),baseline=summary.validation.legacy[target],checkBaseline=summary.fresh.legacy[target];
  const improves=(a,b)=>a.mae<b.mae&&a.stormMae<b.stormMae&&a.rmse<=b.rmse;
  correction[target]={lambda:chosen.lambda,validation:chosen.validation,check:review,eligible:improves(chosen.validation,baseline)&&improves(review,checkBaseline),trials:trials.map(({lambda,validation})=>({lambda,validation}))};
}
report.correction=correction;
await fs.writeFile('.cache/intensity-training/adt91-transition-evaluation.json',JSON.stringify(report,null,2)+'\n');
const maximumChange={wind:Math.max(...rows.map(r=>Math.abs(r.currentWind-r.legacyWind))),pressure:Math.max(...rows.map(r=>Math.abs(r.currentPressure-r.legacyPressure)))};
const published={schema:1,version:'SI-7-ADT91-review',scope:report.scope,datasetDigest:input.digest,backboneDigests:{base:base.trainingDigest,westernPacific:wp.trainingDigest},sample:{requested:input.examples.length,accepted:rows.length,storms:new Set(rows.map(r=>r.storm)).size,failures},selection:report.selection,summary,correction,release:{wind:false,pressure:false},decision:'Use ADT 9.1 for the independently labeled baseline and unsupported trained basins/scenes. Keep the frozen fitted feature definition and released head weights. No direct substitution, prior-difference bridge or fitted ridge correction is enabled.',maximumTrainedPredictionChange:maximumChange,replayDigest:crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex'),references:['https://tropic.ssec.wisc.edu/misc/adt/guides/ADTV9.1_Guide.pdf','https://www.ncei.noaa.gov/products/international-best-track-archive']};
if(maximumChange.wind>1e-9||maximumChange.pressure>1e-9)throw Error('The fitted prediction changed during the ADT baseline transition.');
if(Object.values(correction).some(r=>r.eligible))throw Error('An eligible candidate needs a separately reviewed release; do not silently enable it.');
await fs.writeFile('intensity-data/adt91-transition-benchmark.json',JSON.stringify(published,null,2)+'\n');
console.log(JSON.stringify({accepted:rows.length,failures:failures.length,maximumChange,correction},null,2));
