// Reproducible, CPU-only first model. Reference labels are IBTrACS USA best
// track, NOT independently aircraft-verified surface winds. No image network
// is fabricated. A future ViT needs real training and independent evaluation.
import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseAdtHistory} from '../satellite-dvorak-model.js';
import {FEATURE_NAMES,intensityFeatures,trainingBaseline,evaluationMetrics} from '../satellite-intensity-model.js';
import {trainBoosted,scoreTree} from '../satellite-intensity-trees.js';
import {columnMap,numberValue,recordTime,peakRecords} from '../ibtracs-model.js';

const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'intensity-data'),cache=path.join(root,'.cache','intensity-training');
await fs.mkdir(out,{recursive:true});await fs.mkdir(cache,{recursive:true});
const manifest=JSON.parse(await fs.readFile(path.join(root,'ibtracs-data/index.json'),'utf8')),col=columnMap(manifest.columns);
const splits={train:[2013,2014,2015,2016,2018,2019,2020,2021,2022],validation:[2023],test:[2024]},dataset=[],availability=[];
for(const [split,years]of Object.entries(splits))for(const year of years){
  const snapshot=JSON.parse(zlib.gunzipSync(await fs.readFile(path.join(root,`ibtracs-data/${year}.json.gz`))));
  const candidates=manifest.storms.filter(s=>s.season===year&&s.atcf.some(a=>/^(AL|EP)\d{6}$/.test(a))).map(s=>({...s,records:snapshot.storms.find(t=>t.id===s.id)?.records||[]})).filter(s=>(peakRecords(s.records,col,'USA').wind?.value||0)>=65);
  for(let i=0;i<candidates.length;i+=4){await Promise.all(candidates.slice(i,i+4).map(async storm=>{
    const atcf=storm.atcf.find(a=>/^(AL|EP)\d{6}$/.test(a)),file=path.join(cache,atcf+'.txt'),source=`https://tropic.ssec.wisc.edu/real-time/adt/archive${year}/${atcf.slice(2,4)}${atcf.startsWith('AL')?'L':'E'}-list.txt`;
    let text;try{text=await fs.readFile(file,'utf8');}catch{try{const response=await fetch(source,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Source '+response.status);text=await response.text();if(text.length>3000000)throw Error('Archive too large');await fs.writeFile(file,text);}catch(error){availability.push({storm:atcf,status:'unavailable',reason:error.message});return;}}
    const labels=storm.records.map(r=>({at:Date.parse(recordTime(r,col)),windKt:numberValue(r,col,'USA_WIND'),pressureMb:numberValue(r,col,'USA_PRES')})).filter(r=>Number.isFinite(r.at)).sort((a,b)=>a.at-b.at);
    function labelAt(t,key){const exact=labels.find(r=>r.at===t);if(exact)return exact[key];const hi=labels.findIndex(r=>r.at>t);if(hi<1)return null;const a=labels[hi-1],b=labels[hi];if(b.at-a.at>21600000||a[key]===null||b[key]===null)return null;return a[key]+(b[key]-a[key])*(t-a.at)/(b.at-a.at);}
    const hours=new Set();let count=0;
    for(const r of parseAdtHistory(text)){
      if(r.scene!=='EYE'||r.eye===null||r.cloud===null||r.latitude===null||r.eye< -30||r.cloud> -50||r.cloud<=-100||r.eye-r.cloud<40)continue;
      // One frame per storm/hour prevents modern high-cadence archives dominating.
      const hour=r.timestamp.slice(0,13);if(hours.has(hour))continue;hours.add(hour);
      const time=Date.parse(r.timestamp),windKt=labelAt(time,'windKt'),pressureMb=labelAt(time,'pressureMb');if(windKt===null||windKt<35||windKt>220)continue;
      const features=intensityFeatures({...r,atcf}),baseline=trainingBaseline({eyeC:r.eye,cloudC:r.cloud,latitude:r.latitude,atcf});
      dataset.push({storm:atcf,name:storm.name,season:year,split,timestamp:r.timestamp,features,windKt,pressureMb:pressureMb>=800&&pressureMb<=1050?pressureMb:null,baselineWind:baseline.windKt,baselinePressure:baseline.pressureMb,pressurePrior:baseline.pressurePrior,source,adtVersion:r.version});count++;
    }
    availability.push({storm:atcf,status:count?'used':'no-eye-examples',frames:count});
  }));console.log(`${split} ${year}: ${Math.min(i+4,candidates.length)}/${candidates.length} storms; ${dataset.length} examples`);}
}
dataset.sort((a,b)=>a.storm.localeCompare(b.storm)||a.timestamp.localeCompare(b.timestamp));
const bundle={schema:1,version:'SI-1-tree',createdAt:new Date().toISOString(),featureNames:FEATURE_NAMES,domain:FEATURE_NAMES.map((_,i)=>[Math.min(...dataset.filter(r=>r.split==='train').map(r=>r.features[i])),Math.max(...dataset.filter(r=>r.split==='train').map(r=>r.features[i]))]),release:{},references:{features:'CIMSS ADT eye/mean-cloud measurements',labels:'NOAA IBTrACS USA 1-minute best-track wind and pressure; linearly interpolated within gaps ≤6 hours',sources:['https://tropic.ssec.wisc.edu/','https://www.ncei.noaa.gov/products/international-best-track-archive']},splits,trainingDigest:crypto.createHash('sha256').update(JSON.stringify(dataset)).digest('hex')};
const benchmark={version:bundle.version,createdAt:bundle.createdAt,datasetDigest:bundle.trainingDigest,reference:bundle.references,scope:'Regular eye scenes only; Atlantic and Eastern Pacific. Best-track benchmark, not an independent recon verification. Archive temperatures and local temperature sampling may differ.',splitYears:splits,availability,targets:{}};
for(const [target,key,baselineKey]of [['wind','windKt','baselineWind'],['pressure','pressureMb','baselinePressure']]){
  const rows=split=>dataset.filter(r=>r.split===split&&r[key]!==null).map(r=>({x:r.features,y:r[key],storm:r.storm})),train=rows('train'),validation=rows('validation'),test=rows('test');
  if(train.length<100||validation.length<30||test.length<30)throw Error('Insufficient independent seasons for '+target);
  let best=null;
  // Learn a correction to a published temperature/wind-pressure prior, rather
  // than restricting extreme predictions to the average of a few tree leaves.
  // These priors are empirical regressions, not a first-principles atmosphere.
  const training=dataset.filter(r=>r.split==='train'&&r[key]!==null).map(r=>({x:r.features,y:r[key]-(target==='wind'?r.baselineWind:r.pressurePrior),storm:r.storm}));
  for(const depth of [2,3])for(const trees of [30,60,100]){const model={...trainBoosted(training,{trees,depth}),residual:target},score=scoreTree(model,validation);if(!best||score.mae<best.score.mae)best={model,score};}
  bundle[target]=best.model;
  const baselineValidation=evaluationMetrics(dataset.filter(r=>r.split==='validation'),baselineKey,key),baselineTest=evaluationMetrics(dataset.filter(r=>r.split==='test'),baselineKey,key);
  // Freeze release on the validation year. Test scores never choose the model.
  bundle.release[target]=!!baselineValidation&&best.score.mae<baselineValidation.mae;
  const subsets={};
  for(const [name,filter]of [['Atlantic',r=>r.storm.startsWith('AL')],['Eastern Pacific',r=>r.storm.startsWith('EP')],['130ktAndAbove',r=>r.windKt>=130]]){const subset=dataset.filter(r=>r.split==='test'&&r[key]!==null&&filter(r));subsets[name]={...scoreTree(best.model,subset.map(r=>({x:r.features,y:r[key],storm:r.storm}))),storms:new Set(subset.map(r=>r.storm)).size};}
  benchmark.targets[target]={train:{frames:train.length,storms:new Set(train.map(r=>r.storm)).size},validation:{...best.score,storms:new Set(validation.map(r=>r.storm)).size,baseline:baselineValidation},test:{...scoreTree(best.model,test),storms:new Set(test.map(r=>r.storm)).size,baseline:baselineTest,subsets},trees:best.model.trees.length,released:bundle.release[target]};
}
await fs.writeFile(path.join(out,'tree-model.json'),JSON.stringify(bundle));await fs.writeFile(path.join(out,'benchmark.json'),JSON.stringify(benchmark,null,2));
await fs.writeFile(path.join(cache,'examples.jsonl'),dataset.map(r=>JSON.stringify(r)).join('\n')+'\n');
console.log(JSON.stringify(benchmark.targets,null,2));
