import {SATELLITES,normalizeMcfetch,mcfetchKey,mcfetchFilename,MCFETCH_MAX_BYTES} from './mcfetch-model.js';
import {loadPublicCatalog} from './public-catalog.js';
import {bindStormSearchEnter} from './storm-search.js';
import {putImageImport,importDestinationUrl,clearExpiredImageImports} from './image-import-bridge.js';
import {validateImageBytes,IMPORT_TYPES} from './browser-extension/image-import/common.js';

const get=id=>document.getElementById(id),form=get('archiveForm');
let accessKey='',busy=false,controller=null,catalog=[],previewUrl='',result=null;
const status=(id,message,error=false)=>{get(id).textContent=message;get(id).classList.toggle('error',error);};
const selectedStorm=()=>catalog.find(row=>row.id===get('stormTarget').value)||null;
function updateActions(){
  get('fetchImage').disabled=!accessKey||busy;
  for(const id of ['downloadImage','sendGenerator'])get(id).disabled=!result||busy;
  get('sendGallery').disabled=!result||!selectedStorm()||busy;
  get('fetchHint').textContent=accessKey?'Requests PNG imagery. Fetching a preview does not upload it.':'Connect your McFETCH key to fetch an image.';
  get('previewStage').setAttribute('aria-busy',String(busy));get('loadingPreview').hidden=!busy;
  get('resultStatus').textContent=result&&!selectedStorm()?'Choose a cyclone on the left to upload this image to its gallery.':'';
}
function connect(){
  try{accessKey=mcfetchKey(get('accessKey').value);get('accessKey').value='';get('connectFields').hidden=true;get('connectedFields').hidden=false;get('accessBadge').textContent='Connected';get('accessBadge').classList.add('connected');status('accessStatus','Connected for this page visit.');updateActions();}
  catch(error){status('accessStatus',error.message,true);}
}
get('connectKey').addEventListener('click',connect);
get('accessKey').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();connect();}});
get('disconnectKey').addEventListener('click',()=>{accessKey='';controller?.abort();get('connectFields').hidden=false;get('connectedFields').hidden=true;get('accessBadge').textContent='Not connected';get('accessBadge').classList.remove('connected');status('accessStatus','Key forgotten. Downloaded previews remain available.');updateActions();});
get('scanDate').max=new Date().toISOString().slice(0,10);
for(const row of SATELLITES)get('satellite').add(new Option(row.label,row.id));
function updateBand(){
  const satellite=SATELLITES.find(row=>row.id===get('satellite').value),mode=get('bandMode').value;
  get('customBandField').hidden=mode!=='custom';get('customBand').disabled=mode!=='custom';
  get('enhancement').disabled=mode==='visible';if(mode==='visible')get('enhancement').value='';
  const band=mode==='custom'?get('customBand').value:satellite[mode];
  get('bandHint').textContent=`McIDAS band ${band} · ${mode==='visible'?'Daylight imagery. ':''}Check satellite and band availability in the SSEC inventory.`;
}
get('satellite').addEventListener('change',()=>{get('coverage').value=SATELLITES.find(row=>row.id===get('satellite').value).modern?'FD':'';updateBand();});
get('bandMode').addEventListener('change',updateBand);get('customBand').addEventListener('input',updateBand);get('coverage').value='FD';updateBand();
function renderStorms(){
  const previous=get('stormTarget').value,terms=get('stormSearch').value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const rows=catalog.filter(row=>terms.every(term=>`${row.name} ${row.year}`.toLowerCase().includes(term)));
  get('stormTarget').replaceChildren(new Option('No cyclone selected',''),...rows.map(row=>new Option(`${row.name} (${row.year})`,row.id)));
  if(rows.some(row=>row.id===previous))get('stormTarget').value=previous;
  get('stormHint').textContent=terms.length?`${rows.length} matching cyclones. Press Enter to select the first result.`:'Choose a cyclone to carry its details into the generator or upload to its gallery.';
  updateActions();
}
get('stormSearch').addEventListener('input',renderStorms);get('stormTarget').addEventListener('change',updateActions);bindStormSearchEnter(get('stormSearch'),get('stormTarget'));
async function loadStorms(){
  catalog=(await loadPublicCatalog('cyclones')||[]).sort((a,b)=>Number(b.year)-Number(a.year)||String(a.name).localeCompare(b.name));renderStorms();
  if(!catalog.length)get('stormHint').textContent='The cyclone list is unavailable. You can still fetch, download and use images in the generator.';
}
function readSettings(){
  const satellite=SATELLITES.find(row=>row.id===get('satellite').value),mode=get('bandMode').value;
  return normalizeMcfetch({satellite:satellite.id,date:get('scanDate').value,time:get('scanTime').value,latitude:get('latitude').value,longitude:get('longitude').value,band:mode==='custom'?get('customBand').value:satellite[mode],enhancement:get('enhancement').value,coverage:get('coverage').value,width:get('imageWidth').value,height:get('imageHeight').value,magLine:get('magLine').value,magElement:get('magElement').value,map:get('showMap').checked});
}
form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  if(!accessKey){get('accessKey').focus();return;}
  let settings;try{settings=readSettings();}catch(error){status('requestStatus',error.message,true);return;}
  const storm=selectedStorm();busy=true;controller=new AbortController();updateActions();status('requestStatus','Requesting satellite imagery…');get('previewBadge').textContent='Fetching…';
  try {
    const response=await fetch('/api/mcfetch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...settings,apiKey:accessKey}),signal:controller.signal});
    if(!response.ok){let message='The image could not be retrieved. Please try again.';try{message=(await response.json()).message||message;}catch{}throw Error(message);}
    const blob=await response.blob();if(blob.size>MCFETCH_MAX_BYTES)throw Error('This image is too large to preview. Try smaller pixel dimensions.');
    validateImageBytes(new Uint8Array(await blob.arrayBuffer()),blob.type);
    const url=URL.createObjectURL(blob),probe=new Image();probe.src=url;
    try{await probe.decode();}catch{URL.revokeObjectURL(url);throw Error('The returned image could not be displayed. Try another scan.');}
    if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=url;
    const name=mcfetchFilename(settings,storm?.name).replace(/\.png$/,'.'+IMPORT_TYPES[blob.type]);
    result={blob,name,settings,storm,width:probe.naturalWidth,height:probe.naturalHeight};
    get('archiveImage').src=url;get('archiveImage').alt=`${settings.satellite} band ${settings.band}, requested ${settings.date} at ${settings.time} UTC${storm?' for '+storm.name:''}`;
    get('archiveImage').hidden=false;get('emptyPreview').hidden=true;get('resultDetails').hidden=false;
    get('resultTitle').textContent=storm?`${storm.name} · ${storm.year}`:'Archived satellite image';
    get('resultMeta').textContent=`${settings.satellite} · Band ${settings.band} · Requested ${settings.date} at ${settings.time} UTC`;
    get('resultFacts').replaceChildren(...[`${result.width} × ${result.height} px`,`${(blob.size/1024).toFixed(0)} KB`,`${Math.abs(settings.latitude)}° ${settings.latitude<0?'S':'N'}, ${Math.abs(settings.longitude)}° ${settings.longitude<0?'W':'E'}`,settings.enhancement||'Default grayscale'].map(value=>{const span=document.createElement('span');span.textContent=value;return span;}));
    status('requestStatus','Image retrieved. Download it or send it to your next step.');get('previewBadge').textContent='Image ready';
  } catch(error){status('requestStatus',error.name==='AbortError'?'Image request cancelled.':error.message,true);get('previewBadge').textContent=result?'Previous image':'No image returned';}
  finally{busy=false;controller=null;updateActions();}
});
get('downloadImage').addEventListener('click',()=>{
  if(!result)return;const a=document.createElement('a');a.href=previewUrl;a.download=result.name;document.body.append(a);a.click();a.remove();
});
async function transfer(destination){
  if(!result||busy)return;
  const storm=selectedStorm()||result.storm;
  if(destination==='gallery'&&!selectedStorm())return;
  const button=get(destination==='gallery'?'sendGallery':'sendGenerator');button.disabled=true;
  try {
    await clearExpiredImageImports();
    const id=crypto.randomUUID(),record={id,blob:result.blob,name:result.name,createdAt:Date.now(),pageUrl:'https://mcfetch.ssec.wisc.edu/',imageUrl:'',archive:{settings:result.settings,storm}};
    if(destination==='gallery')record.destination={kind:'cyclone',targetId:storm.id,category:'satellite'};
    await putImageImport(record);
    if(destination==='gallery')location.href=importDestinationUrl('cyclone',storm.id,id);
    else {const url=new URL('tropical-cyclone-generator.html',location.href);url.searchParams.set('archiveImage',id);location.href=url.href;}
  } catch(error){status('resultStatus',error.message||'Could not transfer this image. Download it and choose the file on the next page.',true);updateActions();}
}
get('sendGenerator').addEventListener('click',()=>transfer('generator'));get('sendGallery').addEventListener('click',()=>transfer('gallery'));
loadStorms();updateActions();
