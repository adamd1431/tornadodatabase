// Independent implementation of the published relationships; winds in knots,
// radii in nautical miles, pressure in mb/hPa, and latitude in degrees.
// Courtney & Knaff (2009), equations 2–7:
// https://rammb2.cira.colostate.edu/wp-content/uploads/2024/07/CourtneyKnaff_2009.pdf
// ADT variant and CI wind table documented by SSEC/McIDAS-V:
// https://www.ssec.wisc.edu/mcidas/software/v/javadoc/current/src-html/edu/wisc/ssec/mcidasv/adt/Functions.html
// Brown, Franklin & Landsea (2006), sections 3–5: V = a (b − Pc)^c.
// https://ams.confex.com/ams/pdfpapers/107190.pdf
// Schloemer (1954) pressure profile, generalized with Holland's B parameter:
// p(r) = Pc + (Pe - Pc) exp[-(RMW/r)^B]. B = 1 is Schloemer.
// https://www.weather.gov/media/owp/oh/hdsc/docs/HMR31.pdf
// https://faculty.fiu.edu/~willough/PUBS/HEW%26RAHN_04.pdf
// Chavas, Knaff & Klotzbach (2025), Eqs. 2, 3 and 5, verified against
// the author's reference implementation (m/s, meters, mb):
// https://github.com/drchavas/tcwindprofile/blob/main/tcwindprofile/tc_pmin_estimatefromR34kt.py
export const WIND_FACTORS = {kt:1,mph:1852/1609.344,kmh:1.852};
export const RADIUS_FACTORS = {nmi:1,km:1.852};
export const WIND_LIMITS = {min:25,max:250};
export const CI_WINDS = [[1,25],[1.5,25],[2,30],[2.5,35],[3,45],[3.5,55],[4,65],[4.5,77],[5,90],[5.5,102],[6,115],[6.5,127],[7,140],[7.5,155],[8,170],[8.5,185],[9,200]];
// Traditional Dvorak (1984) table: CI, 1-minute wind (kt), Atlantic pressure,
// Western Pacific pressure (mb). NHC also uses the Atlantic table in the E Pacific.
// https://www.nhc.noaa.gov/abouttafbprod.shtml
export const DVORAK_TABLE = [[1,25,null,null],[1.5,25,null,null],[2,30,1009,1000],[2.5,35,1005,997],[3,45,1000,991],[3.5,55,994,984],[4,65,987,976],[4.5,77,979,966],[5,90,970,954],[5.5,102,960,941],[6,115,948,927],[6.5,127,935,914],[7,140,921,898],[7.5,155,906,879],[8,170,890,858]];
export const DVORAK_BASINS = {atlantic:{label:'Atlantic / Eastern Pacific',column:2},westPacific:{label:'Western Pacific',column:3}};
export const BROWN_FITS = {
  all:{label:'All Atlantic cases',group:'Overall',a:8.354,b:1015.8,c:.6143},
  south25:{label:'South of 25° N',group:'Latitude',a:10.205,b:1014.4,c:.5736},
  north25:{label:'North of 25° N',group:'Latitude',a:8.636,b:1015,c:.5989},
  strengthening:{label:'Strengthening',group:'12-hour wind trend',a:9.397,b:1014.4,c:.5955},
  steady:{label:'No change',group:'12-hour wind trend',a:10.15,b:1013.5,c:.5704},
  weakening:{label:'Weakening',group:'12-hour wind trend',a:8.306,b:1015.9,c:.6039},
  gulf:{label:'Gulf of Mexico',group:'Sub-basin',a:9.457,b:1014,c:.5819},
  caribbean:{label:'Caribbean Sea',group:'Sub-basin',a:11.941,b:1012.2,c:.5412},
  atlantic:{label:'Atlantic sub-basin',group:'Sub-basin',a:5.169,b:1021.3,c:.7171}
};

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
export function isKnackCkzMethod(method,mode) {
  return method==='ckz-original' || (['ckz','knack-revckz'].includes(method) && !['wind','ci'].includes(mode));
}

