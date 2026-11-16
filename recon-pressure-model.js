import {RECON_UNITS} from './recon-reduction-model.js';

function value(raw,label,min,max){if(raw===null||raw===undefined||typeof raw==='boolean'||String(raw).trim()==='')throw Error(`Enter ${label}.`);const number=Number(raw);if(!Number.isFinite(number)||number<min||number>max)throw Error(max===Infinity?`${label} must be a finite, non-negative number.`:`${label} must be between ${min} and ${max}.`);return number;}
export function pressureScaledWind(input={}){
  const unit=RECON_UNITS[input.windUnit||'kt'];if(!unit)throw Error('Choose a supported wind unit.');
  const wind=value(input.wind,'starting wind',0,Infinity),environmentMb=value(input.environmentMb,'environmental pressure (EP)',.01,2000),p1Mb=value(input.p1Mb,'target pressure (P1)',.01,2000),p2Mb=value(input.p2Mb,'starting pressure (P2)',.01,2000);
  if(environmentMb<=p2Mb)throw Error('EP must be greater than P2 so the denominator is positive.');
  if(environmentMb<p1Mb)throw Error('P1 must be at or below EP so the square root is real.');
  const numerator=environmentMb-p1Mb,denominator=environmentMb-p2Mb,factor=Math.sqrt(numerator/denominator),windMps=wind*unit.mps,adjustedMps=windMps*factor;
  if(!Number.isFinite(factor)||!Number.isFinite(adjustedMps))throw Error('These inputs do not produce a finite wind estimate.');
  return {wind,windUnit:input.windUnit||'kt',environmentMb,p1Mb,p2Mb,numerator,denominator,factor,windMps,adjustedMps,adjusted:Object.fromEntries(Object.entries(RECON_UNITS).map(([key,u])=>[key,adjustedMps/u.mps]))};
}
