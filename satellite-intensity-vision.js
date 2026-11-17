import {distanceBearing} from './satellite-dvorak-model.js';

// Calibrated pixel measurements, not an RGB enhancement or an intensity lookup.
export const VISION_FEATURE_NAMES=['eyeWarmFraction24','eye90C24','innerCloudMean24to64','middleCloudMean64to136','outerCloudMean136to200','cloud05C24to136','cold70Fraction24to136','cold80Fraction24to136','cold70SectorCompleteness','cloudSectorStdC','eyeToInnerGradient','pixelKm'];
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const quantile=(a,q)=>{const s=[...a].sort((x,y)=>x-y),p=(s.length-1)*q,i=Math.floor(p);return s[i]+(s[Math.min(i+1,s.length-1)]-s[i])*(p-i);};

export function infraredMorphology(grid,center){
  const {temperature:t,latitude:lat,longitude:lon,width,height}=grid||{};
  const reject=reason=>({features:null,reason});
  if(!t?.length||lat?.length!==t.length||lon?.length!==t.length||!Number.isInteger(width)||!Number.isInteger(height)||width*height!==t.length||![center?.latitude,center?.longitude].every(finite))return reject('A complete calibrated infrared grid is required.');
  const bands=[[],[],[],[]],coverage=Array.from({length:3},()=>new Set()),sectors=Array.from({length:24},()=>[]);let nearest=-1,minDistance=Infinity;
  for(let i=0;i<t.length;i++){
    if(![t[i],lat[i],lon[i]].every(finite)||t[i]<-110||t[i]>50||Math.abs(lat[i])>90||Math.abs(lon[i])>360)continue;
    const {distance:d,bearing}=distanceBearing(center.latitude,center.longitude,lat[i],lon[i]);if(d<minDistance){minDistance=d;nearest=i;}if(d>200)continue;
    const b=d<24?0:d<64?1:d<136?2:3,sector=Math.min(23,Math.floor(bearing/15));bands[b].push(t[i]);
    if(b){coverage[b-1].add(sector);if(b<3)sectors[sector].push(t[i]);}
  }
  if(nearest<0||minDistance>12||bands.some(a=>a.length<8)||coverage.some(a=>a.size!==24)||sectors.some(a=>a.length<3))return reject('The complete eye and 200-km cloud region are not covered.');
  const neighbors=[nearest%width<width-1?nearest+1:nearest-1,nearest+width<t.length?nearest+width:nearest-width];
  const spacing=neighbors.map(i=>distanceBearing(lat[nearest],lon[nearest],lat[i],lon[i]).distance);
  if(!spacing.every(finite)||spacing.some(x=>x<=0))return reject('The infrared pixel navigation is invalid.');
  const cloud=[...bands[1],...bands[2]],averages=sectors.map(mean),cloudAverage=mean(averages),fraction=(a,limit)=>a.filter(t=>t<=limit).length/a.length;
  const features=[bands[0].filter(t=>t>-20).length/bands[0].length,quantile(bands[0],.9),mean(bands[1]),mean(bands[2]),mean(bands[3]),quantile(cloud,.05),fraction(cloud,-70),fraction(cloud,-80),sectors.filter(a=>fraction(a,-70)>=.5).length/24,Math.sqrt(mean(averages.map(t=>(t-cloudAverage)**2))),(mean(bands[0])-mean(bands[1]))/32,Math.max(...spacing)];
  return {features,reason:'',samples:bands.map(a=>a.length),featureNames:VISION_FEATURE_NAMES};
}

export function ridgeValue(model,features){
  if(!model||!Array.isArray(features)||features.length!==model.means?.length||model.scales?.length!==features.length||model.coefficients?.length!==features.length||!features.every(finite)||!finite(model.intercept)||!model.means.every(finite)||!model.scales.every(v=>finite(v)&&v>0)||!model.coefficients.every(finite))return null;
  const value=model.intercept+features.reduce((sum,x,i)=>sum+model.coefficients[i]*(x-model.means[i])/model.scales[i],0);
  return finite(value)?value:null;
}

// This helper only consumes a fitted model and numeric image features. Labels,
// cyclone identities, MOTIS and personal references have no parameter here.
export function nativeCorrection(model,baseFeatures,morphology){
  const x=[...(baseFeatures||[]),...(morphology?.features||[])];
  if(!model||model.schema!==1||model.featureNames?.length!==x.length||!Array.isArray(model.domain)||model.domain.length!==x.length||model.domain.some(r=>!Array.isArray(r)||r.length!==2||!r.every(finite)||r[0]>r[1])||!x.every(finite)||!morphology?.features)return {wind:null,pressure:null,reason:morphology?.reason||'No fitted native-image component is available.'};
  const outside=model.domain.some(([lo,hi],i)=>{const margin=Math.max((hi-lo)*.15,.01);return x[i]<lo-margin||x[i]>hi+margin;});
  if(outside)return {wind:null,pressure:null,reason:'Image morphology falls outside the native-image training range.'};
  if(!model.release?.wind&&!model.release?.pressure)return {wind:null,pressure:null,reason:'The experimental image correction did not pass the release checks. SI-5 predictions are retained.'};
  return {wind:model.release?.wind?ridgeValue(model.wind,x):null,pressure:model.release?.pressure?ridgeValue(model.pressure,x):null,reason:''};
}
