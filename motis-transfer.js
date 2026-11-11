import {unpackSnapshot} from './ibtracs-model.js';
import {normalizeMotisPoints,motisScansForStorm,MOTIS_DATASET} from './motis-model.js?v=poci-csv-2';
export function motisCkzLink(storm,scan){
  return 'wind-pressure.html?'+new URLSearchParams({motis:storm.id,scan:scan.at,satellite:scan.satellite});
}
export function motisCkzPreset(storm,scan){
  const value=n=>n===null||n===undefined?'':String(n);
  return {fields:{method:'ckz',windUnit:'kt',outputUnit:'kt',pressureMb:value(scan.pressureMb),windKnots:'',latitude:value(scan.latitude),environmentMb:value(scan.pociMb),radiusType:'roci',radiusNmi:'',radiusUnit:'nmi',knackRociNmi:'',knackRadiusUnit:'nmi',motionKnots:''},mode:'pressure',storm:storm.name,at:scan.at,agency:'MOTIS',poci:scan.pociMb,longitude:scan.longitude,source:MOTIS_DATASET,missing:[...(scan.pociMb===null?['POCI / environmental pressure']:[]),'ROCI','six-hour forward speed']};
}
export async function loadMotisCkzPreset(search,read=fetch){
  const params=new URLSearchParams(search);if(!params.has('motis'))return null;
  const sid=params.get('motis'),at=params.get('scan')||'',satellite=params.get('satellite');
  if(!/^\d{7}[NS]\d{5}$/.test(sid)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/.test(at)||!['TERRA','AQUA'].includes(satellite))throw Error('Invalid MOTIS scan link.');
  const response=await read('ibtracs-data/index.json');if(!response.ok)throw Error('The cyclone index could not be loaded.');const manifest=await response.json(),storm=manifest.storms?.find(s=>s.id===sid);if(!storm)throw Error('The selected cyclone is not in the archive.');
  const points=normalizeMotisPoints(await unpackSnapshot(await read('motis-data/points.json.gz?v=poci-2'))),matches=motisScansForStorm(points,storm).filter(scan=>scan.at===at&&scan.satellite===satellite);
  if(matches.length!==1)throw Error('This exact MOTIS scan could not be resolved. Select a scan again in IBTrACS.');
  return {storm,scan:matches[0],preset:motisCkzPreset(storm,matches[0])};
}
