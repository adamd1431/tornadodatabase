// Presentation diagnostics only; these do not change the frozen forecast model.
export function forecastExtremes(points=[],afterAt=null){
  const cutoff=Date.parse(afterAt);
  const future=points.filter(p=>Number.isFinite(p.hours)&&p.hours>0&&(!Number.isFinite(cutoff)||Date.parse(p.validAt)>cutoff)).toSorted((a,b)=>a.hours-b.hours);
  let peak=null,minimum=null;
  for(const p of future){
    if(Number.isFinite(p.windKt)&&(!peak||p.windKt>peak.windKt))peak=p;
    if(Number.isFinite(p.pressureMb)&&(!minimum||p.pressureMb<minimum.pressureMb))minimum=p;
  }
  return {peak,minimum,throughHours:future.at(-1)?.hours??null,
    windThroughHours:future.filter(p=>Number.isFinite(p.windKt)).at(-1)?.hours??null,
    pressureThroughHours:future.filter(p=>Number.isFinite(p.pressureMb)).at(-1)?.hours??null};
}
export function summarizeGuidance(forecast){
  const afterAt=forecast.advisoryAt||forecast.initializedAt;
  const members=(forecast.members||[]).map(m=>({...m,...forecastExtremes(m.points,afterAt)}));
  const range=values=>values.length?{min:Math.min(...values),max:Math.max(...values),count:values.length}:null;
  return {blend:forecastExtremes(forecast.points,afterAt),members,
    peakRange:range(members.filter(m=>m.peak).map(m=>m.peak.windKt)),
    minimumRange:range(members.filter(m=>m.minimum).map(m=>m.minimum.pressureMb))};
}
export function compass(bearing){
  if(!Number.isFinite(bearing))return null;
  return ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(((bearing%360)+360)%360/22.5)%16];
}
export function fixAge(value,now=Date.now()){
  const hours=(+now-Date.parse(value))/3600000;
  if(!Number.isFinite(hours))return 'Time unavailable';
  if(hours<0)return 'Future-dated fix';
  return `${hours.toFixed(1)} h ago`;
}
// Explicit physical display scales, not probabilities or a fitted favorability index.
export function environmentLevel(kind,value){
  if(!Number.isFinite(value))return null;
  const level=kind==='shear'?1-value/60:kind==='sst'?(value-20)/12:kind==='humidity'?value/100:null;
  return level===null?null:Math.max(0,Math.min(100,level*100));
}
