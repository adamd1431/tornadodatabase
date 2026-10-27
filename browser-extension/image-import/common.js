export const DEFAULT_SITE = 'https://tornadodatabase.vercel.app/';
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const IMPORT_TTL = 30 * 60 * 1000;
export const IMPORT_TYPES = {
  'image/jpeg':'jpg', 'image/png':'png', 'image/gif':'gif',
  'image/webp':'webp', 'image/avif':'avif', 'image/bmp':'bmp'
};
export const TORNADO_IMAGE_CATEGORIES = [['photos','Tornado pictures'],['damage','Damage'],['radar','Radar'],['environment','Environment'],['research','Research / Survey'],['text_accounts','Text / Accounts'],['misc','Misc']];
export function webUrl(value) {
  const url = new URL(String(value || '').trim());
  if(!['https:','http:'].includes(url.protocol) || url.username || url.password || url.href.length > 8192)throw new Error('Use an HTTP or HTTPS image or page address without embedded credentials.');
  return url;
}
export function siteUrl(value) {
  const url = webUrl(value);
  if(url.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('The database address must use HTTPS, or localhost for testing.');
  url.hash = ''; url.search = '';
  if(/\.html?$/i.test(url.pathname))return new URL('.',url).href;
  if(!url.pathname.endsWith('/'))url.pathname += '/';
  return url.href;
}
export function captureId(value) {
  const id = String(value || '');
  if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))throw new Error('This image transfer is invalid. Send the image again from its right-click menu.');
  return id;
}
export function imageName(url, mime) {
  const extension = IMPORT_TYPES[mime];
  if(!extension)throw new Error('Choose a JPEG, PNG, GIF, WebP, AVIF, or BMP image.');
  let name = '';
  try{name = decodeURIComponent(webUrl(url).pathname.split('/').pop());}catch{}
  name = name.replace(/\.[^.]+$/,'').replace(/[^a-z0-9_.-]+/gi,'-').replace(/^[-.]+/,'').slice(0,120) || 'web-image';
  return name + '.' + extension;
}
export function validateImageBytes(bytes, mime) {
  if(!IMPORT_TYPES[mime] || !bytes.length || bytes.length > MAX_IMAGE_BYTES)throw new Error('Choose a supported image up to 20 MB.');
  const ascii = (start,end)=>String.fromCharCode(...bytes.slice(start,end));
  const valid = mime==='image/jpeg' ? bytes[0]===255 && bytes[1]===216 && bytes[2]===255
    : mime==='image/png' ? [137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value)
    : mime==='image/gif' ? ['GIF87a','GIF89a'].includes(ascii(0,6))
    : mime==='image/webp' ? ascii(0,4)==='RIFF' && ascii(8,12)==='WEBP'
    : mime==='image/bmp' ? ascii(0,2)==='BM'
    : ascii(4,8)==='ftyp' && /avif|avis/.test(ascii(8,64));
  if(!valid)throw new Error('The downloaded file does not match its image type. Open the original image and try again.');
}
export async function readImageResponse(response) {
  if(!response.ok)throw new Error('The image could not be downloaded (HTTP '+response.status+').');
  const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if(!IMPORT_TYPES[mime])throw new Error('That address did not return a supported image. Try opening the original image first.');
  if(Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES)throw new Error('The image is larger than 20 MB.');
  const reader = response.body?.getReader();
  if(!reader)throw new Error('This browser could not read the image download.');
  const chunks = []; let length = 0;
  try {
    while(true) {
      const {done,value} = await reader.read(); if(done)break;
      length += value.byteLength;
      if(length > MAX_IMAGE_BYTES)throw new Error('The image is larger than 20 MB.');
      chunks.push(value);
    }
  } catch(error) {await reader.cancel().catch(()=>{});throw error;}
  finally {reader.releaseLock();}
  const bytes = new Uint8Array(length); let offset = 0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset += chunk.length;}
  validateImageBytes(bytes,mime);
  return new Blob([bytes],{type:mime});
}
