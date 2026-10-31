import { DEFAULT_GRAPHIC, normalizeGraphic, graphicDimensions, graphicWind, graphicLabels, graphicEstimateValues, graphicFilename, shortStormName, imageFrame, drawCycloneGraphic, clamp } from './tropical-cyclone-graphic.js';
import { cachedPublicMediaUrl } from './media-delivery.js';
import { loadPublicCatalog } from './public-catalog.js';

const get=id=>document.getElementById(id),form=get('graphicForm'),canvas=get('graphicCanvas'),context=canvas.getContext('2d');
const controls={name:'stormName',identifier:'stormId',wind:'stormWind',pressure:'stormPressure',peak:'peakNumber',total:'peakTotal',showCounter:'showCounter',note:'stormNote',heading:'intensityHeading',aspect:'aspectRatio',width:'outputWidth',font:'fontFace',color:'textColor',rounding:'windRounding',pressureUnit:'pressureUnit',textScale:'textScale',backdrop:'backdrop',shadow:'textShadow',style:'slideStyle',accent:'auraAccent',auraStrength:'auraStrength',estimateSource:'estimateSource'};
let image=null,imageVersion=0,imageLoading=false,exporting=false,renderRequest=0,appliedStorm=null,activeStyle='aura';
const styleAppearance={aura:{font:'inter',accent:'#b9d4f4',auraStrength:55},'old-aura':{font:'arial',accent:'#a7b7ff',auraStrength:68},classic:{font:'arial',accent:'#b9d4f4',auraStrength:55}};
let frame={zoom:1,x:50,y:50,fit:'cover'};
const status=(message,error=false)=>{get('graphicStatus').textContent=message;get('graphicStatus').classList.toggle('error',error);};
function readState(){const data={};for(const [key,id]of Object.entries(controls)){const el=get(id);if(el)data[key]=el.type==='checkbox'?el.checked:el.value;}return normalizeGraphic(data);}
function writeFields(values){for(const [key,value]of Object.entries(values)){const el=get(controls[key]);if(!el)continue;if(el.type==='checkbox')el.checked=!!value;else el.value=value;}}
function validateCounter(){get('peakNumber').setCustomValidity(Number(get('peakNumber').value)>Number(get('peakTotal').value)?'Peak number cannot be greater than total peaks.':'');}
function render(){
  renderRequest=0;const state=readState(),dims=graphicDimensions(state);
  if(canvas.width!==dims.width||canvas.height!==dims.height){canvas.width=dims.width;canvas.height=dims.height;}
  const graphic=drawCycloneGraphic(context,image,state,frame);
  get('dimensions').textContent=`${dims.width} × ${dims.height}`;
  const wind=graphicWind(state.wind,state.rounding);get('windConversion').textContent=state.windMissing?'Enter a wind estimate.':`${wind.mph} mph · ${wind.kph} km/h`;
  const missing=[state.windMissing?'wind':'',state.pressureMissing?'pressure':''].filter(Boolean);
  get('estimateSourceHint').textContent=missing.length?`Enter ${missing.join(' and ')} for these ${state.estimateSource==='owner'?'owner estimates':'official figures'}.`:'The selected source is shown on your graphic.';
  get('zoomValue').value=`${Math.round(frame.zoom*100)}%`;get('textScaleValue').value=`${state.textScale}%`;get('backdropValue').value=`${state.backdrop}%`;
  const auraOptions=get('auraOptions');if(auraOptions)auraOptions.hidden=state.style==='classic';
  const auraValue=get('auraStrengthValue');if(auraValue)auraValue.value=`${state.auraStrength}%`;
  get('previewShell').dataset.style=state.style;
  canvas.setAttribute('aria-label',`${graphic.labels.title}. ${graphic.labels.estimate}. ${graphic.labels.wind}. ${graphic.labels.pressure}. Drag to position the image; use arrow keys to pan.`);
  validateCounter();get('downloadGraphic').disabled=!image||imageLoading||exporting;
}
function scheduleRender(){if(!renderRequest)renderRequest=requestAnimationFrame(render);}
form.addEventListener('submit',event=>event.preventDefault());
form.addEventListener('input',event=>{
  if(event.target.id==='zoom')frame.zoom=Number(event.target.value)/100;
  if(event.target.id==='imageFit')frame.fit=event.target.value;
  if(event.target.id==='stormName'&&appliedStorm&&shortStormName(event.target.value).toLowerCase()!==shortStormName(appliedStorm.name).toLowerCase())appliedStorm=null;
  scheduleRender();
});
form.addEventListener('change',scheduleRender);
get('slideStyle').addEventListener('change',()=>{
  const state=readState();styleAppearance[activeStyle]={font:state.font,accent:state.accent,auraStrength:state.auraStrength};
  activeStyle=state.style;writeFields(styleAppearance[activeStyle]);scheduleRender();
});
function changeEstimateSource(value){
  get('estimateSource').value=value;get('pickerEstimateSource').value=value;
  if(appliedStorm)useStormDetails(appliedStorm);scheduleRender();
}
get('estimateSource').addEventListener('change',event=>changeEstimateSource(event.target.value));
get('pickerEstimateSource').addEventListener('change',event=>changeEstimateSource(event.target.value));
get('resetCrop').addEventListener('click',()=>{frame={zoom:1,x:50,y:50,fit:get('imageFit').value};get('zoom').value=100;scheduleRender();});
get('resetDetails').addEventListener('click',()=>{appliedStorm=null;writeFields(Object.fromEntries(['name','identifier','wind','pressure','peak','total','showCounter','note','heading','estimateSource'].map(key=>[key,DEFAULT_GRAPHIC[key]])));get('pickerEstimateSource').value=DEFAULT_GRAPHIC.estimateSource;scheduleRender();status('Storm details reset.');});

