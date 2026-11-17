import {ownerPeakReference} from './satellite-intensity-peak.js';
const seasons=new Map();
export async function loadOwnerReference(client,storm,{refresh=false}={}){
  const year=Number(storm.season);
  if(refresh)seasons.delete(year);
  if(!seasons.has(year))seasons.set(year,(async()=>{
    const rows=[];
    for(let from=0;;from+=500){const {data,error}=await client.from('tropical_cyclones').select('id,status,name,year,owner_estimated_winds_mph,owner_estimated_pressure_mb').eq('status','approved').eq('year',year).order('id',{ascending:true}).range(from,from+499);if(error)throw error;rows.push(...data||[]);if(!data||data.length<500)break;}
    return rows;
  })().catch(error=>{seasons.delete(year);throw error;}));
  return ownerPeakReference(await seasons.get(year),storm);
}
