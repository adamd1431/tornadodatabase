import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {FEATURE_NAMES,evaluationMetrics,predictBoosted} from '../satellite-intensity-model.js';
import {trainBoosted,scoreTree} from '../satellite-intensity-trees.js';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const cache='.cache/intensity-training',dataset=(await fs.readFile(`${cache}/examples-pacific.jsonl`,'utf8')).trim().split('\n').map(JSON.parse),source=JSON.parse(await fs.readFile(`${cache}/pacific-availability.json`));
const subset=split=>dataset.filter(r=>r.split===split),training=subset('train'),calibration=subset('calibration'),validation=subset('validation');
if(training.some(r=>r.season>=2022||r.season===2016)||validation.some(r=>r.season!==2023)||subset('test').some(r=>r.season!==2024))throw Error('Season separation violated.');
const bundle={schema:2,version:'SI-5-WP-tree',featureNames:FEATURE_NAMES,basins:['WP'],domain:FEATURE_NAMES.map((_,i)=>[Math.min(...training.map(r=>r.features[i])),Math.max(...training.map(r=>r.features[i]))]),release:{},splits:source.splits,trainingDigest:source.digest,references:{features:'Calibrated IR eye/cloud temperatures, measured Raw T diagnostic, IR-derived eye structure and strictly causal six-hour thermal history; no external intensity estimate inputs',labels:'IBTrACS USA best-track one-minute wind and central pressure, interpolated only across gaps <=6 hours; not independent reconnaissance truth',sources:['https://tropic.ssec.wisc.edu/misc/adt/info.html','https://www.ncei.noaa.gov/products/international-best-track-archive']}};
const report={version:bundle.version,datasetDigest:source.digest,splitYears:source.splits,availability:source.availability,selection:'2023 MAE + 0.35 * MAE at reference winds >=130kt; optional bias from 2022 only. 2016 and 2024 never used for fitting or model selection.',scope:'Western Pacific clear-eye archive measurement model; 2024 withheld-season retrospective evaluation. Labels are best track and may themselves use satellite estimates. Native pixel sampling differences remain.',targets:{}};
function score(model,rows,key){const a=rows.filter(r=>r[key]!==null);return {...scoreTree(model,a.map(r=>({x:r.features,y:r[key]}))),storms:new Set(a.map(r=>r.storm)).size};}
function objective(model,rows,key){const all=score(model,rows,key),strong=score(model,rows.filter(r=>r.windKt>=130),key);return all.mae+.35*(strong.mae??all.mae);}
function bias(model,key){const groups=new Map();for(const r of calibration.filter(r=>r[key]!==null)){const a=groups.get(r.storm)||[];a.push(r[key]-predictBoosted(model,r.features));groups.set(r.storm,a);}return [...groups.values()].reduce((s,a)=>s+a.reduce((x,y)=>x+y,0)/a.length,0)/groups.size;}
for(const [target,key,baselineKey]of [['wind','windKt','baselineWind'],['pressure','pressureMb','baselinePressure']]){
  let best=null;const trials=[];
  for(const depth of [2,3])for(const strongWeight of [1,2]){
    const rows=training.filter(r=>r[key]!==null).flatMap(r=>{const row={storm:r.storm,x:r.features,y:r[key]-(target==='wind'?r.baselineWind:r.pressurePrior),weight:r.windKt>=130?strongWeight:1};if(!r.features[11])return [row];const missing=[...r.features];missing.fill(0,8);return [row,{...row,x:missing}];});
    const fitted=trainBoosted(rows,{trees:240,depth,minLeaf:16});
    for(const count of [80,160,240])for(const useBias of [false,true]){
      const model={...fitted,trees:fitted.trees.slice(0,count),residual:target};if(useBias)model.offset=bias(model,key);
      const metrics=score(model,validation,key),o=objective(model,validation,key),trial={depth,strongWeight,trees:count,bias:model.offset||0,validation:metrics,objective:o};trials.push(trial);if(!best||o<best.objective)best={model,objective:o,trial};
    }
    console.log(`${target}, depth ${depth}, strong weight ${strongWeight}: validation objective ${best.objective.toFixed(3)}`);
  }
  const validationBaseline=evaluationMetrics(validation,baselineKey,key);bundle.release[target]=best.trial.validation.mae<validationBaseline.mae;bundle[target]=best.model;
  // The test and diagnostic seasons are scored only after selection is frozen.
  const test=subset('test'),development=subset('development'),subsets={};for(const [name,filter]of [['130ktAndAbove',r=>r.windKt>=130],['Below130kt',r=>r.windKt<130]])subsets[name]=score(best.model,test.filter(filter),key);
  report.targets[target]={released:bundle.release[target],train:{frames:training.length,storms:new Set(training.map(r=>r.storm)).size},calibration:score(best.model,calibration,key),validation:{...best.trial.validation,baseline:validationBaseline},test:{...score(best.model,test,key),baseline:evaluationMetrics(test,baselineKey,key),subsets},development:{...score(best.model,development,key),baseline:evaluationMetrics(development,baselineKey,key)},selected:best.trial,trials};
  console.log(JSON.stringify({target,released:bundle.release[target],selected:best.trial,test:report.targets[target].test,development:report.targets[target].development}));
}
await fs.writeFile('intensity-data/pacific-tree-model.json',JSON.stringify(bundle));
await fs.writeFile('intensity-data/pacific-benchmark.json',JSON.stringify(report,null,2)+'\n');
