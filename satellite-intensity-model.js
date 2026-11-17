import {analyzeEyeDvorak,eyeRegression,distanceBearing} from './satellite-dvorak-model.js';
import {ciToWind,pressureFromWind,DVORAK_TABLE} from './wind-pressure-model.js';
import {infraredEyeStructure} from './satellite-intensity-structure.js';

export const INTENSITY_VERSION='SI-2';
export const FEATURE_NAMES=['eyeC','cloudC','absoluteLatitude','contrastC','atlanticBasin','rawT','irRmwKm','hasIrRmw','cloudChange6h','eyeChange6h','rawTChange6h','hasThermalHistory'];
export const finite=v=>typeof v==='number'&&Number.isFinite(v);
export function intensityFeatures({eye,cloud,latitude,atcf,rawT,irRmwKm,thermalHistory}){
  if(![eye,cloud,latitude].every(finite)||! /^(AL|EP)\d{6}$/.test(atcf||''))return null;
  const t=finite(rawT)?rawT:eyeRegression({eye,cloud,symmetry:0,domain:'atlantic'}),history=thermalHistory&&[thermalHistory.eye,thermalHistory.cloud,thermalHistory.rawT].every(finite);
  return [eye,cloud,Math.abs(latitude),eye-cloud,atcf.startsWith('AL')?1:0,t,finite(irRmwKm)?irRmwKm:0,finite(irRmwKm)?1:0,history?cloud-thermalHistory.cloud:0,history?eye-thermalHistory.eye:0,history?t-thermalHistory.rawT:0,history?1:0];
}
export function tablePressure(rawT,atcf){
  const column=/^(AL|EP|CP)/.test(atcf)?2:/^WP/.test(atcf)?3:null;
  if(!column||!finite(rawT)||rawT<2||rawT>8)return null;
  const i=DVORAK_TABLE.findIndex(r=>r[0]>=rawT);if(i<1)return null;
  const a=DVORAK_TABLE[i-1],b=DVORAK_TABLE[i];
  if(a[column]===null)return b[0]===rawT?b[column]:null;
  return a[column]+(b[column]-a[column])*(rawT-a[0])/(b[0]-a[0]);
}
export function treeValue(tree,x){
  let node=tree,depth=0;
  while(node&&depth++<8){if(finite(node.value))return node.value;if(!Number.isInteger(node.feature)||!finite(node.threshold))return NaN;node=x[node.feature]<=node.threshold?node.left:node.right;}
  return NaN;
}
export function predictBoosted(model,x){
  if(!model||!Array.isArray(x)||x.length<1||x.length>32||model.featureCount&&x.length!==model.featureCount||!x.every(finite)||!finite(model.base)||!finite(model.rate)||!Array.isArray(model.trees)||model.trees.length>500)return null;
  let value=(model.base+model.rate*model.trees.reduce((s,t)=>s+treeValue(t,x),0))*(model.correctionScale??1)+(model.offset??0);
  if(model.residual){const prior=trainingBaseline({eyeC:x[0],cloudC:x[1],latitude:x[2],atcf:x[4]?'AL012000':'EP012000',rawT:x[5]});value+=model.residual==='wind'?prior.windKt:prior.pressurePrior;}
  return finite(value)?value:null;
}
export function treeEligibility(bundle,features,options={}){
  if(!bundle||bundle.schema!==2||bundle.featureNames?.join('|')!==FEATURE_NAMES.join('|')||!features||features.length!==FEATURE_NAMES.length||!features.every(finite))return 'The trained member covers Atlantic and Eastern Pacific eye scenes with a complete feature vector.';
  if(options.largeEye||options.pinhole)return 'The trained member has not been evaluated for the selected special eye scene.';
  // Small differences between native pixel sampling and archived measurements
  // must not trigger an abrupt jump to an unrelated stronger baseline.
  if([0,1,2,3,5].some(i=>{const [lo,hi]=bundle.domain[i],margin=(hi-lo)*.1;return features[i]<lo-margin||features[i]>hi+margin;}))return 'Temperatures or latitude fall outside the supported training neighborhood; using the eye-scene baseline.';
  return '';
}
export function estimateIntensity(grid,options={},bundle=null){
  const eye=analyzeEyeDvorak(grid,{...options,autoCenter:options.autoCenter!==false});
  const structure=infraredEyeStructure(grid,eye);
  const baselineWind=ciToWind(eye.rawT),baselinePressure=tablePressure(eye.rawT,options.atcf||'');
  const features=intensityFeatures({...eye,...structure,atcf:options.atcf,thermalHistory:options.thermalHistory}),treeReason=treeEligibility(bundle,features,options);
  const treeWind=treeReason?null:predictBoosted(bundle.wind,features),treePressure=treeReason?null:predictBoosted(bundle.pressure,features);
  // Publication flags are chosen on validation seasons, before the test season.
  const useWind=!treeReason&&bundle.release?.wind&&treeWind>=25&&treeWind<=220;
  const usePressure=!treeReason&&bundle.release?.pressure&&treePressure>=800&&treePressure<=1050;
  let physicsPressure=null,physicsReason='Enter environmental pressure, ROCI and six-hour motion for the CKZ cross-check.';
  const e=options.environment;
  if(e&&[e.pociMb,e.rociNmi,e.motionKt].every(finite))try{
    const row=pressureFromWind(useWind?treeWind:baselineWind,{method:'ckz-published',latitude:eye.latitude,environmentMb:e.pociMb,radiusType:'roci',radiusNmi:e.rociNmi,motionKnots:e.motionKt});
    physicsPressure=row.pressureMb;physicsReason='Published CKZ relationship, EP = POCI. This depends on the estimated wind and is a consistency check, not an independent trained member.';
  }catch(error){physicsReason=error.message;}
  const windKt=useWind?treeWind:baselineWind,pressureMb=usePressure?treePressure:physicsPressure??baselinePressure;
  return {version:INTENSITY_VERSION,timestamp:grid.timestamp,atcf:options.atcf||'',eye,structure,thermalHistory:options.thermalHistory||null,features,windKt,pressureMb,
    windMethod:useWind?'Boosted trees · eye-scene model':'Single-image eye-scene baseline',
    pressureMethod:usePressure?'Boosted trees':physicsPressure!==null?'Published CKZ':baselinePressure!==null?'Dvorak pressure table':'Unavailable',
    members:{baselineWind,baselinePressure,treeWind,treePressure,physicsPressure},treeReason,physicsReason,
    // A temperature ring is NOT a measured or inferred radius of maximum wind.
    coldRingKm:eye.ringRadius,rmwKm:null,uncertainty:{kind:'not-calibrated',text:'A calibrated confidence interval is not available. Historical benchmark errors are reported separately.'}};
}
export function regularGrid(grid){
  const {width,height,bounds,values}=grid||{};if(!Number.isInteger(width)||!Number.isInteger(height)||width*height!==values?.length||width*height>1500000||!bounds)throw Error('The calibrated image grid is invalid.');
  const latitude=new Float32Array(values.length),longitude=new Float32Array(values.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x;latitude[i]=bounds.north-(y+.5)/height*(bounds.north-bounds.south);longitude[i]=((bounds.west+(x+.5)/width*(bounds.east-bounds.west)+540)%360)-180;}
  return {width,height,latitude,longitude,temperature:values,timestamp:grid.validAt};
}
export function nearestObservation(rows,time,maxMinutes=90,key='timestamp'){
  const t=Date.parse(time);if(!finite(t))return null;
  const candidates=rows.filter(r=>finite(Date.parse(r[key]))).sort((a,b)=>Math.abs(Date.parse(a[key])-t)-Math.abs(Date.parse(b[key])-t));
  const row=candidates[0],offsetMinutes=row?(Date.parse(row[key])-t)/60000:Infinity;
  return Math.abs(offsetMinutes)<=maxMinutes?{...row,offsetMinutes}:null;
}
export function evaluationMetrics(rows,predicted,observed){
  const used=rows.filter(r=>finite(r[predicted])&&finite(r[observed]));if(!used.length)return null;
  const errors=used.map(r=>r[predicted]-r[observed]);
  return {count:used.length,mae:errors.reduce((a,b)=>a+Math.abs(b),0)/used.length,rmse:Math.sqrt(errors.reduce((a,b)=>a+b*b,0)/used.length),bias:errors.reduce((a,b)=>a+b,0)/used.length};
}
export function sixHourTrackMotion(track,timestamp){
  const at=Date.parse(timestamp),times=[at-10800000,at+10800000];
  function point(t){const exact=track.find(r=>Date.parse(r.timestamp)===t);if(exact)return exact;const hi=track.findIndex(r=>Date.parse(r.timestamp)>t);if(hi<1)return null;const a=track[hi-1],b=track[hi],ta=Date.parse(a.timestamp),tb=Date.parse(b.timestamp);if(tb-ta>21600000)return null;const f=(t-ta)/(tb-ta);return {latitude:a.latitude+f*(b.latitude-a.latitude),longitude:((a.longitude+f*(((b.longitude-a.longitude+540)%360)-180)+540)%360)-180};}
  const [a,b]=times.map(point);return a&&b?Math.round(distanceBearing(a.latitude,a.longitude,b.latitude,b.longitude).distance/1.852/6*100)/100:null;
}
export function trainingBaseline({eyeC,cloudC,latitude,atcf,rawT}){const t=finite(rawT)?rawT:eyeRegression({eye:eyeC,cloud:cloudC,symmetry:0,domain:'atlantic'}),windKt=ciToWind(t);return {windKt,pressureMb:tablePressure(t,atcf),pressurePrior:1015.8-(windKt/8.354)**(1/.6143)};}
