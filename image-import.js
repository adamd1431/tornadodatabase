import {supabase} from './supabase.js';
import {CYCLONE_CATEGORIES,cycloneActor} from './cyclones.js';
import {captureId,TORNADO_IMAGE_CATEGORIES,IMPORT_TTL,MAX_IMAGE_BYTES,IMPORT_TYPES} from './browser-extension/image-import/common.js';
import {prepareImageImport,putImageImport,getImageImport,clearExpiredImageImports,importDestinationUrl} from './image-import-bridge.js';
import {bindStormSearchEnter} from './storm-search.js';
const get=id=>document.getElementById(id),say=message=>{get('imageImportStatus').textContent=message;};
let id,record=null,rows=[],request=0,receiving=false,previewUrl='',actor={user:null,isAdmin:false};
try {id=captureId(new URLSearchParams(location.hash.slice(1)).get('capture') || crypto.randomUUID());}
catch(error){say(error.message);throw error;}
history.replaceState(null,'','#capture='+id);
let preferred={};try{preferred=JSON.parse(localStorage.getItem('utwx:imageImportDestination') || '{}') || {};}catch{}
if(['cyclone','tornado'].includes(preferred.kind))get('stormType').value=preferred.kind;
const categories=()=>get('stormType').value==='cyclone'?CYCLONE_CATEGORIES:TORNADO_IMAGE_CATEGORIES;
function showImage(value) {
  record=value;if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(value.blob);
  const image=new Image();image.alt='Selected image to upload';image.src=previewUrl;
  get('imagePreview').replaceChildren(image);get('imageFilename').textContent=value.name;
  get('imageSource').hidden=!value.pageUrl;if(value.pageUrl)get('imageSource').href=value.pageUrl;
  get('reviewImage').disabled=!get('stormTarget').value;
}
window.addEventListener('message',async event=>{
  if(event.source!==window || event.origin!==location.origin || event.data?.id!==id)return;
  const reply=(type,extra={})=>window.postMessage({type,id,...extra},location.origin);
  if(event.data.type==='utwx:image-offer'){reply('utwx:image-ready');return;}
  if(event.data.type!=='utwx:image-data' || receiving)return;
  receiving=true;
  try {const value=prepareImageImport(event.data);await putImageImport(value);showImage(value);say('Image received. Choose its storm and category.');reply('utwx:image-accepted');}
  catch(error){say(error.message);reply('utwx:image-error',{message:error.message});}
  finally {receiving=false;}
});
function filterRows() {
  const selected=get('stormTarget').value || (preferred.kind===get('stormType').value?String(preferred.targetId || ''):'');
  const terms=get('stormSearch').value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const visible=rows.filter(row=>terms.every(term=>(row.name+' '+(row.year || row.date || '')).toLowerCase().includes(term)));
  get('stormTarget').replaceChildren(new Option('Choose a storm…',''));
  for(const row of visible)get('stormTarget').add(new Option(row.name+' ('+(row.year || String(row.date || '').slice(0,4))+')',String(row.id)));
  if(visible.some(row=>String(row.id)===selected))get('stormTarget').value=selected;
  get('stormCount').textContent=visible.length+' of '+rows.length+' storms';get('reviewImage').disabled=!record || !get('stormTarget').value;
}
async function loadRows() {
  const run=++request,kind=get('stormType').value;rows=[];get('reviewImage').disabled=true;
  get('stormTarget').replaceChildren(new Option('Loading storms…',''));
  get('imageCategory').replaceChildren(...categories().map(([value,label])=>new Option(label,value)));
  if(preferred.kind===kind && categories().some(([key])=>key===preferred.category))get('imageCategory').value=preferred.category;
  try {
    actor=await cycloneActor(supabase);
    get('imageAccount').textContent=actor.user?'Using your database account. Existing upload approval rules apply.':'Log in on the database before continuing. Your image will start duplicate scanning when the storm page opens.';
    const found=[];
    for(let offset=0;;offset+=1000) {
      let query=supabase.from(kind==='cyclone'?'tropical_cyclones':'tornadoes').select(kind==='cyclone'?'id,name,year,status':'id,name,date,status').order(kind==='cyclone'?'year':'date',{ascending:false}).order('id').range(offset,offset+999);
      query=actor.isAdmin?query.neq('status','rejected'):query.eq('status','approved');
      const {data,error}=await query;if(error)throw error;
      if(run!==request)return;
      found.push(...data);if(data.length<1000)break;
    }
    rows=found;filterRows();
  } catch(error){if(run===request){get('stormTarget').replaceChildren(new Option('Could not load storms',''));say('Could not load storms. Refresh the page to try again.');}}
}
get('stormType').addEventListener('change',()=>{get('stormSearch').value='';loadRows();});
get('stormSearch').addEventListener('input',filterRows);
bindStormSearchEnter(get('stormSearch'),get('stormTarget'));
get('stormTarget').addEventListener('change',()=>{get('reviewImage').disabled=!record || !get('stormTarget').value;});
get('imageFile').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  try {
    if(!IMPORT_TYPES[file.type] || !file.size || file.size>MAX_IMAGE_BYTES)throw new Error('Choose a supported image up to 20 MB.');
    const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Could not read the selected image.'));reader.readAsDataURL(file);});
    const value=prepareImageImport({id,name:file.name,mime:file.type,base64});await putImageImport(value);showImage(value);say('Image ready. Choose its storm and category.');
  } catch(error){say(error.message);}
  event.target.value='';
});
get('imageDestination').addEventListener('submit',async event=>{
  event.preventDefault();if(!record || !get('stormTarget').value)return;
  get('reviewImage').disabled=true;
  try {
    if(Date.now()-record.createdAt>IMPORT_TTL)throw new Error('This image expired. Send it again from its right-click menu.');
    const destination={kind:get('stormType').value,targetId:get('stormTarget').value,category:get('imageCategory').value};
    if(!rows.some(row=>String(row.id)===destination.targetId) || !categories().some(([key])=>key===destination.category))throw new Error('Choose a storm and category.');
    await putImageImport({...record,destination});
    try{localStorage.setItem('utwx:imageImportDestination',JSON.stringify(destination));}catch{}
    location.href=importDestinationUrl(destination.kind,destination.targetId,id);
  } catch(error){say(error.message);get('reviewImage').disabled=false;}
});
await clearExpiredImageImports().catch(()=>{});
const previous=await getImageImport(id).catch(()=>null);if(previous)showImage(previous);
loadRows();
supabase.auth.onAuthStateChange(()=>{setTimeout(loadRows,0);});
