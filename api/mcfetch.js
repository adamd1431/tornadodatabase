import {mcfetchUrl,normalizeMcfetch,mcfetchKey,MCFETCH_MAX_BYTES} from '../mcfetch-model.js';
import {validateImageBytes} from '../browser-extension/image-import/common.js';
import {readInventory} from '../mcfetch-inventory.js';

const json=(status,message,headers={},code='')=>new Response(JSON.stringify({message,...(code?{code}:{})}),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
export function mcfetchError(text,status=200){
  // Return fixed messages only. Never echo an upstream page or URL: either may
  // contain the key, even when the upstream returns HTTP 200 for an error.
  if(/(?:quota|daily.{0,30}limit|transaction.{0,30}limit|limit.{0,30}exceed|too many requests)/i.test(text)||status===429)return {status:429,code:'quota',message:'Your McFETCH account has reached a data or transaction limit. Wait for its limit to reset or check your account with SSEC.'};
  if(status===401||status===403||/(?:invalid|unrecognized|unknown|incorrect|missing|not valid|not found|not authorized|not registered).{0,70}(?:dkey|api.?key|access.?key)|(?:dkey|api.?key|access.?key).{0,70}(?:invalid|unrecognized|unknown|incorrect|missing|not valid|not found|not authorized|not registered)|valid.{0,20}key.{0,30}required/i.test(text))return {status:403,code:'key',message:'McFETCH rejected the access key. Use an approved key issued to you by SSEC; the Discord bot’s access does not carry over to this page.'};
  if(status>=500)return {status:502,code:'upstream',message:'The SSEC image service is unavailable. Try again shortly.'};
  if(/(?:unsupported|invalid|unknown).{0,40}(?:output|format)|(?:output|format).{0,40}(?:unsupported|invalid|unknown)/i.test(text))return {status:422,code:'format',message:'McFETCH did not accept the requested image format. Please report this request to the site owner.'};
  return {status:422,code:'image',message:'McFETCH returned no image. If you have not received an approved SSEC key, register first. Otherwise check the selected archive scan and your account’s data access.'};
}
async function boundedBytes(response,max){
  if(Number(response.headers.get('content-length'))>max){await response.body?.cancel();throw Error('size');}
  const reader=response.body?.getReader();if(!reader)return new Uint8Array();
  let size=0;const chunks=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw Error('size');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
function imageMime(bytes){
  for(const mime of ['image/gif','image/png','image/jpeg'])try{validateImageBytes(bytes,mime);return mime;}catch{}
  return '';
}

// The caller's own key exists only in this request. Never log the body, key,
// upstream URL or response text; upstream error pages may contain credentials.
export function createMcfetchHandler({read=globalThis.fetch,now=()=>new Date()}={}) {
  const inventoryCache=new Map();
  return {async fetch(request) {
    if(request.method!=='POST')return json(405,'Use the Satellite Archive page to request an image.',{Allow:'POST'});
    const origin=request.headers.get('origin');
    if(origin&&origin!==new URL(request.url).origin)return json(403,'Open Satellite Archive on the database website.');
    if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))return json(415,'Send image settings as JSON.');
    let settings,key,action;
    try {
      if(Number(request.headers.get('content-length'))>8192)return json(413,'This request is too large.');
      const text=await request.text();
      if(new TextEncoder().encode(text).length>8192)return json(413,'This request is too large.');
      const input=JSON.parse(text);
      action=input?.action||'image';if(!['scan','image'].includes(action))throw Error('Choose an image request or archive lookup.');
      settings=normalizeMcfetch(input,now());if(action==='image')key=mcfetchKey(input.apiKey);
    } catch(error) {return json(400,error instanceof SyntaxError?'The image settings could not be read.':error.message);}
    if(action==='scan'){
      try{return new Response(JSON.stringify(await readInventory(settings,{read,cache:inventoryCache})),{headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
      catch(error){return json(422,error.message,{},'scan');}
    }
    try {
      const upstream=await read(mcfetchUrl(settings,key),{redirect:'error',signal:AbortSignal.timeout(25000),headers:{Accept:settings.renderMode==='plot'?'application/x-netcdf':'image/png,image/gif,image/jpeg'}});
      let bytes;try{bytes=await boundedBytes(upstream,MCFETCH_MAX_BYTES);}catch(error){if(error.message==='size')return json(413,'The returned image is too large. Choose smaller pixel dimensions.');throw error;}
      const classic=bytes[0]===67&&bytes[1]===68&&bytes[2]===70&&[1,2].includes(bytes[3]);
      const mime=settings.renderMode==='plot'?(classic?'application/x-netcdf':''):imageMime(bytes);
      if(!upstream.ok||!mime){const error=mcfetchError(new TextDecoder().decode(bytes.slice(0,16384)),upstream.status);return json(error.status,error.message,{},error.code);}
      return new Response(bytes,{headers:{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
    } catch {return json(502,'McFETCH is unavailable or the image request timed out. Wait a moment, then try again.');}
  }};
}
export default createMcfetchHandler();
