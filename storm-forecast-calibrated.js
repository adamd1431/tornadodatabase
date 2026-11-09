// The same frozen, nonnegative correction used in the retrospective study.
import calibration from './storm-forecast-calibration.js';
import {buildForecast,distanceKm,officialGuidance} from './storm-forecast-model.js';
import {FORECAST_FAMILIES,HOUR,parseForecastDeck,operationalInitials,selectForecastSources,legacySources,forecastFeatures,adjustedFeature,regionFor,xy,fromXY} from './storm-forecast-core.js';

const finite=Number.isFinite;
export function parametersAt(config,hours){
  if(!config?.promotedFromValidation||hours<=0||hours>120)return null;
  const leads=Object.keys(config.leads).map(Number).sort((a,b)=>a-b),hi=leads.find(h=>h>=hours),lo=[0,...leads].filter(h=>h<=hours).at(-1);
  const b=config.leads[hi],a=lo?config.leads[lo]:{weights:{},bias:b.bias.map(()=>0),trendGain:0};
  const f=hi===lo?0:(hours-lo)/(hi-lo),mix=(x,y)=>x+(y-x)*f,keys=new Set([...Object.keys(a.weights),...Object.keys(b.weights)]);
  return {weights:Object.fromEntries([...keys].map(k=>[k,mix(a.weights[k]||0,b.weights[k]||0)])),bias:a.bias.map((v,i)=>mix(v,b.bias[i])),trendGain:mix(a.trendGain,b.trendGain)};
}
export function calibratePoint(baseline,features,storm,hours,model=calibration){
  if(!hours)return {...baseline,latitude:storm.latitude,longitude:storm.longitude,windKt:storm.windKt,pressureMb:storm.pressureMb,calibrated:[]};
  const result={...baseline,calibrated:[]},region=model.model[regionFor(storm.id)];
  for(const target of ['track','wind','pressure']){
    const config=region[target],p=parametersAt(config,hours);if(!p)continue;
    const rawBase=target==='track'?Object.values(xy(baseline,storm)):[baseline[target==='wind'?'windKt':'pressureMb']];
    if(!rawBase.every(finite))continue;const value=rawBase.map((v,i)=>v+p.bias[i]);
    for(const feature of features){const weight=p.weights[feature.id]||0;if(!weight||!feature[target])continue;let adjusted=adjustedFeature(feature[target],hours,config.decayHours);adjusted=Array.isArray(adjusted)?adjusted:[adjusted];
      if(target==='wind')adjusted[0]=Math.max(0,adjusted[0]);if(target==='pressure'&&(adjusted[0]<800||adjusted[0]>1100))continue;
      if(adjusted.every(finite))adjusted.forEach((v,i)=>value[i]+=weight*(v-rawBase[i]));
    }
    if(target==='track')Object.assign(result,fromXY(value[0],value[1],storm));
    else{const trend=storm[target==='wind'?'trendWind12':'trendPressure12'];value[0]+=p.trendGain*(finite(trend)?trend:0)*hours/12*Math.exp(-hours/24);result[target==='wind'?'windKt':'pressureMb']=target==='wind'?Math.max(0,value[0]):value[0]>=800&&value[0]<=1100?value[0]:null;}
    result.calibrated.push(target);
  }
  return result;
}
function legacyGuidance(sources){return sources.map(row=>{const g=row.sources.track;return {family:row.id,name:FORECAST_FAMILIES.find(f=>f.id===row.id)?.name||row.id,code:g.code,cycle:new Date(g.cycle).toISOString(),initial:g.initial,points:g.points.filter(p=>p.lead>=0).map(p=>({...p,validAt:new Date(p.at).toISOString()}))};});}
export function buildCalibratedForecast(advisory,text,{pressureMb=advisory.pressureMb,asOf=new Date()}={}){
  const deck=parseForecastDeck(text,advisory.id),advisoryTime=Date.parse(advisory.validAt);
  const analysis=operationalInitials(deck,advisory.id).filter(p=>Date.parse(p.validAt)<=advisoryTime&&advisoryTime-Date.parse(p.validAt)<=3*HOUR&&distanceKm(p,advisory)<250&&Math.abs(p.windKt-advisory.windKt)<=20).at(-1);
  // Calibration was tested on native operational analyses. An unmatched advisory
  // remains a baseline instead of silently applying weights to another time base.
  const storm=analysis?{...advisory,...analysis}:{...advisory,pressureMb},cutoff=new Date(Math.min(+asOf,Date.parse(storm.validAt)+3*HOUR));
  const legacy=legacySources(deck,storm,cutoff);if(!legacy.length)throw Error('No matching early guidance.');
  const base=buildForecast(storm,legacyGuidance(legacy),{asOf}),sources=selectForecastSources(deck,storm,cutoff),members=sources.map(s=>({family:s.id,name:s.name,code:[...new Set(Object.values(s.sources).map(g=>g.code))].join('/'),cycle:new Date(Math.max(...Object.values(s.sources).map(g=>g.cycle))).toISOString(),sources:Object.fromEntries(Object.entries(s.sources).map(([k,g])=>[k,{code:g.code,cycle:new Date(g.cycle).toISOString()}])),points:[]}));
  const points=base.points.map(p=>{
    const features=forecastFeatures(sources,storm,p.hours),result=analysis?calibratePoint(p,features,storm,p.hours):{...p,calibrated:[]};
    const values={wind:[],pressure:[],track:[]};
    for(const f of features){const sample={hours:p.hours,validAt:p.validAt,latitude:null,longitude:null,windKt:null,pressureMb:null};
      for(const target of ['track','wind','pressure']){if(!f[target])continue;const config=calibration.model[regionFor(storm.id)][target],v=adjustedFeature(f[target],p.hours,analysis&&config.promotedFromValidation?config.decayHours:0);
        if(target==='track'){Object.assign(sample,fromXY(...v,storm));values.track.push(sample);}
        else{const value=target==='wind'?Math.max(0,v):v>=800&&v<=1100?v:null;sample[target==='wind'?'windKt':'pressureMb']=value;if(value!==null)values[target].push(value);}
      }members.find(m=>m.family===f.id).points.push(sample);
    }
    for(const [target,key]of [['wind','wind'],['pressure','pressure']]){const a=values[target];result[key+'Min'+(key==='wind'?'Kt':'Mb')]=a.length?Math.min(...a):null;result[key+'Max'+(key==='wind'?'Kt':'Mb')]=a.length?Math.max(...a):null;result[key+'Count']=a.length;}
    result.modelCount=values.track.length;result.trackSpreadKm=values.track.length?Math.max(...values.track.map(v=>distanceKm(result,v))):null;return result;
  });
  const official=officialGuidance(text,advisory);if(official)official.points=official.points.map(p=>({...p,hours:(Date.parse(p.validAt)-Date.parse(storm.validAt))/HOUR}));
  const officialInformed=!!analysis&&Object.values(calibration.model[regionFor(storm.id)]).some(c=>c.promotedFromValidation&&Object.values(c.leads).some(p=>p.weights.official>0));
  let hash=2166136261;for(const c of JSON.stringify([calibration.frozenModelSha256,points,members])){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619);}
  return {...base,version:calibration.version,method:!analysis?'Uncalibrated baseline · native analysis unavailable':officialInformed?'Calibrated guidance · official-informed':'Calibrated model guidance',runId:(hash>>>0).toString(16).padStart(8,'0'),points,members:members.filter(m=>m.points.length>1),official,verified:false,
    calibrationApplied:!!analysis,officialInformed,advisoryAt:advisory.validAt,availabilityCutoff:cutoff.toISOString(),validation:{reportUrl:'/storm-forecast-validation.html',frozenModelSha256:calibration.frozenModelSha256},notes:[
      analysis?'Initialized from the native operational ATCF analysis. Its valid time can precede the latest public advisory by up to three hours.':'A matching native operational analysis was unavailable. The uncalibrated baseline is shown; fitted corrections were not applied.',
      'Frozen lead- and region-specific nonnegative weights, bounded bias correction and optional past intensity tendency. Selected on 2024 validation storms, then evaluated on separate whole storms and the final 2025 NHC season.',
      'Raw guidance must be at least six hours old and early/interpolated guidance three hours old at the nominal issue time (analysis +3h). Actual archive publication times and late revisions cannot be reconstructed.',
      'Atlantic/eastern Pacific track retains the original consensus: its validation gain was insufficient. Global track improvement on the reserved sample was small and uncertain.',
      officialInformed?'This intensity blend can use the official forecast as an input. Its comparison with the official forecast is not an independent competition.':'Environmental statistical guidance may include LGEM, Decay-SHIPS and CHIPS. Displayed GFS/SST diagnostics do not supply a separately trained correction.',
      'Member ranges show model disagreement, not calibrated probabilities. Six-hour coefficients interpolate the tested 12/24/48/72/96/120-hour leads. No model tail is extrapolated. Historical performance does not guarantee future skill.'
    ]};
}
