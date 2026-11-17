import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseAdtHistory} from '../satellite-dvorak-model.js';
import {causalThermalHistory} from '../satellite-intensity-structure.js';
import {FEATURE_NAMES,intensityFeatures,trainingBaseline,evaluationMetrics,predictBoosted} from '../satellite-intensity-model.js';
import {trainBoosted,scoreTree} from '../satellite-intensity-trees.js';
import {columnMap,numberValue,recordTime,peakRecords} from '../ibtracs-model.js';

const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'intensity-data'),cache=path.join(root,'.cache/intensity-training');
await fs.mkdir(out,{recursive:true});await fs.mkdir(cache,{recursive:true});
const manifest=JSON.parse(await fs.readFile(path.join(root,'ibtracs-data/index.json'),'utf8')),col=columnMap(manifest.columns);
const splits={train:[2013,2014,2015,2016,2017,2018,2019,2020,2021,2025],calibration:[2022],validation:[2023],test:[2024]},dataset=[],availability=[];
// All completed available seasons may train the current estimator. 2024 remains
// a whole-season retrospective test; this is not a chronological hindcast.
// Reported problem storms are development cases, not independent test scores.
const excludedStorms=[];
for(const [split,years]of Object.entries(splits))for(const year of years){
  const snapshot=JSON.parse(zlib.gunzipSync(await fs.readFile(path.join(root,`ibtracs-data/${year}.json.gz`))));
  const candidates=manifest.storms.filter(s=>s.season===year&&!excludedStorms.some(a=>s.atcf.includes(a))&&s.atcf.some(a=>/^(AL|EP)\d{6}$/.test(a))).map(s=>({...s,records:snapshot.storms.find(t=>t.id===s.id)?.records||[]})).filter(s=>(peakRecords(s.records,col,'USA').wind?.value||0)>=65);
  for(let i=0;i<candidates.length;i+=4){await Promise.all(candidates.slice(i,i+4).map(async storm=>{
    const atcf=storm.atcf.find(a=>/^(AL|EP)\d{6}$/.test(a)),file=path.join(cache,atcf+'.txt'),source=`https://tropic.ssec.wisc.edu/real-time/adt/archive${year}/${atcf.slice(2,4)}${atcf.startsWith('AL')?'L':'E'}-list.txt`;
    let text;try{text=await fs.readFile(file,'utf8');}catch{try{const response=await fetch(source,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Source '+response.status);text=await response.text();if(text.length>3000000)throw Error('Archive too large');await fs.writeFile(file,text);}catch(error){availability.push({storm:atcf,status:'unavailable',reason:error.message});return;}}
    const labels=storm.records.map(r=>({at:Date.parse(recordTime(r,col)),windKt:numberValue(r,col,'USA_WIND'),pressureMb:numberValue(r,col,'USA_PRES')})).filter(r=>Number.isFinite(r.at)).sort((a,b)=>a.at-b.at);
    function labelAt(t,key){const exact=labels.find(r=>r.at===t);if(exact)return exact[key];const hi=labels.findIndex(r=>r.at>t);if(hi<1)return null;const a=labels[hi-1],b=labels[hi];if(b.at-a.at>21600000||a[key]===null||b[key]===null)return null;return a[key]+(b[key]-a[key])*(t-a.at)/(b.at-a.at);}
    const hours=new Set(),thermalRows=parseAdtHistory(text);let count=0;
    for(const r of thermalRows){
      if(r.scene!=='EYE'||r.eye===null||r.cloud===null||r.latitude===null||r.eye< -30||r.cloud> -50||r.cloud<=-100||r.eye-r.cloud<40)continue;
      const hour=r.timestamp.slice(0,13);if(hours.has(hour))continue;hours.add(hour);
      const time=Date.parse(r.timestamp),windKt=labelAt(time,'windKt'),pressureMb=labelAt(time,'pressureMb');if(windKt===null||windKt<35||windKt>220)continue;
      const history=causalThermalHistory(thermalRows,r.timestamp),features=intensityFeatures({...r,atcf,thermalHistory:history}),baseline=trainingBaseline({eyeC:r.eye,cloudC:r.cloud,latitude:r.latitude,atcf,rawT:r.rawT});
      dataset.push({storm:atcf,name:storm.name,season:year,split,timestamp:r.timestamp,features,windKt,pressureMb:pressureMb>=800&&pressureMb<=1050?pressureMb:null,baselineWind:baseline.windKt,baselinePressure:baseline.pressureMb,pressurePrior:baseline.pressurePrior,source,adtVersion:r.version});count++;
    }
    availability.push({storm:atcf,status:count?'used':'no-eye-examples',frames:count});
  }));}console.log(`${split} ${year}: ${dataset.length} examples so far`);
}
dataset.sort((a,b)=>a.storm.localeCompare(b.storm)||a.timestamp.localeCompare(b.timestamp));
const training=dataset.filter(r=>r.split==='train'),bundle={schema:2,version:'SI-2-tree',createdAt:new Date().toISOString(),featureNames:FEATURE_NAMES,domain:FEATURE_NAMES.map((_,i)=>[Math.min(...training.map(r=>r.features[i])),Math.max(...training.map(r=>r.features[i]))]),release:{},references:{features:'CIMSS IR temperatures, Raw T (not Final T/CI), IR structural radius and strictly causal six-hour IR history',labels:'IBTrACS USA 1-minute best-track wind/pressure; interpolation across gaps ≤6 h',sources:['https://tropic.ssec.wisc.edu/','https://www.ncei.noaa.gov/products/international-best-track-archive']},splits,excludedStorms,trainingDigest:crypto.createHash('sha256').update(JSON.stringify(dataset)).digest('hex')};
const benchmark={version:bundle.version,createdAt:bundle.createdAt,datasetDigest:bundle.trainingDigest,reference:bundle.references,scope:'Regular-eye Atlantic/Eastern Pacific archive-measurement benchmark, not independent recon verification. Native sampling differences remain.',splitYears:splits,excludedStorms,availability,targets:{}};
function subsetScore(model,rows,key){const used=rows.filter(r=>r[key]!==null);return {...scoreTree(model,used.map(r=>({x:r.features,y:r[key],storm:r.storm}))),storms:new Set(used.map(r=>r.storm)).size};}
function objective(model,rows,key){const all=subsetScore(model,rows,key),strong=subsetScore(model,rows.filter(r=>r.windKt>=130),key);return all.mae+.35*(strong.mae||all.mae);}
function calibratedBias(model,rows,key){const byStorm=new Map();for(const r of rows.filter(r=>r[key]!==null)){const list=byStorm.get(r.storm)||[];list.push(r[key]-predictBoosted(model,r.features));byStorm.set(r.storm,list);}return [...byStorm.values()].reduce((s,r)=>s+r.reduce((a,b)=>a+b,0)/r.length,0)/byStorm.size;}
for(const [target,key,baselineKey]of [['wind','windKt','baselineWind'],['pressure','pressureMb','baselinePressure']]){
  const validation=dataset.filter(r=>r.split==='validation'),calibration=dataset.filter(r=>r.split==='calibration'),test=dataset.filter(r=>r.split==='test'),trials=[];let best=null;
  for(const [depth,minLeaf]of [[3,12],[4,8]])for(const strongWeight of [1,2])for(const geometry of [true]){
    const rows=training.filter(r=>r[key]!==null).flatMap(r=>{
      const x=[...r.features];if(!geometry){x[6]=0;x[7]=0;}
      const row={x,y:r[key]-(target==='wind'?r.baselineWind:r.pressurePrior),storm:r.storm,weight:r.windKt>=130?strongWeight:1};
      // Explicit missing-context examples make history outages usable, without
      // silently replacing the estimator with a different intensity method.
      if(!x[11])return [row];const missing=[...x];missing.fill(0,8);return [row,{...row,x:missing}];
    });
    const fitted=trainBoosted(rows,{trees:300,depth,minLeaf});
    for(const treeCount of [100,200,300])for(const scale of [.5,1])for(const useBias of [false,true]){
      const model={...fitted,trees:fitted.trees.slice(0,treeCount),residual:target,correctionScale:scale,geometry};
      if(useBias)model.offset=calibratedBias(model,calibration,key);
      const score=objective(model,validation,key),result={depth,minLeaf,trees:treeCount,strongWeight,geometry,scale,bias:model.offset||0,validation:subsetScore(model,validation,key),objective:score};trials.push(result);
      if(!best||score<best.score)best={model,score,result};
    }
    console.log(`${target}: depth ${depth}, weight ${strongWeight}, geometry ${geometry}; best validation objective ${best.score.toFixed(3)}`);
  }
  bundle[target]=best.model;
  const baselineValidation=evaluationMetrics(validation,baselineKey,key),baselineTest=evaluationMetrics(test,baselineKey,key);
  bundle.release[target]=best.result.validation.mae<baselineValidation.mae;
  const subsets={};for(const [name,filter]of [['Atlantic',r=>r.storm.startsWith('AL')],['Eastern Pacific',r=>r.storm.startsWith('EP')],['130ktAndAbove',r=>r.windKt>=130]])subsets[name]=subsetScore(best.model,test.filter(filter),key);
  benchmark.targets[target]={train:{frames:training.length,storms:new Set(training.map(r=>r.storm)).size},calibration:subsetScore(best.model,calibration,key),validation:{...best.result.validation,baseline:baselineValidation},test:{...subsetScore(best.model,test,key),baseline:baselineTest,subsets},trees:best.model.trees.length,released:bundle.release[target],selected:best.result,selection:'2023 MAE + 0.35 × MAE for reference winds ≥130 kt; optional bias fit on 2022 only',trials};
}
await fs.writeFile(path.join(out,'tree-model.json'),JSON.stringify(bundle));await fs.writeFile(path.join(out,'benchmark.json'),JSON.stringify(benchmark,null,2));await fs.writeFile(path.join(cache,'examples-v2.jsonl'),dataset.map(r=>JSON.stringify(r)).join('\n')+'\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(benchmark.targets).map(([k,v])=>[k,{selected:v.selected,test:v.test}])),null,2));
