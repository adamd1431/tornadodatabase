import {WIND_FACTORS,RADIUS_FACTORS,BROWN_FITS,calculateWindPressure,windPressureCurve,schloemerPressureCurve} from './wind-pressure-model.js';

const get=id=>document.getElementById(id);
const defaults={method:'ckz',brownFit:'all',mode:'wind',windKnots:'100',windUnit:'kt',outputUnit:'kt',pressureMb:'965',ci:'5',latitude:'20',environmentMb:'1010',radiusType:'r34',radiusNmi:'100',radiusUnit:'nmi',motionKnots:'11',rmwNmi:'25',distanceNmi:'20',schRadiusUnit:'nmi',stationMb:'909.4',hollandB:'1'};
get('brownFit').innerHTML=[...new Set(Object.values(BROWN_FITS).map(fit=>fit.group))].map(group=>`<optgroup label="${group}">${Object.entries(BROWN_FITS).filter(([,fit])=>fit.group===group).map(([key,fit])=>`<option value="${key}">${fit.label}</option>`).join('')}</optgroup>`).join('');
const ckzExample={...defaults,method:'ckz',mode:'wind',windKnots:'100',windUnit:'kt',outputUnit:'kt',latitude:'20',environmentMb:'1010',radiusType:'r34',radiusNmi:'100',radiusUnit:'nmi',motionKnots:'11'};
let beforeCkzExample=null;
const storageKey='utwx:windPressure:v1';
const fields=Object.keys(defaults).filter(key=>key!=='mode');
let mode=defaults.mode,previousWindMode=defaults.mode,lastWindUnit=defaults.windUnit,lastRadiusUnit=defaults.radiusUnit,lastSchRadiusUnit=defaults.schRadiusUnit,ckzMotion='11',currentResult=null,currentInput=null,frame=0;
const format=(value,digits=1)=>Number(value).toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits});
const windLabel=unit=>unit==='kt'?'kt':unit==='kmh'?'km/h':'mph';
const numeric=id=>get(id).value.trim()===''?null:Number(get(id).value);
const displayUnit=()=>mode==='wind'?get('windUnit').value:get('outputUnit').value;
const displayWind=(knots,unit=displayUnit())=>format(knots*WIND_FACTORS[unit])+' '+windLabel(unit);
const displayDistance=nmi=>format(nmi*RADIUS_FACTORS[get('schRadiusUnit').value])+' '+get('schRadiusUnit').value;

