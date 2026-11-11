import {keyText} from './ibtracs-model.js';
export const MOTIS_SOURCE='https://motis.dapiya.cn/';
export const MOTIS_DATA_URL='https://motis.dapiya.cn/data/modis_points.json';
export const MOTIS_CSV_URL='https://zenodo.org/records/22224266/files/MOTIS_dataset_260212.csv?download=1';
export const MOTIS_DATASET='https://zenodo.org/records/22224266';
export const EYE_CLARITY={1:'Good',2:'Fair',3:'Poor'};
export function normalizeMotisPoints(data){
  if(!Array.isArray(data)||data.length>20000)throw Error('The MOTIS scan dataset is invalid.');
  return data.map(p=>{
    if(!p||typeof p.name!=='string'||!Number.isInteger(p.year)||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}Z$/.test(p.scanTime)||!Number.isFinite(p.pressure)||p.pressure<700||p.pressure>1100||!Number.isFinite(p.lat)||Math.abs(p.lat)>90||!Number.isFinite(p.lon)||Math.abs(p.lon)>360||!EYE_CLARITY[p.category]||!['TERRA','AQUA'].includes(p.satellite))throw Error('The MOTIS scan dataset contains an invalid observation.');
    const at=p.scanTime.replace(' ','T').replace('Z',':00Z');if(!Number.isFinite(Date.parse(at))||new Date(at).toISOString().slice(0,16)!==at.slice(0,16))throw Error('A MOTIS scan has an invalid timestamp.');
    if(p.poci!==undefined&&p.poci!==null&&(!Number.isFinite(p.poci)||p.poci<800||p.poci>1100))throw Error('A MOTIS observation has an invalid POCI.');
    return {name:p.name,year:p.year,at,pressureMb:p.pressure,latitude:p.lat,longitude:((p.lon+540)%360)-180,satellite:p.satellite,eyeClarity:EYE_CLARITY[p.category],pociMb:p.poci??null};
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
const csvFields=line=>[...line.matchAll(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g)].map(m=>m[1].replace(/^"|"$/g,'').replaceAll('""','"').trim());
const scanKey=p=>[keyText(p.name),p.year,p.scanTime,p.satellite,(((p.lon+540)%360)-180).toFixed(3),p.lat.toFixed(3)].join('|');
export function augmentMotisPoci(points,text){
  const lines=text.trim().replace(/^\uFEFF/,'').split(/\r?\n/),columns=csvFields(lines.shift()),col=Object.fromEntries(columns.map((c,i)=>[c,i]));
  for(const field of ['Name','Year','Date','Time','Satellite','Lon','Lat','POCI','P MOTIS'])if(!Object.hasOwn(col,field))throw Error('The full MOTIS CSV is missing '+field+'.');
  const index=new Map();
  for(const line of lines){
    const row=csvFields(line),get=k=>row[col[k]];if(row.length!==columns.length)throw Error('Invalid MOTIS CSV row.');
    const date=String(get('Date')).padStart(4,'0'),time=String(get('Time')).padStart(4,'0'),p={name:get('Name'),year:Number(get('Year')),scanTime:`${get('Year')}-${date.slice(0,2)}-${date.slice(2)} ${time.slice(0,2)}:${time.slice(2)}Z`,satellite:get('Satellite'),lon:Number(get('Lon')),lat:Number(get('Lat')),pressure:Number(get('P MOTIS')),poci:get('POCI')===''?null:Number(get('POCI'))};
    if(!Number.isFinite(p.lon)||!Number.isFinite(p.lat)||!Number.isFinite(p.pressure)||p.poci!==null&&(!Number.isFinite(p.poci)||p.poci<800||p.poci>1100))throw Error('Invalid MOTIS CSV measurement.');
    const key=scanKey(p);if(index.has(key))throw Error('Ambiguous MOTIS CSV scan.');index.set(key,p);
  }
  return points.map(point=>{const row=index.get(scanKey(point));const {poci:previous,...base}=point;return {...base,poci:row&&Math.abs(row.pressure-point.pressure)<.005?row.poci:null};});
}