export function normalizeWindPressureOptions(input={}) {
  if(!['ckz-published','ckz-original','ckz','knack-revckz','ckk2025','adt','brown2006','schloemer','dvorak'].includes(input.method))throw new WindPressureError('Choose a wind–pressure method.','method');
  // CKZ keeps the matched ROCI reverse calculation. Its forward calculation
  // uses the published R34 relationship, including CI-derived wind inputs.
  if(['ckz','knack-revckz'].includes(input.method) && !isKnackCkzMethod(input.method,input.mode))input={...input,method:'ckz-published'};
  if(input.method==='dvorak') {
    if(!Object.hasOwn(DVORAK_BASINS,input.dvorakBasin))throw new WindPressureError('Choose a Dvorak pressure table.','dvorakBasin');
    return {method:input.method,dvorakBasin:input.dvorakBasin,basin:DVORAK_BASINS[input.dvorakBasin]};
  }
  if(input.method==='schloemer') {
    const environmentMb=number(input.environmentMb,800,1100,'Environmental pressure (mb)','environmentMb');
    const stationMb=number(input.stationMb,400,1100,'Station sea-level pressure (mb)','stationMb');
    const rmwNmi=number(input.rmwNmi,0,Infinity,'Radius of maximum wind (nmi)','rmwNmi');
    const distanceNmi=number(input.distanceNmi,0,Infinity,'Station distance (nmi)','distanceNmi');
    const hollandB=number(input.hollandB,0,Infinity,'Holland B','hollandB');
    if(rmwNmi===0)throw new WindPressureError('Radius of maximum wind must be greater than zero.','rmwNmi');
    if(hollandB===0)throw new WindPressureError('Holland B must be greater than zero.','hollandB');
    if(stationMb>=environmentMb)throw new WindPressureError('Station pressure must be lower than environmental pressure.','stationMb');
    return {method:input.method,environmentMb,stationMb,rmwNmi,distanceNmi,hollandB};
  }
  if(input.method==='brown2006') {
    if(!Object.hasOwn(BROWN_FITS,input.brownFit))throw new WindPressureError('Choose a Brown et al. (2006) fit.','brownFit');
    return {method:input.method,brownFit:input.brownFit,fit:BROWN_FITS[input.brownFit]};
  }
  if(isKnackCkzMethod(input.method)) {
    if(input.radiusType!=null && input.radiusType!=='roci')throw new WindPressureError('CKZ Pressure → wind and Original equation only require ROCI.','radiusType');
    const latitude=number(input.latitude,-60,60,'Latitude (degrees)','latitude');
    const environmentMb=number(input.environmentMb,800,1100,'Environmental pressure (mb)','environmentMb');
    const radiusNmi=number(input.radiusNmi,0,1500,'ROCI (nmi)','knackRociNmi');
    if(radiusNmi===0)throw new WindPressureError('ROCI must be greater than zero.','knackRociNmi');
    const motionKnots=number(input.motionKnots,0,60,'Storm motion (knots)','motionKnots');
    // Inferred from user-supplied KnackBot REVCKZ screenshots (2026-10-22).
    // ROCI 330 nmi implies S=0.7875 at every sampled latitude; an earlier
    // 440-nmi example implies S=1.0166667. The inferred rule also matches an
    // independent 600-nmi example, and all supplied REVCKZ cases to four
    // decimals. It is not published CKZ or
    // verified KnackBot source, and no unobserved size floor is assumed.
    return {method:input.method==='ckz-original'?'ckz-original':'ckz',latitude,absoluteLatitude:Math.abs(latitude),environmentMb,radiusType:'roci',radiusNmi,motionKnots,size:radiusNmi/480+.1};
  }
  if(input.method==='ckk2025') {
    if(input.radiusType!=null && input.radiusType!=='r34')throw new WindPressureError('CKK requires R34; ROCI cannot be used as R34.','radiusType');
    const latitude=number(input.latitude,-60,60,'Latitude (degrees)','latitude');
    const environmentMb=number(input.environmentMb,800,1100,'Environmental pressure (mb)','environmentMb');
    const radiusNmi=number(input.radiusNmi,0,Infinity,'Mean R34 (nmi)','ckkRadiusNmi');
    const motionKnots=number(input.motionKnots,0,60,'Storm motion (knots)','motionKnots');
    if(!['quadrants','azimuthal'].includes(input.ckkRadiusMode))throw new WindPressureError('Choose the CKK R34 convention.','ckkRadiusMode');
    // Reported quadrant radii are quadrant maxima. Their nonzero mean is
    // multiplied by 0.85 to estimate the azimuthal mean used by CKK.
    const radiusFactor=input.ckkRadiusMode==='quadrants'?.85:1;
    return {method:input.method,latitude,absoluteLatitude:Math.abs(latitude),environmentMb,motionKnots,
      radiusType:'r34',radiusNmi,ckkRadiusMode:input.ckkRadiusMode,radiusFactor,r34:radiusNmi*radiusFactor};
  }
  if(!['r34','roci'].includes(input.radiusType))throw new WindPressureError('Choose R34 or ROCI.','radiusType');
  const latitude=number(input.latitude,-60,60,'Latitude (degrees)','latitude');
  const environmentMb=number(input.environmentMb,800,1100,'Environmental pressure (mb)','environmentMb');
  const radiusNmi=number(input.radiusNmi,0,input.radiusType==='roci'?1500:Infinity,'Radius (nmi)','radiusNmi');
  if(input.radiusType==='roci' && radiusNmi===0)throw new WindPressureError('ROCI must be greater than zero.','radiusNmi');
  const motionKnots=input.method==='adt'?11:number(input.motionKnots,0,60,'Storm motion (knots)','motionKnots');
  return {method:input.method,latitude,absoluteLatitude:Math.abs(latitude),environmentMb,radiusType:input.radiusType,radiusNmi,
    r34:input.radiusType==='roci'?.354*radiusNmi+13.3:radiusNmi,motionKnots};
}

