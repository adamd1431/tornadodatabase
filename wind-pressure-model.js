// Independent implementation of the published relationships; winds in knots,
// radii in nautical miles, pressure in mb/hPa, and latitude in degrees.
// Courtney & Knaff (2009), equations 2–7:
// https://rammb2.cira.colostate.edu/wp-content/uploads/2024/07/CourtneyKnaff_2009.pdf
// ADT variant and CI wind table documented by SSEC/McIDAS-V:
// https://www.ssec.wisc.edu/mcidas/software/v/javadoc/current/src-html/edu/wisc/ssec/mcidasv/adt/Functions.html
export const WIND_FACTORS = {kt:1,mph:1852/1609.344,kmh:1.852};
export const RADIUS_FACTORS = {nmi:1,km:1.852};
export const WIND_LIMITS = {min:25,max:250};
export const CI_WINDS = [[1,25],[1.5,25],[2,30],[2.5,35],[3,45],[3.5,55],[4,65],[4.5,77],[5,90],[5.5,102],[6,115],[6.5,127],[7,140],[7.5,155],[8,170],[8.5,185],[9,200]];

export class WindPressureError extends Error {
  constructor(message,field) {super(message);this.name='WindPressureError';this.field=field;}
}
function number(value,min,max,label,field) {
  if(value == null || typeof value === 'boolean' || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value)<min || Number(value)>max) throw new WindPressureError(Number.isFinite(max) ? `${label} must be between ${min} and ${max}.` : `${label} must be a finite number of ${min} or greater.`,field);
  return Number(value);
}
export function ciToWind(ci) {
  const value=number(ci,1,9,'CI number','ci');
  if(Math.abs(value*10-Math.round(value*10))>1e-8) throw new WindPressureError('Enter a CI number in 0.1 steps, from 1.0 to 9.0.','ci');
  const upper=CI_WINDS.findIndex(([t])=>t>=value);
  if(upper===0)return CI_WINDS[0][1];
  const [t0,v0]=CI_WINDS[upper-1],[t1,v1]=CI_WINDS[upper];
  return v0+(v1-v0)*(value-t0)/(t1-t0);
}
export function normalizeWindPressureOptions(input={}) {
  if(!['ckz','adt'].includes(input.method))throw new WindPressureError('Choose a wind–pressure method.','method');
  if(!['r34','roci'].includes(input.radiusType))throw new WindPressureError('Choose R34 or ROCI.','radiusType');
  const latitude=number(input.latitude,-60,60,'Latitude (degrees)','latitude');
  const environmentMb=number(input.environmentMb,800,1100,'Environmental pressure (mb)','environmentMb');
  const radiusNmi=number(input.radiusNmi,0,input.radiusType==='roci'?1500:Infinity,'Radius (nmi)','radiusNmi');
  if(input.radiusType==='roci' && radiusNmi===0)throw new WindPressureError('ROCI must be greater than zero.','radiusNmi');
  const motionKnots=input.method==='adt'?11:number(input.motionKnots,0,60,'Storm motion (knots)','motionKnots');
  return {method:input.method,latitude,absoluteLatitude:Math.abs(latitude),environmentMb,radiusType:input.radiusType,radiusNmi,
    r34:input.radiusType==='roci'?.354*radiusNmi+13.3:radiusNmi,motionKnots};
}
function evaluateWind(windKnots,options) {
  const {method,absoluteLatitude:lat,environmentMb,r34,motionKnots}=options;
  const translation=1.5*Math.pow(motionKnots,.63);
  const relativeWind=windKnots-translation;
  if(relativeWind<=0)throw new WindPressureError('Wind must exceed the storm-motion adjustment.','windKnots');
  // The paper uses Vmax1 in its climatological profile; the published ADT
  // implementation instead uses storm-relative wind in that profile.
  const profileWind=method==='adt'?relativeWind:windKnots;
  const profileRadius=66.785-.09102*profileWind+1.0619*(lat-25);
  const exponent=.1147+.0055*profileWind-.001*(lat-25);
  const climatologicalWind=profileWind*Math.pow(profileRadius/500,exponent);
  const outerWind=r34/9-3;
  const size=Math.max(outerWind/climatologicalWind,.4);
  const lowLatitude=method==='ckz' && lat<18;
  const pressureChange=lowLatitude
    ?5.962-.267*relativeWind-Math.pow(relativeWind/18.26,2)-6.8*size
    :23.286-.483*relativeWind-Math.pow(relativeWind/24.254,2)-12.587*size-.483*lat;
  const rawPressure=environmentMb+pressureChange;
  const floorApplied=method==='adt' && rawPressure>=environmentMb-1;
  const pressureMb=floorApplied?environmentMb-2:rawPressure;
  if(!Number.isFinite(pressureMb) || !Number.isFinite(size))throw new WindPressureError('These inputs fall outside the calculable wind–pressure range.');
  return {windKnots,pressureMb,rawPressure,deficit:environmentMb-pressureMb,translation,relativeWind,profileRadius,exponent,climatologicalWind,outerWind,size,lowLatitude,floorApplied,r34,motionKnots};
}
export function pressureFromWind(wind,input) {
  const options=normalizeWindPressureOptions(input);
  const windKnots=number(wind,WIND_LIMITS.min,WIND_LIMITS.max,'1-minute wind (knots)','windKnots');
  if(windKnots<34 && options.r34>0)throw new WindPressureError('Use R34 = 0 for winds below 34 knots; gale-force winds are not present.','radiusNmi');
  const result=evaluateWind(windKnots,options);
  if(result.deficit<=0)throw new WindPressureError('These inputs do not produce a central pressure below the environment. Check the wind, size, and storm motion.');
  return result;
}

