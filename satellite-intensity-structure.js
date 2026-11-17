import {distanceBearing} from './satellite-dvorak-model.js';
// SSEC's four-direction -45.15 C eye-size retrieval, with a conservative three-pixel
// resolution check. The derived regression radius is an IR feature, not a
// measured RMW. https://github.com/mcidasv/mcidasv/blob/master/edu/wisc/ssec/mcidasv/adt/Data.java
export function infraredEyeStructure(grid,eye){
  const {width,height,temperature:t,latitude:lat,longitude:lon}=grid;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width*height!==t.length)return {irRmwKm:null,eyeRadiusKm:null};
  let center=-1,nearest=Infinity;
  for(let i=0;i<t.length;i++){if(!Number.isFinite(t[i]))continue;const d=distanceBearing(eye.latitude,eye.longitude,lat[i],lon[i]).distance;if(d<nearest){nearest=d;center=i;}}
  const empty={irRmwKm:null,eyeRadiusKm:null};if(center<0||nearest>12)return empty;
  const threshold=eye.cloud>=-50.15?(eye.eye+2*eye.cloud)/3:-45.15;let edges=[];
  for(let k=0;k<5;k++){
    if(!Number.isFinite(t[center])||t[center]<=threshold)return empty;
    const y=Math.floor(center/width),x=center%width;edges=[];
    for(const [dx,dy]of [[-1,0],[1,0],[0,-1],[0,1]]){let px=x,py=y,edge=-1;
      for(let step=1;step<200;step++){px+=dx;py+=dy;if(px<0||px>=width||py<0||py>=height)return empty;const i=py*width+px;if(!Number.isFinite(t[i])||distanceBearing(lat[center],lon[center],lat[i],lon[i]).distance>100)return empty;if(t[i]<=threshold){edge=i;break;}}
      if(edge<0)return empty;edges.push(edge);
    }
    center=Math.floor((Math.floor(edges[2]/width)+Math.floor(edges[3]/width))/2)*width+Math.floor(((edges[0]%width)+(edges[1]%width))/2);
  }
  const radii=edges.map(i=>distanceBearing(lat[center],lon[center],lat[i],lon[i]).distance),radius=radii.reduce((a,b)=>a+b,0)/4;
  const neighbor=[center+1,center+width].filter(i=>i<t.length).map(i=>distanceBearing(lat[center],lon[center],lat[i],lon[i]).distance),pixel=Math.max(...neighbor);
  if(!Number.isFinite(radius)||radius<3*pixel||radius>80)return {...empty,pixelKm:pixel,unresolved:true};
  return {eyeRadiusKm:radius,irRmwKm:2.8068+.8361*radius,pixelKm:pixel,unresolved:false};
}
export function causalThermalHistory(rows,time){
  const target=Date.parse(time);if(!Number.isFinite(target))return null;
  // Only observations at or before the requested six-hour lag may be used.
  const lag=target-21600000,prior=[...rows].filter(r=>Number.isFinite(Date.parse(r.timestamp))&&Date.parse(r.timestamp)<=lag&&lag-Date.parse(r.timestamp)<=5400000&&r.scene==='EYE'&&[r.eye,r.cloud,r.rawT].every(Number.isFinite)).sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp))[0];
  return prior?{timestamp:prior.timestamp,eye:prior.eye,cloud:prior.cloud,rawT:prior.rawT}:null;
}