async function decodeImage(blob){
  if(!blob.type.startsWith('image/'))throw Error('Choose a PNG, JPG, WebP, or another image file.');
  if(blob.size>50*1024*1024)throw Error('Choose an image smaller than 50 MB.');
  if(typeof createImageBitmap==='function')return createImageBitmap(blob);
  const url=URL.createObjectURL(blob);
  try{
    const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('This image could not be opened.'));img.src=url;});
    if(img.naturalWidth*img.naturalHeight>80000000)throw Error('This image is too large to open here. Choose a smaller image.');
    const still=document.createElement('canvas');still.width=img.naturalWidth;still.height=img.naturalHeight;still.getContext('2d').drawImage(img,0,0);return still;
  }finally{URL.revokeObjectURL(url);}
}
async function setImage(source,label,{onLoaded=()=>{},allowed=()=>true}={}){
  const version=++imageVersion;imageLoading=true;scheduleRender();status('Opening image…');let next;
  try{
    let blob=source;
    if(!(source instanceof Blob)){
      const response=await fetch(cachedPublicMediaUrl(source),{credentials:'omit'});
      if(!response.ok)throw Error('The image could not be loaded. Try another image or upload a saved copy.');
      blob=await response.blob();
    }
    next=await decodeImage(blob);
    if(version!==imageVersion||!allowed()){next.close?.();if(version===imageVersion)status(image?'Ready. Choose another image or download your graphic.':'Choose an image to begin.');return false;}
    if(!next.width||!next.height||next.width*next.height>80000000){next.close?.();throw Error('This image is too large to open here. Choose a smaller image.');}
    image?.close?.();image=next;appliedStorm=null;frame={zoom:1,x:50,y:50,fit:get('imageFit').value};get('zoom').value=100;
    get('imageName').textContent=label;get('imageName').title=label;onLoaded();status('Ready. Edit the details or download your graphic.');return true;
  }catch(error){if(version===imageVersion)status(error.message||'The image could not be opened.',true);return false;}
  finally{if(version===imageVersion){imageLoading=false;scheduleRender();}}
}
get('uploadButton').addEventListener('click',()=>get('imageFile').click());
get('imageFile').addEventListener('change',()=>{const file=get('imageFile').files?.[0];get('imageFile').value='';if(file)setImage(file,file.name);});
for(const zone of [get('imageDrop'),get('previewShell')]){
  let depth=0;
  zone.addEventListener('dragenter',event=>{if(!event.dataTransfer.types.includes('Files'))return;event.preventDefault();depth++;zone.classList.add('dragging');});
  zone.addEventListener('dragover',event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();});
  zone.addEventListener('dragleave',()=>{if(--depth<=0){depth=0;zone.classList.remove('dragging');}});
  zone.addEventListener('drop',event=>{event.preventDefault();depth=0;zone.classList.remove('dragging');const file=[...event.dataTransfer.files].find(file=>file.type.startsWith('image/'));if(file)setImage(file,file.name);else status('Drop an image file here.',true);});
}
document.addEventListener('paste',event=>{
  if(event.target.closest('input,textarea,[contenteditable=true]'))return;
  const item=[...(event.clipboardData?.items||[])].find(item=>item.type.startsWith('image/'));
  const file=item?.getAsFile();if(file){event.preventDefault();setImage(file,'Pasted image');}
});
let drag=null;
canvas.addEventListener('pointerdown',event=>{
  if(!image||event.button!==0)return;
  canvas.focus({preventScroll:true});canvas.setPointerCapture(event.pointerId);
  drag={id:event.pointerId,clientX:event.clientX,clientY:event.clientY,x:frame.x,y:frame.y};
});
canvas.addEventListener('pointermove',event=>{
  if(!drag||event.pointerId!==drag.id)return;
  const bounds=canvas.getBoundingClientRect(),rect=imageFrame(image.width,image.height,canvas.width,canvas.height,frame),ratio=canvas.width/bounds.width;
  if(Math.abs(canvas.width-rect.width)>1)frame.x=clamp(drag.x+(event.clientX-drag.clientX)*ratio*100/(canvas.width-rect.width),0,100);
  if(Math.abs(canvas.height-rect.height)>1)frame.y=clamp(drag.y+(event.clientY-drag.clientY)*ratio*100/(canvas.height-rect.height),0,100);
  scheduleRender();
});
for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,()=>drag=null);
canvas.addEventListener('keydown',event=>{
  if(!image)return;
  const step=event.shiftKey?10:1,r=imageFrame(image.width,image.height,canvas.width,canvas.height,frame);
  const xSign=Math.sign(canvas.width-r.width),ySign=Math.sign(canvas.height-r.height);
  if(event.key==='ArrowLeft')frame.x=clamp(frame.x-step*xSign,0,100);
  else if(event.key==='ArrowRight')frame.x=clamp(frame.x+step*xSign,0,100);
  else if(event.key==='ArrowUp')frame.y=clamp(frame.y-step*ySign,0,100);
  else if(event.key==='ArrowDown')frame.y=clamp(frame.y+step*ySign,0,100);
  else if(['+','=','-'].includes(event.key)){frame.zoom=clamp(frame.zoom+(event.key==='-'?-.05:.05),1,4);get('zoom').value=Math.round(frame.zoom*100);}
  else return;
  event.preventDefault();scheduleRender();
});
get('jumpPreview').addEventListener('click',()=>get('previewHeading').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'}));

get('downloadGraphic').addEventListener('click',async()=>{
  validateCounter();if(!form.reportValidity()||!image||exporting)return;
  exporting=true;get('downloadGraphic').disabled=true;status('Preparing PNG…');
  try{
    await document.fonts?.ready;render();const filename=graphicFilename(readState());
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob)throw Error('The PNG could not be created. Try a smaller export size.');
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    status(`Downloaded ${canvas.width} × ${canvas.height} PNG.`);
  }catch(error){status(error.message||'The image could not be exported. Upload a saved copy of the image and try again.',true);}
  finally{exporting=false;scheduleRender();}
});

