import {MAX_IMAGE_BYTES,IMPORT_TTL,IMPORT_TYPES,captureId,webUrl,validateImageBytes} from './browser-extension/image-import/common.js';

export function prepareImageImport(payload,now=Date.now()) {
  const id=captureId(payload.id),mime=String(payload.mime || '').toLowerCase();
  const base64=String(payload.base64 || '');
  if(!IMPORT_TYPES[mime] || !base64 || base64.length > Math.ceil(MAX_IMAGE_BYTES/3)*4 || base64.length%4 || !/^[a-z0-9+/]*={0,2}$/i.test(base64))throw new Error('The image transfer is invalid or larger than 20 MB.');
  let raw;try{raw=atob(base64);}catch{throw new Error('The image could not be decoded.');}
  const bytes=Uint8Array.from(raw,char=>char.charCodeAt(0));validateImageBytes(bytes,mime);
  const name=String(payload.name || 'web-image').replace(/\.[^.]+$/,'').replace(/[^a-z0-9_.-]+/gi,'-').replace(/^[-.]+/,'').slice(0,120) || 'web-image';
  return {id,blob:new Blob([bytes],{type:mime}),name:name+'.'+IMPORT_TYPES[mime],
    imageUrl:payload.imageUrl?webUrl(payload.imageUrl).href:'',pageUrl:payload.pageUrl?webUrl(payload.pageUrl).href:'',createdAt:now};
}
function openImports() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('utwx-image-imports',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('images',{keyPath:'id'});
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(new Error('Browser storage is unavailable. Allow site storage and try again.'));
  });
}
async function stored(mode,action) {
  const db=await openImports();
  try {return await new Promise((resolve,reject)=>{
    const transaction=db.transaction('images',mode),request=action(transaction.objectStore('images'));
    transaction.oncomplete=()=>resolve(request?.result);
    transaction.onerror=transaction.onabort=()=>reject(new Error('Could not save the image transfer in this browser.'));
  });} finally {db.close();}
}
export const putImageImport=record=>stored('readwrite',store=>store.put(record));
export const deleteImageImport=id=>stored('readwrite',store=>store.delete(captureId(id)));
export async function getImageImport(id) {
  const row=await stored('readonly',store=>store.get(captureId(id)));
  if(row && Date.now()-row.createdAt > IMPORT_TTL){await deleteImageImport(id);return null;}
  return row || null;
}
async function claimImageImport(id,retry) {
  const db=await openImports();
  try {return await new Promise((resolve,reject)=>{
    let claimed=null;
    const transaction=db.transaction('images','readwrite'),store=transaction.objectStore('images');
    const request=store.get(captureId(id));
    request.onsuccess=()=>{
      const row=request.result;
      if(!row || Date.now()-row.createdAt>IMPORT_TTL || (row.uploadStartedAt && !retry))return;
      claimed={...row,uploadStartedAt:Date.now()};store.put(claimed);
    };
    transaction.oncomplete=()=>resolve(claimed);
    transaction.onerror=transaction.onabort=()=>reject(new Error('Could not start the image upload in this browser.'));
  });} finally {db.close();}
}
export async function clearExpiredImageImports() {
  const rows=await stored('readonly',store=>store.getAll());
  await Promise.all(rows.filter(row=>Date.now()-row.createdAt>IMPORT_TTL).map(row=>deleteImageImport(row.id)));
}
export function importDestinationUrl(kind,targetId,id,base=location.href) {
  if(!['cyclone','tornado'].includes(kind) || !/^[a-z0-9_-]{1,200}$/i.test(String(targetId || '')))throw new Error('Choose a valid storm.');
  const url=new URL(kind==='cyclone'?'tropical-cyclone.html':'tornado.html',base);
  url.searchParams.set('id',String(targetId));url.searchParams.set('imageImport',captureId(id));return url.href;
}
export function matchesImportDestination(record,kind,targetId,categories) {
  return !!record && record.destination?.kind===kind && String(record.destination?.targetId)===String(targetId)
    && categories.some(([key])=>key===record.destination.category);
}
export async function uploadImportedImage(record,category,client,upload) {
  const {data,error}=await client.auth.getUser();
  if(error || !data?.user)throw new Error('Log in to the database before uploading. Your selected image is still here.');
  const file=new File([record.blob],record.name,{type:record.blob.type});
  return upload({files:[file],value:''},category,{scanDuplicates:true});
}

let previewUrl='';
export async function mountImageImport({kind,targetId,categories,host,client,upload}) {
  const id=new URLSearchParams(location.search).get('imageImport');
  if(!id || !host || document.getElementById('imageImportReview'))return;
  let record;
  try {record=await getImageImport(id);}catch{return;}
  if(!matchesImportDestination(record,kind,targetId,categories) || document.getElementById('imageImportReview'))return;
  if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(record.blob);
  const section=document.createElement('section');section.id='imageImportReview';section.className='image-import-review';
  section.innerHTML='<div class="image-import-review-heading"><img alt="Selected image"><div><p class="image-import-eyebrow">FROM YOUR BROWSER</p><h2>Browser image upload</h2><p class="image-import-filename"></p><a class="image-import-source" target="_blank" rel="noopener noreferrer">Original page ↗</a></div></div><label>Upload category <select aria-label="Imported image category"></select></label><div class="image-import-actions"><button class="btn btn-primary" type="button" data-import-upload hidden>Retry upload</button><button class="btn" type="button" data-import-discard>Discard</button></div><p role="status" aria-live="polite" data-import-status></p>';
  section.querySelector('img').src=previewUrl;
  section.querySelector('.image-import-filename').textContent=record.name;
  const source=section.querySelector('a');source.hidden=!record.pageUrl;if(record.pageUrl)source.href=webUrl(record.pageUrl).href;
  const category=section.querySelector('select');
  for(const [value,label] of categories){const option=document.createElement('option');option.value=value;option.textContent=label;category.append(option);}
  category.value=record.destination.category;
  const button=section.querySelector('[data-import-upload]'),discard=section.querySelector('[data-import-discard]'),status=section.querySelector('[data-import-status]');
  let pending=false,done=false;
  const controls=()=>{button.hidden=pending || done;button.disabled=pending || done;discard.disabled=pending;category.disabled=pending || done;};
  const clear=()=>{const url=new URL(location.href);url.searchParams.delete('imageImport');history.replaceState(null,'',url);};
  discard.addEventListener('click',async()=>{try{await deleteImageImport(id);clear();URL.revokeObjectURL(previewUrl);section.remove();}catch(error){status.textContent=error.message;}});
  async function startUpload(retry=false) {
    if(pending || done)return;
    pending=true;controls();
    try {
      const claimed=await claimImageImport(id,retry);
      if(!claimed)throw new Error('This image already started uploading. Check the upload status below before retrying.');
      if(!matchesImportDestination(claimed,kind,targetId,categories))throw new Error('This image is assigned to another storm. Choose its destination again.');
      record=claimed;
      status.textContent='Checking for duplicate images…';
      const result=await uploadImportedImage(record,category.value,client,upload);
      if(result?.saved>0) {
        done=true;section.querySelector('h2').textContent='Image uploaded';discard.textContent='Dismiss';
        status.textContent='Image uploaded. See the upload status below for its approval status.';
        clear();await deleteImageImport(id);
      } else status.textContent='No image was added. Check the upload status below, then try again if needed.';
    } catch(error){status.textContent=error.message || 'Could not finish this upload. Please try again.';}
    finally {pending=false;controls();}
  }
  button.addEventListener('click',()=>startUpload(true));
  host.before(section);
  host.scrollIntoView?.({block:'start'});
  await startUpload();
}
