import {searchStorms,columnMap,peakRecords,unpackSnapshot} from './ibtracs-model.js';
import {utcClock} from './mcfetch-model.js';
import {estimateIntensity,nearestObservation,finite} from './satellite-intensity-model.js';
import {jsonRead,stormRecords,reportedEnvironment,loadHistoricScan,loadLiveScan,closeIntensitySources,thermalContext} from './satellite-intensity-data.js';
import {plotIntensity} from './satellite-intensity-plot.js';
import {readIntensityScan} from './intensity-scan-store.js';
import {reconSupported} from './recon-import-model.js';
import {hourlyScanTimes,summarizeHourlyPeaks,compareOwnerPeak,edgeExpansionTimes,MPH_PER_KNOT} from './satellite-intensity-peak.js';
import {loadOwnerReference} from './satellite-intensity-owner.js';

const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;},fmt=(v,d=1)=>finite(v)?v.toFixed(d):'—';
const stamp=t=>t?.replace('T',' ').replace(/(?:\.000)?Z$/,' UTC')||'Unknown time';
let manifest=null,bundle=null,benchmark=null,matches=[],storm=null,liveStorms=[],live=false,automaticYear=false,manualEnvironment=false,scan=null,analysis=null,records=[],history=[],controller=null,revision=0,plotGeometry=null,reconController=null,evolutionController=null;
let ownerReference=null,ownerStatus='No saved estimate loaded',hourlyController=null,hourlyRows=[],hourlyResult=null,windPeakScan=null,pressurePeakScan=null;
async function loadOwnerComparison(chosen,refresh=false){
  ownerReference=null;ownerStatus='Loading your website estimate…';comparison();
  try{const {supabase}=await import('./supabase.js'),reference=await loadOwnerReference(supabase,chosen,{refresh});if(storm?.id!==chosen.id)return;ownerReference=reference;ownerStatus=reference?'':'No matching saved owner estimate for this cyclone.';}
  catch{if(storm?.id!==chosen.id)return;ownerStatus='Your website estimate could not be loaded. Refresh to try again.';}
  comparison();if(hourlyResult)renderHourlySummary();
}
function status(text,error=false){$('requestStatus').textContent=text;$('requestStatus').classList.toggle('error',error);}
function clearDerived(){analysis=null;history=[];hourlyResult=null;hourlyRows=[];windPeakScan=null;pressurePeakScan=null;$('hourlyPanel').hidden=true;$('analysis').hidden=true;$('exportAnalysis').disabled=true;$('copyAnalysis').disabled=true;$('loadEvolution').disabled=false;$('reconResults').replaceChildren();$('reconStatus').textContent='Aircraft observations are comparison data and never enter the satellite wind estimate.';}
function cancel(){revision++;controller?.abort();reconController?.abort();evolutionController?.abort();if(hourlyController){hourlyController.abort();hourlyController=null;$('hourlyStatus').textContent='Search cancelled. Partial hourly results are not a completed peak search.';$('useWindPeak').disabled=true;$('usePressurePeak').disabled=true;}closeIntensitySources();controller=null;$('estimateButton').disabled=!storm;$('hourlyPeak').disabled=!storm||live;$('cancelRequest').hidden=true;$('example').disabled=false;}
function invalidate(){cancel();scan=null;clearDerived();}
function chooseMode(value){invalidate();live=value;$('historicFields').hidden=live;$('liveFields').hidden=!live;$('historicMode').setAttribute('aria-pressed',String(!live));$('liveMode').setAttribute('aria-pressed',String(live));$('scanDate').disabled=live;$('scanClock').disabled=live;$('scanDate').required=!live;$('scanClock').required=!live;storm=null;$('estimateButton').disabled=true;if(live)chooseLive();else search();}
function search(){if(!manifest)return;invalidate();storm=null;$('estimateButton').disabled=true;$('hourlyPeak').disabled=true;matches=$('stormQuery').value.trim()?searchStorms(manifest.storms,{query:$('stormQuery').value,year:$('stormYear').value}).filter(s=>s.season>=1974):[];$('stormMatch').replaceChildren(new Option(matches.length?'Choose a cyclone…':'Search by cyclone name…',''),...matches.slice(0,70).map(s=>new Option(`${s.name} · ${s.season} · ${s.atcf.join(' / ')}`,s.id)));status(matches.length?`${matches.length} matching cyclones. Press Enter to choose the first.`:'Search a cyclone, or open the real calibrated Patricia example.');}
async function chooseHistoric(id){
  invalidate();storm=manifest.storms.find(s=>s.id===id)||null;if(!storm){$('hourlyPeak').disabled=true;return;}
  loadOwnerComparison(storm);
  const own=revision,chosen=storm;$('stormQuery').value=storm.name;$('stormYear').value=storm.season;automaticYear=true;$('stormMatch').value=id;status('Loading the cyclone’s observation times…');
  try{records=await stormRecords(chosen,manifest);if(own!==revision)return;
    const peak=records.filter(r=>finite(r.windKt)).sort((a,b)=>b.windKt-a.windKt)[0]||records[0];if(!peak)throw Error('No satellite-era observation time is available.');
    $('scanDate').min=chosen.start.slice(0,10);$('scanDate').max=chosen.end.slice(0,10);$('scanDate').value=peak.timestamp.slice(0,10);$('scanClock').value=peak.timestamp.slice(11,16).replace(':','');$('estimateButton').disabled=false;$('hourlyPeak').disabled=false;status(`${chosen.name} ${chosen.season} · Starts at the reported wind peak. Find hourly peak checks the surrounding hours.`);
  }catch(error){if(own===revision)status(error.message,true);}
}
function chooseLive(){invalidate();storm=liveStorms.find(s=>s.id===$('liveMatch').value)||null;records=[];$('estimateButton').disabled=!storm;$('hourlyPeak').disabled=true;if(storm){loadOwnerComparison({...storm,season:Number(storm.id.slice(-4))});status(`Ready to retrieve calibrated infrared for ${storm.name}. The advisory position is used as the initial center.`);}}
function environment(){return {...Object.fromEntries([['pociMb','poci'],['rociNmi','roci'],['motionKt','motion']].map(([key,id])=>[key,$(id).value.trim()===''?null:Number($(id).value)])),source:manualEnvironment?'Manual values':'IBTrACS USA outer structure / six-hour track motion',timestamp:manualEnvironment?null:nearestObservation(records,scan?.grid.timestamp)?.timestamp||null};}
function draw(){if(scan)plotGeometry=plotIntensity($('stormCanvas'),scan,analysis,{ring:$('showRing').checked});}
function facts(id,pairs){$(id).replaceChildren(...pairs.map(([key,value])=>{const row=el('div');row.append(el('dt',key),el('dd',value));return row;}));}
function comparison(){
  $('ownerWindValue').textContent=fmt(ownerReference?.windKt);
  $('ownerNote').textContent=ownerReference?`${fmt(ownerReference.windMph)} mph · ${fmt(ownerReference.pressureMb)} mb. Your lifetime peak estimate; individual scans can be weaker.`:ownerStatus;
  $('ownerReferenceLink').hidden=!ownerReference;if(ownerReference)$('ownerReferenceLink').href=ownerReference.sourceUrl;
  if(!scan){$('officialValue').textContent='—';$('officialNote').textContent='No scan selected';return;}
  const official=scan.advisory?nearestObservation([{...scan.advisory,timestamp:scan.advisory.validAt}],scan.grid.timestamp):nearestObservation(records,scan.grid.timestamp);
  $('officialValue').textContent=fmt(official?.windKt);$('officialNote').textContent=official?`${stamp(official.timestamp)} · ${official.offsetMinutes===0?'exact time':fmt(Math.abs(official.offsetMinutes),0)+' min '+(official.offsetMinutes<0?'before':'after')} · ${fmt(official.pressureMb)} mb`:'No official observation within 90 minutes of acquisition.';
}
function renderMembers(){
  const m=analysis?.members||{},box=(name,wind,pressure,note)=>{const n=el('article',undefined,'member-card');n.append(el('h4',name),el('strong',`${fmt(wind)} kt · ${fmt(pressure)} mb`),el('p',note));return n;};
  $('memberCards').replaceChildren(box('Infrared eye-scene baseline',m.baselineWind,m.baselinePressure,'Single-scan temperature regression; pressure uses the basin’s published Dvorak table only within its supported range.'),box('Trained boosted trees',m.treeWind,m.treePressure,analysis?.treeReason||'Temperature diagnostics, IR eye structure and causal six-hour thermal history. Separate training, calibration and model-selection seasons.'),box('Published CKZ cross-check',null,m.physicsPressure,analysis?.physicsReason||'Requires an accepted eye-scene wind estimate and outer pressure/radius measurements.'));
}
function analyze(){
  if(!scan)return;analysis=null;reconController?.abort();$('reconResults').replaceChildren();
  try{const latitude=$('eyeLatitude').value.trim(),longitude=$('eyeLongitude').value.trim();if(!latitude||!longitude)throw Error('Enter an analysis center.');
    analysis=estimateIntensity(scan.grid,{atcf:scan.atcf,latitude:Number(latitude),longitude:Number(longitude),autoCenter:$('autoCenter').checked,largeEye:$('eyeScene').value==='large',pinhole:$('eyeScene').value==='pinhole',environment:environment(),thermalHistory:scan.thermalHistory},bundle);
    $('windValue').textContent=fmt(analysis.windKt);$('pressureValue').textContent=fmt(analysis.pressureMb);$('ringValue').textContent=fmt(analysis.coldRingKm);$('windMethod').textContent=analysis.windMethod;$('pressureMethod').textContent=analysis.pressureMethod;
    const disagreement=finite(analysis.members.treeWind)&&Math.abs(analysis.members.treeWind-analysis.members.baselineWind)>=15?' Members differ by at least 15 kt; inspect the scene and comparison data.':'';
    $('modelStatus').textContent=`${analysis.windMethod}. ${analysis.treeReason||'The trained member is supported for this scene.'}${disagreement} ${analysis.uncertainty.text}`;
    $('centerStatus').textContent=`Raw T${analysis.eye.rawT.toFixed(1)} · Eye ${fmt(analysis.eye.eye)} °C · Cloud ${fmt(analysis.eye.cloud)} °C · Symmetry ${fmt(analysis.eye.symmetry)} °C · center shift ${fmt(analysis.eye.centerShiftKm)} km.${analysis.structure.eyeRadiusKm!==null?' IR eye radius '+fmt(analysis.structure.eyeRadiusKm)+' km.':''}${scan.thermalHistory?' Six-hour IR context from '+stamp(scan.thermalHistory.timestamp)+'.':' No prior IR context; the trained missing-history path is used.'}`;
    const same=history.findIndex(r=>r.scan.grid.timestamp===scan.grid.timestamp),item={scan,analysis};if(same<0)history.push(item);else history[same]=item;
    history.sort((a,b)=>a.scan.grid.timestamp.localeCompare(b.scan.grid.timestamp));history=history.slice(-4);
    $('exportAnalysis').disabled=false;$('copyAnalysis').disabled=false;$('modelStatus').classList.remove('error');
  }catch(error){for(const id of ['windValue','pressureValue','ringValue'])$(id).textContent='—';$('windMethod').textContent='No accepted eye scene';$('pressureMethod').textContent='No accepted estimate';$('modelStatus').textContent=error.message.replace('; for non-eye scenes use the archived ADT analysis below.','. A cloud-filled or unresolved eye may fall outside this model’s supported scenes.')+' No intensity has been assigned to this image.';$('modelStatus').classList.add('error');$('centerStatus').textContent='Adjust the center or select the appropriate eye scene, then recalculate.';$('exportAnalysis').disabled=true;$('copyAnalysis').disabled=true;}
  renderMembers();draw();renderHistory();comparison();$('uncertaintyNote').textContent='A cold cloud-ring radius is displayed, not an RMW estimate. No generic ±error label or confidence percentage is inferred from one image.';
}
function showScan(value,{preserve=false}={}){
  const previous=preserve?history.filter(r=>r.scan.atcf===value.atcf):[];scan=value;analysis=null;history=previous;$('analysis').hidden=false;
  $('analysisKicker').textContent=`${scan.atcf} · ${scan.source}`;$('stormTitle').textContent=`${scan.name} ${scan.season}`;$('analysisTime').textContent=`Acquired ${stamp(scan.grid.timestamp)}${scan.requestedAt&&scan.requestedAt!==scan.grid.timestamp?' · requested '+stamp(scan.requestedAt):''}${scan.demo?' · archived demonstration; training/development case':''}`;
  $('eyeLatitude').value=scan.center.latitude.toFixed(4);$('eyeLongitude').value=scan.center.longitude.toFixed(4);$('eyeScene').value='eye';$('autoCenter').checked=true;
  manualEnvironment=false;const e=reportedEnvironment(records,scan.grid.timestamp);for(const [key,id]of [['pociMb','poci'],['rociNmi','roci'],['motionKt','motion']])$(id).value=e[key]===null?'':e[key];
  $('environmentNote').textContent=e.timestamp?`Reported outer structure at ${stamp(e.timestamp)}. Motion: distance from −3 h to +3 h ÷ 6, rounded to 0.01 kt.`:'No time-matched outer-structure record. Enter measured values if available.';
  $('imageCaption').textContent=`${scan.source} · ${scan.satellite||scan.grid.sensor} · ${stamp(scan.grid.timestamp)} · east-positive longitude.`;$('sourceLink').href=scan.sourceUrl;
  $('loadEvolution').disabled=live||!!scan.demo||!storm;$('evolutionStatus').textContent=live?'The last four distinct live scans retrieved during this visit are retained. You can enable 30-minute refresh above.':scan.demo?'The stored example uses one real scan. Select a cyclone and date above to request a four-scan evolution.':'Load three earlier calibrated scans at three-hour intervals. Only successfully retrieved, distinct acquisition times are included.';
  const supported=storm&&reconSupported(storm);$('loadRecon').disabled=!supported;$('reconStatus').textContent=supported?'Find a vortex message within 90 minutes of this scan. Flight-level wind remains distinct from surface wind.':'Automatic aircraft comparison covers Atlantic/Eastern/Central Pacific archive cyclones from 1989 onward. No recon value is substituted for unavailable observations.';
  $('reconResults').replaceChildren();$('environmentFacts').replaceChildren();analyze();
}
async function run(){
  if(!storm)return;const previous=live?history:[];cancel();const own=revision,chosen=storm;controller=new AbortController();const signal=controller.signal;$('estimateButton').disabled=true;$('hourlyPeak').disabled=true;$('example').disabled=true;$('cancelRequest').hidden=false;clearDerived();history=previous;status('Finding a calibrated infrared scan…');
  try{
    const time=live?null:`${$('scanDate').value}T${utcClock($('scanClock').value)}:00.000Z`;if(!live&&(!time||!finite(Date.parse(time))))throw Error('Choose a valid date and UTC time from 0000 to 2359.');
    const value=live?await loadLiveScan(chosen,{signal,onProgress:p=>{if(own===revision)status(typeof p==='string'?p:'Decoding the native infrared scan…');}}):await loadHistoricScan(chosen,time,{signal});if(own!==revision)return;
    showScan(value,{preserve:live});historyReplace();status('Calibrated scan loaded. Estimates and source measurements are shown below.');
    if(live)loadLiveContext(chosen,own,signal);
  }catch(error){if(own===revision&&error.name!=='AbortError')status(error.message,true);}finally{if(own===revision){$('estimateButton').disabled=!storm;$('hourlyPeak').disabled=!storm||live;$('example').disabled=false;$('cancelRequest').hidden=true;controller=null;}}
}
function renderHourlyRows(){
  $('hourlyRows').replaceChildren(...[...hourlyRows].sort((a,b)=>a.requestedAt.localeCompare(b.requestedAt)).map(r=>{const tr=el('tr');if(hourlyResult&&(r.acquiredAt===hourlyResult.windPeak?.acquiredAt||r.acquiredAt===hourlyResult.pressurePeak?.acquiredAt))tr.className='peak-row';for(const v of [stamp(r.acquiredAt||r.requestedAt),fmt(r.windKt),fmt(r.pressureMb),r.error||r.method])tr.append(el('td',v));return tr;}));
}
function renderHourlySummary(){
  if(!hourlyResult)return;const comparison=compareOwnerPeak(hourlyResult,ownerReference),sign=v=>finite(v)?(v>=0?'+':'')+fmt(v):'—';
  $('hourlySummary').replaceChildren(...[['Highest wind scan',hourlyResult.windPeak,'windKt','kt',ownerReference?.windKt,comparison.windDifferenceKt],['Lowest pressure scan',hourlyResult.pressurePeak,'pressureMb','mb',ownerReference?.pressureMb,comparison.pressureDifferenceMb]].map(([title,row,key,unit,target,difference])=>{const card=el('article');card.append(el('h4',title),el('strong',`${fmt(row?.[key])} ${unit}`),el('p',stamp(row?.acquiredAt),'muted'),el('p',`Your peak estimate: ${fmt(target)} ${unit} · difference ${sign(difference)} ${unit}`,'muted'));return card;}));
}
function openHourlyScan(value){if(!value)return;showScan(value);$('scanDate').value=value.requestedAt.slice(0,10);$('scanClock').value=value.requestedAt.slice(11,16).replace(':','');historyReplace();}
async function hourlyPeak(){
  if(!storm||live)return;const chosen=storm,seed=scan?.atcf===chosen.atcf[0]?scan:null;
  let times,anchor;try{anchor=`${$('scanDate').value}T${utcClock($('scanClock').value)}:00.000Z`;times=hourlyScanTimes(anchor,{hours:12,start:chosen.start.replace(' ','T')+'Z',end:chosen.end.replace(' ','T')+'Z'});if(!times.length)throw Error('Choose a UTC time inside this cyclone’s available track.');}catch(error){status(error.message,true);return;}
  cancel();loadOwnerComparison(chosen,true);const own=revision;hourlyController=new AbortController();const signal=hourlyController.signal;hourlyRows=[];hourlyResult=null;windPeakScan=null;pressurePeakScan=null;
  $('hourlyPanel').hidden=false;$('hourlySummary').replaceChildren();$('hourlyRows').replaceChildren();$('useWindPeak').disabled=true;$('usePressurePeak').disabled=true;$('hourlyPeak').disabled=true;$('estimateButton').disabled=true;$('example').disabled=true;$('cancelRequest').hidden=false;
  let wind=-Infinity,pressure=Infinity;
  try{for(let index=0;index<times.length;index++){const requestedAt=times[index];
    if(own!==revision)return;status(`Checking hourly scan ${hourlyRows.length+1}/${times.length}…`);$('hourlyStatus').textContent=`Checking ${stamp(requestedAt)}. The peak is selected after the search completes.`;
    try{const value=seed&&Date.parse(seed.grid.timestamp)>=Date.parse(requestedAt)-1800000&&Date.parse(seed.grid.timestamp)<Date.parse(requestedAt)+1800000?seed:await loadHistoricScan(chosen,requestedAt,{signal});if(own!==revision)return;
      const result=estimateIntensity(value.grid,{...value.center,atcf:value.atcf,autoCenter:true,environment:reportedEnvironment(records,value.grid.timestamp),thermalHistory:value.thermalHistory},bundle);
      const row={requestedAt,acquiredAt:value.grid.timestamp,windKt:result.windKt,pressureMb:result.pressureMb,method:result.windMethod};hourlyRows.push(row);
      if(finite(result.windKt)&&result.windKt>wind){wind=result.windKt;windPeakScan={...value,requestedAt};}if(finite(result.pressureMb)&&result.pressureMb<pressure){pressure=result.pressureMb;pressurePeakScan={...value,requestedAt};}
    }catch(error){if(signal.aborted)return;if(/quota|transaction limit|data limit/i.test(error.message))throw error;hourlyRows.push({requestedAt,error:error.message});}
    renderHourlyRows();
    if(index===times.length-1){const extra=edgeExpansionTimes(summarizeHourlyPeaks(hourlyRows),anchor,times,{start:chosen.start.replace(' ','T')+'Z',end:chosen.end.replace(' ','T')+'Z'});if(extra.length)times.push(...extra);}
  }
  if(own!==revision)return;hourlyResult={...summarizeHourlyPeaks(hourlyRows),anchor,initialHours:12,maxHours:24,complete:true};
  if(!hourlyResult.windPeak)throw Error('No accepted eye scenes were found in the hourly search. No peak has been assigned.');
  openHourlyScan(windPeakScan);
  $('hourlyPanel').hidden=false;renderHourlyRows();renderHourlySummary();$('useWindPeak').disabled=false;$('usePressurePeak').disabled=!pressurePeakScan;
  const caution=hourlyResult.edgePeak?' A selected peak is at an edge of the available sequence; the search reached its 24-hour extension limit or the end of the available track. This is a window peak, not a confirmed lifetime maximum.':'';
  $('hourlyStatus').textContent=`${hourlyResult.distinct} distinct accepted scans from ${hourlyResult.requested} hourly attempts; ${hourlyResult.failed} unavailable or rejected. Highest wind and lowest pressure are selected independently.${caution}`;
  status('Hourly search complete. The strongest accepted scan is open; your website estimate is the comparison target.');
  }catch(error){if(own===revision){hourlyResult=null;$('hourlyStatus').textContent=error.message+' Search incomplete; partial results are not a final peak.';status(error.message,true);}}
  finally{if(own===revision){hourlyController=null;$('hourlyPeak').disabled=false;$('estimateButton').disabled=false;$('example').disabled=false;$('cancelRequest').hidden=true;}}
}
async function loadLiveContext(chosen,own,signal){
  const responses=await Promise.allSettled([jsonRead('/api/live-storms?'+new URLSearchParams({view:'ocean',storm:chosen.id}),{signal}),jsonRead('/api/live-storms?'+new URLSearchParams({view:'environment',storm:chosen.id,schema:'2'}),{signal})]);if(own!==revision)return;
  const ocean=responses[0].status==='fulfilled'?responses[0].value:null,air=responses[1].status==='fulfilled'?responses[1].value:null,row=air?.rows?.find(r=>r.hours===0);
  facts('environmentFacts',[['SST',finite(ocean?.temperatureC)?fmt(ocean.temperatureC)+' °C':'Unavailable'],['SST timestamp',ocean?.sampledAt?stamp(ocean.sampledAt):'Not available'],['GFS deep-layer shear',finite(row?.shearKt)?fmt(row.shearKt)+' kt':'Unavailable'],['Air timestamp',row?.validAt?stamp(row.validAt):'Not available']]);
}
function historyReplace(){const q=new URLSearchParams();if(live)q.set('storm',storm.id);else if(storm){q.set('sid',storm.id);q.set('at',scan.grid.timestamp);}historyApi.replaceState(null,'','satellite-intensity.html?'+q);}
const historyApi=window.history;
function renderHistory(){
  $('evolution').replaceChildren(...history.map(item=>{const card=el('article'),canvas=el('canvas');canvas.width=400;canvas.height=415;card.append(el('h4',stamp(item.scan.grid.timestamp)),canvas,el('p',`${fmt(item.analysis.windKt)} kt · ${fmt(item.analysis.pressureMb)} mb`));plotIntensity(canvas,item.scan,item.analysis,{small:true,ring:true});return card;}));
}
async function evolution(){
  if(!scan||!storm||live||scan.demo)return;const own=revision,anchor=scan,chosen=storm;evolutionController?.abort();evolutionController=new AbortController();const signal=evolutionController.signal;$('loadEvolution').disabled=true;let added=0,failures=[];
  try{for(const h of [9,6,3]){
    if(own!==revision)return;const at=new Date(Date.parse(anchor.grid.timestamp)-h*3600000).toISOString();$('evolutionStatus').textContent=`Loading ${stamp(at)} · ${added}/3 additional analyses ready…`;
    try{const value=await loadHistoricScan(chosen,at,{signal});if(own!==revision)return;if(history.some(r=>r.scan.grid.timestamp===value.grid.timestamp))continue;
      const e=reportedEnvironment(records,value.grid.timestamp),result=estimateIntensity(value.grid,{...value.center,atcf:value.atcf,autoCenter:true,environment:e,thermalHistory:value.thermalHistory},bundle);history.push({scan:value,analysis:result});history.sort((a,b)=>a.scan.grid.timestamp.localeCompare(b.scan.grid.timestamp));history=history.slice(-4);added++;renderHistory();
    }catch(error){if(error.name==='AbortError')return;failures.push(stamp(at)+': '+error.message);}
  }if(own===revision)$('evolutionStatus').textContent=`${added} additional distinct analyses loaded.${failures.length?' Some scans were unavailable or had no accepted eye scene. '+failures.join(' '):''}`;}finally{if(own===revision)$('loadEvolution').disabled=false;}
}
async function recon(){
  if(!storm||!scan)return;const own=revision,chosen=storm;reconController?.abort();reconController=new AbortController();$('loadRecon').disabled=true;$('reconResults').replaceChildren();$('reconStatus').textContent='Reading aircraft messages around the scan time…';
  try{
    // Adjacent dates cover a near-midnight image without relaxing match tolerance.
    const t=Date.parse(scan.grid.timestamp),dates=[...new Set([-90,90].map(m=>new Date(t+m*60000).toISOString().slice(0,10)))],rows=[];
    for(const date of dates){const data=await jsonRead('/api/recon-data?'+new URLSearchParams({sid:chosen.id,date}),{signal:reconController.signal});if(own!==revision)return;rows.push(...(data.records||[]));}
    const row=nearestObservation(rows,scan.grid.timestamp,90,'fixAt');if(!row){$('reconStatus').textContent='No parsed aircraft message was found within 90 minutes. The satellite estimate remains unchanged.';return;}
    const pressureError=analysis&&finite(analysis.pressureMb)&&finite(row.pressureMb)?analysis.pressureMb-row.pressureMb:null,grid=el('div',undefined,'recon-grid');
    for(const [title,value,note]of [['Observed central pressure',fmt(row.pressureMb)+' mb',stamp(row.fixAt)],['Flight-level maximum',fmt(row.flightWindKt)+' kt',`${row.flightLevelMb||'Unknown'}-mb flight level · ${stamp(row.windAt)} · not surface wind`],['Satellite minus recon pressure',fmt(pressureError)+' mb','A time-matched comparison, not an error calibration from one case.']]){const box=el('div');box.append(el('p',title),el('strong',value),el('p',note));grid.append(box);}
    const source=el('a','Read original aircraft message ↗');source.href=row.sourceUrl;source.target='_blank';source.rel='noopener';const details=el('details'),summary=el('summary','Original vortex message'),pre=el('pre',row.raw);pre.style.cssText='white-space:pre-wrap;font-size:12px;overflow-wrap:anywhere';details.append(summary,pre);$('reconResults').append(grid,source,details);
    $('reconStatus').textContent=`${fmt(Math.abs(row.offsetMinutes),1)} min ${row.offsetMinutes<0?'before':'after'} acquisition · FL RMW ${fmt(row.rmwNmi)} nmi. Surface wind is not inferred or treated as verified truth here.`;
  }catch(error){if(own===revision&&error.name!=='AbortError')$('reconStatus').textContent=error.message;}finally{if(own===revision)$('loadRecon').disabled=false;}
}
function exportValue(){return {version:analysis.version,observation:{name:scan.name,atcf:scan.atcf,sid:scan.sid,timestamp:scan.grid.timestamp,satellite:scan.satellite,source:scan.source,sourceUrl:scan.sourceUrl},estimate:analysis,environment:environment(),ownerPeakReference:ownerReference,hourlySearch:hourlyResult?{...hourlyResult,rows:hourlyRows,comparison:compareOwnerPeak(hourlyResult,ownerReference)}:null,evolution:history.map(r=>({timestamp:r.scan.grid.timestamp,estimate:r.analysis,reference:nearestObservation(records,r.scan.grid.timestamp)})),benchmarkVersion:benchmark?.version,notes:['Experimental research estimate, not an official analysis.','Your website estimates describe lifetime peaks, not each hourly observation.','Cold cloud-ring radius is not RMW.','Tree labels are best track, not independently verified aircraft surface wind.']};}
function download(){if(!analysis)return;const url=URL.createObjectURL(new Blob([JSON.stringify(exportValue(),null,2)],{type:'application/json'})),a=el('a');a.href=url;a.download=`intensity-${scan.atcf}-${scan.grid.timestamp.replace(/[^0-9]/g,'').slice(0,12)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function example(){
  cancel();clearDerived();const own=revision;$('example').disabled=true;status('Opening a real archived Patricia infrared observation…');
  try{const response=await fetch('intensity-data/patricia-2015.json.gz'),fixture=await unpackSnapshot(response);if(own!==revision)return;
    live=false;$('historicMode').setAttribute('aria-pressed','true');$('liveMode').setAttribute('aria-pressed','false');$('historicFields').hidden=false;$('liveFields').hidden=true;$('scanDate').disabled=false;$('scanClock').disabled=false;
    const chosen=manifest?.storms.find(s=>s.atcf.includes(fixture.atcf));storm=chosen||null;if(chosen)loadOwnerComparison(chosen);records=chosen?await stormRecords(chosen,manifest):[];if(own!==revision)return;
    $('stormQuery').value='Patricia';$('stormYear').value='2015';automaticYear=true;if(chosen)$('stormMatch').replaceChildren(new Option(`${chosen.name} · 2015 · ${chosen.atcf.join(' / ')}`,chosen.id));$('scanDate').min='';$('scanDate').max='';$('scanDate').value='2015-10-23';$('scanClock').value='1200';
    const thermalHistory=await thermalContext(fixture.atcf,fixture.grid);if(own!==revision)return;showScan({grid:fixture.grid,center:fixture.center,atcf:fixture.atcf,thermalHistory,name:'PATRICIA',season:2015,sid:chosen?.id,source:fixture.source,sourceUrl:'https://mcfetch.ssec.wisc.edu/',satellite:'GOES-15',demo:true});status('Real 12:00 UTC scan loaded. Patricia belongs to a training season and is a development check, not an independent test result.');
  }catch(error){if(own===revision)status(error.message,true);}finally{if(own===revision){$('example').disabled=false;$('estimateButton').disabled=!storm;$('hourlyPeak').disabled=!storm;}}
}
function renderValidation(){
  if(!benchmark){$('validationIntro').textContent='Benchmark unavailable. The eye-scene baseline can still run; trained members will not load without their model file.';return;}
  const years=benchmark.splitYears;$('validationIntro').textContent=`Trained on ${years.train.join(', ')}; calibration ${years.calibration?.join(', ')||'not separate'}; selected on ${years.validation.join(', ')}; retrospective held-out test ${years.test.join(', ')}. Training includes 2025, so this is not a chronological hindcast. References are IBTrACS USA best track, not independent recon verification.`;
  $('validationCards').replaceChildren(...['wind','pressure'].map(key=>{const score=benchmark.targets[key],r=score.test,unit=key==='wind'?'kt':'mb',card=el('article'),strong=r.subsets?.['130ktAndAbove'];card.append(el('h3',`${years.test.join('/')} held-out ${key} · mean absolute error`),el('strong',`${fmt(r.mae)} ${unit}`),el('p',`${r.count} hourly frames · ${r.storms} storms · RMSE ${fmt(r.rmse)} ${unit} · bias ${fmt(r.bias)} ${unit}`),el('p',`Simplified eye-scene/table baseline: ${fmt(r.baseline?.mae)} ${unit} MAE. ${score.trees} fitted regression trees.`));if(strong)card.append(el('p',`At ≥130 kt: ${fmt(strong.mae)} ${unit} MAE; bias ${fmt(strong.bias)} ${unit} (${strong.count} frames, ${strong.storms} storms).`));card.append(el('p','Archive measurement benchmark. A confidence interval for an individual local-image estimate has not been calibrated.'));return card;}));
}
$('historicMode').onclick=()=>chooseMode(false);$('liveMode').onclick=()=>chooseMode(true);$('stormQuery').oninput=()=>{if(automaticYear){$('stormYear').value='';automaticYear=false;}search();};$('stormYear').oninput=()=>{automaticYear=false;search();};$('stormMatch').onchange=()=>chooseHistoric($('stormMatch').value);$('liveMatch').onchange=chooseLive;
$('stormForm').onsubmit=event=>{event.preventDefault();if(!live&&!storm&&matches[0])chooseHistoric(matches[0].id);else run();};
for(const id of ['stormQuery','stormYear'])$(id).onkeydown=event=>{if(event.key==='Enter'&&!live&&!storm&&matches[0]){event.preventDefault();chooseHistoric(matches[0].id);}};
for(const id of ['scanDate','scanClock'])$(id).oninput=()=>{invalidate();status('Time changed. Retrieve a new scan to update the estimate.');};
for(const id of ['eyeLatitude','eyeLongitude','eyeScene','autoCenter','poci','roci','motion'])$(id).oninput=()=>{if(scan){cancel();hourlyResult=null;$('hourlyPanel').hidden=true;if(['poci','roci','motion'].includes(id)){manualEnvironment=true;$('environmentNote').textContent='Manual outer-structure or motion values. EP = POCI; no offset is added.';}analysis=null;$('reconResults').replaceChildren();renderMembers();$('exportAnalysis').disabled=true;$('copyAnalysis').disabled=true;for(const output of ['windValue','pressureValue','ringValue'])$(output).textContent='—';$('modelStatus').textContent='Inputs changed. Recalculate to update this estimate.';}};
$('recalculate').onclick=analyze;$('applyEnvironment').onclick=analyze;$('showRing').onchange=draw;$('example').onclick=example;$('cancelRequest').onclick=()=>{cancel();status('Request cancelled.');};$('loadEvolution').onclick=evolution;$('loadRecon').onclick=recon;$('exportAnalysis').onclick=download;
$('hourlyPeak').onclick=hourlyPeak;$('useWindPeak').onclick=()=>openHourlyScan(windPeakScan);$('usePressurePeak').onclick=()=>openHourlyScan(pressurePeakScan);
$('copyAnalysis').onclick=async()=>{if(!analysis)return;try{await navigator.clipboard.writeText(`${scan.name} ${scan.season} · ${stamp(scan.grid.timestamp)}\nExperimental satellite estimate: ${fmt(analysis.windKt)} kt; ${fmt(analysis.pressureMb)} mb\n${analysis.windMethod}; ${analysis.pressureMethod}\nRaw eye-scene T${fmt(analysis.eye.rawT)} · cold ring ${fmt(analysis.coldRingKm)} km (not RMW)\nSource: ${scan.sourceUrl}\nNo calibrated confidence interval. Not an official analysis.`);status('Result copied.');}catch{status('Clipboard unavailable. Download the analysis instead.',true);}};
$('stormCanvas').onclick=event=>{if(!scan||!plotGeometry)return;const rect=event.currentTarget.getBoundingClientRect(),g=plotGeometry,x=(event.clientX-rect.left)*event.currentTarget.width/rect.width,y=(event.clientY-rect.top)*event.currentTarget.height/rect.height;if(x<g.left||x>g.left+g.size||y<g.top||y>g.top+g.size)return;$('eyeLatitude').value=(g.latitude+(1-(y-g.top)/g.size*2)*g.extent/111.195).toFixed(5);$('eyeLongitude').value=(((g.longitude+((x-g.left)/g.size*2-1)*g.extent/(111.195*Math.cos(g.latitude*Math.PI/180))+540)%360)-180).toFixed(5);$('autoCenter').checked=false;analyze();};
window.addEventListener('focus',()=>{if(storm&&document.visibilityState==='visible')loadOwnerComparison({...storm,season:storm.season||Number(storm.id.slice(-4))},true);});
window.addEventListener('pagehide',()=>{cancel();});
setInterval(async()=>{if(!live||!storm||!$('autoRefresh').checked||document.hidden||controller)return;const id=storm.id,own=revision;try{const data=await jsonRead('/api/live-storms?view=storms');if(!live||own!==revision||storm?.id!==id)return;const updated=data.storms?.find(s=>s.id===id);if(!updated){status('This cyclone has left the current feed. Automatic refresh is paused.');$('autoRefresh').checked=false;return;}storm=updated;await run();}catch(error){status('Automatic refresh could not complete. '+error.message,true);}},1800000);
(async()=>{
  const loaded=await Promise.allSettled([jsonRead('ibtracs-data/index.json'),jsonRead('intensity-data/tree-model.json'),jsonRead('intensity-data/benchmark.json')]);
  manifest=loaded[0].status==='fulfilled'?loaded[0].value:null;bundle=loaded[1].status==='fulfilled'?loaded[1].value:null;benchmark=loaded[2].status==='fulfilled'?loaded[2].value:null;renderValidation();$('example').disabled=false;
  if(!manifest){status('Cyclone search is unavailable. You can still open the stored Patricia example.',true);return;}
  for(const id of ['stormQuery','stormYear','stormMatch'])$(id).disabled=false;search();
  const q=new URLSearchParams(location.search),shared=q.get('scan');
  if(shared)try{const value=await readIntensityScan(shared);value.thermalHistory=await thermalContext(value.atcf,value.grid);storm=manifest.storms.find(s=>s.id===value.sid||s.atcf.includes(value.atcf))||null;if(storm)loadOwnerComparison(storm);records=storm?await stormRecords(storm,manifest):[];$('hourlyPeak').disabled=!storm;$('stormQuery').value=value.name;$('stormYear').value=value.season;automaticYear=true;if(storm)$('stormMatch').replaceChildren(new Option(`${storm.name} · ${storm.season}`,storm.id));$('scanDate').value=value.grid.timestamp.slice(0,10);$('scanClock').value=value.grid.timestamp.slice(11,16).replace(':','');$('estimateButton').disabled=!storm;showScan(value);status('Calibrated scan opened locally. No image download was repeated; earlier IR context was checked separately.');}catch(error){status(error.message,true);}
  else if(q.has('sid')){const chosen=manifest.storms.find(s=>s.id===q.get('sid'));if(chosen){matches=[chosen];$('stormMatch').replaceChildren(new Option(`${chosen.name} · ${chosen.season}`,chosen.id));await chooseHistoric(chosen.id);const at=q.get('at');if(at&&finite(Date.parse(at))){$('scanDate').value=at.slice(0,10);$('scanClock').value=at.slice(11,16).replace(':','');}}}
  try{const data=await jsonRead('/api/live-storms?view=storms');liveStorms=data.storms||[];$('liveMatch').replaceChildren(new Option('Choose a current storm…',''),...liveStorms.map(s=>new Option(`${s.name} · ${s.id}`,s.id)));$('liveStatus').textContent=`${liveStorms.length} systems in the advisory feeds. Calibrated live coverage depends on satellite availability.`;if(q.has('storm')){chooseMode(true);$('liveMatch').value=q.get('storm');chooseLive();}}catch{$('liveMatch').replaceChildren(new Option('Advisory feeds unavailable',''));$('liveStatus').textContent='Current advisory feeds could not be read. Historical analysis remains available.';}
})();
