import {SATELLITES,normalizeMcfetch} from './mcfetch-model.js';
import {decodeTemperatureGrid} from './mcfetch-netcdf.js';
import {createTrackLoader,positionAt,suggestSatellite} from './satellite-storm-lookup.js';
import {unpackSnapshot,columnMap,numberValue,recordTime,position} from './ibtracs-model.js';
import {regularGrid,sixHourTrackMotion,nearestObservation} from './satellite-intensity-model.js';
import {createHsdClient} from './live-storms-hsd-client.js';
import {decodePackedGrid} from './live-storms-grid.js';
const tracks=createTrackLoader(),years=new Map(),hsd=createHsdClient();
export async function jsonRead(url,options={}){const response=await fetch(url,options);const data=await response.json();if(!response.ok)throw Error(data.message||'The source could not be reached.');return data;}
export async function thermalContext(atcf,grid,{signal}={}){
  if(! /^(AL|EP|WP)\d{6}$/.test(atcf||''))return null;
  try{const data=await jsonRead('/api/satellite-dvorak?'+new URLSearchParams({atcf,time:grid.timestamp,view:'thermal'}),{signal});return data.thermalHistory||null;}catch{return null;}
}
export async function stormRecords(storm,manifest){
  if(!years.has(storm.season))years.set(storm.season,fetch(`ibtracs-data/${storm.season}.json.gz`).then(unpackSnapshot).catch(error=>{years.delete(storm.season);throw error;}));
  const year=await years.get(storm.season),col=columnMap(manifest.columns),records=year.storms.find(r=>r.id===storm.id)?.records||[];
  return records.map(row=>{const p=position(row,col,'USA');return {timestamp:recordTime(row,col),latitude:p?.lat,longitude:p?.lon,windKt:numberValue(row,col,'USA_WIND'),pressureMb:numberValue(row,col,'USA_PRES'),pociMb:numberValue(row,col,'USA_POCI'),rociNmi:numberValue(row,col,'USA_ROCI')};}).filter(r=>r.timestamp);
}
export function reportedEnvironment(records,time){const row=nearestObservation(records,time);return {pociMb:row?.pociMb>800?row.pociMb:null,rociNmi:row?.rociNmi>0?row.rociNmi:null,motionKt:sixHourTrackMotion(records.filter(r=>Number.isFinite(r.latitude)&&Number.isFinite(r.longitude)),time),timestamp:row?.timestamp||null};}
export async function loadHistoricScan(storm,time,{signal}={}){
  const date=time.slice(0,10),clock=time.slice(11,16),rows=await tracks(Number(date.slice(0,4))),track=rows.find(r=>r.id===storm.id);if(signal?.aborted)throw new DOMException('Cancelled','AbortError');if(!track)throw Error('A satellite-era position is unavailable for this cyclone.');
  let center=positionAt(track,date,clock),satellite=suggestSatellite(date,center.longitude),info=SATELLITES.find(r=>r.id===satellite);if(!info)throw Error('No supported satellite archive covers this date and position.');
  const settings=normalizeMcfetch({satellite,date,time:clock,latitude:center.latitude,longitude:center.longitude,band:info.infrared,coverage:info.modern?'FD':'',renderMode:'plot',autoSatellite:true,autoCoverage:true,plotExtent:5,width:info.modern?500:350,height:info.modern?500:350,magLine:1,magElement:1,map:false});
  const scan=await jsonRead('/api/mcfetch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...settings,action:'scan'}),signal});
  center=positionAt(track,scan.date,scan.time);
  const actual={...settings,satellite:scan.satellite,band:scan.band,coverage:scan.coverage,date:scan.date,time:scan.time,latitude:center.latitude,longitude:center.longitude};
  const response=await fetch('/api/mcfetch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(actual),signal});if(!response.ok){const data=await response.json();throw Error(data.message||'The calibrated image could not be retrieved.');}
  const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.byteLength>4194304)throw Error('The scan exceeds the size limit.');const grid=decodeTemperatureGrid(bytes);
  if(grid.band!==scan.band)throw Error('The returned infrared band does not match the request.');
  // Navigation uses the acquisition time from the data, not the requested clock.
  center=positionAt(track,grid.timestamp.slice(0,10),grid.timestamp.slice(11,19));
  const thermalHistory=await thermalContext(storm.atcf[0],grid,{signal});
  return {grid,center,atcf:storm.atcf[0],thermalHistory,name:storm.name,season:storm.season,sid:storm.id,satellite:scan.satellite,source:'UW–Madison SSEC McFETCH · calibrated infrared',sourceUrl:'https://mcfetch.ssec.wisc.edu/',requestedAt:time};
}
export async function loadLiveScan(storm,{signal,onProgress}={}){
  const data=await jsonRead('/api/live-storms?'+new URLSearchParams({view:'charts',storm:storm.id,product:'spectrum'}),{signal}),sat=data.satellite,frame=sat.frames.at(-1);if(!frame)throw Error('No calibrated scan is available.');
  let raster;if(sat.kind==='hsd')raster=await hsd.load(frame,{signal,onProgress});else raster=decodePackedGrid(await jsonRead('/api/live-storms?'+new URLSearchParams({view:'grid',storm:storm.id,product:'spectrum',scan:frame.scan}),{signal}));
  const grid=regularGrid(raster),thermalHistory=await thermalContext(storm.id,grid,{signal});
  return {grid,thermalHistory,center:{latitude:storm.latitude,longitude:storm.longitude},atcf:storm.id,name:storm.name,season:Number(storm.id.slice(-4)),satellite:sat.satellite,source:sat.source,sourceUrl:sat.sourceUrl,advisory:storm,positionAt:storm.validAt};
}
export function closeIntensitySources(){hsd.close();}
