import {distanceBearing} from './satellite-dvorak-model.js';

// Dvorak (1995), EIR step 2c, as published by the Australian Bureau of
// Meteorology. E-number uses the narrowest complete cold-ring width;
// eye adjustment uses the coldest enclosing shade, with no minimum width.
export const EIR_SOURCE='https://tropic.ssec.wisc.edu/real-time/amsu/herndon/AMSTC_Intensity/DVK_EIR_diagram_600dpi.pdf';
const NM=1.852,rad=Math.PI/180,mean=a=>a.reduce((s,n)=>s+n,0)/a.length;
const shades=['WMG','OW','DG','MG','LG','B','W','CMG','CDG'];
const limits=[9,-30,-42,-54,-64,-70,-76,-81];
export function bdShade(t){
  if(!Number.isFinite(t)||t< -110||t>50)throw Error('A calibrated infrared temperature is required.');
  const index=limits.findIndex(limit=>t>limit);return shades[index<0?8:index];
}
const rings=[['CMG',-76,6.5,30*NM],['W',-70,6,30*NM],['B',-64,5.5,30*NM],['LG',-54,5,24*NM],['MG',-42,4.5,24*NM],['DG',-30,4.5,18*NM],['OW',9,4,18*NM]];
const adjustments={
  OW:[0,-.5],DG:[0,0,-.5],MG:[0,0,-.5,-.5],LG:[.5,0,0,-.5,-.5],
  B:[1,.5,0,0,-.5,-.5],W:[1,.5,.5,0,0,-1,-1],
  CMG:[1,.5,.5,0,0,-.5,-1],CDG:[1,.5,.5,0,0,-.5,-1]
};
export function eirEyeAdjustment(eye,ring,{largeEye=false,elongated=false}={}){
  const value=adjustments[ring]?.[shades.indexOf(bdShade(eye))];
  if(!Number.isFinite(value))throw Error('The eye is not warmer than its enclosing ring.');
  return largeEye||elongated?Math.min(0,value):value;
}
export function eirBanding(centralFeature,{banding=0,met=null}={}){
  if(![0,.5,1].includes(banding))throw Error('Choose a banding contribution of 0, 0.5 or 1.0.');
  if(banding&&(!Number.isFinite(met)||met<1||met>9||centralFeature>=met||centralFeature+banding>met))throw Error('Banding needs a history-derived MET above the eye-pattern value and at least as high as the adjusted result.');
  return centralFeature+banding;
}

