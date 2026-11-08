import {SATELLITES,normalizeMcfetch,MCFETCH_MAX_BYTES} from './mcfetch-model.js';
export const INVENTORY_ENDPOINT='https://inventory.ssec.wisc.edu/inventory/assets/python/query.py';
const canonical=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const utc=value=>Date.parse(String(value).trim().replace(' ','T').replace(/Z?$/,'Z'));
export function inventoryUrl(input){
  const s=normalizeMcfetch(input),at=utc(s.date+' '+s.time),hour=Math.floor(at/3600000)*3600000;
  const format=ms=>new Date(ms).toISOString().slice(0,19).replace('T',' ');
  const name=s.satellite.startsWith('MET')?'MET-'+s.satellite.slice(3):SATELLITES.find(row=>row.id===s.satellite).label.toUpperCase();
  const url=new URL(INVENTORY_ENDPOINT);url.search=new URLSearchParams({start_time:format(hour-3*3600000),end_time:format(hour+4*3600000),satellite:name,output:'json'});return url;
}
export function hasBand(map,band){
  return String(map).split(/[\s,;]+/).some(token=>{const m=token.match(/^(\d+)(?:-(\d+))?$/);return m&&band>=+m[1]&&band<=+(m[2]||m[1]);});
}
export function selectInventoryScan(data,input){
  const s=normalizeMcfetch(input),requested=utc(s.date+' '+s.time),candidates=[];
  if(!Array.isArray(data?.data))throw Error('The SSEC inventory could not be read.');
  for(const satellite of data.data){
    if(canonical(satellite.n)!==canonical(s.satellite)||!Array.isArray(satellite.h)||!Array.isArray(satellite.d))continue;
    const columns=Object.fromEntries(satellite.h.map((v,i)=>[String(v).toLowerCase(),i]));
    for(const row of satellite.d){
      const field=name=>row[columns[name]],time=utc(field('imagetime')),coverage=String(field('coverage')||'').toUpperCase();
      if(!Number.isFinite(time)||Math.abs(time-requested)>3*3600000||!hasBand(field('bandmap'),s.band)||!['FD','NH','SH','CONUS','MESO1','MESO2'].includes(coverage))continue;
      if(s.coverage&&s.coverage!==coverage)continue;
      if((coverage==='NH'&&s.latitude<0)||(coverage==='SH'&&s.latitude>0))continue;
      // With automatic coverage, use full-disk/hemisphere imagery rather than
      // assuming an unknown CONUS/mesoscale footprint contains the cyclone.
      if(!s.coverage&&!['FD','NH','SH'].includes(coverage))continue;
      const subLat=Number(field('sub_lat')),subLon=Number(field('sub_lon'));
      if(field('sub_lat')!==null&&field('sub_lon')!==null&&String(field('sub_lat')).trim()!==''&&String(field('sub_lon')).trim()!==''&&Number.isFinite(subLat)&&Number.isFinite(subLon)){
        const rad=Math.PI/180,cos=Math.sin(s.latitude*rad)*Math.sin(subLat*rad)+Math.cos(s.latitude*rad)*Math.cos(subLat*rad)*Math.cos((s.longitude+subLon)*rad);
        if(cos<0.151)continue; // Below the geostationary Earth's visible limb.
      }
      candidates.push({time,coverage});
    }
  }
  candidates.sort((a,b)=>Math.abs(a.time-requested)-Math.abs(b.time-requested)||a.time-b.time||Number(b.coverage==='FD')-Number(a.coverage==='FD'));
  if(!candidates.length){const error=Error('No scan covering this position and band was found within three hours. Try another satellite, date, band or coverage.');error.code='no-scan';throw error;}
  const scan=candidates[0],stamp=new Date(scan.time).toISOString();
  return {satellite:s.satellite,date:stamp.slice(0,10),time:stamp.slice(11,19),coverage:scan.coverage,band:s.band,offsetMinutes:(scan.time-requested)/60000,source:'SSEC inventory',requested:{date:s.date,time:s.time}};
}
async function inventoryData(url,{read,cache}){
  const key=url.href,existing=cache.get(key);let data;
  if(existing&&Date.now()-existing.at<600000)data=existing.data;
  else{
    const response=await read(url,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{Accept:'application/json'}});
    if(!response.ok)throw Error('SSEC inventory is unavailable. Try again shortly.');
    const reader=response.body?.getReader();if(!reader)throw Error('SSEC inventory returned no data.');
    let size=0;const chunks=[];
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MCFETCH_MAX_BYTES){await reader.cancel();throw Error('The SSEC inventory response is too large.');}chunks.push(value);}}finally{reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{throw Error('The SSEC inventory could not be read.');}
    if(!Array.isArray(data?.data))throw Error('The SSEC inventory could not be read.');
    if(cache.size>=32)cache.delete(cache.keys().next().value);cache.set(key,{at:Date.now(),data});
  }
  return data;
}
export async function readInventory(input,{read=fetch,cache=new Map()}={}){
  const settings=normalizeMcfetch(input),options={read,cache},url=inventoryUrl(settings);
  const primary=await inventoryData(url,options);let unavailable;
  try{return selectInventoryScan(primary,settings);}catch(error){if(error.code!=='no-scan')throw error;unavailable=error;}
  if(settings.autoCoverage&&settings.coverage){try{return {...selectInventoryScan(primary,{...settings,coverage:''}),coverageFallbackFrom:settings.coverage};}catch(error){if(error.code!=='no-scan')throw error;}}
  if(!settings.autoSatellite)throw unavailable;
  // Operational-era guesses cannot account for archive outages. Check the actual
  // inventory once across satellites, using each sensor's own infrared band.
  url.searchParams.delete('satellite');const data=await inventoryData(url,options),alternatives=[];
  for(const block of data.data){
    const satellite=SATELLITES.find(row=>canonical(row.id)===canonical(block.n));if(!satellite||satellite.id===settings.satellite||!Array.isArray(block.h)||!Array.isArray(block.d))continue;
    const latColumn=block.h.indexOf('sub_lat'),lonColumn=block.h.indexOf('sub_lon');
    const location=block.d.find(row=>row[latColumn]!=null&&row[lonColumn]!=null&&String(row[latColumn]).trim()!==''&&String(row[lonColumn]).trim()!==''&&Number.isFinite(Number(row[latColumn]))&&Number.isFinite(Number(row[lonColumn])));if(!location)continue;
    const rad=Math.PI/180,cos=Math.sin(settings.latitude*rad)*Math.sin(Number(location[latColumn])*rad)+Math.cos(settings.latitude*rad)*Math.cos(Number(location[latColumn])*rad)*Math.cos((settings.longitude+Number(location[lonColumn]))*rad);
    let coverage=settings.coverage;if(settings.autoCoverage)coverage=satellite.modern?'FD':satellite.id==='MTSAT1R'&&settings.latitude>0&&['00','06','12','18'].includes(settings.time.slice(0,2))?'NH':'';
    let scan;try{scan=selectInventoryScan(data,{...settings,satellite:satellite.id,band:satellite.infrared,coverage,autoSatellite:false});}catch(error){if(error.code!=='no-scan')throw error;if(settings.autoCoverage&&coverage)try{scan=selectInventoryScan(data,{...settings,satellite:satellite.id,band:satellite.infrared,coverage:'',autoSatellite:false});}catch(error){if(error.code!=='no-scan')throw error;}}
    if(scan)alternatives.push({scan,cos});
  }
  alternatives.sort((a,b)=>b.cos-a.cos||Math.abs(a.scan.offsetMinutes)-Math.abs(b.scan.offsetMinutes));
  if(!alternatives.length){const error=Error('No available infrared scan covering this storm was found within three hours, including other archived satellites. Try another time or choose a satellite manually.');error.code='no-scan';throw error;}
  return {...alternatives[0].scan,fallbackFrom:settings.satellite};
}
