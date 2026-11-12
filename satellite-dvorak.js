import {analyzeEyeDvorak,dvorakDomain,ADT_GUIDE,ADT_EYE_SOURCE,ADT_SAMPLING_SOURCE} from './satellite-dvorak-model.js?v=3';
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
      const row=analyzeEyeDvorak(loaded.plot.grid,{latitude:Number(latitude),longitude:Number(longitude),domain:get('dvorakDomain').value,atcf:loaded.atcf||'',largeEye:get('dvorakScene').value==='large',pinhole:get('dvorakScene').value==='pinhole',autoCenter:get('dvorakAutoCenter').checked});
      get('dvorakRaw').textContent=`T${row.rawT.toFixed(1)}`;get('dvorakLocalResults').hidden=false;
      facts('dvorakMeasurements',[['Eye (within 24 km)',`${row.eye.toFixed(2)} °C`],['Mean cloud',`${row.cloud.toFixed(2)} °C`],['Asymmetry (24–136 km)',`${row.symmetry.toFixed(2)} °C`],['Cloud annulus',`${row.inner}–${row.outer} km`],['Analysis center',`${row.latitude.toFixed(3)}°, ${row.longitude.toFixed(3)}°`],['Center adjustment',`${row.centerShiftKm.toFixed(1)} km${row.pinhole?' · pinhole correction':''}`]]);
      message('dvorakLocalStatus','SSEC eye-scene regression and temperature sampling, with support above T8.0. This is a single-image estimate, not a full ADT run with automatic scene classification, microwave data and history rules. Confirm the selected eye scene and center. Published research peak bias corrections are not automatically added to individual scans.');
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
  for(const id of ['dvorakLatitude','dvorakLongitude','dvorakDomain','dvorakScene','dvorakAutoCenter'])get(id).addEventListener('input',()=>{get('dvorakLocalResults').hidden=true;message('dvorakLocalStatus','Center or scene changed. Recalculate to update the estimate.');});
  get('useDvorakCenter').addEventListener('click',()=>{if(!archived)return;get('dvorakLatitude').value=archived.latitude;get('dvorakLongitude').value=archived.longitude;get('dvorakAutoCenter').checked=false;get('dvorakScene').value=/EYE\/P|PINHOL/.test(archived.scene)?'pinhole':/EYE\/L|LARGE/.test(archived.scene)?'large':'eye';calculate();});
  get('dvorakGuide').href=ADT_GUIDE;get('dvorakEquations').href=ADT_EYE_SOURCE;get('dvorakSampling').href=ADT_SAMPLING_SOURCE;
  return {setResult(result){
    revision++;controller?.abort();loaded=result;archived=null;get('dvorakPanel').hidden=true;get('calculateDvorak').setAttribute('aria-expanded','false');get('dvorakArchivedResults').hidden=true;get('dvorakLocalResults').hidden=true;
    const infrared=result?.plot&&SATELLITES.find(s=>s.id===result.settings.satellite)?.infrared===result.settings.band;
    get('calculateDvorak').hidden=!infrared;
    if(!infrared){loaded=null;return;}
    get('dvorakLatitude').value=result.eyeCenter.latitude;get('dvorakLongitude').value=result.eyeCenter.longitude;
    get('dvorakDomain').value=dvorakDomain(result.atcf||'',result.eyeCenter.latitude,result.eyeCenter.longitude);get('dvorakAutoCenter').checked=true;
    get('dvorakScene').value='eye';get('dvorakScan').textContent=`${result.atcf||'Manual center'} · Image acquired ${stamp(result.plot.grid.timestamp)} · ${result.settings.satellite}. Requested ${result.requested.date} ${result.requested.time} UTC.`;
    message('dvorakLocalStatus','');message('dvorakArchiveStatus','');
  }};
}
