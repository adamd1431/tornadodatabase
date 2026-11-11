import {keyText} from './ibtracs-model.js';
export const MOTIS_SOURCE='https://motis.dapiya.cn/';
export const MOTIS_DATA_URL='https://motis.dapiya.cn/data/modis_points.json';
export const EYE_CLARITY={1:'Good',2:'Fair',3:'Poor'};
export function normalizeMotisPoints(data){
  if(!Array.isArray(data)||data.length>20000)throw Error('The MOTIS scan dataset is invalid.');
  return data.map(p=>{
    if(!p||typeof p.name!=='string'||!Number.isInteger(p.year)||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}Z$/.test(p.scanTime)||!Number.isFinite(p.pressure)||p.pressure<700||p.pressure>1100||!Number.isFinite(p.lat)||Math.abs(p.lat)>90||!Number.isFinite(p.lon)||Math.abs(p.lon)>360||!EYE_CLARITY[p.category]||!['TERRA','AQUA'].includes(p.satellite))throw Error('The MOTIS scan dataset contains an invalid observation.');
    const at=p.scanTime.replace(' ','T').replace('Z',':00Z');if(!Number.isFinite(Date.parse(at))||new Date(at).toISOString().slice(0,16)!==at.slice(0,16))throw Error('A MOTIS scan has an invalid timestamp.');
    return {name:p.name,year:p.year,at,pressureMb:p.pressure,latitude:p.lat,longitude:((p.lon+540)%360)-180,satellite:p.satellite,eyeClarity:EYE_CLARITY[p.category]};
  });
}
export function motisScansForStorm(points,storm){
  if(!storm)return [];const years=new Set([storm.season,Number(storm.start?.slice(0,4)),Number(storm.end?.slice(0,4))]),name=keyText(storm.name),start=Date.parse(storm.start?.replace(' ','T')+'Z'),end=Date.parse(storm.end?.replace(' ','T')+'Z');
  return points.filter(p=>keyText(p.name)===name&&years.has(p.year)&&(!Number.isFinite(start)||Date.parse(p.at)>=start-43200000)&&(!Number.isFinite(end)||Date.parse(p.at)<=end+43200000)).sort((a,b)=>a.at.localeCompare(b.at)||a.satellite.localeCompare(b.satellite));
}
export function nearestMotisScan(scans,at){
  const time=Date.parse(at);if(!scans.length||!Number.isFinite(time))return null;
  return scans.reduce((best,p)=>Math.abs(Date.parse(p.at)-time)<Math.abs(Date.parse(best.at)-time)?p:best,scans[0]);
}