function restore() {
  let saved={};try{saved=JSON.parse(localStorage.getItem(storageKey)||'{}')||{};}catch{}
  fields.forEach(key=>{
    const value=String(saved[key]??defaults[key]),el=get(key);
    el.value=el.tagName==='SELECT' && ![...el.options].some(option=>option.value===value)?defaults[key]:value;
  });
  mode=['wind','pressure','ci','station'].includes(saved.mode)?saved.mode:defaults.mode;
  previousWindMode=['wind','pressure','ci'].includes(saved.previousWindMode)?saved.previousWindMode:defaults.mode;
  ckzMotion=String(saved.ckzMotion??defaults.motionKnots);
  get('motionKnots').disabled=get('method').value==='adt';
  if(get('motionKnots').disabled)get('motionKnots').value='11';
  lastWindUnit=get('windUnit').value;lastRadiusUnit=get('radiusUnit').value;lastSchRadiusUnit=get('schRadiusUnit').value;
}
function save() {
  try{localStorage.setItem(storageKey,JSON.stringify({...Object.fromEntries(fields.map(key=>[key,get(key).value])),mode,previousWindMode,ckzMotion}));}catch{}
}
function syncControls() {
  const brown=get('method').value==='brown2006',sch=get('method').value==='schloemer';
  if(sch && mode!=='station'){previousWindMode=mode;mode='station';}
  if(!sch && mode==='station')mode=previousWindMode;
  if(brown && mode==='ci')mode='pressure';
  document.querySelector('.mode-tabs').classList.toggle('brown-mode',brown);
  document.querySelector('.mode-tabs').classList.toggle('sch-mode',sch);
  get('windMode').hidden=sch;get('pressureMode').hidden=sch;get('ciMode').hidden=brown || sch;get('stationMode').hidden=!sch;
  get('ckzTutorial').hidden=brown || sch;
  get('brownFitGroup').hidden=!brown;
  ['schSizeGroup','schStationGroup'].forEach(id=>{get(id).hidden=!sch;});
  get('ckzInputsGroup').hidden=brown;get('latitudeGroup').hidden=sch;
  get('ckzInputsGroup').classList.toggle('single-field',sch);
  ['sizeGroup','motionGroup'].forEach(id=>{get(id).hidden=brown || sch;});
  document.querySelectorAll('[data-mode]').forEach(button=>{const active=button.dataset.mode===mode;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;});
  get('calculatorPanel').setAttribute('aria-labelledby',mode+'Mode');
  get('windGroup').hidden=mode!=='wind';get('pressureGroup').hidden=mode!=='pressure';get('ciGroup').hidden=mode!=='ci';get('outputUnitGroup').hidden=mode==='wind' || sch;
  const adt=get('method').value==='adt',motion=get('motionKnots');
  if(adt && !motion.disabled){ckzMotion=motion.value;motion.value='11';}
  if(!adt && motion.disabled)motion.value=ckzMotion;
  motion.disabled=adt;
  get('methodHint').textContent=sch?'Central pressure from a station observation using the Schloemer pressure profile with an editable Holland B.':brown?'Atlantic pressure–wind fits from Brown, Franklin & Landsea (2006). No size, motion, or environmental-pressure inputs are needed.':adt?'SSEC / McIDAS-V CKZ conversion with ADT defaults.':'Published equations with the low-latitude correction below 18°.';
  get('environmentHint').textContent=sch?'Ambient sea-level pressure far from the cyclone. Used directly; no POCI adjustment is added.':adt?'Environmental pressure Pe used in the selected equation.':'Pe: outermost closed-isobar pressure + 2 mb for CKZ.';
  get('motionHint').textContent=adt?'Fixed at the documented ADT climatological value of 11 knots.':'Forward motion of the cyclone, not the maximum wind.';
  const roci=get('radiusType').value==='roci';
  get('radiusLabel').textContent=roci?'Radius of outermost closed isobar':'Mean TS-force radius (R34)';
  get('radiusHint').textContent=roci?'Estimates R34 = 0.354 × ROCI + 13.3, with both radii in nmi.':'TS-force winds start at 34 kt. Average the reported nonzero quadrant radii; enter 0 only when there are no TS-force winds.';
  get('resultLabel').textContent=mode==='pressure'?'Estimated 1-minute wind':'Estimated central pressure';
  get('methodChip').textContent=sch?'SCH / Holland':brown?'Brown 2006':adt?'ADT / McIDAS-V':'CKZ 2009';
  get('analysisTitle').textContent=sch?'Radial pressure profile':'Wind–pressure curve';
}
function readInput() {
  const wind=numeric('windKnots'),radius=numeric('radiusNmi'),rmw=numeric('rmwNmi'),distance=numeric('distanceNmi'),distanceFactor=RADIUS_FACTORS[get('schRadiusUnit').value];
  return {mode,method:get('method').value,brownFit:get('brownFit').value,windKnots:wind==null?null:wind/WIND_FACTORS[get('windUnit').value],pressureMb:numeric('pressureMb'),ci:numeric('ci'),
    latitude:numeric('latitude'),environmentMb:numeric('environmentMb'),radiusType:get('radiusType').value,radiusNmi:radius==null?null:radius/RADIUS_FACTORS[get('radiusUnit').value],motionKnots:numeric('motionKnots'),
    rmwNmi:rmw==null?null:rmw/distanceFactor,distanceNmi:distance==null?null:distance/distanceFactor,stationMb:numeric('stationMb'),hollandB:numeric('hollandB')};
}
function metric(value,label){return `<div><b>${value}</b><span>${label}</span></div>`;}
function renderResult(result) {
  const {solutions,options}=result,first=solutions[0],unit=displayUnit(),sch=options.method==='schloemer';
  get('resultValue').textContent=mode==='pressure'?(solutions.length>1?String(solutions.length):format(first.windKnots*WIND_FACTORS[unit])):format(first.pressureMb);
  get('resultUnit').textContent=mode==='pressure'?(solutions.length>1?'wind solutions':windLabel(unit)):'mb / hPa';
  get('resultDescription').textContent=sch
    ?'From '+format(options.stationMb)+' mb observed '+displayDistance(options.distanceNmi)+' from the center · RMW '+displayDistance(options.rmwNmi)+' · B = '+format(options.hollandB,2)
    :mode==='pressure'
    ?solutions.map(row=>displayWind(row.windKnots,'kt')+' · '+displayWind(row.windKnots,'mph')+' · '+displayWind(row.windKnots,'kmh')).join(' | ')
    :(mode==='ci'?'CI '+format(result.ci)+' → ':'')+displayWind(first.windKnots,'kt')+' · '+displayWind(first.windKnots,'mph')+' · '+displayWind(first.windKnots,'kmh');
  const brown=options.method==='brown2006';
  get('resultMetrics').innerHTML=sch
    ?metric(format(first.deficit)+' mb','Central pressure deficit')+metric(displayDistance(options.rmwNmi),'Radius of maximum wind')+metric(format(first.amplification,2)+'×','Station error amplification')
    :brown
    ?metric(format(first.fittedDeficit)+' mb','b − central pressure')+metric(format(options.fit.b)+' mb','Fitted reference b')+metric('1 minute','Sustained wind')
    :metric(format(first.deficit)+' mb','Pressure deficit')+metric(format(options.r34)+' nmi','Mean TS-force radius')+metric(format(options.motionKnots)+' kt','Forward motion');
  const notes=[];
  if(sch) {
    notes.push(options.hollandB===1?'B = 1: original Schloemer profile.':'Using the Holland generalization of the Schloemer profile.');
    if(options.hollandB>2.5)notes.push('B is above the conventional Holland range of about 1–2.5. Large values make the profile extremely sharp.');
    if(first.amplification>5)notes.push('At this distance, a 1 mb station-pressure change shifts the central-pressure estimate by about '+format(first.amplification,1)+' mb.');
    if(first.fraction<1e-6 && options.distanceNmi>0)notes.push('The modeled pressure at this distance is essentially equal to central pressure.');
  }
  if(brown) {
    notes.push('Selected fit: '+options.fit.label+'. The reference b is fitted, rather than a measured environmental pressure.');
    const lowest=options.brownFit==='atlantic'?920:892;
    if(first.pressureMb<lowest)notes.push('Below '+lowest+' mb is an extrapolation beyond the lowest pressure in '+(options.brownFit==='atlantic'?'this regional sample.':'the study.'));
  }
  if(solutions.length>1)notes.push('More than one wind matches these inputs. Every matching solution is listed above and marked on the curve.');
  if(first.lowLatitude)notes.push('Using the CKZ low-latitude equation (absolute latitude below 18°).');
  if(solutions.some(row=>row.floorApplied))notes.push('ADT’s weak-system adjustment sets central pressure to environmental pressure minus 2 mb.');
  if(options.radiusType==='roci')notes.push('TS-force radius (R34) is estimated from ROCI. A measured R34 can give a different result.');
  get('calculationNote').textContent=notes.join(' ');get('calculationNote').hidden=!notes.length;
  get('copyResult').disabled=false;
  renderDetails(result);renderChart(result);
}
function renderDetails({solutions,options}) {
  if(options.method==='schloemer') {
    const row=solutions[0],box=document.createElement('div');box.className='equation';
    box.textContent='Schloemer pressure profile with Holland B\nP(r) = Pc + (Pe − Pc) × exp[−(RMW / r)^B]\nq = exp[−(RMW / r)^B]\nPc = Pe − (Pe − Pstation) / (1 − q)\n\nPressures in mb / hPa; RMW and r use the same distance units.\nAt r = 0, Pc = Pstation. B = 1 is the original Schloemer form.';
    const table=document.createElement('table');table.className='detail-table';
    table.innerHTML='<tbody>'+[['Station sea-level pressure',format(options.stationMb,3)+' mb'],['Environmental pressure',format(options.environmentMb,3)+' mb'],['RMW',displayDistance(options.rmwNmi)],['Station distance',displayDistance(options.distanceNmi)],['Holland B',format(options.hollandB,4)],['Profile fraction q',row.fraction.toExponential(5)],['Station error amplification',format(row.amplification,3)+'×'],['Central pressure',format(row.pressureMb,4)+' mb']].map(([name,value])=>`<tr><th scope="row">${name}</th><td>${value}</td></tr>`).join('')+'</tbody>';
    get('calculationDetails').replaceChildren(box,table);return;
  }
  if(options.method==='brown2006') {
    const {a,b,c,label}=options.fit,row=solutions[0],box=document.createElement('div');box.className='equation';
    box.textContent=`Brown et al. (2006) · ${label}\nV = ${a} × (${b} − Pc)^${c}\nPc = ${b} − (V / ${a})^(1 / ${c})\n\nV is 1-minute wind in knots; Pc is central pressure in mb.\na = ${a}; b = ${b} mb; c = ${c}\nb is a regression constant, not an environmental-pressure input.`;
    get('calculationDetails').replaceChildren(box);
    const table=document.createElement('table');table.className='detail-table';
    table.innerHTML='<tbody>'+[['Selected fit',label],['1-minute wind',displayWind(row.windKnots,'kt')],['b − central pressure',format(row.fittedDeficit,3)+' mb'],['Central pressure',format(row.pressureMb,3)+' mb']].map(([name,value])=>`<tr><th scope="row">${name}</th><td>${value}</td></tr>`).join('')+'</tbody>';
    get('calculationDetails').append(table);return;
  }
  const low=solutions[0].lowLatitude;
  const equation=low?'Pc = Pe + 5.962 − 0.267 Vr − (Vr / 18.26)² − 6.8 S':'Pc = Pe + 23.286 − 0.483 Vr − (Vr / 24.254)² − 12.587 S − 0.483 |lat|';
  const box=document.createElement('div');box.className='equation';
  box.textContent='Vr = Vmax − 1.5 C^0.63\nVprofile = '+(options.method==='adt'?'Vr':'Vmax')+'\nRmax,c = 66.785 − 0.09102 Vprofile + 1.0619 (|lat| − 25)\nx = 0.1147 + 0.0055 Vprofile − 0.001 (|lat| − 25)\nV500,c = Vprofile × (Rmax,c / 500)^x\nS = max[(R34 / 9 − 3) / V500,c, 0.4]\n'+equation;
  get('calculationDetails').replaceChildren(box);
  solutions.forEach((row,index)=>{
    const container=document.createElement('div');
    const rows=[['1-minute wind',displayWind(row.windKnots,'kt')],['Motion adjustment',format(row.translation)+' kt'],['Storm-relative wind',format(row.relativeWind)+' kt'],['Climatological V500',format(row.climatologicalWind,3)+' kt'],['Size parameter S',format(row.size,4)],['Raw central pressure',format(row.rawPressure,3)+' mb'],['Final central pressure',format(row.pressureMb)+' mb']];
    container.innerHTML=(solutions.length>1?`<p class="hint">Solution ${index+1}</p>`:'')+'<table class="detail-table"><tbody>'+rows.map(([label,value])=>`<tr><th scope="row">${label}</th><td>${value}</td></tr>`).join('')+'</tbody></table>';
    get('calculationDetails').append(container);
  });
}
function renderChart(result) {
  const sch=result.options.method==='schloemer';
  const points=sch?schloemerPressureCurve(currentInput):windPressureCurve(currentInput),unit=displayUnit();
  if(!points.length){get('relationshipChart').innerHTML='<div class="chart-empty">No curve available for these inputs.</div>';return;}
  const width=Math.max(240,Math.min(640,get('relationshipChart').clientWidth)),height=260,left=46,right=18,top=32,bottom=48,plotWidth=width-left-right,plotHeight=height-top-bottom;
  const brown=result.options.method==='brown2006';
  const xMin=sch?0:25,xMax=sch?points.at(-1).distanceNmi:250,yMin=Math.floor(Math.min(...points.map(row=>row.pressureMb),...result.solutions.map(row=>row.pressureMb))/20)*20,yMax=Math.ceil((brown?result.options.fit.b:result.options.environmentMb)/20)*20;
  const x=v=>left+(v-xMin)/(xMax-xMin)*plotWidth,y=v=>top+(yMax-v)/(yMax-yMin)*plotHeight;
  const path=points.map((point,i)=>(i?'L':'M')+x(sch?point.distanceNmi:point.windKnots).toFixed(2)+','+y(point.pressureMb).toFixed(2)).join(' ');
  const axes=[];
  for(let i=0;i<=4;i++){
    const pressure=yMin+(yMax-yMin)*i/4,wind=xMin+(xMax-xMin)*i/4;
    axes.push(`<line x1="${left}" x2="${width-right}" y1="${y(pressure)}" y2="${y(pressure)}" stroke="#94a3b81c"/><text x="${left-9}" y="${y(pressure)+4}" text-anchor="end">${Math.round(pressure)}</text><text x="${x(wind)}" y="${height-bottom+23}" text-anchor="middle">${Math.round(wind*(sch?RADIUS_FACTORS[get('schRadiusUnit').value]:WIND_FACTORS[unit]))}</text>`);
  }
  const markers=sch
    ?`<circle cx="${x(0)}" cy="${y(result.solutions[0].pressureMb)}" r="4" fill="#dbeafe" stroke="#60a5fa" stroke-width="2"><title>Estimated central pressure</title></circle><circle cx="${x(result.options.distanceNmi)}" cy="${y(result.options.stationMb)}" r="5" fill="#fbbf24"><title>Station observation</title></circle>`
    :result.solutions.map(row=>`<circle cx="${x(row.windKnots)}" cy="${y(row.pressureMb)}" r="8" fill="#93c5fd22"/><circle cx="${x(row.windKnots)}" cy="${y(row.pressureMb)}" r="4" fill="#dbeafe" stroke="#60a5fa" stroke-width="2"/>`).join('');
  get('relationshipChart').innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="curveTitle curveDescription"><title id="curveTitle">${sch?'SCH radial pressure profile':'Wind versus central pressure'}</title><desc id="curveDescription">${sch?'Pressure versus distance using the entered RMW and Holland B. The gold marker is the station observation; the blue marker is estimated central pressure.':(brown?'Brown et al. (2006), '+result.options.fit.label+' fit.':'The selected relationship with the current latitude, size, motion, and environmental pressure.')+' Markers show the calculated solution'+(result.solutions.length>1?'s':'')+'.'}</desc><g font-family="Inter,system-ui,sans-serif" font-size="11" fill="#8ea0bd"><text x="${left}" y="13">${sch?'Pressure':'Central pressure'} (mb)</text>${axes.join('')}<text x="${left+plotWidth/2}" y="${height-3}" text-anchor="middle">${sch?'Distance from center ('+get('schRadiusUnit').value+')':'1-minute wind ('+windLabel(unit)+')'}</text></g><path d="${path}" fill="none" stroke="#60a5fa" stroke-width="2.5" stroke-linejoin="round"/>${markers}</svg>`;
}
function update() {
  frame=0;syncControls();currentResult=null;get('copyStatus').textContent='';
  get('windPressureForm').querySelectorAll('[aria-invalid]').forEach(el=>el.removeAttribute('aria-invalid'));
  try{
    currentInput=readInput();currentResult=calculateWindPressure(currentInput);
    get('inputError').hidden=true;get('inputError').textContent='';renderResult(currentResult);
  }catch(error){
    get('resultValue').textContent='—';get('resultUnit').textContent='';get('resultDescription').textContent='Adjust the inputs to calculate an estimate.';
    get('inputError').textContent=error.message;get('inputError').hidden=false;get(error.field)?.setAttribute('aria-invalid','true');
    get('resultMetrics').replaceChildren();get('calculationNote').hidden=true;get('copyResult').disabled=true;
    get('relationshipChart').innerHTML='<div class="chart-empty">The curve will appear when the inputs are valid.</div>';get('calculationDetails').textContent='Enter valid storm inputs to view the equations and calculation.';
  }
  save();
}
function schedule(){if(!frame)frame=requestAnimationFrame(update);}

function applyTutorialInputs(values,nextMode,nextCkzMotion) {
  fields.forEach(key=>{get(key).value=values[key];});
  mode=nextMode;ckzMotion=nextCkzMotion;
  get('motionKnots').disabled=values.method==='adt';
  lastWindUnit=values.windUnit;lastRadiusUnit=values.radiusUnit;lastSchRadiusUnit=values.schRadiusUnit;
  update();
}
get('ckzExamplePressure').textContent=format(calculateWindPressure(ckzExample).solutions[0].pressureMb)+' mb';
get('loadCkzExample').addEventListener('click',()=>{
  if(!beforeCkzExample)beforeCkzExample={values:Object.fromEntries(fields.map(key=>[key,get(key).value])),mode,ckzMotion};
  applyTutorialInputs(ckzExample,'wind',ckzExample.motionKnots);
  get('restoreCkzInputs').hidden=false;
  get('ckzTutorialStatus').textContent='Example loaded: '+format(currentResult.solutions[0].pressureMb)+' mb. Change an input to see its effect in the result below.';
});
get('restoreCkzInputs').addEventListener('click',()=>{
  if(!beforeCkzExample)return;
  const previous=beforeCkzExample;beforeCkzExample=null;
  applyTutorialInputs(previous.values,previous.mode,previous.ckzMotion);
  get('restoreCkzInputs').hidden=true;
  get('loadCkzExample').focus();
  get('ckzTutorialStatus').textContent='Your previous inputs have been restored.';
});
get('loadSchExample').addEventListener('click',()=>{
  Object.entries({method:'schloemer',rmwNmi:'25',distanceNmi:'20',schRadiusUnit:'nmi',environmentMb:'1009.5',stationMb:'909.4',hollandB:'100'}).forEach(([key,value])=>{get(key).value=value;});
  lastSchRadiusUnit='nmi';update();
});
document.querySelector('.mode-tabs').addEventListener('click',event=>{const button=event.target.closest('[data-mode]');if(!button)return;mode=button.dataset.mode;update();});
document.querySelector('.mode-tabs').addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
  const modes=get('method').value==='schloemer'?['station']:get('method').value==='brown2006'?['wind','pressure']:['wind','pressure','ci'],index=modes.indexOf(mode),next=event.key==='Home'?0:event.key==='End'?modes.length-1:(index+(event.key==='ArrowRight'?1:-1)+modes.length)%modes.length;
  mode=modes[next];update();get(mode+'Mode').focus();
});
get('windPressureForm').addEventListener('submit',event=>event.preventDefault());
get('windPressureForm').addEventListener('input',schedule);
get('windPressureForm').addEventListener('change',event=>{
  if(event.target.id==='windUnit'){
    const value=numeric('windKnots');if(value!=null && Number.isFinite(value))get('windKnots').value=String(Number((value/WIND_FACTORS[lastWindUnit]*WIND_FACTORS[event.target.value]).toFixed(6)));
    lastWindUnit=event.target.value;
  }
  if(event.target.id==='radiusUnit'){
    const value=numeric('radiusNmi');if(value!=null && Number.isFinite(value))get('radiusNmi').value=String(Number((value/RADIUS_FACTORS[lastRadiusUnit]*RADIUS_FACTORS[event.target.value]).toFixed(6)));
    lastRadiusUnit=event.target.value;
  }
  if(event.target.id==='schRadiusUnit'){
    for(const key of ['rmwNmi','distanceNmi']) {
      const value=numeric(key);if(value!=null && Number.isFinite(value))get(key).value=String(Number((value/RADIUS_FACTORS[lastSchRadiusUnit]*RADIUS_FACTORS[event.target.value]).toFixed(6)));
    }
    lastSchRadiusUnit=event.target.value;
  }
  schedule();
});
get('resetCalculator').addEventListener('click',()=>{try{localStorage.removeItem(storageKey);}catch{}restore();get('motionKnots').disabled=false;get('motionKnots').value=defaults.motionKnots;ckzMotion=defaults.motionKnots;update();});
get('copyResult').addEventListener('click',async()=>{
  if(!currentResult)return;
  const {options,solutions}=currentResult;
  const brown=options.method==='brown2006';
  const text=options.method==='schloemer'
    ?'SCH · Schloemer / Holland pressure profile\nEstimated central pressure: '+format(solutions[0].pressureMb,4)+' mb\nStation sea-level pressure: '+format(options.stationMb)+' mb; distance: '+displayDistance(options.distanceNmi)+'; RMW: '+displayDistance(options.rmwNmi)+'; environment: '+format(options.environmentMb)+' mb; Holland B: '+format(options.hollandB,4)+'.\nPc = Pe − (Pe − Pstation) / (1 − exp[−(RMW / r)^B]).\nSource: https://www.weather.gov/media/owp/oh/hdsc/docs/HMR31.pdf\nHolland generalization: https://faculty.fiu.edu/~willough/PUBS/HEW%26RAHN_04.pdf'
    :(brown?'Brown, Franklin & Landsea (2006) · '+options.fit.label:options.method==='adt'?'ADT / SSEC McIDAS-V':'CKZ (Courtney & Knaff, 2009)')+'\n'+solutions.map(row=>displayWind(row.windKnots,'kt')+' / '+displayWind(row.windKnots,'mph')+' → '+format(row.pressureMb)+' mb').join('\n')+(brown?'\nV = '+options.fit.a+' × ('+options.fit.b+' − Pc)^'+options.fit.c+'; V in kt, Pc in mb.\nSource: https://ams.confex.com/ams/pdfpapers/107190.pdf':'\nLatitude: '+format(options.latitude)+'°; environment: '+format(options.environmentMb)+' mb; TS-force radius (R34): '+format(options.r34)+' nmi; motion: '+format(options.motionKnots)+' kt.');
  try{await navigator.clipboard.writeText(text);get('copyStatus').textContent='Result copied.';}catch{get('copyStatus').textContent='Clipboard access is unavailable. You can select and copy the result above.';}
});
window.addEventListener('resize',()=>{if(currentResult)renderChart(currentResult);});
restore();update();
