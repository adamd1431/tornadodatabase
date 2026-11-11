import {unpackSnapshot} from './ibtracs-model.js';
import {MOTIS_DATASET,normalizeMotisPoints,motisScansForStorm,nearestMotisScan} from './motis-model.js?v=poci-csv-2';

export function initMotisRecord({onSelection=()=>{},onActiveChange=()=>{}}={}){
  const $=id=>document.getElementById(id),button=$('motisToggle'),panel=$('motisRecord');
  let context=null,scans=[],promise=null,serial=0,active=false;
  const utc=at=>at.replace('T',' ').replace(':00Z',' UTC');
  const status=(message,error=false)=>{$('motisStatus').textContent=message;$('motisStatus').classList.toggle('error',error);};
  const clear=()=>{onSelection(null);$('motisFacts').replaceChildren();$('motisScan').replaceChildren();$('motisScan').disabled=true;$('motisLowest').disabled=true;$('motisSendCkz').hidden=true;$('motisSendCkz').removeAttribute('href');};
  async function dataset(){
    if(!promise)promise=fetch('motis-data/points.json.gz?v=poci-2').then(response=>{if(!response.ok)throw Error('MOTIS scans could not be loaded. Close and reopen MOTIS to retry.');return unpackSnapshot(response);}).then(normalizeMotisPoints).catch(error=>{promise=null;throw error;});
    return promise;
  }
  function showScan(index){
    const scan=scans[Number(index)];if(!scan)return;$('motisScan').value=String(index);$('motisFacts').replaceChildren();
    const fact=(label,value)=>{const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;$('motisFacts').append(dt,dd);};
    fact('Estimated pressure',scan.pressureMb.toFixed(1)+' mb');fact('Dataset POCI',scan.pociMb===null?'Not supplied':scan.pociMb.toFixed(3)+' mb');fact('Actual scan time',utc(scan.at));fact('Satellite',scan.satellite);fact('Eye clarity',scan.eyeClarity);fact('Position',`${Math.abs(scan.latitude).toFixed(3)}°${scan.latitude<0?'S':'N'} ${Math.abs(scan.longitude).toFixed(3)}°${scan.longitude<0?'W':'E'}`);
    $('motisSendCkz').href='#setupIsobars';$('motisSendCkz').textContent='Next: choose POCI / ROCI ↓';$('motisSendCkz').hidden=false;onSelection(scan);
    const offset=(Date.parse(scan.at)-Date.parse(context.at))/60000;
    status(`${scans.length} MOTIS scans for ${context.storm.name} ${context.storm.season}. ${offset===0?'This scan matches the selected IBTrACS time.':`This scan is ${Math.abs(offset).toFixed(0)} min ${offset<0?'before':'after'} the selected IBTrACS time.`}`);
  }
  async function render(){
    const token=++serial;clear();if(!active||!context)return;status('Loading MOTIS satellite pressure estimates…');panel.setAttribute('aria-busy','true');
    try{
      const points=await dataset();if(token!==serial)return;scans=motisScansForStorm(points,context.storm);
      if(!scans.length){status(`No MOTIS scans are available for ${context.storm.name} ${context.storm.season} in this dataset.`);return;}
      $('motisScan').replaceChildren(...scans.map((p,i)=>new Option(`${utc(p.at)} · ${p.pressureMb.toFixed(1)} mb · ${p.satellite}`,String(i))));$('motisScan').disabled=false;$('motisLowest').disabled=false;
      showScan(scans.indexOf(nearestMotisScan(scans,context.at)||scans[0]));
    }catch(error){if(token===serial)status(error.message,true);}
    finally{if(token===serial)panel.removeAttribute('aria-busy');}
  }
  function setActive(value){active=value;button.setAttribute('aria-expanded',String(active));button.setAttribute('aria-pressed',String(active));panel.hidden=!active;onActiveChange(active);if(active)render();else{serial++;panel.removeAttribute('aria-busy');}}
  button.addEventListener('click',()=>setActive(!active));
  $('motisScan').addEventListener('change',()=>showScan($('motisScan').value));
  $('motisLowest').addEventListener('click',()=>{if(scans.length)showScan(scans.indexOf(scans.reduce((a,b)=>a.pressureMb<=b.pressureMb?a:b)));});
  $('motisSource').href=MOTIS_DATASET;
  return {setActive,setObservation(storm,at){const changed=context?.storm.id!==storm.id||context?.at!==at;context={storm,at};if(changed){scans=[];if(active)render();else clear();}}};
}
