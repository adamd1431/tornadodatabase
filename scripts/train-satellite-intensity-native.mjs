import fs from 'node:fs';import crypto from 'node:crypto';import {fileURLToPath}from 'node:url';
import {trainBoosted,scoreTree}from '../satellite-intensity-trees.js';
import {evaluationMetrics,predictBoosted}from '../satellite-intensity-model.js';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const base=JSON.parse(fs.readFileSync(process.argv.includes('--retune')?'.cache/intensity-training/si2-model.json':'intensity-data/tree-model.json')),oldReport=JSON.parse(fs.readFileSync(process.argv.includes('--retune')?'.cache/intensity-training/si2-benchmark.json':'intensity-data/benchmark.json')),archive=fs.readFileSync('.cache/intensity-training/examples-v2.jsonl','utf8').trim().split('\n').map(JSON.parse),native=JSON.parse(fs.readFileSync('intensity-data/native-training.json')).examples;
if(base.version!=='SI-2-tree')throw Error('Run the SI-2 archive training first, or restore its frozen model before this native augmentation stage.');
fs.writeFileSync('.cache/intensity-training/si2-model.json',JSON.stringify(base));fs.writeFileSync('.cache/intensity-training/si2-benchmark.json',JSON.stringify(oldReport));
if(native.some(r=>!base.splits.train.includes(r.season)||r.split!=='train'))throw Error('Native augmentation cannot use a calibration, selection or test season.');
const dataset=[...archive,...native].sort((a,b)=>a.storm.localeCompare(b.storm)||a.timestamp.localeCompare(b.timestamp)||String(a.featureSource||'').localeCompare(String(b.featureSource||''))),bundle={...base,version:'SI-3-tree',createdAt:new Date().toISOString(),trainingDigest:crypto.createHash('sha256').update(JSON.stringify(dataset)).digest('hex'),nativeTraining:{examples:native.length,storms:new Set(native.map(r=>r.storm)).size,source:'intensity-data/native-training.json',labels:'IBTrACS USA time-matched wind / pressure; no owner-label interpolation'}},report={...oldReport,version:'SI-3-tree',createdAt:bundle.createdAt,datasetDigest:bundle.trainingDigest,previousDatasetDigest:base.trainingDigest,nativeTraining:bundle.nativeTraining,targets:{}};
const training=dataset.filter(r=>r.split==='train'),validation=archive.filter(r=>r.split==='validation'),test=archive.filter(r=>r.split==='test');
function score(model,rows,key){const used=rows.filter(r=>r[key]!==null);return {...scoreTree(model,used.map(r=>({storm:r.storm,x:r.features,y:r[key]}))),storms:new Set(used.map(r=>r.storm)).size};}
const calibration=archive.filter(r=>r.split==='calibration');
function calibrationBias(model,key){const groups=new Map();for(const r of calibration.filter(r=>r[key]!==null)){const values=groups.get(r.storm)||[];values.push(r[key]-predictBoosted(model,r.features));groups.set(r.storm,values);}return [...groups.values()].reduce((s,values)=>s+values.reduce((a,b)=>a+b,0)/values.length,0)/groups.size;}
function objective(model,rows,key){return score(model,rows,key).mae+.35*score(model,rows.filter(r=>r.windKt>=130),key).mae;}
for(const [target,key,baselineKey]of [['wind','windKt','baselineWind'],['pressure','pressureMb','baselinePressure']]){
 let best={model:base[target],objective:objective(base[target],validation,key),choice:{source:'SI-2 retained'}},trials=[];
 for(const nativeWeight of [1,2,4]){
  const rows=training.filter(r=>r[key]!==null).flatMap(r=>{const row={storm:r.storm,x:r.features,y:r[key]-(target==='wind'?r.baselineWind:r.pressurePrior),weight:r.featureSource?nativeWeight:1};if(!r.features[11])return [row];const x=[...r.features];x.fill(0,8);return [row,{...row,x}];});
  const fitted=trainBoosted(rows,{trees:300,depth:3,minLeaf:12});
  fs.writeFileSync(`.cache/intensity-training/native-${target}-${nativeWeight}.json`,JSON.stringify(fitted));
  for(const trees of [100,200,300])for(const useBias of [false,true]){const model={...fitted,trees:fitted.trees.slice(0,trees),residual:target,correctionScale:1,geometry:true};if(useBias)model.offset=calibrationBias(model,key);const s=score(model,validation,key),o=objective(model,validation,key),choice={source:'native augmentation',nativeWeight,trees,bias:model.offset||0,validation:s,objective:o};trials.push(choice);if(o<best.objective&&s.mae<score(base[target],validation,key).mae)best={model,objective:o,choice};}
  console.log(target+' native weight '+nativeWeight+'; selection objective '+best.objective.toFixed(3));
 }
 bundle[target]=best.model;const subsets={};for(const [name,filter]of [['Atlantic',r=>r.storm.startsWith('AL')],['Eastern Pacific',r=>r.storm.startsWith('EP')],['130ktAndAbove',r=>r.windKt>=130]])subsets[name]=score(best.model,test.filter(filter),key);
 report.targets[target]={...oldReport.targets[target],train:{frames:training.length,storms:new Set(training.map(r=>r.storm)).size},calibration:score(best.model,calibration,key),validation:{...score(best.model,validation,key),baseline:evaluationMetrics(validation,baselineKey,key)},test:{...score(best.model,test,key),baseline:evaluationMetrics(test,baselineKey,key),subsets},trees:best.model.trees.length,selected:best.choice,selection:'Native weight and tree count selected on 2023 only; SI-2 retained unless validation MAE and strong-storm objective both improve.',trials};
 console.log(JSON.stringify({target,choice:best.choice,test:report.targets[target].test}));
}
fs.writeFileSync('intensity-data/tree-model.json',JSON.stringify(bundle));fs.writeFileSync('intensity-data/benchmark.json',JSON.stringify(report,null,2));
