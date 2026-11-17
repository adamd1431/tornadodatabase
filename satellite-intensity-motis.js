import {distanceBearing} from './satellite-dvorak-model.js';
import {windsFromPressure} from './wind-pressure-model.js';

export const MOTIS_PAPER='https://arxiv.org/html/2606.06408v1';
export const SOUNDING_FEATURES=['band24Anomaly','band36Anomaly','upperDifference','midDifference','band27Anomaly','eyeSampling','band31Minus32','band33Truncated','aquaBias','terraBias'];
// Published Table 2, not coefficients fitted to a storm or a saved estimate.
const beta=[3.4313,5.6742,42.7566,-28.7243,-.0785,61.6813,-1.3833,2.5781,-1.0099,-.6308];
const finite=v=>typeof v==='number'&&Number.isFinite(v);

export function warmCorePressure(measurement){
  const {predictors,cdoC,pociMb}=measurement||{};
  if(!Array.isArray(predictors)||predictors.length!==10||!predictors.every(finite)||!finite(cdoC)||cdoC< -110||cdoC>50||!finite(pociMb)||pociMb<900||pociMb>1050)throw Error('Complete calibrated MODIS measurements and background POCI are required.');
  const cdoFactor=(35-Math.min(-50,cdoC))/100;
  const deficitMb=12.8+cdoFactor*predictors.reduce((sum,x,i)=>sum+x*beta[i],0);
  const pressureMb=pociMb-deficitMb;
  if(!finite(pressureMb)||pressureMb<750||deficitMb<=0)throw Error('The warm-core result is outside the supported pressure range.');
  return {pressureMb,deficitMb,cdoFactor};
}

// Match the physical observation, not a cyclone name or an intensity target.
// A five-hour-old sounding must not become the current image's estimate.
export function nearbySounding(points,{timestamp,latitude,longitude}){
  const time=Date.parse(timestamp);if(!finite(time)||![latitude,longitude].every(finite))return null;
  const matches=points.filter(p=>p.eyeClarity==='Good'&&['AQUA','TERRA'].includes(p.satellite)&&finite(Date.parse(p.timestamp))&&Math.abs(Date.parse(p.timestamp)-time)<=15*60000&&[p.latitude,p.longitude].every(finite)).map(p=>({...p,offsetMinutes:(Date.parse(p.timestamp)-time)/60000,distanceKm:distanceBearing(latitude,longitude,p.latitude,p.longitude).distance})).filter(p=>p.distanceKm<=50);
  matches.sort((a,b)=>Math.abs(a.offsetMinutes)-Math.abs(b.offsetMinutes)||a.distanceKm-b.distanceKm);
  return matches[0]||null;
}

export function soundingScanTimes(points,track,start,end){
  const lo=Date.parse(start),hi=Date.parse(end);
  const positions=track.filter(p=>finite(Date.parse(p.timestamp))&&[p.latitude,p.longitude].every(finite)).sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
  return [...new Set(points.filter(p=>{
    const t=Date.parse(p.timestamp);if(p.eyeClarity!=='Good'||!finite(t)||t<lo||t>hi)return false;
    const exact=positions.find(r=>Date.parse(r.timestamp)===t);let position=exact;
    if(!position){const i=positions.findIndex(r=>Date.parse(r.timestamp)>t);if(i<1)return false;const a=positions[i-1],b=positions[i],gap=Date.parse(b.timestamp)-Date.parse(a.timestamp);if(gap>21600000)return false;const f=(t-Date.parse(a.timestamp))/gap;position={latitude:a.latitude+f*(b.latitude-a.latitude),longitude:a.longitude+f*(((b.longitude-a.longitude+540)%360)-180)};}
    return [p.latitude,p.longitude].every(finite)&&distanceBearing(position.latitude,position.longitude,p.latitude,p.longitude).distance<=75;
  }).map(p=>p.timestamp))].sort();
}

export function soundingIntensity(points,center,environment){
  const measurement=nearbySounding(points,center);if(!measurement)return null;
  const pressure=warmCorePressure(measurement);let windKt=null,windReason='ROCI and six-hour motion are required to infer wind from pressure.';
  if(environment&&[environment.rociNmi,environment.motionKt].every(finite))try{
    const solutions=windsFromPressure(pressure.pressureMb,{method:'ckz-published',latitude:measurement.latitude,environmentMb:measurement.pociMb,radiusType:'roci',radiusNmi:environment.rociNmi,motionKnots:environment.motionKt});
    if(solutions.length===1){windKt=solutions[0].windKnots;windReason='Published CKZ inverted from the MODIS-derived pressure, ERA5 POCI, reported ROCI and six-hour motion; not an independent wind observation.';}
    else windReason='The pressure relationship has multiple wind solutions; no unique wind is assigned.';
  }catch(error){windReason=error.message;}
  // Explicit allowlist: central-pressure labels, names and saved estimates can
  // never propagate from a source row into a prediction or its exported inputs.
  return {...pressure,windKt,windReason,timestamp:measurement.timestamp,satellite:measurement.satellite,latitude:measurement.latitude,longitude:measurement.longitude,eyeClarity:measurement.eyeClarity,offsetMinutes:measurement.offsetMinutes,distanceKm:measurement.distanceKm,pociMb:measurement.pociMb,cdoC:measurement.cdoC,predictors:[...measurement.predictors],source:'MOTIS published MODIS measurements · Table 2 reconstruction',sourceUrl:MOTIS_PAPER};
}
