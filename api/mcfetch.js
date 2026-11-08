import {mcfetchUrl,normalizeMcfetch,mcfetchKey,MCFETCH_MAX_BYTES} from '../mcfetch-model.js';
import {validateImageBytes} from '../browser-extension/image-import/common.js';

const json=(status,message,headers={})=>new Response(JSON.stringify({message}),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});

// The caller's own key exists only in this request. Never log the body, key,
// upstream URL or response text; upstream error pages may contain credentials.
export function createMcfetchHandler({read=globalThis.fetch,now=()=>new Date()}={}) {
  return {async fetch(request) {
    if(request.method!=='POST')return json(405,'Use the Satellite Archive page to request an image.',{Allow:'POST'});
    const origin=request.headers.get('origin');
    if(origin&&origin!==new URL(request.url).origin)return json(403,'Open Satellite Archive on the database website.');
    if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))return json(415,'Send image settings as JSON.');
    let settings,key;
    try {
      if(Number(request.headers.get('content-length'))>8192)return json(413,'This request is too large.');
      const text=await request.text();
      if(new TextEncoder().encode(text).length>8192)return json(413,'This request is too large.');
      const input=JSON.parse(text);
      settings=normalizeMcfetch(input,now());key=mcfetchKey(input.apiKey);
    } catch(error) {return json(400,error instanceof SyntaxError?'The image settings could not be read.':error.message);}
    try {
      const upstream=await read(mcfetchUrl(settings,key),{redirect:'error',signal:AbortSignal.timeout(25000),headers:{Accept:'image/png,image/gif,image/jpeg'}});
      if(!upstream.ok){await upstream.body?.cancel();return json(upstream.status===401||upstream.status===403?403:502,'McFETCH could not supply this image. Check your access key, account limits, satellite, date and coverage.');}
      const mime=(upstream.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
      if(!['image/png','image/jpeg','image/gif'].includes(mime)){await upstream.body?.cancel();return json(422,'No image was returned. Check the satellite, band and scan time in the SSEC inventory. Your account may also limit recent dates.');}
      if(Number(upstream.headers.get('content-length'))>MCFETCH_MAX_BYTES){await upstream.body?.cancel();return json(413,'The returned image is too large. Choose smaller pixel dimensions.');}
      const chunks=[];let size=0;const reader=upstream.body?.getReader();
      if(!reader)return json(502,'McFETCH returned an empty image.');
      try {
        while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MCFETCH_MAX_BYTES){await reader.cancel();return json(413,'The returned image is too large. Choose smaller pixel dimensions.');}chunks.push(value);}
      } finally {reader.releaseLock();}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      try{validateImageBytes(bytes,mime);}catch{return json(422,'McFETCH did not return a valid image. Check the scan settings and try again.');}
      return new Response(bytes,{headers:{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
    } catch {return json(502,'McFETCH is unavailable or the image request timed out. Wait a moment, then try again.');}
  }};
}
export default createMcfetchHandler();
