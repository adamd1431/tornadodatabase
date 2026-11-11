// Single-scan eye-scene estimate, not a complete ADT implementation.
// Sampling: Olander/Velden ADT 8.2.1 guide, sections 5C and 5H.
// Basin-dependent regression coefficients: SSEC McIDAS-V ADT Intensity.java.
export const ADT_GUIDE='https://tropic.ssec.wisc.edu/misc/adt/guides/ADTV8.2.1_Guide.pdf';
export const ADT_EYE_SOURCE='https://github.com/mcidasv/mcidasv/blob/master/edu/wisc/ssec/mcidasv/adt/Intensity.java';
const breaks=[30,9,-30,-42,-54,-64,-70,-76,-80,-84,-100];
const bases={atlantic:[1,2,3.25,4,4.75,5.25,5.75,6.5,7.25,7.75,8.25],pacific:[1.5,2.25,3.3,3.85,4.5,4.75,5.15,5.5,6,6.25,6.75]};
const mean=values=>values.reduce((a,b)=>a+b,0)/values.length;
const radians=degrees=>degrees*Math.PI/180;
export function distanceBearing(latitude,longitude,lat,lon){
  const a=radians(latitude),b=radians(lat),dl=radians(((lon-longitude+540)%360)-180),dy=b-a;
  const h=Math.sin(dy/2)**2+Math.cos(a)*Math.cos(b)*Math.sin(dl/2)**2;
  return {distance:12742*Math.asin(Math.sqrt(Math.min(1,h))),bearing:(Math.atan2(Math.sin(dl)*Math.cos(b),Math.cos(a)*Math.sin(b)-Math.sin(a)*Math.cos(b)*Math.cos(dl))*180/Math.PI+360)%360};
}
export function eyeRegression({eye,cloud,symmetry,domain='pacific',largeEye=false}){
  if(!Object.hasOwn(bases,domain)||![eye,cloud,symmetry].every(Number.isFinite)||cloud>9||cloud<=-100||symmetry<0)throw Error('The eye-scene temperatures are outside the supported range.');
  const i=breaks.findIndex((t,i)=>i<breaks.length-1&&cloud<=t&&cloud>breaks[i+1]);
  const f=(cloud-breaks[i])/(breaks[i+1]-breaks[i]),base=bases[domain][i]+f*(bases[domain][i+1]-bases[domain][i]);
  let t=Math.min(9,base+(domain==='atlantic'?.011:.015)*(eye-cloud)-.015*symmetry);
  if(largeEye)t=Math.min(t-.5,6.5);
  return Math.round(t*10)/10;
}
export function calculateEyeDvorak(grid,{latitude,longitude,domain,largeEye=false}={}){
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)throw Error('Enter a valid eye-center latitude and longitude.');
  if(!grid?.temperature?.length||grid.latitude?.length!==grid.temperature.length||grid.longitude?.length!==grid.temperature.length)throw Error('Load a calibrated infrared scan first.');
  const samples=[],rings=Array.from({length:28},()=>[]);let eye=-Infinity,nearest=Infinity;
  for(let i=0;i<grid.temperature.length;i++){
    const t=grid.temperature[i],lat=grid.latitude[i],lon=grid.longitude[i];
    if(!Number.isFinite(t)||t< -110||t>50||!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(lon)||Math.abs(lon)>360)continue;
    const {distance,bearing}=distanceBearing(latitude,longitude,lat,lon);nearest=Math.min(nearest,distance);
    if(distance>216)continue;
    const sample={t,d:distance,sector:Math.min(23,Math.floor(bearing/15))};samples.push(sample);
    if(distance<=24)eye=Math.max(eye,t);
    if(distance>=24&&distance<136)rings[Math.floor((distance-24)/4)].push(sample);
  }
  if(!Number.isFinite(eye)||nearest>12)throw Error('The eye center is outside the scan or the sampling is too coarse. Recenter or load a larger scan at native resolution.');
  // A partial cold arc must never be treated as a closed eyewall. Require
  // native pixels in all 24 sectors before considering a 4-km ring.
  const complete=rings.map((pixels,i)=>({pixels,radius:24+4*i,sectors:new Set(pixels.map(p=>p.sector))})).filter(r=>r.sectors.size===24);
  if(!complete.length)throw Error('There is not enough complete ring coverage. Increase the source image dimensions and check the eye center.');
  const ring=complete.reduce((best,r)=>Math.max(...r.pixels.map(p=>p.t))<Math.max(...best.pixels.map(p=>p.t))?r:best);
  const inner=Math.max(24,ring.radius-40),outer=inner+80,annulus=samples.filter(p=>p.d>=inner&&p.d<=outer),sectors=Array.from({length:24},()=>[]);
  for(const p of annulus)sectors[p.sector].push(p.t);
  if(sectors.some(p=>p.length<3))throw Error('The surrounding cloud ring is cut off or undersampled. Load a larger scan at native resolution.');
  // Coverage in both radial halves rejects an annulus clipped by the image edge.
  if([0,1].some(half=>new Set(annulus.filter(p=>(p.d<inner+40?0:1)===half).map(p=>p.sector)).size!==24))throw Error('The full surrounding cloud ring is not covered by this scan. Increase the source image dimensions.');
  const cloud=mean(annulus.map(p=>p.t)),averages=sectors.map(mean),symmetry=mean(Array.from({length:12},(_,i)=>Math.abs(averages[i]-averages[i+12]))),coldestWarmest=Math.max(...ring.pixels.map(p=>p.t));
  if(eye< -30||cloud> -50||eye-cloud<40||coldestWarmest> -40)throw Error('A clear warm eye surrounded by deep cloud could not be confirmed at this center. Adjust the eye center; for non-eye scenes use the archived ADT analysis below.');
  const selectedDomain=domain||((longitude>0&&longitude<180)?'pacific':'atlantic');
  return {rawT:eyeRegression({eye,cloud,symmetry,domain:selectedDomain,largeEye}),eye,cloud,symmetry,inner,outer,ringRadius:ring.radius,coldestWarmest,domain:selectedDomain,latitude,longitude,largeEye,timestamp:grid.timestamp};
}
const months=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
export function parseAdtHistory(text){
  const version=text.match(/ADT-Version\s+([\d.]+)/)?.[1]||'',records=[];
  for(const line of text.split(/\r?\n/)){
    const match=line.match(/^(\d{4})([A-Z]{3})(\d{2})\s+(\d{6})\s+/);if(!match)continue;
    const m=months.indexOf(match[2]);if(m<0)continue;
    const clock=match[4],timestamp=`${match[1]}-${String(m+1).padStart(2,'0')}-${match[3]}T${clock.slice(0,2)}:${clock.slice(2,4)}:${clock.slice(4)}Z`;
    if(!Number.isFinite(Date.parse(timestamp))||new Date(timestamp).toISOString().replace('.000Z','Z')!==timestamp||+clock.slice(0,2)>23||+clock.slice(2,4)>59||+clock.slice(4)>59)continue;
    const parts=line.trim().split(/\s+/),values=parts.slice(2,8).map(Number);
    if(values.length!==6||!values.every(Number.isFinite)||values[0]<1||values[0]>9||values.slice(3).some(v=>v<1||v>9))continue;
    const sceneIndex=parts.findIndex((p,i)=>i>=8&&/^(EYE(?:\/[LP])?|PINHOL|PINHOLE|LARGE|UNIFRM|EMBC|IRRCDO|CRVBND|SHEAR)$/.test(p));
    const position=line.match(/\s(-?\d+\.\d+)\s+(-?\d+\.\d+)\s+([A-Z][A-Z0-9_/-]*)\s+(\S+)\s+\d+\.\d+(?:\s|$)/);
    const eye=sceneIndex>1?Number(parts[sceneIndex-2]):NaN,cloud=sceneIndex>1?Number(parts[sceneIndex-1]):NaN;
    records.push({timestamp,ci:values[0],windKnots:values[2]>=0?values[2]:null,finalT:values[3],adjustedRawT:values[4],rawT:values[5],eye:Number.isFinite(eye)&&eye> -150?eye:null,cloud:Number.isFinite(cloud)&&cloud> -150?cloud:null,scene:sceneIndex<0?'Unavailable':parts[sceneIndex],latitude:position?+position[1]:null,longitude:position?-Number(position[2]):null,satellite:position?.[4]||'',version});
  }return records.sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
}
export function nearestAdt(records,timestamp,maxMinutes=90){
  const target=Date.parse(timestamp);if(!Number.isFinite(target))throw Error('Choose a valid scan time.');
  const record=records.reduce((best,r)=>!best||Math.abs(Date.parse(r.timestamp)-target)<Math.abs(Date.parse(best.timestamp)-target)?r:best,null);
  const offsetMinutes=record?(Date.parse(record.timestamp)-target)/60000:Infinity;
  return Math.abs(offsetMinutes)<=maxMinutes?{...record,offsetMinutes}:null;
}