const dialog=get('databaseDialog');let catalog=[],catalogPromise=null,filtered=[],selectedStorm=null,media=[],satelliteOnly=true,pickerVersion=0,clientPromise;
const databaseStatus=(text,error=false)=>{get('databaseStatus').textContent=text;get('databaseStatus').classList.toggle('error',error);};
async function databaseClient(){return clientPromise||=(import('./supabase.js').then(module=>module.supabase));}
async function loadCatalog(){
  if(!catalogPromise)catalogPromise=(async()=>{const cached=await loadPublicCatalog('cyclones');if(cached)return cached;const [{loadCyclones},client]=await Promise.all([import('./cyclones.js'),databaseClient()]);return loadCyclones(client,false);})().catch(error=>{catalogPromise=null;throw error;});
  return catalogPromise;
}
function renderStorms(){
  const terms=get('stormSearch').value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  filtered=catalog.filter(row=>terms.every(term=>`${row.name} ${row.year}`.toLowerCase().includes(term))).sort((a,b)=>b.year-a.year||a.name.localeCompare(b.name));
  get('stormResults').replaceChildren();
  for(const row of filtered){
    const button=document.createElement('button');button.type='button';button.className='storm-result';
    if(row.cover_image){const img=document.createElement('img');img.src=cachedPublicMediaUrl(row.cover_image);img.alt='';img.loading='lazy';button.append(img);}
    const text=document.createElement('span'),name=document.createElement('strong'),detail=document.createElement('small');name.textContent=row.name;detail.textContent=`${row.year} · ${row.peak_winds_mph} mph · ${row.lowest_pressure_mb} mbar`;text.append(name,detail);button.append(text);button.addEventListener('click',()=>selectStorm(row));get('stormResults').append(button);
  }
  databaseStatus(filtered.length?`${filtered.length} tropical cyclone${filtered.length===1?'':'s'}`:'No matching tropical cyclones.');
}
function showStorms(){pickerVersion++;selectedStorm=null;get('mediaPicker').hidden=true;get('stormResults').hidden=false;get('databaseHeading').textContent='Choose a tropical cyclone';get('stormSearch').disabled=false;renderStorms();}
async function openDatabase(){
  dialog.showModal();get('mediaPicker').hidden=true;get('stormResults').hidden=false;get('stormResults').replaceChildren();get('databaseHeading').textContent='Choose a tropical cyclone';get('stormSearch').disabled=false;databaseStatus('Loading tropical cyclones…');
  try{catalog=await loadCatalog();if(dialog.open){renderStorms();get('stormSearch').focus();}}catch(error){databaseStatus('The database could not be loaded. Try again, or choose an image from your computer.',true);}
}
get('databaseButton').addEventListener('click',openDatabase);get('closeDatabase').addEventListener('click',()=>dialog.close());
dialog.addEventListener('close',()=>pickerVersion++);
dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
get('backToStorms').addEventListener('click',showStorms);get('stormSearch').addEventListener('input',renderStorms);
get('stormSearch').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();if(filtered.length)selectStorm(filtered[0]);}});

