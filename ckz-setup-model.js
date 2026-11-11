import {numberValue,recordTime,position} from './ibtracs-model.js';
import {greatCircleKm} from './poci-roci-model.js';
import {calculateWindPressure} from './wind-pressure-model.js';
function bracket(records,col,at){
  const time=Date.parse(at);if(!Number.isFinite(time))return null;
  const exact=records.find(row=>Date.parse(recordTime(row,col))===time);if(exact)return {a:exact,b:exact,f:0,interpolated:false,times:[recordTime(exact,col)]};
  const ordered=records.map(row=>({row,time:Date.parse(recordTime(row,col))})).filter(p=>Number.isFinite(p.time)).sort((a,b)=>a.time-b.time),i=ordered.findIndex(p=>p.time>time);if(i<1)return null;
  const a=ordered[i-1],b=ordered[i];if(b.time-a.time>21600000)return null;
  return {a:a.row,b:b.row,f:(time-a.time)/(b.time-a.time),interpolated:true,times:[recordTime(a.row,col),recordTime(b.row,col)]};
}
export function trackPositionAt(records,col,at,agency='USA'){
  const span=bracket(records,col,at);if(!span)return null;const a=position(span.a,col,agency),b=position(span.b,col,agency);if(!a||!b||a.source!==b.source)return null;
  return {lat:a.lat+(b.lat-a.lat)*span.f,lon:((a.lon+(((b.lon-a.lon+540)%360)-180)*span.f+540)%360)-180,source:a.source,interpolated:span.interpolated,bracket:span.times};
}
export function reportedIsobarsAt(records,col,at,agency='USA'){
  const span=bracket(records,col,at);if(!span)return {pociMb:null,rociNmi:null,interpolated:false,bracket:[]};
  const value=field=>{const a=numberValue(span.a,col,agency+'_'+field),b=numberValue(span.b,col,agency+'_'+field);return a>0&&b>0?a+(b-a)*span.f:null;};
  return {pociMb:value('POCI'),rociNmi:value('ROCI'),interpolated:span.interpolated,bracket:span.times,agency};
}
export function sixHourMotionAt(records,col,at,agency='USA'){
  const when=Date.parse(at);if(!Number.isFinite(when))return null;const startAt=new Date(when-10800000).toISOString(),endAt=new Date(when+10800000).toISOString(),start=trackPositionAt(records,col,startAt,agency),end=trackPositionAt(records,col,endAt,agency);
  if(!start||!end||start.source!==end.source)return null;
  return {speedKnots:Math.round(greatCircleKm(start,end)/1.852/6*100)/100,startAt,endAt,start,end,source:start.source,interpolated:start.interpolated||end.interpolated};
}
const number=value=>value===null||value===undefined||value===''?null:Number.isFinite(Number(value))?Number(value):null;
export function ckzSetupDraft(input){
  const p=number(input.pressureMb),lat=number(input.latitude),pe=number(input.pociMb),roci=number(input.rociNmi),motion=number(input.motionKnots),missing=[];
  if(p===null||p<400||p>1100)missing.push('central pressure');if(lat===null||Math.abs(lat)>60)missing.push('latitude');if(pe===null||pe<800||pe>1100)missing.push('POCI (800–1100 mb)');if(roci===null||roci<=0||roci>1500)missing.push('ROCI (above 0, up to 1500 nmi)');if(motion===null||motion<0||motion>60)missing.push('forward speed (0–60 kt)');
  const value=n=>n===null?'':String(n),fields={method:'ckz',pressureMb:value(p),latitude:value(lat),environmentMb:value(pe),knackRociNmi:value(roci),radiusNmi:value(roci),radiusType:'roci',radiusUnit:'nmi',knackRadiusUnit:'nmi',motionKnots:value(motion),windKnots:'',windUnit:'kt',outputUnit:'kt'};
  let error='';if(!missing.length)try{calculateWindPressure({...fields,mode:'pressure'});}catch(e){error=e.message;}
  const at=String(input.at||'');if(!Number.isFinite(Date.parse(at)))missing.push('observation time');
  return {version:1,fields,mode:'pressure',agency:String(input.agency||'USA'),source:input.source==='motis'?'motis':'agency',storm:String(input.storm||''),season:Number(input.season),sid:String(input.sid||''),at,longitude:number(input.longitude),sources:{intensity:String(input.sources?.intensity||''),isobars:String(input.sources?.isobars||''),motion:String(input.sources?.motion||'')},missing,error,ready:!missing.length&&!error};
}
const transferPrefix='utwx:ckzSetup:';
export function saveCkzSetup(draft,storage=sessionStorage){
  const checked=ckzSetupDraft({...draft,...draft.fields,pociMb:draft.fields.environmentMb,rociNmi:draft.fields.knackRociNmi});if(!checked.ready)throw Error('Complete all CKZ inputs before continuing.');
  const id=crypto.randomUUID();storage.setItem(transferPrefix+id,JSON.stringify({createdAt:Date.now(),draft:checked}));return 'wind-pressure.html?'+new URLSearchParams({setup:id});
}
export function readCkzSetup(search,storage=sessionStorage){
  const id=new URLSearchParams(search).get('setup');if(!id)return null;if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid CKZ setup link.');
  let saved;try{saved=JSON.parse(storage.getItem(transferPrefix+id)||'null');}catch{}
  if(!saved?.draft||!Number.isFinite(saved.createdAt)||saved.createdAt>Date.now()+60000||Date.now()-saved.createdAt>86400000)throw Error('These prepared inputs are unavailable. Return to IBTrACS and prepare them again.');
  const p=saved.draft;if(p.version!==1||p.mode!=='pressure')throw Error('Unsupported CKZ setup.');
  const checked=ckzSetupDraft({...p,...p.fields,pociMb:p.fields.environmentMb,rociNmi:p.fields.knackRociNmi});if(!checked.ready)throw Error('The prepared CKZ inputs are incomplete.');return checked;
}