// Samples remain native brightness temperatures, independent of enhancement,
// storm identity, agency intensities, or any saved owner estimate.
function polarEye(grid,{latitude,longitude}){
  const n=grid?.temperature?.length,w=grid?.width;
  if(!n||grid.latitude?.length!==n||grid.longitude?.length!==n||!Number.isInteger(w)||w<2||n%w)throw Error('The calibrated scan needs its native raster dimensions.');
  const points=[],byIndex=new Map();let nearest=null;
  for(let i=0;i<n;i++){
    const t=grid.temperature[i],lat=grid.latitude[i],lon=grid.longitude[i];
    if(!Number.isFinite(t)||t< -110||t>50||!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(lon)||Math.abs(lon)>360)continue;
    const {distance:d,bearing:b}=distanceBearing(latitude,longitude,lat,lon);if(d>230)continue;
    const p={i,t,d,x:d*Math.sin(b*rad),y:d*Math.cos(b*rad)};points.push(p);byIndex.set(i,p);if(!nearest||d<nearest.d)nearest=p;
  }
  if(!nearest||nearest.d>12)throw Error('The selected eye is outside the native scan.');
  const horizontal=[],vertical=[];
  for(const p of points)if(p.d<=32){for(const [delta,list]of [[1,horizontal],[w,vertical]]){const q=byIndex.get(p.i+delta);if(q&&(delta!==1||Math.floor(q.i/w)===Math.floor(p.i/w)))list.push(Math.hypot(q.x-p.x,q.y-p.y));}}
  const median=a=>{a.sort((a,b)=>a-b);return a.length?a[Math.floor(a.length/2)]:NaN;};
  const resolution=Math.max(median(horizontal),median(vertical));
  if(!Number.isFinite(resolution)||resolution>12||resolution<=0)throw Error('The native scan is too coarse to measure an eye-pattern ring.');
  const cell=Math.max(2,resolution),buckets=new Map(),key=(x,y)=>`${x},${y}`;
  for(const p of points){const k=key(Math.floor(p.x/cell),Math.floor(p.y/cell));if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(p);}
  function sample(x,y){
    let best=null,d2=(resolution*.9)**2;const bx=Math.floor(x/cell),by=Math.floor(y/cell);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const p of buckets.get(key(bx+dx,by+dy))||[]){const d=(p.x-x)**2+(p.y-y)**2;if(d<=d2){best=p;d2=d;}}
    return best?.t??NaN;
  }
  const step=Math.max(1,Math.min(2,resolution/2)),radii=Array.from({length:Math.floor(216/step)+1},(_,i)=>i*step);
  const rays=Array.from({length:72},(_,i)=>{const a=i*5*rad;return radii.map(r=>sample(r*Math.sin(a),r*Math.cos(a)));});
  return {radii,rays,resolution,step};
}
function coldRuns(values,radii,threshold){
  const runs=[];let start=-1;
  const crossing=(a,b)=>radii[a]+(radii[b]-radii[a])*(threshold-values[a])/(values[b]-values[a]);
  for(let i=0;i<=values.length;i++){
    const cold=Number.isFinite(values[i])&&values[i]<=threshold;
    if(cold&&start<0)start=i;
    if(!cold&&start>=0){const end=i-1,left=start>0&&Number.isFinite(values[start-1])?crossing(start-1,start):radii[start],right=i<values.length&&Number.isFinite(values[i])?crossing(end,i):radii[end];runs.push({inner:left,outer:right,width:right-left});start=-1;}
  }
  return runs;
}
export function measureEirEye(grid,options={}){
  const {latitude,longitude,eye,largeEye=false,banding=0,met=null}=options;
  if(![latitude,longitude,eye].every(Number.isFinite)||Math.abs(latitude)>90||Math.abs(longitude)>180)throw Error('Enter a valid eye center and calibrated eye temperature.');
  const {radii,rays,resolution}=polarEye(grid,options),profiles=[];
  let enclosingTemp=Infinity,enclosingRadius=null;
  for(let i=0;i<radii.length;i++)if(radii[i]>=24&&radii[i]<=136&&rays.every(ray=>Number.isFinite(ray[i]))){const warmest=Math.max(...rays.map(ray=>ray[i]));if(warmest<enclosingTemp){enclosingTemp=warmest;enclosingRadius=radii[i];}}
  if(!Number.isFinite(enclosingTemp)||enclosingTemp> -30)throw Error('No complete cold ring was resolved around this eye.');
  for(const [shade,threshold,eNumber,requiredWidth]of rings){
    const runs=rays.map(ray=>coldRuns(ray,radii,threshold));let best=null;
    for(const radius of radii)if(radius>=24&&radius<=136){const encircling=runs.map(r=>r.find(run=>run.inner<=radius&&run.outer>=radius));if(encircling.some(r=>!r))continue;
      const narrowest=Math.min(...encircling.map(r=>r.width));if(!best||narrowest>best.width)best={width:narrowest,inner:Math.max(...encircling.map(r=>r.inner)),outer:Math.min(...encircling.map(r=>r.outer)),radius};
    }
    profiles.push({shade,threshold,eNumber,requiredWidth,width:best?.width??0,qualifies:!!best&&best.width>=requiredWidth,inner:best?.inner??null,outer:best?.outer??null,radius:best?.radius??null});
  }
  const selected=profiles.find(r=>r.qualifies);if(!selected)throw Error('The complete cold ring is too narrow for the EIR eye-pattern method.');
  const eyeRadii=rays.map(ray=>{const i=ray.findIndex(t=>Number.isFinite(t)&&t<=-30);if(i<1||radii[i]>70||ray.slice(0,i).some(t=>!Number.isFinite(t)))return null;return radii[i-1]+(radii[i]-radii[i-1])*(-30-ray[i-1])/(ray[i]-ray[i-1]);});
  const diameters=eyeRadii.every(Number.isFinite)?eyeRadii.slice(0,36).map((r,i)=>r+eyeRadii[i+36]):null;
  // Do not impose a shape penalty for a one-pixel ambiguity at the 2/3 rule.
  const major=diameters?Math.max(...diameters):null,minor=diameters?Math.min(...diameters):null,elongated=major!==null&&(minor+resolution)/(major-resolution)<=2/3,isLarge=largeEye||major!==null&&major-resolution>=45*NM;
  if(!diameters)throw Error('The eye boundary is not fully resolved. Recenter the eye or use a higher-resolution scan.');
  const eyeAdjustment=eirEyeAdjustment(eye,bdShade(enclosingTemp),{largeEye:isLarge,elongated});
  const shapeAdjustment=elongated&&selected.eNumber<=4.5&&eyeAdjustment>=0?-.5:0;
  const centralFeature=selected.eNumber+eyeAdjustment+shapeAdjustment,dataT=eirBanding(centralFeature,{banding,met});
  return {dataT,centralFeature,eNumber:selected.eNumber,eyeAdjustment,shapeAdjustment,banding,met,eyeShade:bdShade(eye),ringShade:selected.shade,adjustmentShade:bdShade(enclosingTemp),ringTemperature:enclosingTemp,ringRadius:enclosingRadius,narrowestWidthKm:selected.width,requiredWidthKm:selected.requiredWidth,widthMarginKm:selected.width-selected.requiredWidth,resolutionKm:resolution,nearWidthThreshold:selected.width-selected.requiredWidth<resolution*2,eyeDiameterKm:mean(diameters),eyeMajorKm:major,eyeMinorKm:minor,eyeUndersampled:minor<resolution*3,elongated,largeEye:isLarge,profiles,source:EIR_SOURCE};
}