async function selectStorm(row){
  const run=++pickerVersion;selectedStorm=row;media=[];get('stormResults').hidden=true;get('mediaPicker').hidden=false;get('mediaResults').replaceChildren();get('stormSearch').disabled=true;get('databaseHeading').textContent=`${row.name} (${row.year})`;databaseStatus('Loading images…');
  get('pickerEstimateSource').value=get('estimateSource').value;
  try{
    const client=await databaseClient(),rows=[];
    for(let start=0;;start+=1000){const {data,error}=await client.from('cyclone_uploads').select('id,file_url,filename,mime_type,category').eq('cyclone_id',row.id).eq('status','approved').order('created_at',{ascending:false}).range(start,start+999);if(error)throw error;rows.push(...(data||[]));if(!data||data.length<1000)break;}
    if(run!==pickerVersion||!dialog.open)return;
    media=rows.filter(row=>/^image\//i.test(row.mime_type||'')||/\.(?:jpe?g|png|webp|gif|avif|bmp|tiff?)(?:[?#]|$)/i.test(row.file_url||''));
    if(!media.length&&row.cover_image)media=[{id:'cover',file_url:row.cover_image,filename:'Cover image',category:'photos'}];
    satelliteOnly=media.some(row=>row.category==='satellite');renderMedia();
  }catch(error){if(run===pickerVersion)databaseStatus('Images could not be loaded. Choose another cyclone or upload a saved image.',true);}
}
function useStormDetails(row){
  const name=shortStormName(row.name),same=shortStormName(get('stormName').value).toLowerCase()===name.toLowerCase();
  appliedStorm=row;
  writeFields({name:name.toUpperCase(),identifier:same?get('stormId').value:'',...graphicEstimateValues(row,get('estimateSource').value),...(same?{}:{note:'',peak:1,total:1})});
}
function renderMedia(){
  get('satelliteFilter').classList.toggle('active',satelliteOnly);get('allImagesFilter').classList.toggle('active',!satelliteOnly);get('satelliteFilter').setAttribute('aria-pressed',String(satelliteOnly));get('allImagesFilter').setAttribute('aria-pressed',String(!satelliteOnly));
  const visible=media.filter(row=>!satelliteOnly||row.category==='satellite');get('mediaResults').replaceChildren();
  databaseStatus(visible.length?`Choose an image · ${visible.length} available`:'No satellite imagery in this cyclone. Choose All images.');
  for(const row of visible){
    const button=document.createElement('button');button.type='button';button.className='media-result';button.setAttribute('aria-label',`Use ${row.filename||'image'}`);
    const img=document.createElement('img');img.src=cachedPublicMediaUrl(row.file_url);img.alt='';img.loading='lazy';const name=document.createElement('span');name.textContent=row.filename||'Image';button.append(img,name);
    button.addEventListener('click',async()=>{const run=pickerVersion;databaseStatus('Opening image…');const loaded=await setImage(row.file_url,row.filename||'Database image',{allowed:()=>dialog.open&&run===pickerVersion,onLoaded:()=>useStormDetails(selectedStorm)});if(loaded)dialog.close();else if(dialog.open)databaseStatus('That image could not be opened. Try another image.',true);});get('mediaResults').append(button);
  }
}
get('satelliteFilter').addEventListener('click',()=>{satelliteOnly=true;renderMedia();});get('allImagesFilter').addEventListener('click',()=>{satelliteOnly=false;renderMedia();});
document.fonts?.ready.then(scheduleRender);document.fonts?.addEventListener('loadingdone',scheduleRender);
render();
setImage('./media-archive/8da62f50b3e1bcf5af12bddca189783f495159d302ee715371613a13cd1b66ed.jpg','Polo example image',{onLoaded:()=>{frame.y=70;}});