function dvorakAtCi(ci,options) {
  const upper=DVORAK_TABLE.findIndex(row=>row[0]>=ci),last=DVORAK_TABLE[Math.max(0,upper-1)],next=DVORAK_TABLE[upper];
  const fraction=upper===0?0:(ci-last[0])/(next[0]-last[0]);
  const interpolate=column=>fraction===0?last[column]:fraction===1?next[column]:last[column]==null || next[column]==null?null:last[column]+fraction*(next[column]-last[column]);
  return {ci,ciRange:null,windKnots:interpolate(1),pressureMb:interpolate(options.basin.column),interpolated:!DVORAK_TABLE.some(row=>Math.abs(row[0]-ci)<1e-8)};
}
function dvorakCiForValue(value,column,field,label) {
  const rows=DVORAK_TABLE.filter(row=>row[column]!=null),values=rows.map(row=>row[column]);
  const minimum=Math.min(...values),maximum=Math.max(...values);
  // Switching display units rounds to six decimals. Preserve table endpoints
  // within that rounding error, including the 25-kt CI ambiguity.
  const candidate=typeof value==='number' || (typeof value==='string' && value.trim()!=='')?Number(value):NaN;
  const target=number(Math.abs(candidate-minimum)<1e-6?minimum:Math.abs(candidate-maximum)<1e-6?maximum:value,minimum,maximum,label,field);
  for(let index=1;index<rows.length;index++) {
    const a=rows[index-1],b=rows[index];
    if(a[column]!==b[column] && target>=Math.min(a[column],b[column])-1e-8 && target<=Math.max(a[column],b[column])+1e-8)return a[0]+(target-a[column])/(b[column]-a[column])*(b[0]-a[0]);
  }
  // CI 1.0–1.5 shares a 25-kt wind; callers expose that ambiguity explicitly.
  return rows[0][0];
}
function evaluateDvorakWind(wind,options) {
  const ci=dvorakCiForValue(wind,1,'windKnots','Dvorak 1-minute wind (knots)'),result=dvorakAtCi(ci,options);
  if(result.windKnots===25){result.ci=1;result.ciRange=[1,1.5];result.interpolated=false;}
  return result;
}

