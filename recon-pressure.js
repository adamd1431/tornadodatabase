import {RECON_UNITS} from './recon-reduction-model.js';
import {pressureScaledWind} from './recon-pressure-model.js?v=pressure-scale-1';

export function setupReconPressure({getReducedWind}){
  const $=id=>document.getElementById(id),form=$('pressureScaleForm'),number=(n,d=1)=>n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});let result=null,lastUnit='kt';
  function clear(message,error=false){result=null;$('scaledWindResult').textContent='—';$('scaledWindConversions').textContent='';$('pressureScaleFactor').textContent='—';$('pressureScaleEquation').textContent='';$('copyScaledWind').disabled=true;$('useScaledWind').hidden=true;$('pressureScaleStatus').textContent=message;$('pressureScaleStatus').classList.toggle('error',error);}
  function refresh(){
    const linked=$('linkReducedWind').checked,reduced=getReducedWind();$('pressureScaleWind').readOnly=linked;$('pressureScaleUnit').disabled=linked;$('pressureScaleSource').textContent=linked?'Starting wind follows the reduced result above, using its full calculation precision.':'Using the wind entered here.';
    if(linked){const unit=$('reconOutput').value;$('pressureScaleUnit').value=unit;lastUnit=unit;$('pressureScaleWind').value=reduced?Number(reduced.surface[unit].toPrecision(12)):'';}
    const unit=$('pressureScaleUnit').value;lastUnit=unit;$('scaledWindUnit').textContent=RECON_UNITS[unit].label;$('pressureScaleCopyStatus').textContent='';
    if(linked&&!reduced){clear('Enter valid recon inputs above to supply a reduced wind.');return;}
    if(['pressureScaleEp','pressureScaleP1','pressureScaleP2'].some(id=>!$(id).value.trim())){clear('Enter EP, P1 and P2 to calculate.');return;}
    try{
      result=pressureScaledWind({wind:linked?reduced.surface[unit]:$('pressureScaleWind').value,windUnit:unit,environmentMb:$('pressureScaleEp').value,p1Mb:$('pressureScaleP1').value,p2Mb:$('pressureScaleP2').value});
      $('scaledWindResult').textContent=number(result.adjusted[unit]);$('scaledWindConversions').textContent=Object.keys(RECON_UNITS).filter(u=>u!==unit).map(u=>number(result.adjusted[u])+' '+RECON_UNITS[u].label).join(' · ');$('pressureScaleFactor').textContent=number(result.factor,4);
      $('pressureScaleEquation').textContent=`${number(result.wind,4)} ${RECON_UNITS[unit].label} × √((${number(result.environmentMb,4)} − ${number(result.p1Mb,4)}) / (${number(result.environmentMb,4)} − ${number(result.p2Mb,4)})) = ${number(result.adjusted[unit],4)} ${RECON_UNITS[unit].label}`;
      $('pressureScaleStatus').textContent='';$('pressureScaleStatus').classList.remove('error');$('copyScaledWind').disabled=false;$('useScaledWind').hidden=result.adjusted.kt<25||result.adjusted.kt>250;$('useScaledWind').href='wind-pressure.html?'+new URLSearchParams({reconWind:result.adjusted.kt.toPrecision(12)});
    }catch(error){clear(error.message,true);}
  }
  form.addEventListener('submit',event=>{event.preventDefault();refresh();});form.addEventListener('input',event=>{if(['pressureScaleUnit','linkReducedWind'].includes(event.target.id))return;refresh();});
  $('linkReducedWind').addEventListener('change',refresh);
  $('pressureScaleUnit').addEventListener('change',()=>{const unit=$('pressureScaleUnit').value,raw=$('pressureScaleWind').value,wind=Number(raw);if(raw.trim()&&Number.isFinite(wind))$('pressureScaleWind').value=Number((wind*RECON_UNITS[lastUnit].mps/RECON_UNITS[unit].mps).toPrecision(12));lastUnit=unit;refresh();});
  $('copyScaledWind').addEventListener('click',async()=>{if(!result)return;try{await navigator.clipboard.writeText(`Pressure-scaled wind\nV = wind × sqrt((EP − P1) / (EP − P2))\n${$('pressureScaleEquation').textContent}\nEP: ${result.environmentMb} mb · P1 (target): ${result.p1Mb} mb · P2 (starting): ${result.p2Mb} mb\nFactor: ${number(result.factor,6)}\n${$('linkReducedWind').checked?'Starting wind: reduced recon result':'Starting wind: manual entry'}`);$('pressureScaleCopyStatus').textContent='Result copied.';}catch{$('pressureScaleCopyStatus').textContent='Copy is unavailable. Select the result text to copy it.';}});
  refresh();return {refresh};
}
