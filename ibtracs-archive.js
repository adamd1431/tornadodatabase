import {AGENCIES,columnMap,rawValue,position,unpackSnapshot} from './ibtracs-model.js';
import {suggestSatellite} from './satellite-storm-lookup.js';
export async function loadIbtracsArchivePreset(search,read=fetch){
  const params=new URLSearchParams(search),sid=params.get('ibtracs');if(!sid)return null;
  const time=params.get('at')||'',agency=params.get('agency')||'USA';
  if(!/^\d{7}[NS]\d{5}$/.test(sid)||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(time)||!AGENCIES.some(a=>a.id===agency))throw Error('Invalid IBTrACS observation link.');
  const response=await read('ibtracs-data/index.json');if(!response.ok)throw Error('The IBTrACS archive could not be loaded.');const manifest=await response.json(),summary=manifest.storms?.find(s=>s.id===sid);if(!summary)throw Error('This cyclone is not in the IBTrACS snapshot.');
  const year=await unpackSnapshot(await read('ibtracs-data/'+summary.season+'.json.gz')),storm=year.storms.find(s=>s.id===sid),col=columnMap(manifest.columns),row=storm?.records.find(r=>rawValue(r,col,'ISO_TIME')===time),p=position(row,col,agency);
  if(!row||!p||time<'1974-01-01'||summary.season<1974)throw Error('This observation has no usable Satellite Archive position.');
  const at=Date.parse(time.replace(' ','T')+'Z');
  return {values:{lookupName:summary.name,lookupYear:summary.season,scanDate:time.slice(0,10),scanTime:time.slice(11,16).replace(':','')},storm:{...summary,start:at/60000,points:[[0,p.lat,p.lon,p.source==='USA'?0:1]]},position:{latitude:p.lat,longitude:p.lon,source:(p.source.startsWith('IBTrACS')?p.source:'IBTrACS '+p.source)+' position',method:'record',times:[new Date(at).toISOString()]},satellite:suggestSatellite(time.slice(0,10),p.lon)};
}
