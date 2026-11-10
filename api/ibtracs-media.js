import manifest from '../ibtracs-data/index.json' with {type:'json'};
import {gatherIbtracsMedia} from '../ibtracs-media-sources.js';
const cached=new Map();
export default {async fetch(request){
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed.',{status:405});
  const params=new URL(request.url).searchParams,sid=params.get('sid'),storm=manifest.storms.find(s=>s.id===sid);
  if(!storm)return new Response('Cyclone not found.',{status:404,headers:{'Cache-Control':'no-store'}});
  if(params.has('fresh'))cached.delete(sid);let entry=cached.get(sid);
  if(!entry||entry.until<Date.now()){entry={until:Date.now()+3600000,data:gatherIbtracsMedia(storm).then(data=>{if(data.warnings.length)entry.until=Date.now()+60000;return data;}).catch(e=>{cached.delete(sid);throw e;})};cached.set(sid,entry);if(cached.size>150)cached.delete(cached.keys().next().value);}
  try{const data=await entry.data;return new Response(request.method==='HEAD'?null:JSON.stringify(data),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':params.has('fresh')?'no-store':data.warnings.length?'public, max-age=60':'public, max-age=3600','X-Content-Type-Options':'nosniff'}});}catch{return new Response('Image sources unavailable.',{status:502,headers:{'Cache-Control':'no-store'}});}
}};
