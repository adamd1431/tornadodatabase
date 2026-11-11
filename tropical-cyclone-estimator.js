import {BASINS,AGENCIES,searchStorms,columnMap,recordTime,availableAgencies,peakRecords,unpackSnapshot,designation} from './ibtracs-model.js';
import {initCkzSetup} from './ckz-setup.js?v=estimator-2';
import {initMotisRecord} from './motis-record.js?v=guided-3';
import {estimatorSelection,estimatorUrl} from './tropical-cyclone-estimator-model.js';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),years=new Map();
let manifest,col,storm=null,records=[],agency='USA',current=0,matches=[],shown=100,serial=0,selectedScan=null;
const utc=at=>at.replace('T',' ').replace(/:00(?:\.000)?Z$/,' UTC');
const status=(message,error=false)=>{$('pageStatus').textContent=message;$('pageStatus').classList.toggle('error',error);};
const setup=initCkzSetup({onActivateAgency:()=>motis.setActive(false)});
const motis=initMotisRecord({onActiveChange:active=>{setup.setMotisActive(active);if(!active)selectedScan=null;updateUrl();},onSelection:scan=>{selectedScan=scan;setup.setMotisScan(scan);updateUrl();}});
function updateUrl(){
  if(!storm)return;
  history.replaceState(null,'',estimatorUrl({sid:storm.id,at:selectedScan?.at||recordTime(records[current],col),agency,source:selectedScan?'motis':'agency'}));
}
function renderResults(){
  $('searchResults').hidden=false;
  $('stormMatches').replaceChildren(...matches.slice(0,shown).map(s=>new Option(`${s.name} · ${s.season} · ${s.atcf.map(id=>designation(id,s)).join(' / ')||s.basins.join(' / ')}`,s.id)));
  $('stormMatches').size=Math.max(2,Math.min(5,matches.length));$('stormMatches').style.height=(matches.length<2?54:Math.min(5,matches.length)*33+14)+'px';
  $('stormMatches').value=matches.some(s=>s.id===storm?.id)?storm.id:'';
  $('matchCount').textContent=`${matches.length.toLocaleString()} matches${matches.length>shown?' · showing '+shown:''}. Press Enter to select the top result.`;
  $('moreResults').hidden=matches.length<=shown;
}
function search(){if(!manifest)return;shown=100;matches=searchStorms(manifest.storms,{query:$('stormSearch').value,year:$('seasonFilter').value,basin:$('basinFilter').value});renderResults();}
function render(scanAt){
  const row=records[current];if(!row)return;
  const selected=AGENCIES.find(a=>a.id===agency),peaks=peakRecords(records,col,agency);
  $('agencyNote').textContent=selected?.note||'Native source values';
  for(const [id,p,unit]of [['peakWind',peaks.wind,'kt'],['minPressure',peaks.pressure,'mb']]){$(id).disabled=!p;$(id+'Value').textContent=p?p.value.toFixed(1)+' '+unit:'—';$(id+'Time').textContent=p?utc(p.time):'';}
  $('recordSelect').value=String(current);$('recordSlider').value=String(current);$('previousRecord').disabled=current===0;$('nextRecord').disabled=current===records.length-1;
  $('archiveRecord').href='ibtracs.html?'+new URLSearchParams({sid:storm.id,at:recordTime(row,col),agency});
  setup.setObservation({storm,records,col,agency,row});motis.setObservation(storm,scanAt||recordTime(row,col));updateUrl();
}
async function choose(id,options={}){
  const selected=manifest.storms.find(s=>s.id===id);if(!selected)return;
  const token=++serial;status('Loading '+selected.name+' '+selected.season+'…');$('stormView').hidden=true;$('estimatorEmpty').hidden=true;
  try{
    if(!years.has(selected.season))years.set(selected.season,fetch(`ibtracs-data/${selected.season}.json.gz`).then(unpackSnapshot).catch(error=>{years.delete(selected.season);throw error;}));
    const data=await years.get(selected.season);if(token!==serial)return;
    const full=data.storms.find(s=>s.id===id);if(!full?.records?.length)throw Error('This cyclone record is unavailable.');
    motis.setActive(false);storm=selected;records=full.records;
    const selection=estimatorSelection(records,col,options);agency=selection.agency;current=selection.index;
    $('agencySelect').replaceChildren(...availableAgencies(records,col).map(a=>new Option(a.label,a.id)));if(!$('agencySelect').options.length)$('agencySelect').add(new Option('WMO reporting agency','WMO'));$('agencySelect').value=agency;
    $('recordSelect').replaceChildren(...records.map((row,i)=>new Option(utc(recordTime(row,col)),String(i))));$('recordSlider').max=String(records.length-1);
    $('stormSearch').value=storm.name+' '+storm.season;$('stormView').hidden=false;render(selection.scanAt);
    if(selection.source==='motis')motis.setActive(true);
    status(selection.notice||`${storm.name} ${storm.season} · choose a peak or another UTC time, then complete the inputs below.`);
    if(years.size>3)for(const y of years.keys())if(y!==storm.season){years.delete(y);break;}
  }catch(error){if(token!==serial)return;status(error.message,true);$('estimatorEmpty').hidden=false;}
}
function setRecord(index){if(!records[index])return;current=index;render();}
$('searchForm').addEventListener('submit',event=>{event.preventDefault();search();if(matches[0])choose(matches[0].id);});
$('stormSearch').addEventListener('input',search);for(const id of ['seasonFilter','basinFilter'])$(id).addEventListener('change',search);
$('stormMatches').addEventListener('change',()=>choose($('stormMatches').value));$('moreResults').addEventListener('click',()=>{shown+=100;renderResults();});
$('agencySelect').addEventListener('change',()=>{agency=$('agencySelect').value;render();});$('recordSelect').addEventListener('change',()=>setRecord(+$('recordSelect').value));$('recordSlider').addEventListener('input',()=>setRecord(+$('recordSlider').value));
$('previousRecord').addEventListener('click',()=>setRecord(current-1));$('nextRecord').addEventListener('click',()=>setRecord(current+1));
$('peakWind').addEventListener('click',()=>setRecord(peakRecords(records,col,agency).wind?.index));$('minPressure').addEventListener('click',()=>setRecord(peakRecords(records,col,agency).pressure?.index));
try{
  const response=await fetch('ibtracs-data/index.json');if(!response.ok)throw Error('The cyclone archive could not be loaded. Please refresh.');
  manifest=await response.json();if(manifest.version!==1||!Array.isArray(manifest.storms))throw Error('Unsupported IBTrACS snapshot.');col=columnMap(manifest.columns);
  $('archiveCount').textContent=manifest.storms.length.toLocaleString()+' cyclones';$('snapshotDate').textContent='Snapshot '+new Date(manifest.generatedAt).toISOString().slice(0,10);
  for(const year of [...manifest.years].reverse())$('seasonFilter').add(new Option(year,year));for(const [id,label]of Object.entries(BASINS))$('basinFilter').add(new Option(label,id));
  const sid=params.get('sid');if(sid&&manifest.storms.some(s=>s.id===sid))await choose(sid,{agency:params.get('agency')||'USA',at:params.get('at'),source:params.get('source')==='motis'?'motis':'agency'});
  else status(sid?'That cyclone was not found. Search by name, year or designation.':'Choose a cyclone to begin.');
}catch(error){status(error.message,true);}
