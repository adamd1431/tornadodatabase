import {bareName,keyText} from './ibtracs-model.js';
export const MPH_PER_KNOT=1.1507794480235425;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
export function ownerPeakReference(rows,storm){
  if(!storm)return null;
  const name=keyText(bareName(storm.name));
  const matches=rows.filter(r=>r.status==='approved'&&Number(r.year)===Number(storm.season)&&keyText(bareName(r.name))===name);
  if(matches.length!==1)return null;
  const number=v=>['number','string'].includes(typeof v)&&String(v).trim()!==''&&finite(Number(v))?Number(v):null;
  const r=matches[0],wind=number(r.owner_estimated_winds_mph),pressure=number(r.owner_estimated_pressure_mb),windMph=wind!==null&&wind>=0&&wind<=500?wind:null;
  return {id:r.id,name:r.name,year:Number(r.year),windMph,windKt:windMph===null?null:windMph/MPH_PER_KNOT,pressureMb:pressure!==null&&pressure>0?pressure:null,sourceUrl:'https://tornadodatabase.vercel.app/tropical-cyclone.html?id='+encodeURIComponent(r.id),kind:'owner-peak-estimate'};
}
export function hourlyScanTimes(anchor,{hours=12,start,end}={}){
  const at=Date.parse(anchor),begin=Date.parse(start),finish=Date.parse(end);
  if(!finite(at)||![6,12,24].includes(hours))throw Error('Choose a valid scan time and a 6, 12 or 24-hour search window.');
  const hour=Math.floor(at/3600000)*3600000,times=[];
  for(let offset=-hours;offset<=hours;offset++){const t=hour+offset*3600000;if((finite(begin)&&t<begin)||(finite(finish)&&t>finish))continue;times.push(new Date(t).toISOString());}
  return times;
}
// Selection has no owner/best-track intensity input. Wind maximum and pressure
// minimum may occur in different images, and must retain their own timestamps.
export function summarizeHourlyPeaks(rows){
  const unique=new Map();for(const r of rows){if(r.error||!r.acquiredAt||!finite(Date.parse(r.acquiredAt))||!finite(r.windKt)&&!finite(r.pressureMb))continue;if(!unique.has(r.acquiredAt))unique.set(r.acquiredAt,r);}
  const accepted=[...unique.values()].sort((a,b)=>Date.parse(a.acquiredAt)-Date.parse(b.acquiredAt));
  const windPeak=accepted.filter(r=>finite(r.windKt)).reduce((a,b)=>!a||b.windKt>a.windKt?b:a,null),pressurePeak=accepted.filter(r=>finite(r.pressureMb)).reduce((a,b)=>!a||b.pressureMb<a.pressureMb?b:a,null);
  return {accepted,windPeak,pressurePeak,requested:rows.length,distinct:accepted.length,failed:rows.filter(r=>r.error).length,edgePeak:[windPeak,pressurePeak].some(p=>p&&(p===accepted[0]||p===accepted.at(-1)))};
}
export function compareOwnerPeak(summary,reference){
  return {reference,windDifferenceKt:finite(summary.windPeak?.windKt)&&finite(reference?.windKt)?summary.windPeak.windKt-reference.windKt:null,pressureDifferenceMb:finite(summary.pressurePeak?.pressureMb)&&finite(reference?.pressureMb)?summary.pressurePeak.pressureMb-reference.pressureMb:null};
}
export function edgeExpansionTimes(summary,anchor,attempted,limits={}){
  if(!summary.accepted.length||!attempted.length)return [];
  const first=summary.accepted[0].acquiredAt,last=summary.accepted.at(-1).acquiredAt,peaks=[summary.windPeak,summary.pressurePeak];
  const left=peaks.some(r=>r?.acquiredAt===first),right=peaks.some(r=>r?.acquiredAt===last),min=Math.min(...attempted.map(Date.parse)),max=Math.max(...attempted.map(Date.parse));
  return hourlyScanTimes(anchor,{...limits,hours:24}).filter(t=>left&&Date.parse(t)<min||right&&Date.parse(t)>max);
}
