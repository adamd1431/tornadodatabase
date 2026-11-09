import {BASINS,AGENCIES,bareName,keyText,designation,searchStorms,columnMap,rawValue,numberValue,recordTime,availableAgencies,peakRecords,position,sixHourMotion,archiveLink,stormCsv,unpackSnapshot,fieldGroup} from './ibtracs-model.js';
import {drawTrack,drawIntensity} from './ibtracs-plots.js';
import {loadPublicCatalog} from './public-catalog.js';
import {cachedPublicMediaUrl} from './media-delivery.js';
import {cycloneUrl} from './cyclones.js';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),yearCache=new Map(),catalog=fetch('public-data/catalogs.json').then(r=>{if(!r.ok)throw Error('No gallery snapshot');return r.json();}).then(d=>d.resources?.cyclones?.rows||[]).catch(()=>loadPublicCatalog('cyclones'));
const coasts=fetch('assets/mcfetch-coastlines.json').then(r=>r.ok?r.json():null).catch(()=>null);
let manifest,col,storm=null,records=[],current=0,agency='USA',variable='WIND',coastlines=null,matches=[],shown=100,serial=0;
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
    $('sourcePage').href='https://ncics.org/ibtracs/index.php?name=v04r01-'+storm.id;
    $('recordSelect').replaceChildren(...records.map((r,i)=>new Option(fmtTime(recordTime(r,col)),i)));$('recordSlider').max=records.length-1;
    const peaks=peakRecords(records,col,agency);current=peaks.wind?.index??peaks.pressure?.index??0;
    $('stormView').hidden=false;$('stormView').setAttribute('aria-busy','false');$('stormMatches').value=id;status(`${manifest.columns.length} source fields · ${records.length} observations · ${manifest.dataset}`);history.replaceState(null,'','ibtracs.html?'+new URLSearchParams({sid:id}));
    updateAgency();renderHistory();renderObservation();loadImagery(token);coasts.then(c=>{if(token===serial){coastlines=c;renderMap();}});
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
  $('scanAvailability').textContent=link?'Opens this storm, UTC time and location. McFETCH access is required for scans.':'This observation predates the Satellite Archive’s 1974 coverage.';$('imageryScanTime').textContent=fmtTime(recordTime(row,col))+' · '+(link?'Prefilled from this IBTrACS record.':'Historical satellite coverage is unavailable here.');
  renderMap();renderChart();renderFields();for(const tr of $('historyRows').children)tr.setAttribute('aria-selected',String(+tr.dataset.index===current));
}
function setRecord(i){if(!records[i])return;current=i;renderObservation();}
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
  try{const rows=await catalog;if(token!==serial)return;const found=(rows||[]).filter(r=>r.year===storm.season&&keyText(bareName(r.name))===keyText(storm.name));if(found.length!==1){$('imageryStatus').textContent='No uniquely matched database gallery for this storm. Use Satellite Archive to look for scans at the selected time.';return;}
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
try{
  const response=await fetch('ibtracs-data/index.json');if(!response.ok)throw Error('The global archive could not be loaded. Please refresh.');manifest=await response.json();if(manifest.version!==1||!Array.isArray(manifest.storms))throw Error('Unsupported IBTrACS snapshot.');col=columnMap(manifest.columns);
  $('archiveCount').textContent=manifest.storms.length.toLocaleString()+' cyclones';$('snapshotDate').textContent='Snapshot '+new Date(manifest.generatedAt).toISOString().slice(0,10);for(const y of [...manifest.years].reverse())$('seasonFilter').add(new Option(y,y));for(const [key,value]of Object.entries(BASINS))$('basinFilter').add(new Option(value,key));for(const a of AGENCIES)$('fieldAgency').add(new Option(a.label,a.id));
  const sid=params.get('sid'),initial=manifest.storms.find(s=>s.id===sid)||manifest.storms.find(s=>s.name==='HAIYAN'&&s.season===2013)||manifest.storms.at(-1);$('stormSearch').value=initial.name+' '+initial.season;filterResults();await choose(initial.id);
}catch(e){status(e.message,true);}
