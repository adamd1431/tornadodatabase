import {RECON_FACTORS} from './recon-reduction-model.js';
const rad=Math.PI/180;
export const HDOB_SOURCE='https://www.nhc.noaa.gov/abouthdobs_2007.shtml';
export const finite=v=>typeof v==='number'&&Number.isFinite(v);
export const deltaLon=(a,b)=>((a-b+540)%360)-180;
export function distanceKm(a,b){const h=Math.sin((a.latitude-b.latitude)*rad/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(deltaLon(a.longitude,b.longitude)*rad/2)**2;return 12742.0176*Math.asin(Math.min(1,Math.sqrt(h)));}
export function centerAt(track,time){const t=Date.parse(time),points=track.filter(p=>finite(p.latitude)&&finite(p.longitude)).sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)),i=points.findIndex(p=>Date.parse(p.timestamp)>=t);if(i<0)return null;const b=points[i];if(Date.parse(b.timestamp)===t)return b;if(i===0)return null;const a=points[i-1],span=Date.parse(b.timestamp)-Date.parse(a.timestamp);if(span>21600000)return null;const f=(t-Date.parse(a.timestamp))/span;return {latitude:a.latitude+(b.latitude-a.latitude)*f,longitude:((a.longitude+deltaLon(b.longitude,a.longitude)*f+540)%360)-180};}
function value(s,min,max,scale=1){if(!/^[-+]?\d+$/.test(s)||/^9+$/.test(s))return null;const n=+s*scale;return n>=min&&n<=max?n:null;}
function coordinate(s,lat){if(!(lat?/^\d{4}[NS]$/:/^\d{5}[EW]$/).test(s))return null;const deg=+s.slice(0,-3),min=+s.slice(-3,-1);if(min>=60||deg>(lat?90:180))return null;const n=deg+min/60;if(n>(lat?90:180))return null;return /[SW]$/.test(s)?-n:n;}
// Decode the modern NHOP HDOB format. Flagged fields stay missing; SFMR is
// an observation in its own right, never a flight-level conversion target.
export function parseHdob(raw,{atcf,date,sourceUrl=''}={}){
  if(typeof raw!=='string'||raw.length>4000000||! /^(AL|EP|CP)\d{6}$/.test(atcf||''))return [];
  const rows=[],blocks=raw.split(/(?=^[A-Z0-9]+\s+\d{4}[AEC]\s+[^\r\n]*\bHDOB\s)/m);
  for(const block of blocks){const head=block.match(/^([A-Z0-9]+)\s+(\d{2})(\d{2})([AEC])\s+(.+?)\s+HDOB\s+\d+\s+(\d{8})\b/m);if(!head)continue;
    const basin={A:'AL',E:'EP',C:'CP'}[head[4]],day=head[6],year=+day.slice(0,4);if(basin+head[3]+year!==atcf)continue;
    const base=Date.UTC(year,+day.slice(4,6)-1,+day.slice(6,8));if(new Date(base).toISOString().slice(0,10).replaceAll('-','')!==day)continue;
    const mission=head[1]+' '+head[2]+head[3]+head[4],lines=block.slice(head.index+head[0].length).split(/\r?\n/);let offset=0,last=-1;
    for(const line of lines){const s=line.trim().split(/\s+/);if(s.length!==13||!/^([01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(s[0])||!/^\d{2}$/.test(s[12]))continue;
      const clock=+s[0].slice(0,2)*3600+(+s[0].slice(2,4))*60+(+s[0].slice(4));if(last-clock>43200)offset+=86400000;last=clock;const timestamp=new Date(base+offset+clock*1000).toISOString();if(date&&timestamp.slice(0,10)!==date)continue;
      const pos=+s[12][0],met=+s[12][1];if(pos>3||![0,1,2,3,4,5,6,9].includes(met))continue;
      let latitude=coordinate(s[1],true),longitude=coordinate(s[2],false);if(latitude===null||longitude===null)continue;if([1,3].includes(pos)){latitude=null;longitude=null;}
      const pressureBad=[2,3].includes(pos),windBad=[2,4,6,9].includes(met),sfmrBad=[3,5,6,9].includes(met),tempBad=[1,4,5,9].includes(met);
      let flightPressureMb=value(s[3],0,1100,.1);if(flightPressureMb!==null&&flightPressureMb<100)flightPressureMb+=1000;
      let surfacePressureMb=flightPressureMb>=550?value(s[5],0,1100,.1):null;if(surfacePressureMb!==null&&surfacePressureMb<100)surfacePressureMb+=1000;if(surfacePressureMb!==null&&surfacePressureMb<800)surfacePressureMb=null;
      let temperatureC=tempBad?null:value(s[6],-100,60,.1),dewpointC=tempBad?null:value(s[7],-100,60,.1);if(dewpointC!==null&&temperatureC!==null&&dewpointC>temperatureC)dewpointC=null;
      const direction=windBad?null:value(s[8].slice(0,3),0,360),windKt=windBad?null:value(s[8].slice(3),0,250),peakWindKt=windBad?null:value(s[9],0,250),sfmrKt=sfmrBad?null:value(s[10],0,250);
      rows.push({timestamp,mission,aircraft:head[1],stormName:head[5].trim(),latitude,longitude,flightPressureMb:pressureBad?null:flightPressureMb,heightM:pressureBad?null:value(s[4],0,20000),surfacePressureMb:pressureBad?null:surfacePressureMb,temperatureC,dewpointC,direction,windKt,peakWindKt,sfmrKt,rainMmH:sfmrBad?null:value(s[11],0,500),flags:s[12],sourceUrl});
    }
  }return rows;
}
export function cleanObservations(rows){const unique=new Map();for(const r of rows)unique.set(r.mission+'|'+r.timestamp,r);const points=[...unique.values()].sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
  for(let i=1;i<points.length-1;i++){const a=points[i-1],b=points[i],c=points[i+1];if(a.mission!==b.mission||b.mission!==c.mission||![a,b,c].every(r=>finite(r.latitude)&&finite(r.longitude)))continue;const speed=(x,y)=>distanceKm(x,y)/((Date.parse(y.timestamp)-Date.parse(x.timestamp))/3600000)/1.852;if(speed(a,b)>650&&speed(b,c)>650){points[i]={...b,latitude:null,longitude:null};}}
  return points;
}
export function standardSurface(row,peak=false){if(!finite(row.flightPressureMb))return null;const level=[700,850,925].find(p=>Math.abs(row.flightPressureMb-p)<=25),wind=peak?row.peakWindKt:row.windKt;return level&&finite(wind)?wind*RECON_FACTORS[level].eyewall:null;}
export function prepareFlights(rows,track){const grouped=new Map();for(const r of cleanObservations(rows)){const center=centerAt(track,r.timestamp),radiusKm=center&&finite(r.latitude)&&finite(r.longitude)?distanceKm(r,center):null,point={...r,center,radiusKm,surfaceKt:standardSurface(r),surfacePeakKt:standardSurface(r,true)};if(!grouped.has(r.mission))grouped.set(r.mission,[]);grouped.get(r.mission).push(point);}
  return [...grouped].map(([id,points])=>{const core=points.filter(r=>finite(r.radiusKm)&&r.radiusKm<=300*1.852&&finite(r.heightM)&&r.heightM<=5000),max=key=>core.filter(r=>finite(r[key])).sort((a,b)=>b[key]-a[key])[0]||null,wind=max('windKt');return {id,aircraft:points[0].aircraft,start:points[0].timestamp,end:points.at(-1).timestamp,points,coreCount:core.length,wind,peak:max('peakWindKt'),sfmr:max('sfmrKt'),surface:max('surfaceKt'),surfacePeak:max('surfacePeakKt')};}).sort((a,b)=>a.start.localeCompare(b.start));
}
