// Shared by retrospective feature extraction and the deployed calibrated blend.
// Missing values stay missing; best-track verification never enters these functions.
import {distanceKm,wrapLongitude} from './storm-forecast-model.js';
export const FORECAST_FAMILIES=Object.freeze([
  {id:'gfs',name:'GFS / GEFS',raw:['AVNO','AEMN'],early:['AVNI','AVN2','AEMI','AEM2'],roles:['track','wind','pressure']},
  {id:'hafs',name:'HAFS',raw:['HFSA','HFSB','HAFA','HAFB'],early:['HFAI','HFBI','HFA2','HFB2'],roles:['track','wind','pressure']},
  {id:'hwrf',name:'HWRF',raw:['HWRF'],early:['HWFI','HWF2'],roles:['track','wind','pressure']},
  {id:'hmon',name:'HMON',raw:['HMON'],early:['HMNI','HMN2'],roles:['track','wind','pressure']},
  {id:'ecmwf',name:'ECMWF',raw:['EMX','ECMF'],early:['EMXI','EMX2'],roles:['track','wind','pressure']},
  {id:'ukmet',name:'UKMET',raw:['UKX','UKM','EGRR'],early:['UKXI','UKX2','UKMI','UKM2','EGRI','EGR2'],roles:['track','wind','pressure']},
  {id:'canadian',name:'Canadian',raw:['CMC','CEMN'],early:['CMCI','CMC2','CEMI','CEM2'],roles:['track','wind','pressure']},
  {id:'navgem',name:'NAVGEM',raw:['NVGM','NGX'],early:['NVGI','NVG2','NGXI','NGX2'],roles:['track','wind','pressure']},
  {id:'coamps',name:'COAMPS-TC',raw:['CTCX'],early:['CTCI','CTC2'],roles:['track','wind','pressure']},
  {id:'lgem',name:'LGEM',raw:[],early:['LGEM'],roles:['wind']},
  {id:'dships',name:'Decay-SHIPS',raw:[],early:['DSHP'],roles:['wind']},
  {id:'chips',name:'CHIPS',raw:['CHIP'],early:['CHPI'],roles:['wind']},
  {id:'trackConsensus',name:'Operational track consensus',raw:[],early:['HCCA','TVCN'],roles:['track']},
  {id:'windConsensus',name:'Operational intensity consensus',raw:[],early:['HCCA','IVCN'],roles:['wind']},
  {id:'official',name:'Official forecast',raw:[],early:['OFCL','JTWC','WRNG'],roles:['track','wind']}
]);
export const LEGACY_FAMILIES=Object.freeze([
  ['gfs',['AVNO','AEMN']],['hafs',['HFSA','HFSB','HAFA','HAFB']],['ecmwf',['ECMF','EMX']],
  ['ukmet',['UKM','UKX','EGRR']],['canadian',['CMC','CEMN']],['navgem',['NGX','NVGM']]
]);
export const HOUR=3600000,KM_PER_DEGREE=Math.PI*6371/180;
const number=(value,lo,hi)=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(+value)&&+value>=lo&&+value<=hi?+value:null;
const timestamp=s=>/^\d{10}$/.test(s)?Date.parse(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:00:00Z`):NaN;
const location=(a,b)=>{const lat=a?.match(/^(\d+)([NS])$/),lon=b?.match(/^(\d+)([EW])$/);if(!lat||!lon)return [null,null];const p=+lat[1]/10*(lat[2]==='S'?-1:1),q=+lon[1]/10*(lon[2]==='W'?-1:1);return Math.abs(p)<=90&&Math.abs(q)<=180?[p,q]:[null,null];};
export const regionFor=id=>/^(AL|EP|CP)/.test(id)?'nhc':'jtwc';
export function parseForecastDeck(text,stormId){
  const groups=new Map();for(const line of text.split(/\r?\n/)){
    const c=line.split(',').map(v=>v.trim());if(c.length<10||c[0]+c[1]!==stormId.slice(0,4))continue;
    const cycle=timestamp(c[2]),lead=number(c[5],-24,168),[latitude,longitude]=location(c[6],c[7]);if(!Number.isFinite(cycle)||lead===null)continue;
    const key=c[4]+':'+cycle,g=groups.get(key)||{code:c[4],cycle,points:new Map()},p={at:cycle+lead*HOUR,lead,latitude,longitude,windKt:number(c[8],1,250),pressureMb:number(c[9],800,1100),status:c[10]||'',name:c.length===14?c[13]:c[27]};
    const previous=g.points.get(lead);if(previous){previous.windKt??=p.windKt;previous.pressureMb??=p.pressureMb;}else g.points.set(lead,p);groups.set(key,g);
  }
  return [...groups.values()].map(g=>({...g,points:[...g.points.values()].sort((a,b)=>a.at-b.at)}));
}
export function sampleForecast(points,at){
  const exact=points.find(p=>p.at===at);if(exact)return {...exact,interpolated:false};
  let a,b;for(const p of points){if(p.at<at)a=p;else if(p.at>at){b=p;break;}}
  if(!a||!b||b.at-a.at>24*HOUR)return null;const f=(at-a.at)/(b.at-a.at),lerp=k=>a[k]===null||b[k]===null?null:a[k]+f*(b[k]-a[k]);
  return {at,latitude:lerp('latitude'),longitude:a.longitude===null||b.longitude===null?null:wrapLongitude(a.longitude+f*wrapLongitude(b.longitude-a.longitude)),windKt:lerp('windKt'),pressureMb:lerp('pressureMb'),interpolated:true};
}
export function operationalInitials(deck,id){
  const cycles=[...new Set(deck.filter(g=>['CARQ','OFCL','JTWC','WRNG'].includes(g.code)).map(g=>g.cycle))].sort((a,b)=>a-b),rows=[];
  for(const at of cycles){const analyses=['CARQ','OFCL','JTWC','WRNG'].map(code=>deck.find(g=>g.code===code&&g.cycle===at)),analysis=analyses.map(g=>g?.points.find(p=>p.lead===0)).find(p=>p&&p.latitude!==null&&p.longitude!==null&&p.windKt!==null);if(!analysis)continue;
    const carq=analyses[0],past=carq?.points.find(p=>p.lead===-12)||carq?.points.find(p=>p.lead===-6),age=past?(at-past.at)/HOUR:0;
    rows.push({id,validAt:new Date(at).toISOString(),latitude:analysis.latitude,longitude:analysis.longitude,windKt:analysis.windKt,pressureMb:analyses.map(g=>g?.points.find(p=>p.lead===0)?.pressureMb).find(v=>v!==null&&v!==undefined)??null,status:analysis.status,name:analysis.name||id,
      trendWind12:past?.windKt!==null&&past?.windKt!==undefined?Math.max(-60,Math.min(60,(analysis.windKt-past.windKt)*12/age)):null,
      trendPressure12:past?.pressureMb!==null&&past?.pressureMb!==undefined&&analysis.pressureMb!==null?Math.max(-60,Math.min(60,(analysis.pressureMb-past.pressureMb)*12/age)):null,
      past:past&&past.latitude!==null?{latitude:past.latitude,longitude:past.longitude,hours:age}:null});
  }
  return rows;
}
function hasValue(p,target){return p&&(target==='track'?p.latitude!==null&&p.longitude!==null:p[target==='wind'?'windKt':'pressureMb']!==null);}
export function selectForecastSources(deck,storm,asOf,{rawDelayHours=6,earlyDelayHours=3}={}){
  const at=Date.parse(storm.validAt),cutoff=+asOf,selected=[];
  for(const family of FORECAST_FAMILIES){const sources={};for(const target of family.roles){
      const choices=deck.filter(g=>{const early=family.early.includes(g.code),raw=family.raw.includes(g.code);return (raw||early)&&g.cycle<=at&&at-g.cycle<=24*HOUR&&g.cycle+(early?earlyDelayHours:rawDelayHours)*HOUR<=cutoff;}).sort((a,b)=>b.cycle-a.cycle||[...family.raw,...family.early].indexOf(a.code)-[...family.raw,...family.early].indexOf(b.code));
      for(const g of choices){const initial=sampleForecast(g.points,at);if(!hasValue(initial,target)||!g.points.some(p=>p.at>=at+12*HOUR&&hasValue(p,target)))continue;
        if(target==='track'&&distanceKm(initial,storm)>500)continue;
        sources[target]={...g,initial};break;
      }
    }if(Object.keys(sources).length)selected.push({id:family.id,name:family.name,sources});
  }
  return selected;
}
export function legacySources(deck,storm,asOf){
  const at=Date.parse(storm.validAt),cutoff=Math.min(at,+asOf-6*HOUR),sources=[];
  for(const [id,codes]of LEGACY_FAMILIES){const choices=deck.filter(g=>codes.includes(g.code)&&g.cycle<=cutoff&&at-g.cycle<=24*HOUR).sort((a,b)=>b.cycle-a.cycle||codes.indexOf(a.code)-codes.indexOf(b.code));for(const g of choices){const initial=sampleForecast(g.points,at);if(!hasValue(initial,'track')||distanceKm(initial,storm)>500||!g.points.some(p=>p.at>=at+12*HOUR))continue;sources.push({id,sources:{track:{...g,initial},wind:{...g,initial},pressure:{...g,initial}}});break;}}
  return sources;
}
export function xy(point,origin){return {east:wrapLongitude(point.longitude-origin.longitude)*KM_PER_DEGREE*Math.max(.2,Math.cos(origin.latitude*Math.PI/180)),north:(point.latitude-origin.latitude)*KM_PER_DEGREE};}
export function fromXY(east,north,origin){return {latitude:origin.latitude+north/KM_PER_DEGREE,longitude:wrapLongitude(origin.longitude+east/(KM_PER_DEGREE*Math.max(.2,Math.cos(origin.latitude*Math.PI/180))))};}
export function forecastFeatures(sources,storm,hours){
  const at=Date.parse(storm.validAt)+hours*HOUR,rows=[];
  for(const source of sources){const row={id:source.id,name:source.name||source.id,track:null,wind:null,pressure:null,codes:{},cycles:{}};
    for(const target of ['track','wind','pressure']){const g=source.sources[target];if(!g)continue;const p=sampleForecast(g.points,at),initial=g.initial;if(!hasValue(p,target)||!hasValue(initial,target))continue;
      row.codes[target]=g.code;row.cycles[target]=new Date(g.cycle).toISOString();
      if(target==='track'){const raw=xy(p,storm),start=xy(initial,storm);row.track={raw:[raw.east,raw.north],offset:source.id==='official'?[0,0]:[-start.east,-start.north]};}
      else{const key=target==='wind'?'windKt':'pressureMb',anchor=storm[key];if(anchor===null||anchor===undefined)continue;row[target]={raw:p[key],offset:source.id==='official'?0:anchor-initial[key]};}
    }if(row.track||row.wind||row.pressure)rows.push(row);
  }
  return rows;
}
export function adjustedFeature(feature,hours,decayHours=0){
  const f=decayHours>0?Math.exp(-hours/decayHours):1;return Array.isArray(feature.raw)?feature.raw.map((v,i)=>v+feature.offset[i]*f):feature.raw+feature.offset*f;
}
