import {calculateEyeDvorak,ADT_GUIDE,ADT_EYE_SOURCE} from './satellite-dvorak-model.js';
import {SATELLITES} from './mcfetch-model.js';

export function setupSatelliteDvorak(){
  const get=id=>document.getElementById(id);let loaded=null,archived=null,controller=null,revision=0;
  const message=(id,text,error=false)=>{get(id).textContent=text;get(id).classList.toggle('error',error);};
  const stamp=time=>time.replace('T',' ').replace(/(?:\.000)?Z$/,' UTC');
  function facts(id,items){
    get(id).replaceChildren(...items.map(([label,value])=>{const box=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;box.append(dt,dd);return box;}));
  }
  function calculate(){
    if(!loaded)return;
    get('dvorakLocalResults').hidden=true;
    try{
      const latitude=get('dvorakLatitude').value.trim(),longitude=get('dvorakLongitude').value.trim();
      if(!latitude||!longitude)throw Error('Enter the eye-center latitude and longitude.');
      const row=calculateEyeDvorak(loaded.plot.grid,{latitude:Number(latitude),longitude:Number(longitude),domain:get('dvorakDomain').value,largeEye:get('dvorakScene').value==='large'});
      get('dvorakRaw').textContent=`T${row.rawT.toFixed(1)}`;get('dvorakLocalResults').hidden=false;
      facts('dvorakMeasurements',[['Eye (within 24 km)',`${row.eye.toFixed(2)} °C`],['Mean cloud',`${row.cloud.toFixed(2)} °C`],['Cloud asymmetry',`${row.symmetry.toFixed(2)} °C`],['Cloud annulus',`${row.inner}–${row.outer} km`]]);
      message('dvorakLocalStatus','Approximate eye-scene regression using the loaded temperatures. Confirm the eye center. This is not a full ADT run: scene classification, microwave adjustments and history rules are not applied. The historical ADT record is shown separately below.');
    }catch(error){message('dvorakLocalStatus',error.message,true);}
  }
  async function lookupArchive(){
    controller?.abort();controller=new AbortController();const ownRevision=revision;
    if(!loaded.atcf){message('dvorakArchiveStatus','Load a scan using the storm-name lookup to compare it with the CIMSS ADT archive. Manual coordinates still support the local eye-scene calculation.');return;}
    message('dvorakArchiveStatus','Checking the historical CIMSS ADT archive…');
    try{
      const query=new URLSearchParams({atcf:loaded.atcf,time:loaded.plot.grid.timestamp,longitude:String(loaded.settings.longitude)}),response=await fetch('/api/satellite-dvorak?'+query,{signal:controller.signal}),data=await response.json();
      if(ownRevision!==revision)return;
      if(data.status!=='found'){message('dvorakArchiveStatus',data.message||'The CIMSS archive could not be checked.',!response.ok);return;}
      archived=data.record;
      get('dvorakArchivedResults').hidden=false;
      facts('dvorakArchivedRatings',[['Archived Raw T',`T${archived.rawT.toFixed(1)}`],['Archived Final T',`T${archived.finalT.toFixed(1)}`],['Archived CI',archived.ci.toFixed(1)]]);
      facts('dvorakArchivedDetails',[['Eye / center',archived.eye===null?'Unavailable':`${archived.eye.toFixed(2)} °C`],['Mean cloud',archived.cloud===null?'Unavailable':`${archived.cloud.toFixed(2)} °C`],['Scene',archived.scene],['Satellite',archived.satellite||'Unavailable']]);
      const offset=archived.offsetMinutes,difference=offset===0?'Exact time match':`${Math.abs(offset).toFixed(1)} minutes ${offset<0?'before':'after'} the loaded scan`;
      message('dvorakArchiveStatus',`${stamp(archived.timestamp)} · ${difference}. Historical ADT version ${archived.version}. Its center or satellite can differ from your scan. This record has not been updated to match later reanalyses.`);
      get('dvorakArchiveLink').href=data.sourceUrl;
      get('useDvorakCenter').hidden=archived.latitude===null||archived.longitude===null;
    }catch(error){if(error.name!=='AbortError'&&ownRevision===revision)message('dvorakArchiveStatus','CIMSS ADT could not be reached. You can still calculate the local eye-scene estimate.',true);}
  }
  get('calculateDvorak').addEventListener('click',()=>{
    if(!loaded)return;
    const panel=get('dvorakPanel');panel.hidden=false;get('calculateDvorak').setAttribute('aria-expanded','true');
    calculate();lookupArchive();panel.scrollIntoView({behavior:'auto',block:'nearest'});
  });
  get('dvorakForm').addEventListener('submit',event=>{event.preventDefault();calculate();});
  for(const id of ['dvorakLatitude','dvorakLongitude','dvorakDomain','dvorakScene'])get(id).addEventListener('input',()=>{get('dvorakLocalResults').hidden=true;message('dvorakLocalStatus','Center or scene changed. Recalculate to update the estimate.');});
  get('useDvorakCenter').addEventListener('click',()=>{if(!archived)return;get('dvorakLatitude').value=archived.latitude;get('dvorakLongitude').value=archived.longitude;calculate();});
  get('dvorakGuide').href=ADT_GUIDE;get('dvorakEquations').href=ADT_EYE_SOURCE;
  return {setResult(result){
    revision++;controller?.abort();loaded=result;archived=null;get('dvorakPanel').hidden=true;get('calculateDvorak').setAttribute('aria-expanded','false');get('dvorakArchivedResults').hidden=true;get('dvorakLocalResults').hidden=true;
    const infrared=result?.plot&&SATELLITES.find(s=>s.id===result.settings.satellite)?.infrared===result.settings.band;
    get('calculateDvorak').hidden=!infrared;
    if(!infrared){loaded=null;return;}
    get('dvorakLatitude').value=result.eyeCenter.latitude;get('dvorakLongitude').value=result.eyeCenter.longitude;
    get('dvorakDomain').value=result.eyeCenter.longitude>0&&result.eyeCenter.longitude<180?'pacific':'atlantic';
    get('dvorakScene').value='eye';get('dvorakScan').textContent=`${result.atcf||'Manual center'} · Image acquired ${stamp(result.plot.grid.timestamp)} · ${result.settings.satellite}. Requested ${result.requested.date} ${result.requested.time} UTC.`;
    message('dvorakLocalStatus','');message('dvorakArchiveStatus','');
  }};
}
