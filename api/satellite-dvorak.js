import manifest from '../ibtracs-data/index.json' with {type:'json'};
import {parseAdtHistory,nearestAdt} from '../satellite-dvorak-model.js';
const cache=new Map();
export function adtArchiveCandidates(atcf,longitude=0){
  const m=String(atcf).match(/^(AL|EP|CP|WP|IO|SH)(\d{2})(\d{4})$/);if(!m||+m[3]<2000||+m[3]>new Date().getUTCFullYear())return [];
  const letters={AL:['L'],EP:['E'],CP:['C'],WP:['W'],IO:longitude>=75?['B','A']:['A','B'],SH:longitude>=135?['P','S']:['S','P']}[m[1]];
  return letters.map(letter=>`https://tropic.ssec.wisc.edu/real-time/adt/archive${m[3]}/${m[2]}${letter}-list.txt`);
}
export function createAdtHandler({read=fetch,storms=manifest.storms}={}){return {async fetch(request){
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed.',{status:405,headers:{Allow:'GET, HEAD'}});
  const url=new URL(request.url),atcf=url.searchParams.get('atcf')||'',time=url.searchParams.get('time')||'',storm=storms.find(s=>s.atcf?.includes(atcf));
  if(!storm||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(time)||!Number.isFinite(Date.parse(time))||new Date(time).toISOString().slice(0,19)!==time.slice(0,19))return Response.json({message:'Choose a tracked cyclone and a valid scan time.'},{status:400});
  const year=+atcf.slice(-4),actualYear=new Date(time).getUTCFullYear();if(Math.abs(actualYear-year)>1)return Response.json({message:'The scan time does not match this cyclone’s season.'},{status:400});
  const candidates=adtArchiveCandidates(atcf,Number(url.searchParams.get('longitude'))||0);let unavailable=false;
  for(const sourceUrl of candidates){
    try{
      let entry=cache.get(sourceUrl);if(!entry||entry.until<Date.now()){
        entry={until:Date.now()+3600000,data:(async()=>{
          const response=await read(sourceUrl,{signal:AbortSignal.timeout(12000),redirect:'error'});if(response.status===404)return [];
          if(!response.ok)throw Error('Archive unavailable');
          const text=await response.text();if(text.length>2000000)throw Error('Archive too large');return parseAdtHistory(text);
        })()};cache.set(sourceUrl,entry);if(cache.size>40)cache.delete(cache.keys().next().value);
        entry.data.catch(()=>cache.delete(sourceUrl));
      }
      const record=nearestAdt(await entry.data,time);if(record){const body={status:'found',atcf,name:storm.name,sourceUrl,record};return new Response(request.method==='HEAD'?null:JSON.stringify(body),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=3600, s-maxage=3600','X-Content-Type-Options':'nosniff'}});}
    }catch{unavailable=true;}
  }
  return Response.json({status:unavailable?'unavailable':'not-found',message:unavailable?'CIMSS ADT is temporarily unavailable. The local eye-scene calculation still works.':'No CIMSS ADT record was found within 90 minutes of this scan. Older storms and some basins have no archived analysis.'},{status:unavailable?503:200,headers:{'Cache-Control':'no-store'}});
}};}
export default createAdtHandler();
