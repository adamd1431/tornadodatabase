import {analyzeEyeDvorak,dvorakDomain,ADT91_GUIDE} from './satellite-dvorak-model.js?v=5';
import {SATELLITES} from './mcfetch-model.js';
import {setupDvorakOverlay} from './satellite-dvorak-overlay.js?v=1';
import {measureEirEye,eirBanding,EIR_SOURCE} from './satellite-dvorak-eir.js?v=1';

export function setupSatelliteDvorak(){
  const get=id=>document.getElementById(id);let loaded=null,archived=null,controller=null,revision=0,lastAnalysis=null;
  const overlay=setupDvorakOverlay({onPick(point){get('dvorakLatitude').value=point.latitude.toFixed(5);get('dvorakLongitude').value=point.longitude.toFixed(5);get('dvorakAutoCenter').checked=false;calculate();}});
  const message=(id,text,error=false)=>{get(id).textContent=text;get(id).classList.toggle('error',error);};
  const stamp=time=>time.replace('T',' ').replace(/(?:\.000)?Z$/,' UTC');
  function facts(id,items){
    get(id).replaceChildren(...items.map(([label,value])=>{const box=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;box.append(dt,dd);return box;}));
  }
  function calculate(){
    if(!loaded)return;
    get('dvorakLocalResults').hidden=true;
    lastAnalysis=null;get('copyDvorak').disabled=true;overlay.clear();
    try{
      const latitude=get('dvorakLatitude').value.trim(),longitude=get('dvorakLongitude').value.trim();
      if(!latitude||!longitude)throw Error('Enter the eye-center latitude and longitude.');
      const row=analyzeEyeDvorak(loaded.plot.grid,{latitude:Number(latitude),longitude:Number(longitude),domain:get('dvorakDomain').value,atcf:loaded.atcf||'',largeEye:get('dvorakScene').value==='large',pinhole:get('dvorakScene').value==='pinhole',autoCenter:get('dvorakAutoCenter').checked,version:'9.1'});
      let pattern=null,patternError='';
      try{
        pattern=measureEirEye(loaded.plot.grid,row);
        const banding=Number(get('dvorakBanding').value),text=get('dvorakMet').value.trim(),met=text?Number(text):null;
        try{pattern.dataT=eirBanding(pattern.centralFeature,{banding,met});pattern.banding=banding;pattern.met=met;}catch(error){patternError=error.message;}
      }catch(error){patternError=error.message;}
      row.eyePattern=pattern;
      get('dvorakRaw').textContent=`T${row.rawT.toFixed(1)}`;get('dvorakLocalResults').hidden=false;
      get('dvorakPattern').textContent=pattern?`T${pattern.dataT.toFixed(1)}`:'Unresolved';
      get('dvorakPatternSummary').textContent=pattern?`E${pattern.eNumber.toFixed(1)} ${pattern.eyeAdjustment>=0?'+':'−'} ${Math.abs(pattern.eyeAdjustment).toFixed(1)} eye${pattern.shapeAdjustment?' − 0.5 shape':''}${pattern.banding?' + '+pattern.banding.toFixed(1)+' verified banding':' · no banding added'}`:'';
      facts('dvorakRingMeasurements',pattern?[
        ['Qualifying ring',`${pattern.ringShade} · ≤ ${pattern.profiles.find(p=>p.qualifies).threshold} °C`],
        ['Narrowest ring width',`${pattern.narrowestWidthKm.toFixed(1)} km · needs ${pattern.requiredWidthKm.toFixed(1)} km`],
        ['Coldest enclosing shade',`${pattern.adjustmentShade} · ${pattern.ringTemperature.toFixed(2)} °C`],
        ['Native pixel spacing',`About ${pattern.resolutionKm.toFixed(1)} km`],
        ['Eye diameter (−30 °C edge)',`${pattern.eyeDiameterKm.toFixed(1)} km${pattern.largeEye?' · large eye':pattern.elongated?' · elongated eye':''}`],
        ['Width margin',`${pattern.widthMarginKm.toFixed(1)} km${pattern.nearWidthThreshold?' · close to the threshold':''}`]
      ]:[]);
      get('dvorakRingDetails').hidden=!pattern;
      const caveat=pattern?.eyeUndersampled?' The small eye is poorly resolved at this pixel spacing; the eye-pattern estimate may be biased low.':pattern?.nearWidthThreshold?' Ring width is within two native pixels of the threshold.':'';
      message('dvorakPatternStatus',patternError||`72 directions measured from native temperatures. ${pattern?.banding?'Banding uses your supplied MET; it is not inferred from the storm’s known intensity.':'Eye pattern before any history-based banding contribution.'}${caveat}`,!!patternError);
      lastAnalysis=row;get('copyDvorak').disabled=false;overlay.show(row);
      facts('dvorakMeasurements',[['Eye (within 24 km)',`${row.eye.toFixed(2)} °C`],['Mean cloud',`${row.cloud.toFixed(2)} °C`],[`Asymmetry (${row.symmetryInner}–${row.symmetryOuter} km)`,`${row.symmetry.toFixed(2)} °C`],['Cloud annulus',`${row.inner}–${row.outer} km`],['Analysis center',`${row.latitude.toFixed(3)}°, ${row.longitude.toFixed(3)}°`],['Center adjustment',`${row.centerShiftKm.toFixed(1)} km${row.pinhole?' · pinhole correction':''}`]]);
      message('dvorakLocalStatus','Eye-pattern Data T and ADT raw T are different methods. Neither is a history-constrained Final T or CI. The ADT regression retains values above T8.0. No storm-specific rating or peak correction is added.');
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
  for(const id of ['dvorakLatitude','dvorakLongitude','dvorakDomain','dvorakScene','dvorakAutoCenter','dvorakBanding','dvorakMet'])get(id).addEventListener('input',()=>{lastAnalysis=null;get('copyDvorak').disabled=true;overlay.clear();get('dvorakLocalResults').hidden=true;message('dvorakLocalStatus','Center, scene or banding changed. Recalculate to update the estimate.');});
  get('copyDvorak').addEventListener('click',async()=>{if(!lastAnalysis||!loaded)return;const row=lastAnalysis,p=row.eyePattern;try{await navigator.clipboard.writeText(`${loaded.atcf||'Cyclone'} · ${row.timestamp}\nADT 9.1 raw eye-scene estimate: T${row.rawT.toFixed(1)}${p?`\nEIR eye-pattern Data T: T${p.dataT.toFixed(1)} (E${p.eNumber.toFixed(1)}, eye adjustment ${p.eyeAdjustment.toFixed(1)}, banding ${p.banding.toFixed(1)}${p.banding?', supplied MET '+p.met:''})\nComplete ${p.ringShade} ring: ${p.narrowestWidthKm.toFixed(1)} km minimum width; required ${p.requiredWidthKm.toFixed(1)} km`:''}\nEye: ${row.eye.toFixed(2)} °C · mean cloud: ${row.cloud.toFixed(2)} °C\nEye center: ${row.latitude.toFixed(5)}, ${row.longitude.toFixed(5)}\nCloud annulus: ${row.inner}–${row.outer} km · asymmetry: ${row.symmetry.toFixed(2)} °C\nSatellite: ${loaded.settings.satellite} · band ${loaded.settings.band}\nNot a full-history ADT Final T or CI.`);message('dvorakPickStatus','Analysis copied.');}catch{message('dvorakPickStatus','Copy is unavailable. Select the result text to copy it.',true);}});
  get('useDvorakCenter').addEventListener('click',()=>{if(!archived)return;get('dvorakLatitude').value=archived.latitude;get('dvorakLongitude').value=archived.longitude;get('dvorakAutoCenter').checked=false;get('dvorakScene').value=/EYE\/P|PINHOL/.test(archived.scene)?'pinhole':/EYE\/L|LARGE/.test(archived.scene)?'large':'eye';calculate();});
  get('dvorakGuide').href=ADT91_GUIDE;get('dvorakEquations').href=ADT91_GUIDE+'#page=50';get('dvorakSampling').href=ADT91_GUIDE+'#page=45';get('dvorakEirSource').href=EIR_SOURCE;
  return {setResult(result){
    revision++;controller?.abort();loaded=result;archived=null;get('dvorakPanel').hidden=true;get('calculateDvorak').setAttribute('aria-expanded','false');get('dvorakArchivedResults').hidden=true;get('dvorakLocalResults').hidden=true;
    lastAnalysis=null;get('copyDvorak').disabled=true;overlay.setResult(result);
    const infrared=result?.plot&&SATELLITES.find(s=>s.id===result.settings.satellite)?.infrared===result.settings.band;
    get('calculateDvorak').hidden=!infrared;
    if(!infrared){loaded=null;return;}
    get('dvorakLatitude').value=result.eyeCenter.latitude;get('dvorakLongitude').value=result.eyeCenter.longitude;
    get('dvorakDomain').value=dvorakDomain(result.atcf||'',result.eyeCenter.latitude,result.eyeCenter.longitude,'9.1');get('dvorakAutoCenter').checked=true;
    get('dvorakScene').value='eye';get('dvorakBanding').value='0';get('dvorakMet').value='';get('dvorakScan').textContent=`${result.atcf||'Manual center'} · Image acquired ${stamp(result.plot.grid.timestamp)} · ${result.settings.satellite}. Requested ${result.requested.date} ${result.requested.time} UTC.`;
    message('dvorakLocalStatus','');message('dvorakArchiveStatus','');
  }};
}