function profileFraction(distanceNmi,{rmwNmi,hollandB}) {
  // log space avoids overflowing RMW/r before the exponent is applied.
  const exponent=distanceNmi===0?Infinity:Math.exp(hollandB*(Math.log(rmwNmi)-Math.log(distanceNmi)));
  return {exponent,fraction:Math.exp(-exponent),complement:-Math.expm1(-exponent)};
}

function evaluateSchloemer(options) {
  const {environmentMb,stationMb,distanceNmi}=options;
  const {exponent,fraction,complement}=profileFraction(distanceNmi,options);
  // expm1 retains the pressure deficit when the station is far from the center.
  const amplification=1/complement,deficit=(environmentMb-stationMb)/complement;
  const pressureMb=environmentMb-deficit;
  if(!Number.isFinite(pressureMb) || pressureMb<=0)throw new WindPressureError('These inputs do not produce a positive central pressure. Check the station distance, RMW, pressure, and Holland B.','distanceNmi');
  return {pressureMb,deficit,stationMb,distanceNmi,exponent,fraction,complement,amplification};
}

export function centralPressureFromStation(input) {
  const options=normalizeWindPressureOptions({...input,method:'schloemer'});
  return evaluateSchloemer(options);
}

export function schloemerPressureCurve(input) {
  const options=normalizeWindPressureOptions({...input,method:'schloemer'}),result=evaluateSchloemer(options);
  const largest=Math.max(options.rmwNmi,options.distanceNmi);
  const maxDistance=Math.max(options.rmwNmi<=Number.MAX_VALUE/4?options.rmwNmi*4:options.rmwNmi,options.distanceNmi<=Number.MAX_VALUE/1.25?options.distanceNmi*1.25:options.distanceNmi);
  const radii=new Set([0,options.rmwNmi,options.distanceNmi,largest]);
  for(let i=1;i<=120;i++)radii.add(maxDistance*(i/120));
  // Resolve the narrow transition around RMW for large B values such as 100.
  for(let i=-24;i<=24;i++) {
    const radius=options.rmwNmi*Math.exp(i/(4*options.hollandB));
    if(Number.isFinite(radius) && radius>0 && radius<=maxDistance)radii.add(radius);
  }
  return [...radii].sort((a,b)=>a-b).map(distanceNmi=>({distanceNmi,pressureMb:options.environmentMb-result.deficit*profileFraction(distanceNmi,options).complement}));
}
function evaluateBrownWind(windKnots,options) {
  const {a,b,c}=options.fit,deficit=Math.pow(windKnots/a,1/c),pressureMb=b-deficit;
  return {windKnots,pressureMb,rawPressure:pressureMb,deficit,fittedDeficit:deficit};
}
function knackPressureTerms(options) {
  // Original-equation mode shares the inferred KnackBot size rule, but keeps
  // Eq. 1 / 7b at every latitude instead of switching to the low-latitude fit.
  const lowLatitude=options.method!=='ckz-original' && options.absoluteLatitude<=18;
  return {lowLatitude,linear:lowLatitude?.267:.483,quadratic:1/(lowLatitude?18.26:24.254)**2,
    offset:options.environmentMb+(lowLatitude?5.962-6.8*options.size:23.286-12.587*options.size-.483*options.absoluteLatitude)};
}
function evaluateKnackWind(windKnots,options) {
  const {lowLatitude,linear,quadratic,offset}=knackPressureTerms(options);
  const translation=1.5*options.motionKnots**.63,relativeWind=windKnots-translation;
  const pressureMb=offset-linear*relativeWind-quadratic*relativeWind**2;
  return {windKnots,pressureMb,rawPressure:pressureMb,deficit:options.environmentMb-pressureMb,
    translation,relativeWind,size:options.size,lowLatitude};
}
function evaluateWind(windKnots,options) {
  if(options.method==='brown2006')return evaluateBrownWind(windKnots,options);
  if(isKnackCkzMethod(options.method))return evaluateKnackWind(windKnots,options);
  if(options.method==='ckk2025') {
    const meanWindMs=(windKnots-.55*options.motionKnots)*1852/3600;
    if(meanWindMs<=0)throw new WindPressureError('Wind must exceed 0.55 × storm forward speed for CKK.','windKnots');
    const coriolis=2*7.292e-5*Math.sin(options.absoluteLatitude*Math.PI/180);
    const radiusMeters=options.r34*1852,rotationWindMs=.5*coriolis*radiusMeters;
    const windTerm=-.0127*meanWindMs**2,sizeTerm=-5.506*rotationWindMs,crossTerm=109.013*rotationWindMs/meanWindMs;
    const pressureMb=options.environmentMb-6.60+windTerm+sizeTerm+crossTerm;
    if(!Number.isFinite(pressureMb))throw new WindPressureError('These inputs fall outside the calculable CKK range.','ckkRadiusNmi');
    return {windKnots,pressureMb,rawPressure:pressureMb,deficit:options.environmentMb-pressureMb,
      meanWindMs,coriolis,radiusMeters,rotationWindMs,windTerm,sizeTerm,crossTerm,r34:options.r34,motionKnots:options.motionKnots};
  }
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
  // The published Courtney & Knaff method switches to Eq. 7a below 18 degrees.
  const lowLatitude=method==='ckz-published' && lat<18;
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
  const options=normalizeWindPressureOptions({...input,mode:'wind'});
  if(options.method==='schloemer')throw new WindPressureError('SCH estimates central pressure from a station observation.','method');
  if(options.method==='dvorak')return evaluateDvorakWind(wind,options);
  const windKnots=number(wind,WIND_LIMITS.min,WIND_LIMITS.max,'1-minute wind (knots)','windKnots');
  if(windKnots<34 && options.r34>0)throw new WindPressureError('Use R34 = 0 for winds below 34 knots; TS-force winds are not present.',options.method==='ckk2025'?'ckkRadiusNmi':'radiusNmi');
  const result=evaluateWind(windKnots,options);
  if(result.deficit<=0)throw new WindPressureError('These inputs do not produce a central pressure below the environment. Check the wind, size, and storm motion.');
  return result;
}

