import {BASINS,searchStorms,designation,columnMap,unpackSnapshot,numberValue,recordTime} from './ibtracs-model.js';
import {selectCkzPeak} from './ibtracs-transfer.js?v=peak-extract-1';
import {analysisParameters} from './poci-roci-client.js?v=closed-isobar-2';

export function initCyclonePeakImport({onImport}){
  const $=id=>document.getElementById(id),years=new Map();
  let manifest=null,indexPromise=null,matches=[],selected=null,serial=0,busy=false;
  const status=(message,error=false)=>{$('peakMatchCount').textContent=message;$('peakMatchCount').classList.toggle('peak-import-error',error);};
  async function index(){
    if(!indexPromise)indexPromise=fetch('ibtracs-data/index.json').then(r=>{if(!r.ok)throw Error('The IBTrACS archive could not be loaded. Reopen this panel to retry.');return r.json();}).then(data=>manifest=data).catch(error=>{indexPromise=null;throw error;});
    return indexPromise;
  }
  async function filter(){
    const token=++serial;selected=null;$('peakFixPreview').hidden=true;$('extractCyclonePeak').disabled=true;$('peakCycloneSelect').disabled=true;
    try{
      await index();if(token!==serial)return false;
      const query=$('peakCycloneSearch').value.trim();matches=query?searchStorms(manifest.storms,{query}).sort((a,b)=>Number(a.types.every(t=>/spur/i.test(t)))-Number(b.types.every(t=>/spur/i.test(t)))):[];
      $('peakCycloneSelect').replaceChildren(new Option(query?'Choose a cyclone…':'Search for a cyclone…',''),...matches.slice(0,80).map(s=>new Option(`${s.name} · ${s.season} · ${s.basins.map(b=>BASINS[b]||b).join(' / ')} · ${s.atcf.map(a=>designation(a,s)).join(' / ')||s.id}${s.types.every(t=>/spur/i.test(t))?' · alternate track':''}`,s.id)));
      $('peakCycloneSelect').disabled=!matches.length;
      status(query?`${matches.length.toLocaleString()} matches${matches.length>80?' · showing 80; narrow your search':''}. Enter selects the top result.`:'Enter a name, year, or designation. Enter selects the top result.');
      return true;
    }catch(error){if(token===serial)status(error.message,true);return false;}
  }
  async function choose(sid){
    const storm=manifest?.storms.find(s=>s.id===sid),token=++serial;selected=null;$('extractCyclonePeak').disabled=true;$('peakFixPreview').hidden=true;if(!storm)return;
    status(`Loading ${storm.name} ${storm.season}…`);
    try{
      if(!years.has(storm.season)){years.set(storm.season,fetch(`ibtracs-data/${storm.season}.json.gz`).then(unpackSnapshot).catch(error=>{years.delete(storm.season);throw error;}));if(years.size>4)years.delete(years.keys().next().value);}
      const data=await years.get(storm.season);if(token!==serial)return;
      const records=data.storms.find(s=>s.id===sid)?.records;if(!records?.length)throw Error('This cyclone’s observations are unavailable.');
      selected=selectCkzPeak(storm,records,columnMap(manifest.columns),$('peakBasis').value);
      const wind=numberValue(selected.row,selected.col,'USA_WIND'),pressure=numberValue(selected.row,selected.col,'USA_PRES');
      $('peakFixPreview').textContent=`${storm.name} ${storm.season} · ${recordTime(selected.row,selected.col).replace('T',' ').replace('Z',' UTC')} · ${wind>0?wind+' kt (1-minute)':'wind not reported'} · ${pressure>0?pressure+' mb':'pressure not reported'}`;
      $('peakFixPreview').hidden=false;$('extractCyclonePeak').disabled=false;
      let availability='POCI / ROCI will be extracted for this exact time.';
      try{analysisParameters(recordTime(selected.row,selected.col),storm.id);}catch(error){availability=`IBTrACS inputs can be imported, but POCI / ROCI will stay blank: ${error.message}`;}
      status(`${selected.peakLabel} selected. ${availability}`);
    }catch(error){if(token===serial)status(error.message,true);}
  }
  $('cyclonePeakImport').addEventListener('toggle',()=>{if($('cyclonePeakImport').open&&!manifest)filter();});
  $('peakCycloneSearch').addEventListener('input',filter);
  $('peakCycloneSearch').addEventListener('keydown',async event=>{
    if(event.key!=='Enter'||busy)return;event.preventDefault();if(!await filter()||!matches[0])return;$('peakCycloneSelect').value=matches[0].id;choose(matches[0].id);
  });
  $('peakCycloneSelect').addEventListener('change',()=>choose($('peakCycloneSelect').value));
  $('peakBasis').addEventListener('change',()=>choose($('peakCycloneSelect').value));
  $('cyclonePeakForm').addEventListener('submit',async event=>{
    event.preventDefault();if(!selected||busy)return;busy=true;
    const controls=[...$('cyclonePeakForm').querySelectorAll('input,select,button')].map(el=>[el,el.disabled]);controls.forEach(([el])=>{el.disabled=true;});$('cyclonePeakForm').setAttribute('aria-busy','true');$('extractCyclonePeak').textContent='Extracting NOAA POCI / ROCI…';
    try{await onImport(selected);}finally{busy=false;controls.forEach(([el,disabled])=>{el.disabled=disabled;});$('cyclonePeakForm').removeAttribute('aria-busy');$('extractCyclonePeak').textContent='Extract peak to CKZ →';}
  });
}
