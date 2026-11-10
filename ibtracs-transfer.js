import {AGENCIES,BASINS,bareName,keyText,designation,columnMap,rawValue,numberValue,recordTime,position,sixHourMotion,peakRecords,unpackSnapshot} from './ibtracs-model.js';
const MILES_PER_KNOT=1852/1609.344;
const unnamed=new Set(['UNNAMED','NOTNAMED','NONAME','MISSING','UNKNOWN']);
export function observationLink(page,storm,row,col,agency='USA'){return page+'?'+new URLSearchParams({ibtracs:storm.id,at:rawValue(row,col,'ISO_TIME'),agency});}
export async function loadIbtracsObservation(search,read=fetch){
  const params=new URLSearchParams(search),sid=params.get('ibtracs');if(!params.has('ibtracs'))return null;
  const at=params.get('at')||'',agency=params.get('agency')||'USA';
  if(!/^\d{7}[NS]\d{5}$/.test(sid)||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(at)||!AGENCIES.some(a=>a.id===agency))throw Error('Invalid IBTrACS observation link.');
  const response=await read('ibtracs-data/index.json');if(!response.ok)throw Error('The IBTrACS archive could not be loaded.');const manifest=await response.json(),storm=manifest.storms?.find(s=>s.id===sid);if(!storm)throw Error('This cyclone is not in the IBTrACS snapshot.');
  const data=await unpackSnapshot(await read(`ibtracs-data/${storm.season}.json.gz`)),records=data.storms.find(s=>s.id===sid)?.records,col=columnMap(manifest.columns),index=records?.findIndex(r=>rawValue(r,col,'ISO_TIME')===at);
  if(index===undefined||index<0)throw Error('This observation is not in the IBTrACS snapshot.');return {storm,records,col,index,row:records[index],agency,manifest};
}
export function ckzObservation({storm,records,col,index,agency}){
  const row=records[index],p=position(row,col,agency),pressure=numberValue(row,col,agency+'_PRES'),poci=numberValue(row,col,agency+'_POCI'),roci=numberValue(row,col,agency+'_ROCI'),motion=sixHourMotion(records,col,index,agency),wind=agency==='USA'?numberValue(row,col,'USA_WIND'):null;
  const value=n=>n===null||n===undefined?'':String(n),fields={method:'ckz',windUnit:'kt',outputUnit:'kt',pressureMb:value(pressure>0?pressure:null),windKnots:value(wind),latitude:value(p?.lat),environmentMb:value(poci>0?poci+2:null),radiusType:'roci',radiusNmi:value(roci>0?roci:null),radiusUnit:'nmi',knackRociNmi:value(roci>0?roci:null),knackRadiusUnit:'nmi',motionKnots:value(motion)};
  const missing=[['pressureMb','central pressure'],['latitude','latitude'],['environmentMb','POCI / environmental pressure'],['knackRociNmi','ROCI'],['motionKnots','six-hour forward speed']].filter(([key])=>fields[key]==='').map(([,label])=>label);
  return {fields,mode:'pressure',storm:storm.name,at:recordTime(row,col),agency,missing,poci:poci>0?poci:null,positionSource:p?.source||null};
}
function basinCode(value){const s=keyText(value);if(Object.hasOwn(BASINS,s))return s;if(s.includes('PACIFIC'))return s.includes('WEST')?'WP':s.includes('EAST')||s.includes('CENTRAL')?'EP':s.includes('SOUTH')?'SP':null;if(s.includes('ATLANTIC'))return s.includes('SOUTH')?'SA':s.includes('NORTH')?'NA':null;if(s.includes('INDIAN'))return s.includes('SOUTH')?'SI':s.includes('NORTH')?'NI':null;return null;}
export function matchingDatabaseCyclones(rows,storm){
  const names=keyText(storm.name),years=new Set([storm.season,Number(storm.start?.slice(0,4)),Number(storm.end?.slice(0,4))]),ids=new Set(storm.atcf.map(a=>a.toUpperCase())),shorts=new Set(storm.atcf.map(a=>keyText(designation(a,storm))));
  return (rows||[]).filter(row=>{
    if(row.status==='rejected')return false;const sid=row.ibtracs_sid||row.ibtracs_id;if(sid)return sid===storm.id;
    if(!years.has(Number(row.year)))return false;const basin=basinCode(row.basin);if(basin&&!storm.basins.includes(basin))return false;
    const full=String(row.usa_atcf_id||row.atcf_id||'').toUpperCase();if(full&&ids.has(full))return true;
    const reported=String(row.jtwc_designation||'').toUpperCase().match(/\b(\d{2}[WABSPCLE])\b/)?.[1];if(reported&&shorts.has(reported))return true;
    return !unnamed.has(names)&&keyText(bareName(row.name))===names;
  });
}
function stormType(status,basin){if(['SI','SP','NI'].includes(basin)&&['HU','HR','ST','TY','TC'].includes(status))return 'Cyclone';if(['HU','HR'].includes(status))return 'Hurricane';if(status==='ST')return 'Super Typhoon';if(status==='TY')return 'Typhoon';if(status==='TS')return 'Tropical Storm';if(status==='TD')return 'Tropical Depression';if(['SI','SP','NI'].includes(basin))return 'Cyclone';return 'Tropical Cyclone';}
export function cyclonePeakDraft(storm,records,col){
  const peaks=peakRecords(records,col,'USA'),row=records[peaks.wind?.index??peaks.pressure?.index??0],basin=rawValue(row,col,'BASIN')||storm.basins[0],status=rawValue(row,col,'USA_STATUS'),type=stormType(status,basin),atcf=rawValue(row,col,'USA_ATCF_ID').split(':').find(Boolean)||storm.atcf[0]||'',code=designation(atcf,storm),name=unnamed.has(keyText(storm.name))?(code||storm.id):storm.name.toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase()),wind=peaks.wind?.value??null,pressure=peaks.pressure?.value??null;
  return {values:{name:`${type} ${name}`,year:storm.season,peak_winds_mph:wind===null?'':Math.round(wind*MILES_PER_KNOT/5)*5,peak_winds_kts:wind===null?'':wind,wind_input_unit:'kts',lowest_pressure_mb:pressure??'',jtwc_designation:code?`${type} ${code}`:'',basin:BASINS[basin]||basin||''},windAt:peaks.wind?.time??null,pressureAt:peaks.pressure?.time??null,source:'USA / NHC · JTWC',missing:[...(!peaks.wind?['USA peak wind']:[]),...(!peaks.pressure?['USA lowest pressure']:[])]};
}
export async function loadDatabaseCycloneCandidates(client,storm){
  const years=[...new Set([storm.season,Number(storm.start.slice(0,4)),Number(storm.end.slice(0,4))])],rows=[];
  for(let from=0;;from+=1000){const {data,error}=await client.from('tropical_cyclones').select('id,name,year,status,jtwc_designation,basin').in('year',years).neq('status','rejected').order('id').range(from,from+999);if(error)throw error;if(!Array.isArray(data))throw Error('Existing cyclones could not be checked.');rows.push(...data);if(data.length<1000)return rows;}
}
