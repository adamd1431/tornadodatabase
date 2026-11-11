import {AGENCIES,numberValue,recordTime,position} from './ibtracs-model.js';
import {reportedIsobarsAt,sixHourMotionAt,ckzSetupDraft,saveCkzSetup} from './ckz-setup-model.js?v=guided-1';
import {analysisParameters,fetchPressureAnalysis} from './poci-roci-client.js?v=poci-direct-all-5';
const utc=at=>at.replace('T',' ').replace(/:00(?:\.000)?Z$/,' UTC');
const display=(n,d=1)=>n===null||n===undefined||n===''?'—':Number(n).toFixed(d);
const num=el=>el.value.trim()===''?null:Number(el.value);
export function initCkzSetup({onActivateAgency}){
  const $=id=>document.getElementById(id);let context=null,motis=false,scan=null,activeKey='',motionOverride=false,draft=null,request=0;
  let measurementSources={poci:'Manual measurement',roci:'Manual measurement'};
  const agencyLabel=id=>AGENCIES.find(a=>a.id===id)?.label||id;
  function intensity(){
    if(!context)return null;const {storm,row,col,agency}=context;
    if(motis)return scan?{at:scan.at,pressureMb:scan.pressureMb,latitude:scan.latitude,longitude:scan.longitude,label:`MOTIS · ${scan.satellite} · ${scan.eyeClarity} eye clarity`,storm}:null;
    const p=position(row,col,agency);return {at:recordTime(row,col),pressureMb:numberValue(row,col,agency+'_PRES'),latitude:p?.lat??null,longitude:p?.lon??null,label:agencyLabel(agency),storm};
  }
  function noaaTime(at){const t=new Date(Math.round(Date.parse(at)/10800000)*10800000).toISOString();return {...analysisParameters(t,context.storm.id,'USA'),at:t};}
  function resetMeasurements(){
    request++;$('setupPoci').value='';$('setupRoci').value='';measurementSources={poci:'Manual measurement',roci:'Manual measurement'};motionOverride=false;$('setupMeasurementStatus').textContent='Enter measured values, use a MOTIS POCI, or extract a NOAA estimate.';
  }
  function update(){
    $('setupAgencyButton').setAttribute('aria-pressed',String(!motis));$('setupAgencyInputs').hidden=motis;
    const current=intensity(),measured=$('setupIsobarMeasured').checked;$('setupReported').hidden=measured;$('setupMeasurements').hidden=!measured;$('setupUseMotis').hidden=!(motis&&scan?.pociMb!==null&&scan?.pociMb!==undefined);
    $('ckzContinue').disabled=true;$('setupUseMotion').disabled=true;if(!current){draft=null;$('setupIntensitySummary').textContent=motis?'Choose a MOTIS scan to continue.':'Choose a cyclone observation.';$('setupReadiness').textContent='Choose an intensity source and time.';$('setupReview').replaceChildren();$('setupReadiness').classList.remove('ready');$('setupMotion').value='';$('setupMotionNote').textContent='';$('setupMotionPoints').textContent='';return;}
    const key=[current.storm.id,motis?'motis':context.agency,current.at].join('|');if(key!==activeKey){activeKey=key;resetMeasurements();}
    $('setupIntensitySummary').textContent=`${utc(current.at)} · ${display(current.pressureMb,motis?3:1)} mb · ${display(current.latitude,3)}°, ${display(current.longitude,3)}°`;
    const reported=reportedIsobarsAt(context.records,context.col,current.at,$('setupIsobarAgency').value);
    $('setupReportedPoci').textContent=display(reported.pociMb,3)+' mb';$('setupReportedRoci').textContent=display(reported.rociNmi,1)+' nmi';
    const reportedSource=agencyLabel($('setupIsobarAgency').value)+(reported.interpolated?` · interpolated between ${reported.bracket.map(utc).join(' and ')}`:` · ${utc(current.at)}`);
    $('setupReportedNote').textContent=(reported.pociMb===null||reported.rociNmi===null?'One or both values are missing. Choose another agency or Measurements. ':'')+reportedSource;
    const motion=sixHourMotionAt(context.records,context.col,current.at,$('setupMotionAgency').value);
    if(!motionOverride)$('setupMotion').value=motion?motion.speedKnots.toFixed(2):'';
    $('setupUseMotion').disabled=!motion;
    const motionSource=motion?`${motion.source} track · ${utc(motion.startAt)} to ${utc(motion.endAt)} · great-circle distance ÷ 6 hours${motion.interpolated?' · interpolated endpoint positions':''}`:'The track does not cover both endpoints. Enter a measured forward speed.';
    $('setupMotionNote').textContent=motionSource;
    $('setupMotionPoints').textContent=motion?`${utc(motion.startAt)}: ${display(motion.start.lat,3)}°, ${display(motion.start.lon,3)}° → ${utc(motion.endAt)}: ${display(motion.end.lat,3)}°, ${display(motion.end.lon,3)}°`:'';
    const poci=measured?num($('setupPoci')):reported.pociMb,roci=measured?num($('setupRoci')):reported.rociNmi;
    const isobarsSource=measured?`POCI: ${measurementSources.poci}; ROCI: ${measurementSources.roci}`:reportedSource;
    draft=ckzSetupDraft({storm:current.storm.name,season:current.storm.season,sid:current.storm.id,at:current.at,pressureMb:current.pressureMb,latitude:current.latitude,longitude:current.longitude,pociMb:poci,rociNmi:roci,motionKnots:num($('setupMotion')),sources:{intensity:current.label,isobars:isobarsSource,motion:motionOverride?'Manual forward speed at '+utc(current.at):motionSource}});
    $('setupReview').replaceChildren();for(const [label,value]of [['Central pressure',display(current.pressureMb,motis?3:1)+' mb'],['Latitude',display(current.latitude,3)+'°'],['POCI = environment',display(poci,3)+' mb'],['ROCI',display(roci)+' nmi'],['Forward speed',display(num($('setupMotion')),2)+' kt']]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;$('setupReview').append(dt,dd);}
    $('setupReadiness').textContent=draft.ready?'All inputs are ready. Open CKZ to calculate the wind.':draft.error||'Complete: '+draft.missing.join(', ')+'.';$('setupReadiness').classList.toggle('ready',draft.ready);$('ckzContinue').disabled=!draft.ready;
    $('setupPociSource').textContent=measurementSources.poci;$('setupRociSource').textContent=measurementSources.roci;
    try{const t=noaaTime(current.at),offset=Math.round((Date.parse(t.at)-Date.parse(current.at))/60000);$('setupExtract').disabled=false;$('setupNoaaTime').textContent=`NOAA analysis: ${utc(t.at)}${offset?` · ${Math.abs(offset)} min ${offset<0?'before':'after'} the selected time`:''} · reanalysis estimate`;$('setupChart').href='poci-roci.html?'+new URLSearchParams({date:t.date,time:t.time,sid:context.storm.id,agency:'USA'});}
    catch(error){$('setupExtract').disabled=true;$('setupNoaaTime').textContent=error.message;$('setupChart').href='poci-roci.html';}
  }
  $('setupAgencyButton').addEventListener('click',()=>onActivateAgency());
  for(const id of ['setupIsobarReported','setupIsobarMeasured','setupIsobarAgency','setupMotionAgency'])$(id).addEventListener('change',()=>{if(id==='setupMotionAgency')motionOverride=false;else request++;update();});
  for(const [id,key]of [['setupPoci','poci'],['setupRoci','roci']])$(id).addEventListener('input',()=>{request++;const at=intensity()?.at;measurementSources[key]='Manual measurement'+(at?' at '+utc(at):'');update();});
  $('setupMotion').addEventListener('input',()=>{motionOverride=true;update();});$('setupUseMotion').addEventListener('click',()=>{motionOverride=false;update();});
  $('setupUseMotis').addEventListener('click',()=>{if(!scan||scan.pociMb===null)return;request++;$('setupPoci').value=String(scan.pociMb);measurementSources.poci='MOTIS dataset · '+utc(scan.at);update();});
  $('setupExtract').addEventListener('click',async()=>{
    const current=intensity();if(!current)return;let t;try{t=noaaTime(current.at);}catch{return;}const token=++request,key=activeKey;$('setupExtract').disabled=true;$('setupMeasurementStatus').textContent='Extracting the NOAA closed isobars…';
    try{const data=await fetchPressureAnalysis({date:t.date,time:t.time,sid:context.storm.id,agency:'USA'});if(token!==request||key!==activeKey)return;const result=data.results.find(r=>r.sid===context.storm.id);if(result?.status!=='estimated')throw Error(result?.message||'No separate outer isobar was resolved.');$('setupPoci').value=String(result.pociMb);$('setupRoci').value=String(result.rociNmi);measurementSources={poci:'NOAA 20CRv3 · '+utc(data.at),roci:'NOAA 20CRv3 · '+utc(data.at)};$('setupMeasurementStatus').textContent='NOAA estimates loaded. They are separate from reported agency values.';update();}
    catch(error){if(token===request)$('setupMeasurementStatus').textContent=error.message;}
    finally{if(token===request)update();}
  });
  $('ckzContinue').addEventListener('click',()=>{if(!draft?.ready)return;try{location.href=saveCkzSetup(draft);}catch(error){$('setupReadiness').textContent=error.message;}});
  $('sendCkz').href='#ckzSetup';
  return {
    setObservation(next){const changed=context?.storm.id!==next.storm.id;context=next;if(changed){const populated=AGENCIES.filter(a=>next.records.some(row=>numberValue(row,next.col,a.id+'_POCI')>0||numberValue(row,next.col,a.id+'_ROCI')>0));$('setupIsobarAgency').replaceChildren(...(populated.length?populated:AGENCIES.filter(a=>a.id==='USA')).map(a=>new Option(a.label,a.id)));$('setupIsobarAgency').value=populated.some(a=>a.id==='USA')?'USA':$('setupIsobarAgency').options[0].value;const positionAgencies=AGENCIES.filter(a=>next.records.some(row=>numberValue(row,next.col,a.id+'_LAT')!==null));$('setupMotionAgency').replaceChildren(...(positionAgencies.length?positionAgencies:AGENCIES.filter(a=>a.id==='USA')).map(a=>new Option(a.label,a.id)));$('setupMotionAgency').value=positionAgencies.some(a=>a.id==='USA')?'USA':$('setupMotionAgency').options[0].value;activeKey='';scan=null;}$('ckzSetupTitle').textContent=next.storm.name+' '+next.storm.season+' · CKZ setup';update();},
    setMotisActive(value){motis=value;update();},setMotisScan(value){scan=value;update();}
  };
}