export function windsFromPressure(pressure,input) {
  const options=normalizeWindPressureOptions({...input,mode:'pressure'});
  if(options.method==='schloemer')throw new WindPressureError('SCH estimates central pressure from a station observation.','method');
  if(options.method==='dvorak')return [dvorakAtCi(dvorakCiForValue(pressure,options.basin.column,'pressureMb','Dvorak central pressure (mb)'),options)];
  const target=number(pressure,400,1100,'Central pressure (mb)','pressureMb');
  if(options.method==='brown2006') {
    const {a,b,c}=options.fit;
    if(target>=b)throw new WindPressureError(`Central pressure must be below the selected fit’s reference b (${b} mb).`,'pressureMb');
    const wind=a*Math.pow(b-target,c);
    if(wind<WIND_LIMITS.min-1e-8 || wind>WIND_LIMITS.max+1e-8)throw new WindPressureError('No matching wind between 25 and 250 knots for the selected Brown fit.','pressureMb');
    return [evaluateBrownWind(Math.max(WIND_LIMITS.min,Math.min(WIND_LIMITS.max,wind)),options)];
  }
  if(target>=options.environmentMb)throw new WindPressureError('Central pressure must be lower than environmental pressure.','pressureMb');
  if(isKnackCkzMethod(options.method)) {
    const {linear,quadratic,offset}=knackPressureTerms(options),drop=offset-target;
    // Solve the positive storm-relative root without subtracting two nearly
    // equal numbers. This inverts the same ROCI equation used for forward pressure.
    const relativeWind=drop>0?2*drop/(linear+Math.sqrt(linear**2+4*quadratic*drop)):NaN;
    const windKnots=relativeWind+1.5*options.motionKnots**.63;
    if(!Number.isFinite(windKnots) || windKnots<WIND_LIMITS.min-1e-8 || windKnots>WIND_LIMITS.max+1e-8)throw new WindPressureError('No matching wind between 25 and 250 knots for these CKZ inputs.','pressureMb');
    return [evaluateKnackWind(Math.max(WIND_LIMITS.min,Math.min(WIND_LIMITS.max,windKnots)),options)];
  }
  if(options.method==='ckk2025') {
    // Eq. 5 is strictly decreasing in positive azimuthal-mean wind for
    // nonnegative R34 and |latitude|. Invert that same equation by bisection.
    const lower=Math.max(options.r34>0?34:WIND_LIMITS.min,.55*options.motionKnots+1e-8);
    let lo=lower,hi=WIND_LIMITS.max;
    if(target>evaluateWind(lo,options).pressureMb+1e-8 || target<evaluateWind(hi,options).pressureMb-1e-8)throw new WindPressureError('No matching CKK wind in the 25–250 kt calculation range for these inputs.','pressureMb');
    for(let i=0;i<65;i++) {
      const mid=(lo+hi)/2;
      if(evaluateWind(mid,options).pressureMb>target)lo=mid;else hi=mid;
    }
    return [evaluateWind((lo+hi)/2,options)];
  }
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
  if(options.method==='schloemer') {
    if(input.mode!=='station')throw new WindPressureError('Choose Station → central pressure for SCH.','mode');
    return {options,solutions:[evaluateSchloemer(options)],ci:null,mode:input.mode};
  }
  if(!['wind','pressure','ci'].includes(input.mode))throw new WindPressureError('Choose what to calculate.','mode');
  if(options.method==='dvorak') {
    const ci=input.mode==='ci'?number(input.ci,1,8,'Dvorak CI number','ci'):null;
    if(ci!=null && Math.abs(ci*10-Math.round(ci*10))>1e-8)throw new WindPressureError('Enter a Dvorak CI number in 0.1 steps, from 1.0 to 8.0.','ci');
    const solutions=input.mode==='ci'?[dvorakAtCi(ci,options)]:input.mode==='pressure'?windsFromPressure(input.pressureMb,input):[evaluateDvorakWind(input.windKnots,options)];
    return {options,solutions,ci,mode:input.mode};
  }
  if(options.method==='brown2006' && input.mode==='ci')throw new WindPressureError('Choose Wind → pressure or Pressure → wind for Brown et al. (2006).','mode');
  const ci=input.mode==='ci'?number(input.ci,1,9,'CI number','ci'):null;
  const solutions=input.mode==='pressure'?windsFromPressure(input.pressureMb,input):[pressureFromWind(input.mode==='ci'?ciToWind(ci):input.windKnots,input)];
  return {options,solutions,ci,mode:input.mode};
}
export function windPressureCurve(input) {
  const options=normalizeWindPressureOptions(input),points=[];
  if(options.method==='schloemer')throw new WindPressureError('Use the radial pressure profile for SCH.','method');
  if(options.method==='dvorak')return DVORAK_TABLE.filter(row=>row[options.basin.column]!=null).map(row=>({windKnots:row[1],pressureMb:row[options.basin.column]}));
  const lower=options.method==='ckk2025'?Math.max(options.r34>0?34:WIND_LIMITS.min,Math.floor(.55*options.motionKnots)+1):options.r34>0?34:WIND_LIMITS.min;
  for(let wind=lower;wind<=WIND_LIMITS.max;wind+=1) {
    const row=evaluateWind(wind,options);
    if(row.deficit>0 && row.pressureMb>=400)points.push({windKnots:wind,pressureMb:row.pressureMb});
  }
  return points;
}
