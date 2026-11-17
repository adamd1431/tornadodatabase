import fs from 'node:fs/promises';import crypto from 'node:crypto';import {fileURLToPath}from 'node:url';
import {FEATURE_NAMES,treeEligibility,predictBoosted}from '../satellite-intensity-model.js';import {VISION_FEATURE_NAMES,ridgeValue}from '../satellite-intensity-vision.js';import {fitNativeRidge}from '../satellite-intensity-ridge.js';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const data=JSON.parse(await fs.readFile('intensity-data/native-vision-training.json')),protocol=JSON.parse(await fs.readFile('intensity-data/native-vision-protocol.json'));
if(data.completed!==data.requested||data.protocolDigest!==protocol.digest)throw Error('Native collection is incomplete or differs from the frozen sample plan.');
const baseModel=JSON.parse(await fs.readFile('intensity-data/pacific-tree-model.json'));
const rows=data.examples,train=rows.filter(r=>r.split==='train'&&!treeEligibility(baseModel,r.x.slice(0,12))),calibration=rows.filter(r=>r.split==='calibration'),validation=rows.filter(r=>r.split==='validation');
if(train.length<50||new Set(train.map(r=>r.storm)).size<15||validation.length<8||new Set(validation.map(r=>r.storm)).size<4)throw Error('Insufficient independent storms for native calibration.');
if(train.some(r=>!protocol.splits.train.includes(r.season))||validation.some(r=>!protocol.splits.validation.includes(r.season))||protocol.splits.train.some(y=>[...protocol.splits.fresh,...protocol.splits.validation,...protocol.splits.excluded].includes(y)))throw Error('Native split separation was violated.');
const featureNames=[...FEATURE_NAMES,...VISION_FEATURE_NAMES],bundle={schema:1,version:'SI-6-native-ridge',basins:['WP'],featureNames,domain:featureNames.map((_,i)=>[Math.min(...train.map(r=>r.x[i])),Math.max(...train.map(r=>r.x[i]))]),release:{},protocolDigest:protocol.digest,baseVersion:data.baseVersion,baseDigest:data.baseDigest,datasetDigest:data.digest,fittingDigest:crypto.createHash('sha256').update(JSON.stringify(train)).digest('hex'),splits:protocol.splits};
const report={version:bundle.version,protocolDigest:protocol.digest,datasetDigest:data.digest,fittingDigest:bundle.fittingDigest,splits:protocol.splits,resourceAmendment:protocol.resourceAmendment||null,source:'Real calibrated SSEC McFETCH infrared images, time-matched IBTrACS USA wind/pressure labels. Official intensity is a training label only, never an inference input. MOTIS and owner estimates are not used.',sampling:protocol.selection,requested:data.requested,accepted:rows.length,rejected:data.failures.length,training:{frames:train.length,storms:new Set(train.map(r=>r.storm)).size},targets:{}};
function prediction(model,r,baseKey){return model?r[baseKey]+ridgeValue(model,r.x):r[baseKey];}
function score(model,a,key,baseKey,gated=false){
  const used=a.filter(r=>typeof r[key]==='number'&&typeof r[baseKey]==='number'),groups=new Map(),errors=[];
  for(const r of used){let value=gated&&!domainGate(r)?r[baseKey]:prediction(model,r,baseKey);if(gated&&(value<(key==='windKt'?25:800)||value>(key==='windKt'?250:1050)))value=r[baseKey];const e=value-r[key];errors.push(e);const g=groups.get(r.storm)||[];g.push(e);groups.set(r.storm,g);}
  return {count:used.length,storms:groups.size,mae:errors.length?errors.reduce((s,e)=>s+Math.abs(e),0)/errors.length:null,rmse:errors.length?Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/errors.length):null,bias:errors.length?errors.reduce((s,e)=>s+e,0)/errors.length:null,stormMae:groups.size?[...groups.values()].reduce((s,g)=>s+g.reduce((t,e)=>t+Math.abs(e),0)/g.length,0)/groups.size:null};
}
function objective(model,a,key,baseKey){const all=score(model,a,key,baseKey,true),strong=score(model,a.filter(r=>r.windKt>=130),key,baseKey,true);return all.stormMae+.35*(strong.stormMae??all.stormMae);}
function calibrationBias(model,key,baseKey){const groups=new Map();for(const r of calibration.filter(r=>typeof r[key]==='number'&&domainGate(r))){const a=groups.get(r.storm)||[];a.push(r[key]-prediction(model,r,baseKey));groups.set(r.storm,a);}return groups.size?[...groups.values()].reduce((s,a)=>s+a.reduce((x,y)=>x+y,0)/a.length,0)/groups.size:0;}
// Freeze every member choice on the declared validation season before the fresh year.
for(const [target,key,baseKey]of [['wind','windKt','baseWind'],['pressure','pressureMb','basePressure']]){
  let best=null;const trials=[],old=score(null,validation,key,baseKey);
  for(const lambda of [1,10,100]){
    const fitted=fitNativeRidge(train.filter(r=>typeof r[key]==='number').map(r=>({storm:r.storm,x:r.x,y:r[key]-r[baseKey]})),lambda);
    for(const scale of [.5,1])for(const bias of calibration.length?[false,true]:[false]){
      const model={...fitted,intercept:fitted.intercept*scale,coefficients:fitted.coefficients.map(v=>v*scale),scale};if(bias){model.calibrationBias=calibrationBias(model,key,baseKey);model.intercept+=model.calibrationBias;}
      const s=score(model,validation,key,baseKey,true),o=objective(model,validation,key,baseKey),trial={lambda,scale,calibrationBias:model.calibrationBias||0,validation:s,objective:o};trials.push(trial);if(!best||o<best.objective)best={model,objective:o,trial};
    }
  }
  const s=best.trial.validation,eligible=s.mae<old.mae&&s.stormMae<old.stormMae&&s.rmse<=old.rmse;bundle[target]=best.model;bundle.release[target]=eligible;
  report.targets[target]={validationBaseline:old,selected:best.trial,validationEligible:eligible,trials};
}
// Selection snapshot records fitted weights before any final-year errors exist.
const selectionDigest=crypto.createHash('sha256').update(JSON.stringify(bundle)).digest('hex');bundle.selectionDigest=selectionDigest;report.selectionDigest=selectionDigest;
await fs.writeFile('.cache/intensity-training/native-vision-selection.json',JSON.stringify(bundle));
function domainGate(r){const x=r.x.slice(0,12),w=predictBoosted(baseModel.wind,x),p=predictBoosted(baseModel.pressure,x);return !treeEligibility(baseModel,x)&&w>=25&&w<=220&&p>=800&&p<=1050&&!bundle.domain.some(([lo,hi],i)=>r.x[i]<lo-Math.max((hi-lo)*.15,.01)||r.x[i]>hi+Math.max((hi-lo)*.15,.01));}
for(const [target,key,baseKey]of [['wind','windKt','baseWind'],['pressure','pressureMb','basePressure']]){
  const candidate=bundle[target],candidateScore=a=>score(candidate,a,key,baseKey,true);
  const fresh=rows.filter(r=>r.split==='fresh'),freshModel=candidateScore(fresh),freshBase=score(null,fresh,key,baseKey);
  bundle.release[target]=bundle.release[target]&&freshModel.count>=10&&freshModel.storms>=4&&freshModel.mae<freshBase.mae&&freshModel.stormMae<freshBase.stormMae&&freshModel.rmse<=freshBase.rmse;
  report.targets[target].released=bundle.release[target];report.targets[target].fresh={candidate:freshModel,baseline:freshBase,domainFallback:fresh.filter(r=>!domainGate(r)).length};
  report.targets[target].reviewed={};for(const split of ['test','external']){const a=rows.filter(r=>r.split===split);report.targets[target].reviewed[split]={candidate:candidateScore(a),baseline:score(null,a,key,baseKey),domainFallback:a.filter(r=>!domainGate(r)).length};}
}
report.scope='Native-image calibration. 2012 was fixed before collection and assessed only after validation choices were frozen. Training uses later years, so this is a retrospective held-out-year comparison, not a chronological hindcast. Best track may itself use satellite analysis; no independent aircraft accuracy claim. The fresh year is a promotion gate only; rejected candidates are not retuned on it. Resource-driven split changes, if any, are disclosed separately.';
report.promotion=`Each head must improve both frame and storm-balanced MAE without increasing RMSE, on ${protocol.splits.validation.join('/')} native-component validation and then on the single untouched ${protocol.splits.fresh.join('/')} check. Otherwise SI-5 is retained for that head.`;
await fs.writeFile('intensity-data/native-vision-model.json',JSON.stringify(bundle));await fs.writeFile('intensity-data/native-vision-benchmark.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({release:bundle.release,targets:Object.fromEntries(Object.entries(report.targets).map(([k,v])=>[k,{selected:v.selected,validationBaseline:v.validationBaseline,fresh:v.fresh,reviewed:v.reviewed}]))},null,2));
