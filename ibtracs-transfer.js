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
  const value=n=>n===null||n===undefined?'':String(n),fields={method:'ckz',windUnit:'kt',outputUnit:'kt',pressureMb:value(pressure>0?pressure:null),windKnots:value(wind),latitude:value(p?.lat),environmentMb:value(poci>0?poci:null),radiusType:'roci',radiusNmi:value(roci>0?roci:null),radiusUnit:'nmi',knackRociNmi:value(roci>0?roci:null),knackRadiusUnit:'nmi',motionKnots:value(motion)};
  const missing=[['pressureMb','central pressure'],['latitude','latitude'],['environmentMb','POCI / environmental pressure'],['knackRociNmi','ROCI'],['motionKnots','six-hour forward speed']].filter(([key])=>fields[key]==='').map(([,label])=>label);
  return {fields,mode:'pressure',storm:storm.name,at:recordTime(row,col),agency,missing,poci:poci>0?poci:null,positionSource:p?.source||null};
}
export function selectCkzPeak(storm,records,col,basis='wind'){
  if(!['wind','pressure'].includes(basis))throw Error('Choose a valid peak definition.');
  const fixes=records.map((row,index)=>({row,index,wind:numberValue(row,col,'USA_WIND'),pressure:numberValue(row,col,'USA_PRES'),time:Date.parse(recordTime(row,col))})).filter(f=>Number.isFinite(f.time)&&(basis==='wind'?f.wind>0:f.pressure>0));
  fixes.sort((a,b)=>basis==='wind'?(b.wind-a.wind)||((a.pressure>0?a.pressure:Infinity)-(b.pressure>0?b.pressure:Infinity))||(a.time-b.time):(a.pressure-b.pressure)||((b.wind??-Infinity)-(a.wind??-Infinity))||(a.time-b.time));
  const peak=fixes[0];if(!peak)throw Error(basis==='wind'?'No USA / NHC · JTWC wind peak is available. Try the minimum-pressure option.':'No USA / NHC · JTWC central pressure is available for this cyclone.');
  return {storm,records,col,index:peak.index,row:peak.row,agency:'USA',peakBasis:basis,peakLabel:basis==='wind'?'Peak 1-minute wind':'Minimum central pressure'};
}
export function selectCkzTime(storm,records,col,at){
  if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(at||''))throw Error('Choose an observation time from this cyclone’s record.');
  const index=records.findIndex(row=>rawValue(row,col,'ISO_TIME')===at);
  if(index<0)throw Error('This cyclone has no IBTrACS observation at the selected time.');
  return {storm,records,col,index,row:records[index],agency:'USA',peakBasis:'time',peakLabel:'Selected UTC time'};
}
// ROCI is carried as source context. It is not the RMW used by Schloemer.
export function schloemerIsobarImport(preset){
  const poci=Number(preset.fields.environmentMb),roci=Number(preset.fields.knackRociNmi);
  return {fields:{method:'schloemer',environmentMb:preset.fields.environmentMb},pociMb:preset.fields.environmentMb!==''&&Number.isFinite(poci)&&poci>0?poci:null,rociNmi:preset.fields.knackRociNmi!==''&&Number.isFinite(roci)&&roci>0?roci:null};
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
export function stormType(status,basin,wind){
  // IBTrACS also uses HU as a generic hurricane-strength status in older WP records.
  const strong=wind!==null&&wind!==undefined?wind>=64:['HU','HR','ST','TY','TC'].includes(status);
  if(basin==='WP'&&(wind>=130||status==='ST'))return 'Super Typhoon';
  if(strong){if(basin==='WP')return 'Typhoon';if(['NA','EP','SA'].includes(basin))return 'Hurricane';return 'Cyclone';}
  if(wind>=34||status==='TS')return 'Tropical Storm';
  if((wind!==null&&wind!==undefined&&wind>0)||status==='TD')return 'Tropical Depression';
  return ['NI','SI','SP'].includes(basin)?'Cyclone':'Tropical Cyclone';
}
export function cycloneBasinName(basin,atcf=''){
  if(basin==='EP'&&atcf.startsWith('CP'))return 'Central Pacific';
  return {NA:'Northern Atlantic',EP:'Eastern Pacific',WP:'Western Pacific',NI:'Northern Indian',SI:'Southern Indian',SP:'Southern Pacific',SA:'Southern Atlantic'}[basin]||BASINS[basin]||basin||'';
}
export function cyclonePeakDraft(storm,records,col,{identity,report}={}){
  const peaks=peakRecords(records,col,'USA'),row=records[peaks.wind?.index??peaks.pressure?.index??0],basin=rawValue(row,col,'BASIN')||storm.basins[0],status=rawValue(row,col,'USA_STATUS'),wind=peaks.wind?.value??null,type=stormType(status,basin,wind),atcf=rawValue(row,col,'USA_ATCF_ID').split(':').find(Boolean)||storm.atcf[0]||'',code=designation(atcf,storm),name=unnamed.has(keyText(storm.name))?(code||storm.id):storm.name.toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase());
  const alias=identity?.sid===storm.id&&typeof identity.alternateName==='string'?identity.alternateName.trim().slice(0,80):'',reportPressure=!peaks.pressure&&report?.sid===storm.id&&report?.status==='found'&&report.pressureMb>=800&&report.pressureMb<=1100&&/^https:\/\/www\.metoc\.navy\.mil\/jtwc\/products\/atcr\/\d{4}atcr\.pdf(?:#page=\d+)?$/.test(report.sourceUrl||'')?report:null,pressure=peaks.pressure?.value??reportPressure?.pressureMb??null;
  return {values:{name:`${type} ${name}${alias?' ('+alias+')':''}`,year:storm.season,peak_winds_mph:wind===null?'':Math.round(wind*MILES_PER_KNOT/5)*5,peak_winds_kts:wind===null?'':wind,wind_input_unit:'kts',lowest_pressure_mb:pressure??'',jtwc_designation:code?`${type} ${code}`:'',basin:cycloneBasinName(basin,atcf)},windAt:peaks.wind?.time??null,pressureAt:peaks.pressure?.time??null,pressureReport:reportPressure,identitySource:alias?identity.sourceUrl:null,source:'USA / NHC · JTWC',missing:[...(!peaks.wind?['USA peak wind']:[]),...(pressure===null?['USA lowest pressure']:[])]};
}
export async function prepareCyclonePeakDraft(storm,records,col,{identity,read=fetch}={}){
  const initial=cyclonePeakDraft(storm,records,col,{identity});
  if(initial.values.lowest_pressure_mb!==''||!storm.atcf.some(id=>/^(?:WP|IO|SH|SI|SP)\d{6}$/.test(id)))return initial;
  try{
    const response=await read('api/jtwc-report?'+new URLSearchParams({sid:storm.id}),{signal:AbortSignal.timeout(55000)}),report=await response.json();
    const draft=cyclonePeakDraft(storm,records,col,{identity,report});
    if(!draft.pressureReport)draft.reportWarning=report.message||'No verified JTWC report pressure is available. Enter a verified pressure manually.';
    return draft;
  }catch{return {...initial,reportWarning:'The JTWC annual report could not be checked. Enter a verified pressure manually or try adding this cyclone again.'};}
}
export async function loadDatabaseCycloneCandidates(client,storm){
  const years=[...new Set([storm.season,Number(storm.start.slice(0,4)),Number(storm.end.slice(0,4))])],rows=[];
  for(let from=0;;from+=1000){const {data,error}=await client.from('tropical_cyclones').select('id,name,year,status,jtwc_designation,basin').in('year',years).neq('status','rejected').order('id').range(from,from+999);if(error)throw error;if(!Array.isArray(data))throw Error('Existing cyclones could not be checked.');rows.push(...data);if(data.length<1000)return rows;}
}
