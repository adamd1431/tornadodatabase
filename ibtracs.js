import {BASINS,AGENCIES,bareName,keyText,designation,searchStorms,columnMap,rawValue,numberValue,recordTime,availableAgencies,peakRecords,position,sixHourMotion,archiveLink,stormCsv,unpackSnapshot,fieldGroup} from './ibtracs-model.js';
import {drawTrack,drawIntensity} from './ibtracs-plots.js';
import {loadPublicCatalog} from './public-catalog.js';
import {cachedPublicMediaUrl} from './media-delivery.js';
import {cycloneUrl,openCycloneForm,cycloneActor} from './cyclones.js?v=ibtracs-media-2';
import {observationLink,cyclonePeakDraft,matchingDatabaseCyclones,loadDatabaseCycloneCandidates} from './ibtracs-transfer.js';
import {IMPORT_KINDS,normalizeSource,safeSourceImage,sourceCredit} from './ibtracs-media-model.js';
import {mountImportChoices,selectedImportSources,importCycloneSources} from './ibtracs-media-import.js';
import {analysisParameters,fetchPressureAnalysis,analysisCkzLink} from './poci-roci-client.js';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),yearCache=new Map(),catalog=fetch('public-data/catalogs.json').then(r=>{if(!r.ok)throw Error('No gallery snapshot');return r.json();}).then(d=>d.resources?.cyclones?.rows||[]).catch(()=>loadPublicCatalog('cyclones'));
const coasts=fetch('assets/mcfetch-coastlines.json').then(r=>r.ok?r.json():null).catch(()=>null);
let manifest,col,storm=null,records=[],current=0,agency='USA',variable='WIND',coastlines=null,matches=[],shown=100,serial=0;
let databaseRows=[],databaseState='checking',databaseClient=null;
let pressureSerial=0;
const sourceCache=new Map(),pendingImports=new Map();
try{for(const [sid,value]of JSON.parse(sessionStorage.getItem('ibtracs:pending-images')||'[]'))if(/^\d{7}[NS]\d{5}$/.test(sid)&&value?.result?.id&&Array.isArray(value.items))pendingImports.set(sid,{result:value.result,items:value.items.map(normalizeSource).filter(item=>item.sid===sid)});}catch{}
const savePendingImports=()=>{try{sessionStorage.setItem('ibtracs:pending-images',JSON.stringify([...pendingImports]));}catch{}};
const client=()=>databaseClient||(databaseClient=import('./supabase.js').then(m=>m.supabase).catch(error=>{databaseClient=null;throw error;}));
const fmtTime=time=>time?time.replace('T',' ').replace(/:00(?:\.000)?Z$/,' UTC'):'Not available';
const shortTime=time=>time?new Intl.DateTimeFormat('en-GB',{month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'UTC'}).format(new Date(time)).replace(',','')+' UTC':'';
const display=(value,unit='',decimals=1)=>value===null||value===undefined||value===''?'—':Number.isFinite(+value)?Number(value).toFixed(decimals)+(unit?' '+unit:''):String(value);
const status=(text,error=false)=>{$('pageStatus').textContent=text;$('pageStatus').classList.toggle('error',error);};
const make=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
const descriptions={USA_POCI:'Pressure of outermost closed isobar',USA_ROCI:'Radius of outermost closed isobar',USA_RMW:'Radius of maximum winds',USA_EYE:'Eye diameter',STORM_SPEED:'IBTrACS storm motion speed',STORM_DIR:'Storm motion direction',IFLAG:'Source / interpolation flags',TRACK_TYPE:'Main, provisional or spur track',WMO_WIND:'WMO agency wind; native averaging period',WMO_PRES:'WMO agency central pressure',DIST2LAND:'Distance to nearest land',LANDFALL:'Nearest land within next time step',USA_AGENCY:'Original source of the USA variables'};
const aliases={roci:'ROCI outermost closed isobar radius',poci:'POCI environmental outermost closed isobar pressure',rmw:'RMW radius maximum wind',eye:'EYE eye diameter',tnum:'TNUM Dvorak T number',ci:'CI Dvorak current intensity',r34:'R34 gale wind radii'};
function filterResults(){shown=100;matches=searchStorms(manifest.storms,{query:$('stormSearch').value,year:$('seasonFilter').value,basin:$('basinFilter').value});renderResults();}
function renderResults(){
  $('searchResults').hidden=false;$('stormMatches').replaceChildren(...matches.slice(0,shown).map(s=>new Option(`${s.name} · ${s.season} · ${s.basins.join('/')} · ${s.atcf.map(a=>designation(a,s)).join(' / ')||s.id}${s.types.every(t=>/spur/i.test(t))?' · alternate track':''}`,s.id)));
  $('stormMatches').size=Math.max(2,Math.min(5,matches.length));$('stormMatches').style.height=(matches.length<2?54:Math.min(5,matches.length)*33+14)+'px';
  $('stormMatches').value=matches.some(s=>s.id===storm?.id)?storm.id:'';$('matchCount').textContent=`${matches.length.toLocaleString()} matches${matches.length>shown?' · showing '+shown:''}. Press Enter to open the top result.`;$('moreResults').hidden=matches.length<=shown;
}
async function choose(id){
  const selected=manifest.storms.find(s=>s.id===id);if(!selected)return;const token=++serial;status('Loading '+selected.name+' '+selected.season+'…');$('stormView').setAttribute('aria-busy','true');
  try{
    if(!yearCache.has(selected.season))yearCache.set(selected.season,fetch(`ibtracs-data/${selected.season}.json.gz`).then(unpackSnapshot).catch(e=>{yearCache.delete(selected.season);throw e;}));
    const data=await yearCache.get(selected.season);if(token!==serial)return;const full=data.storms.find(s=>s.id===id);if(!full?.records?.length)throw Error('This storm record is unavailable.');
    storm=selected;records=full.records;current=0;const agencies=availableAgencies(records,col);agency=agencies.some(a=>a.id===agency)?agency:agencies.find(a=>a.id==='USA')?.id||agencies[0]?.id||'WMO';
    $('agencySelect').replaceChildren(...agencies.map(a=>new Option(a.label,a.id)));if(!agencies.length)$('agencySelect').add(new Option('WMO reporting agency','WMO'));$('agencySelect').value=agency;
    $('stormTitle').textContent=`${storm.name} ${storm.season}`;$('stormIdentity').textContent=storm.basins.map(b=>BASINS[b]||b).join(' / ')+' · '+storm.atcf.map(a=>designation(a,storm)).join(' / ');$('stormDates').textContent=`${storm.id} · ${storm.start} — ${storm.end} UTC · ${storm.types.join(', ')}`;$('recordCount').textContent=records.length+' observations';
    $('sourcePage').href='https://ncics.org/ibtracs/index.php?name=v04r01-'+storm.id;$('imageryHeading').textContent='Imagery · '+storm.name+' '+storm.season;
    $('recordSelect').replaceChildren(...records.map((r,i)=>new Option(fmtTime(recordTime(r,col)),i)));$('recordSlider').max=records.length-1;
    const peaks=peakRecords(records,col,agency);current=peaks.wind?.index??peaks.pressure?.index??0;
    $('stormView').hidden=false;$('stormView').setAttribute('aria-busy','false');$('stormMatches').value=id;status(`${manifest.columns.length} source fields · ${records.length} observations · ${manifest.dataset}`);history.replaceState(null,'','ibtracs.html?'+new URLSearchParams({sid:id}));
    updateAgency();renderHistory();renderObservation();checkDatabasePresence(token);loadSourceImagery(token);loadImagery(token);coasts.then(c=>{if(token===serial){coastlines=c;renderMap();}});
    if(yearCache.size>3)for(const key of yearCache.keys())if(key!==storm.season){yearCache.delete(key);break;}
  }catch(e){if(token!==serial)return;status(e.message,true);$('stormView').setAttribute('aria-busy','false');}
}
function updateAgency(){
  const selected=AGENCIES.find(a=>a.id===agency),peaks=peakRecords(records,col,agency);$('agencyNote').textContent=selected?.note||'Native source values';
  for(const [id,peak,unit]of [['peakWind',peaks.wind,'kt'],['minPressure',peaks.pressure,'mb']]){$(id).disabled=!peak;$(id+'Value').textContent=display(peak?.value,unit);$(id+'Time').textContent=shortTime(peak?.time);}
}
function addFact(label,value,secondary){const dt=make('dt',label),dd=make('dd',value);if(secondary)dd.append(make('small',secondary));$('recordFacts').append(dt,dd);}
function renderObservation(){
  if(!records.length)return;$('recordSelect').value=current;$('recordSlider').value=current;$('previousRecord').disabled=current===0;$('nextRecord').disabled=current===records.length-1;const row=records[current],p=position(row,col,agency),wind=numberValue(row,col,agency+'_WIND'),pressure=numberValue(row,col,agency+'_PRES');$('observationHeading').textContent=shortTime(recordTime(row,col));$('recordFacts').replaceChildren();
  addFact('Position',p?`${Math.abs(p.lat).toFixed(2)}°${p.lat<0?'S':'N'} ${Math.abs(p.lon).toFixed(2)}°${p.lon<0?'W':'E'}`:'—',p?p.source+' position':null);addFact('Sustained wind',display(wind,'kt'),wind!==null?`${(wind*1.150779448).toFixed(1)} mph · ${(wind*1.852).toFixed(1)} km/h`:null);addFact('Central pressure',display(pressure!==null&&pressure>0?pressure:null,'mb'));
  for(const [label,key,unit]of [['POCI','POCI','mb'],['ROCI','ROCI','nmi'],['Maximum-wind radius','RMW','nmi'],['Eye diameter','EYE','nmi']])addFact(label,display(numberValue(row,col,agency+'_'+key),unit));
  addFact('IBTrACS motion',display(numberValue(row,col,'STORM_SPEED'),'kt'),display(numberValue(row,col,'STORM_DIR'),'°'));
  const motion=sixHourMotion(records,col,current,agency);addFact('6-hour forward speed',display(motion,'kt',2),'±3h track distance ÷ 6');
  const flags=rawValue(row,col,'IFLAG'),type=rawValue(row,col,'TRACK_TYPE'),origin=rawValue(row,col,agency+'_AGENCY');$('recordFlag').textContent=`${type}${origin?' · '+origin:''}${flags?' · IFLAG '+flags:''}. O = original, P / I / V = interpolated or filled source values. No missing value is estimated here.`;
  $('positionSource').textContent=p?p.source+' position':null;const link=archiveLink(storm,row,col,agency);for(const id of ['archiveScan','imageryArchiveLink']){$(id).href=link||'satellite-archive.html';$(id).setAttribute('aria-disabled',String(!link));}
  $('sendCkz').href=observationLink('wind-pressure.html',storm,row,col,agency);
  pressureSerial++;$('derivedPressureValues').hidden=true;$('derivedCkzLink').hidden=true;$('extractPressure').disabled=false;
  try{const p=analysisParameters(recordTime(row,col),storm.id,agency);$('pressureExtractorLink').href='poci-roci.html?'+new URLSearchParams(p);$('pressureExtractionStatus').textContent='Selected UTC time · NOAA reanalysis estimates.';}catch(error){$('extractPressure').disabled=true;$('pressureExtractionStatus').textContent=error.message;$('pressureExtractorLink').href='poci-roci.html';}
  $('scanAvailability').textContent=link?'Opens this storm, UTC time and location. McFETCH access is required for scans.':'This observation predates the Satellite Archive’s 1974 coverage.';$('imageryScanTime').textContent=fmtTime(recordTime(row,col))+' · '+(link?'Prefilled from this IBTrACS record.':'Historical satellite coverage is unavailable here.');
  renderMap();renderChart();renderFields();for(const tr of $('historyRows').children)tr.setAttribute('aria-selected',String(+tr.dataset.index===current));
}
function updateDatabaseActions(){
  const found=storm?matchingDatabaseCyclones(databaseRows,storm):[];
  $('addCyclone').hidden=databaseState!=='ready'||found.length>0;$('existingCyclone').hidden=found.length!==1||found[0].status==='pending';
  if(found.length===1&&found[0].status!=='pending')$('existingCyclone').href=cycloneUrl(found[0]);
  $('retryDatabaseCheck').hidden=databaseState!=='error';
  $('resumeCycloneImport').hidden=!pendingImports.has(storm?.id);
  $('databaseActionStatus').textContent=found.length?found.some(r=>r.status==='pending')?'This cyclone has already been submitted.':'This cyclone is already in the database.':databaseState==='checking'?'Checking whether this cyclone has been added…':databaseState==='error'?'Could not check existing cyclones. Retry before adding.':'Add cyclone starts with USA / NHC · JTWC lifetime peak values.';
}
async function checkDatabasePresence(token=serial){
  databaseState='checking';updateDatabaseActions();const target=storm;if(!target)return;
  try{const candidates=await loadDatabaseCycloneCandidates(await client(),target);if(token!==serial)return;const years=new Set([target.season,Number(target.start.slice(0,4)),Number(target.end.slice(0,4))]);databaseRows=databaseRows.filter(r=>!years.has(Number(r.year))).concat(candidates);databaseState='ready';updateDatabaseActions();}
  catch{if(token!==serial)return;const saved=await catalog;if(token!==serial)return;databaseRows=(saved||[]).concat(databaseRows);databaseState='error';updateDatabaseActions();}
}
async function addSelectedCyclone(){
  if(!storm||$('stormView').getAttribute('aria-busy')==='true'||databaseState!=='ready'||matchingDatabaseCyclones(databaseRows,storm).length)return;
  const token=serial,target=storm,draft=cyclonePeakDraft(target,records,col);$('addCyclone').disabled=true;
  try{
    const db=await client(),fresh=await loadDatabaseCycloneCandidates(db,target);if(token!==serial)return;
    const found=matchingDatabaseCyclones(fresh,target);if(found.length){databaseRows.push(...found);updateDatabaseActions();return;}
    const [media,actor]=await Promise.all([loadSourceMedia(target).catch(()=>({items:[]})),cycloneActor(db)]);if(token!==serial)return;
    showCycloneImportForm(db,target,draft,media.items,actor);
  }catch(e){if(token===serial)$('databaseActionStatus').textContent=e.message||'Could not prepare the cyclone form.';}
  finally{$('addCyclone').disabled=false;}
}
function showCycloneImportForm(db,target,draft,items,actor,existingResult=null){
  const sourceNote=`IBTrACS ${draft.source}. Lifetime peak wind: ${draft.values.peak_winds_kts===''?'not reported':draft.values.peak_winds_kts+' kt'}${draft.windAt?' at '+fmtTime(draft.windAt):''}. Lowest pressure: ${draft.values.lowest_pressure_mb===''?'not reported':draft.values.lowest_pressure_mb+' mb'}${draft.pressureAt?' at '+fmtTime(draft.pressureAt):''}. Wind conversion follows the database’s nearest-5 mph convention.${draft.missing.length?' Missing fields must be entered before submitting.':''}`;
  openCycloneForm(db,result=>{pendingImports.delete(target.id);savePendingImports();if(target.id===storm?.id){databaseState='ready';updateDatabaseActions();$('databaseActionStatus').textContent=result.status==='approved'?'Tropical cyclone and selected images added.':'Tropical cyclone and selected images submitted for review.';}},
    {values:draft.values,sourceNote,draftKey:target.id+(existingResult?'-retry':'')+':'+(actor.user?.id||'guest')+':'+items.map(item=>item.kind+'='+item.url).join('|'),existingResult,title:existingResult?'Finish cyclone image import':'Add tropical cyclone',mount:form=>mountImportChoices(form,items,actor),
      beforeSubmit:async()=>{const found=matchingDatabaseCyclones(await loadDatabaseCycloneCandidates(db,target),target);if(found.length){databaseRows.push(...found);if(target.id===storm?.id)updateDatabaseActions();throw Object.assign(Error('Cyclone already exists'),{code:'CYCLONE_EXISTS'});}},
      onCreated:(result,form)=>{databaseRows.push({...draft.values,id:result.id,status:result.status});pendingImports.set(target.id,{result,items:selectedImportSources(form,items)});savePendingImports();if(target.id===storm?.id)updateDatabaseActions();},
      afterSubmit:(result,form)=>importCycloneSources(db,result.id,selectedImportSources(form,items))});
}
async function resumeImageImport(){const target=storm,entry=pendingImports.get(target?.id),token=serial;if(!entry)return;try{const db=await client(),actor=await cycloneActor(db);if(token!==serial)return;showCycloneImportForm(db,target,cyclonePeakDraft(target,records,col),entry.items,actor,entry.result);}catch(e){$('databaseActionStatus').textContent=e.message||'Could not resume the image import.';}}
function loadSourceMedia(target,fresh=false){
  if(fresh)sourceCache.delete(target.id);
  if(!sourceCache.has(target.id))sourceCache.set(target.id,fetch('api/ibtracs-media?'+new URLSearchParams({sid:target.id,...(fresh?{fresh:'1'}:{})})).then(async r=>{if(!r.ok)throw Error('Image sources are temporarily unavailable.');const data=await r.json();return {...data,items:(data.items||[]).map(item=>({...normalizeSource(item),preview:safeSourceImage(item.preview)||item.url})).filter(item=>item.sid===target.id)};}).catch(e=>{sourceCache.delete(target.id);throw e;}));
  return sourceCache.get(target.id);
}
async function loadSourceImagery(token=serial,fresh=false){
  const target=storm;if(!target)return;$('sourceImages').replaceChildren();$('sourceImageryStatus').textContent='Finding Wikipedia pictures, track and IBTrACS satellite imagery…';
  try{const data=await loadSourceMedia(target,fresh);if(token!==serial)return;
    for(const item of data.items){const figure=make('figure'),a=make('a'),img=make('img'),caption=make('figcaption');a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';img.src=item.preview||item.url;img.alt=IMPORT_KINDS[item.kind].label+' · '+target.name+' '+target.season;img.loading='lazy';img.referrerPolicy='no-referrer';a.append(img);figure.append(a);caption.append(make('strong',IMPORT_KINDS[item.kind].label));const credit=make('a',sourceCredit(item));credit.href=item.sourcePage;credit.target='_blank';credit.rel='noopener noreferrer';caption.append(credit);if(item.kind==='satellite')caption.append(make('span',item.at?fmtTime(item.at)+' · Archive image; independent of selected time.':'Archive image; timestamp not supplied.'));figure.append(caption);$('sourceImages').append(figure);}
    $('sourceImageryStatus').textContent=(data.items.length?'Matched source images. Add cyclone includes the selected images and uses the Wikipedia picture as its thumbnail.':'No matched source images are available for this cyclone.')+(data.warnings?.length?' '+data.warnings.join(' '):'');
  }catch(e){if(token===serial)$('sourceImageryStatus').textContent=e.message+' Use Refresh sources to retry.';}
}
function setRecord(i){if(!records[i])return;current=i;renderObservation();}
async function extractSelectedPressure(){
  const token=++pressureSerial,target=storm,row=records[current],parameters=analysisParameters(recordTime(row,col),target.id,agency);$('extractPressure').disabled=true;$('pressureExtractionStatus').textContent='Reading NOAA’s pressure grid…';
  try{const data=await fetchPressureAnalysis(parameters);if(token!==pressureSerial)return;const result=data.results.find(r=>r.sid===target.id);if(result?.status!=='estimated')throw Error(result?.message||'No separate pressure low was resolved.');$('derivedPoci').textContent=result.pociMb+' mb';$('derivedRoci').textContent=result.rociNmi+' nmi';$('derivedPressureValues').hidden=false;$('pressureExtractionStatus').textContent='Reanalysis estimate · 1° grid · 2-mb contours. Reported values above are unchanged.';const link=analysisCkzLink(result,agency);$('derivedCkzLink').hidden=!link;if(link)$('derivedCkzLink').href=link;
  }catch(error){if(token===pressureSerial)$('pressureExtractionStatus').textContent=error.message;}finally{if(token===pressureSerial)$('extractPressure').disabled=false;}
}
function renderMap(){drawTrack($('trackPlot'),{records,col,agency,index:current,coastlines,onSelect:setRecord});}
function renderChart(){drawIntensity($('intensityPlot'),{records,col,agency,index:current,variable,onSelect:setRecord});$('intensityCaption').textContent=`${AGENCIES.find(a=>a.id===agency)?.label||agency} · ${variable==='WIND'?'sustained wind (kt)':'central pressure (mb)'} · gaps stay blank`;}
function renderFields(){
  if(!records.length)return;const row=records[current],query=keyText($('fieldSearch').value),group=$('fieldAgency').value,include=$('includeMissing').checked;let count=0;
  const cells=manifest.columns.flatMap((name,i)=>{const value=row[i]??'',description=descriptions[name]||Object.entries(aliases).find(([key])=>name.toLowerCase().includes(key))?.[1]||'';if(group&&fieldGroup(name)!==group||!include&&value===''||query&&!keyText(name+' '+description).includes(query))return [];count++;const cell=make('div',undefined,'field-cell'+(value===''?' empty':'')),heading=make('div');heading.append(make('code',name),make('small',manifest.units[i]||''));cell.append(heading,make('strong',value===''?'—':value));if(description)cell.append(make('span',description,'field-description'));return [cell];});
  $('allFields').replaceChildren(...cells);$('fieldCount').textContent=`${count} of ${manifest.columns.length} fields · ${fmtTime(recordTime(row,col))}`;
}
function renderHistory(){
  $('historyRows').replaceChildren(...records.map((r,i)=>{const tr=make('tr');tr.dataset.index=i;const td=make('td'),button=make('button',fmtTime(recordTime(r,col)));button.type='button';button.addEventListener('click',()=>setRecord(i));td.append(button);tr.append(td);const p=position(r,col,agency);for(const text of [display(p?.lat,'',2),display(p?.lon,'',2),rawValue(r,col,agency+'_WIND')||'—',rawValue(r,col,agency+'_PRES')||'—',rawValue(r,col,'TRACK_TYPE')])tr.append(make('td',text));return tr;}));
}
function safeImage(value){try{const u=new URL(cachedPublicMediaUrl(value),location.href);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
async function loadImagery(token){
  $('stormImages').replaceChildren();$('galleryPage').hidden=true;$('imageryStatus').textContent='Finding matching database imagery…';
  try{const rows=await catalog;if(token!==serial)return;const found=(rows||[]).filter(r=>r.year===storm.season&&keyText(bareName(r.name))===keyText(storm.name));if(found.length!==1){$('imageryStatus').textContent='No existing database gallery is matched to this cyclone.';return;}
    const target=found[0];$('galleryPage').href=cycloneUrl(target);$('galleryPage').hidden=false;const response=await fetch(`public-data/galleries/cyclone/${target.id}.json`),gallery=response.ok?await response.json():null;if(token!==serial)return;
    const images=(gallery?.rows||[]).filter(r=>r.status==='approved'&&(r.mime_type?.startsWith('image/')||/\.(png|jpe?g|gif|webp|avif)(?:\?|$)/i.test(r.file_url||''))).slice(0,6);if(!images.length&&target.cover_image)images.push({file_url:target.cover_image,filename:'Database cover image',category:'satellite'});
    for(const image of images){const src=safeImage(image.file_url);if(!src)continue;const figure=make('figure'),a=make('a'),img=make('img');a.href=src;a.target='_blank';a.rel='noopener noreferrer';img.src=src;img.loading='lazy';img.alt=storm.name+' '+storm.season+' · '+(image.filename||'Database imagery');img.addEventListener('error',()=>{figure.hidden=true;});a.append(img);figure.append(a,make('figcaption',(image.category||'Image')+' · '+(image.filename||'Database imagery')));$('stormImages').append(figure);}
    $('imageryStatus').textContent=images.length?'Approved database imagery for this cyclone. Image times vary; these are not necessarily the selected UTC observation.':'This cyclone’s gallery has no images yet. Satellite Archive can search for historical scans.';
  }catch{if(token===serial)$('imageryStatus').textContent='Database imagery is temporarily unavailable. Satellite Archive remains linked below.';}
}
function download(type){if(!storm)return;const text=type==='csv'?stormCsv(manifest.columns,manifest.units,records):JSON.stringify({dataset:manifest.dataset,source:manifest.source,lastModified:manifest.lastModified,storm,columns:manifest.columns,units:manifest.units,records},null,2),url=URL.createObjectURL(new Blob([text],{type:type==='csv'?'text/csv;charset=utf-8':'application/json'})),a=make('a');a.href=url;a.download=`ibtracs-${storm.name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${storm.season}-${storm.id}.${type}`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
$('searchForm').addEventListener('submit',event=>{event.preventDefault();filterResults();if(matches[0])choose(matches[0].id);});$('stormSearch').addEventListener('input',()=>manifest&&filterResults());for(const id of ['seasonFilter','basinFilter'])$(id).addEventListener('change',filterResults);$('stormMatches').addEventListener('change',()=>choose($('stormMatches').value));$('moreResults').addEventListener('click',()=>{shown+=100;renderResults();});
$('agencySelect').addEventListener('change',()=>{agency=$('agencySelect').value;updateAgency();renderHistory();renderObservation();});$('recordSelect').addEventListener('change',()=>setRecord(+$('recordSelect').value));$('recordSlider').addEventListener('input',()=>setRecord(+$('recordSlider').value));$('previousRecord').addEventListener('click',()=>setRecord(current-1));$('nextRecord').addEventListener('click',()=>setRecord(current+1));
$('peakWind').addEventListener('click',()=>setRecord(peakRecords(records,col,agency).wind?.index));$('minPressure').addEventListener('click',()=>setRecord(peakRecords(records,col,agency).pressure?.index));
for(const [id,v]of [['windChart','WIND'],['pressureChart','PRES']])$(id).addEventListener('click',()=>{variable=v;$('windChart').setAttribute('aria-pressed',String(v==='WIND'));$('pressureChart').setAttribute('aria-pressed',String(v==='PRES'));renderChart();});
for(const id of ['fieldSearch','fieldAgency','includeMissing'])$(id).addEventListener(id==='fieldSearch'?'input':'change',renderFields);$('downloadCsv').addEventListener('click',()=>download('csv'));$('downloadJson').addEventListener('click',()=>download('json'));
$('addCyclone').addEventListener('click',addSelectedCyclone);$('retryDatabaseCheck').addEventListener('click',()=>checkDatabasePresence());
$('refreshSourceImages').addEventListener('click',()=>loadSourceImagery(serial,true));$('resumeCycloneImport').addEventListener('click',resumeImageImport);
$('extractPressure').addEventListener('click',extractSelectedPressure);
try{
  const response=await fetch('ibtracs-data/index.json');if(!response.ok)throw Error('The global archive could not be loaded. Please refresh.');manifest=await response.json();if(manifest.version!==1||!Array.isArray(manifest.storms))throw Error('Unsupported IBTrACS snapshot.');col=columnMap(manifest.columns);
  $('archiveCount').textContent=manifest.storms.length.toLocaleString()+' cyclones';$('snapshotDate').textContent='Snapshot '+new Date(manifest.generatedAt).toISOString().slice(0,10);for(const y of [...manifest.years].reverse())$('seasonFilter').add(new Option(y,y));for(const [key,value]of Object.entries(BASINS))$('basinFilter').add(new Option(value,key));for(const a of AGENCIES)$('fieldAgency').add(new Option(a.label,a.id));
  const sid=params.get('sid'),initial=manifest.storms.find(s=>s.id===sid)||manifest.storms.find(s=>s.name==='HAIYAN'&&s.season===2013)||manifest.storms.at(-1);$('stormSearch').value=initial.name+' '+initial.season;filterResults();await choose(initial.id);
}catch(e){status(e.message,true);}
