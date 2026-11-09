import {observationContext,observationKey} from './live-storms-frame-cache.js';
export const renderedLoopKey=(storm,product,frame)=>'scientific-1800-v1|'+observationKey(observationContext(storm,product),frame)+'|'+JSON.stringify([storm.name,storm.windKt??null,storm.pressureMb??null]);
// Finished, full-color PNG plots stay on this device. Never cache credentials,
// database responses or raw observations here, and never clear other caches.
export function createLoopDiskCache({storage,origin=globalThis.location?.origin||'https://cache.invalid',hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join(''),now=()=>Date.now(),maxBytes=100*1048576,maxEntries=60,ttl=24*3600000}={}){
  const name='tornado-satellite-png-v1',prefix=origin+'/__satellite_loop_cache/v1/';let opened=null,writes=Promise.resolve();
  const open=()=>opened||(opened=Promise.resolve().then(()=>(storage===undefined?globalThis.caches:storage)?.open(name)).catch(()=>null));
  const url=async key=>prefix+await hash(key)+'.png';
  const own=request=>String(request.url||request).startsWith(prefix);
  async function trim(cache){
    const rows=await Promise.all((await cache.keys()).filter(own).map(async request=>{const response=await cache.match(request);return {request,at:Number(response?.headers.get('X-Cached-At')),size:Number(response?.headers.get('X-Frame-Size'))||0};}));
    let bytes=rows.reduce((sum,r)=>sum+r.size,0),count=rows.length;
    for(const r of rows.sort((a,b)=>a.at-b.at))if(!Number.isFinite(r.at)||now()-r.at>ttl||count>maxEntries||bytes>maxBytes){await cache.delete(r.request);bytes-=r.size;count--;}
  }
  return {
    async get(key){try{
      const cache=await open();if(!cache)return null;const request=await url(key),response=await cache.match(request);if(!response)return null;
      const age=now()-Number(response.headers.get('X-Cached-At')),validAt=response.headers.get('X-Scan-Time');
      if(!Number.isFinite(age)||age<0||age>ttl||!Number.isFinite(Date.parse(validAt))||response.headers.get('Content-Type')!=='image/png'){await cache.delete(request);return null;}
      const blob=await response.blob();if(!blob.size||blob.size>maxBytes)return null;return {key,blob,validAt};
    }catch{return null;}},
    set(key,row){
      const job=writes.then(async()=>{const cache=await open();if(!cache||!row.blob?.size||row.blob.size>maxBytes||row.blob.type!=='image/png'||!Number.isFinite(Date.parse(row.validAt)))return false;
        await cache.put(await url(key),new Response(row.blob,{headers:{'Content-Type':'image/png','X-Scan-Time':row.validAt,'X-Cached-At':String(now()),'X-Frame-Size':String(row.blob.size)}}));await trim(cache);return true;
      }).catch(()=>false);writes=job;return job;
    },
    flush:()=>writes
  };
}
export async function runLoopJobs(items,{concurrency=2,signal,work}){
  let index=0,stopped=false;
  async function lane(number){while(!stopped&&!signal?.aborted){const i=index++;if(i>=items.length)return;try{await work(items[i],number);}catch(error){stopped=true;throw error;}}}
  await Promise.all(Array.from({length:Math.min(Math.max(1,concurrency),items.length)},(_,i)=>lane(i)));
}