export function windsFromPressure(pressure,input) {
  const options=normalizeWindPressureOptions(input);
  const target=number(pressure,400,1100,'Central pressure (mb)','pressureMb');
  if(target>=options.environmentMb)throw new WindPressureError('Central pressure must be lower than environmental pressure.','pressureMb');
  if(options.method==='adt' && Math.abs(target-(options.environmentMb-2))<1e-7)throw new WindPressureError('ADT applies a 2 mb deficit to some weak systems, so this pressure cannot give a unique wind estimate. Use a larger pressure deficit.','pressureMb');
  const lower=options.r34>0?34:WIND_LIMITS.min,upper=WIND_LIMITS.max;
  const solutions=[];
  function add(wind) {
    const result=evaluateWind(wind,options);
    if(Math.abs(result.pressureMb-target)<1e-6 && !solutions.some(row=>Math.abs(row.windKnots-wind)<1e-5))solutions.push(result);
  }
  // Size depends on wind: scan for every crossing, then refine each one.
  // This avoids assuming the weak-system part of the curve is monotonic.
  const samples=[];
  const residual=wind=>evaluateWind(wind,options).pressureMb-target;
  for(let wind=lower;wind<=upper;wind+=.25)samples.push({wind,value:residual(wind)});
  // Include smooth turning points so two nearby weak-system solutions, or an
  // exact tangent at the pressure maximum, cannot fall between sample points.
  const extrema=[];
  for(let i=1;i<samples.length-1;i++) {
    const a=samples[i-1],b=samples[i],c=samples[i+1];
    if((b.value-a.value)*(c.value-b.value)>=0)continue;
    const maximum=b.value>a.value;let lo=a.wind,hi=c.wind;
    for(let j=0;j<65;j++) {
      const x=lo+(hi-lo)/3,y=hi-(hi-lo)/3;
      if((residual(x)<residual(y))===maximum)lo=x;else hi=y;
    }
    const wind=(lo+hi)/2;extrema.push({wind,value:residual(wind)});
  }
  samples.push(...extrema);samples.sort((a,b)=>a.wind-b.wind);
  for(let i=0;i<samples.length;i++) {
    const {wind:nextWind,value:next}=samples[i];
    if(Math.abs(next)<1e-8)add(nextWind);
    if(i===0)continue;
    const {wind:previousWind,value:previous}=samples[i-1];
    if(previous*next<0) {
      let lo=previousWind,hi=nextWind,loValue=previous;
      for(let iteration=0;iteration<55;iteration++) {
        const mid=(lo+hi)/2,value=evaluateWind(mid,options).pressureMb-target;
        if(loValue*value<=0)hi=mid;else{lo=mid;loValue=value;}
      }
      // Reject discontinuities caused by ADT's weak-system pressure floor.
      add((lo+hi)/2);
    }
  }
  if(!solutions.length)throw new WindPressureError('No matching wind between '+lower+' and 250 knots for these inputs. Check the pressure, size, and environment.','pressureMb');
  return solutions.sort((a,b)=>a.windKnots-b.windKnots);
}
export function calculateWindPressure(input) {
  const options=normalizeWindPressureOptions(input);
  if(!['wind','pressure','ci'].includes(input.mode))throw new WindPressureError('Choose what to calculate.','mode');
  const ci=input.mode==='ci'?number(input.ci,1,9,'CI number','ci'):null;
  const solutions=input.mode==='pressure'?windsFromPressure(input.pressureMb,input):[pressureFromWind(input.mode==='ci'?ciToWind(ci):input.windKnots,input)];
  return {options,solutions,ci,mode:input.mode};
}
export function windPressureCurve(input) {
  const options=normalizeWindPressureOptions(input),points=[];
  const lower=options.r34>0?34:WIND_LIMITS.min;
  for(let wind=lower;wind<=WIND_LIMITS.max;wind+=1) {
    const row=evaluateWind(wind,options);
    if(row.deficit>0 && row.pressureMb>=400)points.push({windKnots:wind,pressureMb:row.pressureMb});
  }
  return points;
}
