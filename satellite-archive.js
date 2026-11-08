import {SATELLITES,normalizeMcfetch,mcfetchKey,mcfetchFilename,MCFETCH_MAX_BYTES} from './mcfetch-model.js';
import {loadPublicCatalog} from './public-catalog.js';
import {bindStormSearchEnter} from './storm-search.js';
import {putImageImport,importDestinationUrl,clearExpiredImageImports} from './image-import-bridge.js';
import {validateImageBytes,IMPORT_TYPES} from './browser-extension/image-import/common.js';
import {createTrackLoader,findStorms,positionAt,suggestSatellite,parseStormCommand,stormLookupName} from './satellite-storm-lookup.js';

const get=id=>document.getElementById(id),form=get('archiveForm');
let accessKey='',busy=false,controller=null,catalog=[],previewUrl='',result=null;
const loadTracks=createTrackLoader();let lookup=null,matchKey='',inventoryScan=null;
const status=(id,message,error=false)=>{get(id).textContent=message;get(id).classList.toggle('error',error);};
const selectedStorm=()=>catalog.find(row=>row.id===get('stormTarget').value)||null;
const lookupKey=()=>JSON.stringify(['lookupName','lookupYear','scanDate','scanTime'].map(id=>get(id).value));
const currentSatellite=()=>SATELLITES.find(row=>row.id===(get('satellite').value==='auto'?(get('manualPosition').checked?suggestSatellite(get('scanDate').value,Number(get('longitude').value)):lookup?.satellite):get('satellite').value));
function updateActions(){
  get('fetchImage').disabled=!accessKey||busy;
  for(const id of ['downloadImage','sendGenerator'])get(id).disabled=!result||busy;
  get('sendGallery').disabled=!result||!selectedStorm()||busy;
  get('fetchHint').textContent=accessKey?'SSEC verifies your key when an image is requested. Previews are not uploaded.':'An approved SSEC McFETCH key is required to retrieve images. Storm and scan lookups work without one.';
  get('previewStage').setAttribute('aria-busy',String(busy));get('loadingPreview').hidden=!busy;
  get('resultStatus').textContent=result&&!selectedStorm()?'Choose a cyclone on the left to upload this image to its gallery.':'';
}
function connect(){
  try{accessKey=mcfetchKey(get('accessKey').value);get('accessKey').value='';get('connectFields').hidden=true;get('connectedFields').hidden=false;get('accessBadge').textContent='Key ready · unverified';get('accessBadge').classList.remove('connected');status('accessStatus','Key held for this visit. SSEC will validate it on the first image request.');updateActions();}
  catch(error){status('accessStatus',error.message,true);}
}
get('connectKey').addEventListener('click',connect);
get('accessKey').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();connect();}});
get('disconnectKey').addEventListener('click',()=>{accessKey='';controller?.abort();get('connectFields').hidden=false;get('connectedFields').hidden=true;get('accessBadge').textContent='No key';get('accessBadge').classList.remove('connected');status('accessStatus','Key forgotten. Downloaded previews remain available.');updateActions();});
get('scanDate').max=new Date().toISOString().slice(0,10);get('lookupYear').value=new Date().getUTCFullYear();get('lookupYear').max=new Date().getUTCFullYear();
for(const row of SATELLITES)get('satellite').add(new Option(row.label,row.id));
function updateBand(){
  const satellite=currentSatellite(),mode=get('bandMode').value;
  get('customBandField').hidden=mode!=='custom';get('customBand').disabled=mode!=='custom';
  get('enhancement').disabled=mode==='visible';if(mode==='visible')get('enhancement').value='';
  const band=mode==='custom'?get('customBand').value:satellite?.[mode];
  get('bandHint').textContent=band?`${satellite?.label||'Custom satellite'} · McIDAS band ${band} · ${mode==='visible'?'Daylight imagery. ':''}Check exact scan availability in the SSEC inventory.`:'The satellite and band will be selected after the storm lookup.';
}
function updateCoverage(){inventoryScan=null;status('scanStatus','Check the inventory to find the nearest scan covering this storm. No access key needed.');}
get('satellite').addEventListener('change',()=>{updateCoverage();updateBand();});
get('bandMode').addEventListener('change',()=>{updateCoverage();updateBand();});get('customBand').addEventListener('input',()=>{updateCoverage();updateBand();});get('coverage').addEventListener('change',updateCoverage);updateBand();
function clearLookup(){lookup=null;matchKey='';get('matchField').hidden=true;get('lookupMatch').replaceChildren();status('positionStatus',get('manualPosition').checked?'Using your coordinates.':'Position will update when you fetch or find an available scan.');updateCoverage();updateBand();}
for(const id of ['lookupName','lookupYear','scanDate','scanTime'])get(id).addEventListener('input',clearLookup);
get('manualPosition').addEventListener('change',()=>{
  const manual=get('manualPosition').checked;get('coordinateFields').hidden=!manual;
  for(const id of ['latitude','longitude']){get(id).required=manual;get(id).disabled=!manual;}
  for(const id of ['lookupName','lookupYear']){get(id).required=!manual;get(id).disabled=manual;}
  status('positionStatus',manual?'Using your coordinates. Choose a satellite, or let the date and longitude suggest one.':'No coordinates needed when a track is available.');updateCoverage();updateBand();
});
for(const id of ['latitude','longitude'])get(id).addEventListener('input',()=>{updateCoverage();updateBand();});
async function resolvePosition(){
  const key=lookupKey();if(lookup?.key===key&&(get('matchField').hidden||lookup.storm.id===get('lookupMatch').value))return lookup;
  const query=get('lookupName').value.trim(),year=Number(get('lookupYear').value),date=get('scanDate').value,time=get('scanTime').value;
  if(!query||!Number.isInteger(year)||year<1974)throw Error('Enter a storm name or designation and its year.');
  if(!date||!time)throw Error('Choose the scan date and UTC time.');
  status('positionStatus','Looking up the storm’s IBTrACS track…');
  const rows=await loadTracks(Number(date.slice(0,4)));if(key!==lookupKey())throw Error('The storm or time changed. Look up the new settings.');
  const matches=findStorms(rows,{query,year,date});
  if(!matches.length)throw Error('No matching track at that date. Check the name, year and date, or enter coordinates manually.');
  if(matches.length>1&&matchKey!==key){get('lookupMatch').replaceChildren(new Option('Choose a track…',''),...matches.map(row=>new Option(`${row.name} · ${row.basins.join('/')} · ${row.atcf.join(', ')||row.id}`,row.id)));get('matchField').hidden=false;matchKey=key;}
  const storm=matches.length===1?matches[0]:matches.find(row=>row.id===get('lookupMatch').value);
  if(!storm)throw Error('More than one cyclone matches. Choose the track below.');
  const position=positionAt(storm,date,time),satellite=suggestSatellite(date,position.longitude);
  lookup={key,storm,position,satellite};get('latitude').value=position.latitude;get('longitude').value=position.longitude;
  const name=stormLookupName(storm.name).toLowerCase(),destination=catalog.find(row=>stormLookupName(row.name).toLowerCase()===name&&Number(row.year)===year);
  // A new lookup must not silently upload to a previously selected cyclone.
  get('stormSearch').value='';renderStorms();get('stormTarget').value=destination?.id||'';
  updateCoverage();updateBand();updateActions();
  const lat=`${Math.abs(position.latitude).toFixed(2)}°${position.latitude<0?'S':'N'}`,lon=`${Math.abs(position.longitude).toFixed(2)}°${position.longitude<0?'W':'E'}`;
  status('positionStatus',`${storm.name}: ${lat}, ${lon} · ${position.source}${position.method==='interpolated'?` · Interpolated between ${position.times.map(t=>t.slice(11,16)+'Z').join(' and ')}.`:` at ${time}Z.`}${satellite?` Suggested ${SATELLITES.find(row=>row.id===satellite).label}.`:' Choose a satellite manually for this date and region.'}`);
  return lookup;
}
async function checkScan(settings=readSettings()){
  const key=JSON.stringify(settings);if(inventoryScan?.key===key)return inventoryScan.scan;
  status('scanStatus','Checking SSEC’s public scan inventory…');
  try{
    const response=await fetch('/api/mcfetch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...settings,action:'scan'})});
    const scan=await response.json();if(!response.ok)throw Error(scan.message||'The archive scan could not be checked.');
    if(JSON.stringify(readSettings())!==key)throw Error('The settings changed. Check the new scan settings.');
    inventoryScan={key,scan};
    const difference=Math.abs(scan.offsetMinutes),shift=difference?` · ${Number(difference.toFixed(2))} min ${scan.offsetMinutes<0?'before':'after'} your requested time`:' · matches your requested time';
    status('scanStatus',`Available scan: ${scan.date} at ${scan.time} UTC · ${scan.coverage}${shift}.`);return scan;
  }catch(error){status('scanStatus',error.message,true);throw error;}
}
async function showPosition(){get('lookupStorm').disabled=true;try{if(!get('manualPosition').checked)await resolvePosition();await checkScan();}catch(error){if(!lookup&&!get('manualPosition').checked)status('positionStatus',error.message,true);}finally{get('lookupStorm').disabled=false;}}
get('lookupStorm').addEventListener('click',showPosition);get('lookupMatch').addEventListener('change',showPosition);
async function applyCommand(){try{const values=parseStormCommand(get('stormCommand').value);for(const [id,value]of Object.entries({lookupName:values.query,lookupYear:values.year,scanDate:values.date,scanTime:values.time,enhancement:values.enhancement,bandMode:'infrared'}))get(id).value=value;get('manualPosition').checked=false;get('manualPosition').dispatchEvent(new Event('change'));get('satellite').value='auto';get('coverage').value='';clearLookup();await showPosition();}catch(error){status('positionStatus',error.message,true);}}
get('applyCommand').addEventListener('click',applyCommand);get('stormCommand').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();applyCommand();}});
function renderStorms(){
  const previous=get('stormTarget').value,terms=get('stormSearch').value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const rows=catalog.filter(row=>terms.every(term=>`${row.name} ${row.year}`.toLowerCase().includes(term)));
  get('stormTarget').replaceChildren(new Option('No cyclone selected',''),...rows.map(row=>new Option(`${row.name} (${row.year})`,row.id)));
  if(rows.some(row=>row.id===previous))get('stormTarget').value=previous;
  get('stormHint').textContent=terms.length?`${rows.length} matching cyclones. Press Enter to select the first result.`:'Choose a cyclone to carry its details into the generator or upload to its gallery.';
  updateActions();
}
get('stormSearch').addEventListener('input',renderStorms);get('stormTarget').addEventListener('change',()=>{const storm=selectedStorm();if(storm){get('lookupName').value=stormLookupName(storm.name);get('lookupYear').value=storm.year;clearLookup();}updateActions();});bindStormSearchEnter(get('stormSearch'),get('stormTarget'));
async function loadStorms(){
  catalog=(await loadPublicCatalog('cyclones')||[]).sort((a,b)=>Number(b.year)-Number(a.year)||String(a.name).localeCompare(b.name));renderStorms();
  if(!catalog.length)get('stormHint').textContent='The cyclone list is unavailable. You can still fetch, download and use images in the generator.';
}
function readSettings(){
  const satellite=currentSatellite(),mode=get('bandMode').value;
  if(!satellite)throw Error('Choose a satellite for this date and region.');
  return normalizeMcfetch({satellite:satellite.id,date:get('scanDate').value,time:get('scanTime').value,latitude:get('latitude').value,longitude:get('longitude').value,band:mode==='custom'?get('customBand').value:satellite[mode],enhancement:get('enhancement').value,coverage:get('coverage').value,width:get('imageWidth').value,height:get('imageHeight').value,magLine:get('magLine').value,magElement:get('magElement').value,map:get('showMap').checked});
}
form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  if(!accessKey){get('accessKey').focus();return;}
  busy=true;controller=new AbortController();updateActions();status('requestStatus','Finding the storm and requesting satellite imagery…');get('previewBadge').textContent='Fetching…';
  try {
    if(!get('manualPosition').checked)await resolvePosition();
    const requested=readSettings(),scan=await checkScan(requested),storm=selectedStorm()||(!get('manualPosition').checked&&lookup?{name:lookup.storm.name,year:Number(get('lookupYear').value)}:null);
    let position=null;
    if(!get('manualPosition').checked&&lookup)position=positionAt(lookup.storm,scan.date,scan.time);
    const settings=normalizeMcfetch({...requested,date:scan.date,time:scan.time,coverage:scan.coverage,...(position?{latitude:position.latitude,longitude:position.longitude}:{})});
    if(!accessKey||controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
    const response=await fetch('/api/mcfetch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...settings,apiKey:accessKey}),signal:controller.signal});
    if(!response.ok){let detail={message:'The image could not be retrieved. Please try again.'};try{detail=await response.json();}catch{}if(detail.code==='key'){get('accessBadge').textContent='Key rejected';get('accessBadge').classList.remove('connected');status('accessStatus',detail.message,true);}throw Error(detail.message);}
    const blob=await response.blob();if(blob.size>MCFETCH_MAX_BYTES)throw Error('This image is too large to preview. Try smaller pixel dimensions.');
    validateImageBytes(new Uint8Array(await blob.arrayBuffer()),blob.type);
    const url=URL.createObjectURL(blob),probe=new Image();probe.src=url;
    try{await probe.decode();}catch{URL.revokeObjectURL(url);throw Error('The returned image could not be displayed. Try another scan.');}
    if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=url;
    const name=mcfetchFilename(settings,storm?.name).replace(/\.(?:png|gif)$/,'.'+IMPORT_TYPES[blob.type]);
    result={blob,name,settings,requested,scan,storm,position,width:probe.naturalWidth,height:probe.naturalHeight};
    get('archiveImage').src=url;get('archiveImage').alt=`${settings.satellite} band ${settings.band}, selected archive scan ${settings.date} at ${settings.time} UTC${storm?' for '+storm.name:''}`;
    get('archiveImage').hidden=false;get('emptyPreview').hidden=true;get('resultDetails').hidden=false;
    get('resultTitle').textContent=storm?`${storm.name} · ${storm.year}`:'Archived satellite image';
    get('resultMeta').textContent=`${settings.satellite} · Band ${settings.band} · Inventory scan ${settings.date} ${settings.time} UTC · Requested ${requested.date} ${requested.time} UTC`;
    get('resultFacts').replaceChildren(...[`${result.width} × ${result.height} px`,`${(blob.size/1024).toFixed(0)} KB`,`${Math.abs(settings.latitude)}° ${settings.latitude<0?'S':'N'}, ${Math.abs(settings.longitude)}° ${settings.longitude<0?'W':'E'}`,settings.enhancement||'Default grayscale'].map(value=>{const span=document.createElement('span');span.textContent=value;return span;}));
    status('requestStatus','Image retrieved. Download it or send it to your next step.');get('previewBadge').textContent='Image ready';get('accessBadge').textContent='Key verified';get('accessBadge').classList.add('connected');status('accessStatus','Key accepted by SSEC for this image request.');
  } catch(error){status('requestStatus',error.name==='AbortError'?'Image request cancelled.':error.message,true);if(!get('manualPosition').checked&&!lookup)status('positionStatus',error.message,true);get('previewBadge').textContent=result?'Previous image':'No image returned';}
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
    const id=crypto.randomUUID(),record={id,blob:result.blob,name:result.name,createdAt:Date.now(),pageUrl:'https://mcfetch.ssec.wisc.edu/',imageUrl:'',archive:{settings:result.settings,requested:result.requested,scan:result.scan,storm}};
    if(destination==='gallery')record.destination={kind:'cyclone',targetId:storm.id,category:'satellite'};
    await putImageImport(record);
    if(destination==='gallery')location.href=importDestinationUrl('cyclone',storm.id,id);
    else {const url=new URL('tropical-cyclone-generator.html',location.href);url.searchParams.set('archiveImage',id);location.href=url.href;}
  } catch(error){status('resultStatus',error.message||'Could not transfer this image. Download it and choose the file on the next page.',true);updateActions();}
}
get('sendGenerator').addEventListener('click',()=>transfer('generator'));get('sendGallery').addEventListener('click',()=>transfer('gallery'));
loadStorms();updateActions();
