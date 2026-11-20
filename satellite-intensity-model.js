import {analyzeEyeDvorak,calculateEyeDvorak,eyeRegression,distanceBearing} from './satellite-dvorak-model.js';
import {ciToWind,pressureFromWind,DVORAK_TABLE} from './wind-pressure-model.js';
import {infraredEyeStructure} from './satellite-intensity-structure.js';
import {infraredMorphology,nativeCorrection} from './satellite-intensity-vision.js';
import {assessSatelliteScene} from './satellite-scene-quality.js';

export const INTENSITY_VERSION='SI-8';
export const BASELINE_ADT_VERSION='9.1';
export const TRAINED_FEATURE_ADT_VERSION='8.2.1';
export const FEATURE_NAMES=['eyeC','cloudC','absoluteLatitude','contrastC','atlanticBasin','rawT','irRmwKm','hasIrRmw','cloudChange6h','eyeChange6h','rawTChange6h','hasThermalHistory'];
export const finite=v=>typeof v==='number'&&Number.isFinite(v);
export function intensityFeatures({eye,cloud,latitude,atcf,rawT,irRmwKm,thermalHistory}){
  if(![eye,cloud,latitude].every(finite)||! /^(AL|EP|WP)\d{6}$/.test(atcf||''))return null;
  const t=finite(rawT)?rawT:eyeRegression({eye,cloud,symmetry:0,domain:atcf.startsWith('WP')?'pacific':'atlantic'}),history=thermalHistory&&[thermalHistory.eye,thermalHistory.cloud,thermalHistory.rawT].every(finite);
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
  if(!bundle||bundle.schema!==2||bundle.featureNames?.join('|')!==FEATURE_NAMES.join('|')||!features||features.length!==FEATURE_NAMES.length||!features.every(finite))return 'No evaluated trained member is available for this basin and complete feature vector.';
  if(options.largeEye||options.pinhole)return 'The trained member has not been evaluated for the selected special eye scene.';
  // Small differences between native pixel sampling and archived measurements
  // must not trigger an abrupt jump to an unrelated stronger baseline.
  if([0,1,2,3,5].some(i=>{const [lo,hi]=bundle.domain[i],margin=(hi-lo)*.1;return features[i]<lo-margin||features[i]>hi+margin;}))return 'Temperatures or latitude fall outside the supported training neighborhood; using the eye-scene baseline.';
  return '';
}
export function intensityMember(bundle,atcf){
  if(/^WP\d{6}$/.test(atcf||''))return bundle?.westernPacific||null;
  return /^(AL|EP)\d{6}$/.test(atcf||'')?bundle:null;
}
// Keep the frozen replay available for offline comparisons. A caller cannot
// silently change a released tree's numeric feature definition with `version`.
export function estimateIntensityLegacy(grid,options={},bundle=null){return estimateIntensityInternal(grid,options,bundle,false);}
export function estimateIntensity(grid,options={},bundle=null){return estimateIntensityInternal(grid,{...options,version:BASELINE_ADT_VERSION},bundle,true);}
function estimateIntensityInternal(grid,options,bundle,modern){
  bundle=intensityMember(bundle,options.atcf);
  let modelEye=null,featureReason='';
  if(modern&&bundle)try{modelEye=analyzeEyeDvorak(grid,{...options,version:TRAINED_FEATURE_ADT_VERSION,autoCenter:options.autoCenter!==false});}catch(error){featureReason='The fitted feature sampler could not accept this scene. '+error.message;}
  // Measure both methods at the same accepted center, without repeating the
  // centroid search or optimizing the center against the resulting intensity.
  const eye=modelEye?{...calculateEyeDvorak(grid,{...options,latitude:modelEye.latitude,longitude:modelEye.longitude}),centerShiftKm:modelEye.centerShiftKm,centering:modelEye.centering}:analyzeEyeDvorak(grid,{...options,autoCenter:options.autoCenter!==false});
  if(!modern)modelEye=eye;
  const structure=infraredEyeStructure(grid,eye);
  const baselineWind=ciToWind(eye.rawT),baselinePressure=tablePressure(eye.rawT,options.atcf||'');
  const featureEye=modelEye||eye,featureStructure=modelEye?infraredEyeStructure(grid,modelEye):structure;
  const features=featureReason?null:intensityFeatures({...featureEye,...featureStructure,atcf:options.atcf,thermalHistory:options.thermalHistory}),treeReason=featureReason||treeEligibility(bundle,features,options);
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
  const infraredWind=useWind?treeWind:baselineWind,treeShare=bundle?.pressureBlend?.treeShare??1;
  const infraredPressure=usePressure?(physicsPressure!==null?treeShare*treePressure+(1-treeShare)*physicsPressure:treePressure):physicsPressure??baselinePressure;
  // External intensity estimates are comparison evidence, never replacements
  // or inputs to the trained image estimator, even when supplied by callers.
  const morphology=infraredMorphology(grid,featureEye);
  const nativeCompatible=bundle?.nativeVision?.baseDigest===bundle?.trainingDigest;
  const adjustment=bundle?.nativeVision&&nativeCompatible&&useWind&&usePressure?nativeCorrection(bundle.nativeVision,features,morphology):{wind:null,pressure:null,reason:bundle?.nativeVision?nativeCompatible?'The base trained member is unavailable for this scene.':'The image correction does not match this trained backbone.':'No native-image calibration is loaded.'};
  const correctedWind=adjustment.wind!==null?infraredWind+adjustment.wind:null,correctedPressure=adjustment.pressure!==null?infraredPressure+adjustment.pressure:null;
  const nativeWind=finite(correctedWind)&&correctedWind>=25&&correctedWind<=250,nativePressure=finite(correctedPressure)&&correctedPressure>=800&&correctedPressure<=1050;
  const sceneQuality=modern?assessSatelliteScene(grid,eye,{thermalHistory:options.thermalHistory}):null;
  const supported=!sceneQuality||sceneQuality.accepted;
  const windKt=supported?(nativeWind?correctedWind:infraredWind):null,pressureMb=supported?(nativePressure?correctedPressure:infraredPressure):null;
  // The displayed consistency check follows the final wind. It remains separate
  // from the independently learned pressure head.
  if(nativeWind&&supported&&e&&[e.pociMb,e.rociNmi,e.motionKt].every(finite))try{physicsPressure=pressureFromWind(windKt,{method:'ckz-published',latitude:eye.latitude,environmentMb:e.pociMb,radiusType:'roci',radiusNmi:e.rociNmi,motionKnots:e.motionKt}).pressureMb;}catch{}
  return {version:modern?INTENSITY_VERSION:'SI-6',baselineAdtVersion:eye.version,featureAdtVersion:modelEye?.version||null,trainedVersion:bundle?.version||null,timestamp:grid.timestamp,atcf:options.atcf||'',eye,modelEye,structure,sceneQuality,thermalHistory:options.thermalHistory||null,features,windKt,pressureMb,
    morphology,nativeAdjustment:{...adjustment,windApplied:nativeWind&&supported,pressureApplied:nativePressure&&supported,version:bundle?.nativeVision?.version||null},
    windAt:grid.timestamp,pressureAt:grid.timestamp,
    windMethod:!supported?'Withheld · cold ring unresolved':nativeWind?'Boosted trees + image structure calibration':useWind?'Boosted trees · eye-scene model':'Single-image eye-scene baseline',
    pressureMethod:!supported?'Withheld · cold ring unresolved':nativePressure?'Boosted trees + image structure calibration':usePressure?(treeShare<1&&physicsPressure!==null?'Trained pressure / CKZ blend':'Boosted trees'):physicsPressure!==null?'Published CKZ':baselinePressure!==null?'Dvorak pressure table':'Unavailable',
    members:{baselineWind,baselinePressure,treeWind,treePressure,physicsPressure,infraredWind,infraredPressure,nativeWind:nativeWind?windKt:null,nativePressure:nativePressure?pressureMb:null},treeReason:supported?treeReason:sceneQuality.flags[0],physicsReason,
    // A temperature ring is NOT a measured or inferred radius of maximum wind.
    coldRingKm:eye.ringRadius,rmwKm:null,uncertainty:{kind:sceneQuality?.resolutionLimited?'resolution-limited':'not-calibrated',text:[...(sceneQuality?.flags||[]),'A calibrated confidence interval is not available. Historical benchmark errors are reported separately.'].join(' ')}};
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
export function trainingBaseline({eyeC,cloudC,latitude,atcf,rawT}){const t=finite(rawT)?rawT:eyeRegression({eye:eyeC,cloud:cloudC,symmetry:0,domain:/^WP/.test(atcf||'')?'pacific':'atlantic'}),windKt=ciToWind(t);return {windKt,pressureMb:tablePressure(t,atcf),pressurePrior:1015.8-(windKt/8.354)**(1/.6143)};}
