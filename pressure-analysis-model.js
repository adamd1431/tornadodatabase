import {AGENCIES,columnMap,rawValue,numberValue,position,designation} from './ibtracs-model.js';
import {validateAnalysisTime,extractPociRoci} from './poci-roci-model.js';
import {noaaPressureSubsetUrl} from './noaa-pressure-chart.js';
const SOURCE='https://www.psl.noaa.gov/mddb2/makePlot.html?variableID=142214';
export function observationAt(storm,records,at,agency='USA',col){
  const raw=at.replace('T',' ').replace('Z',''),exact=records.find(r=>rawValue(r,col,'ISO_TIME')===raw);
  if(exact){const p=position(exact,col,agency);return p?{...p,at,agency,interpolated:false,windKnots:numberValue(exact,col,agency+'_WIND'),pressureMb:numberValue(exact,col,agency+'_PRES'),reportedPociMb:numberValue(exact,col,agency+'_POCI'),reportedRociNmi:numberValue(exact,col,agency+'_ROCI')}:null;}
  const when=Date.parse(at),ordered=records.map(r=>({r,time:Date.parse(rawValue(r,col,'ISO_TIME').replace(' ','T')+'Z')})),after=ordered.findIndex(r=>r.time>when);if(after<1)return null;
  const a=ordered[after-1],b=ordered[after];if(b.time-a.time>43200000)return null;const p=position(a.r,col,agency),q=position(b.r,col,agency);if(!p||!q||p.source!==q.source)return null;
  const t=(when-a.time)/(b.time-a.time),dlon=((q.lon-p.lon+540)%360)-180;return {lat:p.lat+(q.lat-p.lat)*t,lon:((p.lon+dlon*t+540)%360)-180,source:p.source,at,interpolated:true,bracket:[new Date(a.time).toISOString(),new Date(b.time).toISOString()],windKnots:null,pressureMb:null};
}
export async function analyzePressureTime(manifest,date,time,{sid,agency='USA',interval=5,readField,readYear}={}){
  if(!AGENCIES.some(a=>a.id===agency))throw Error('Invalid reporting agency.');
  if(![2,5].includes(interval))throw Error('Choose a 5-mb or 2-mb contour interval.');
  const t=validateAnalysisTime(date,time),raw=t.at.replace('T',' ').replace('Z',''),active=manifest.storms.filter(s=>s.start<=raw&&s.end>=raw&&!s.types.every(type=>/spur/i.test(type)));
  if(sid&&!active.some(s=>s.id===sid))throw Error('The selected cyclone has no track at this date and time.');
  const seasons=[...new Set(active.map(s=>s.season))],data=await Promise.all(seasons.map(readYear)),rows=new Map(data.flatMap(y=>y.storms).map(s=>[s.id,s.records]));
  const fixes=active.flatMap(storm=>{const fix=observationAt(storm,rows.get(storm.id)||[],t.at,agency,columnMap(manifest.columns));return fix&&Math.abs(fix.lat)<=65?[{storm,fix}]:[];});
  const result={at:t.at,dataset:'NOAA / CIRES / DOE 20CRv3 ensemble-mean MSLP',sourcePage:SOURCE,dataUrl:noaaPressureSubsetUrl(date,time),gridDegrees:1,contourIntervalMb:interval,results:[],note:'Reanalysis-derived estimates. The 1° ensemble-mean grid can smooth or miss a cyclone. These are not JTWC-reported POCI / ROCI.'};
  if(!fixes.length)return result;
  const grid=await readField(t);let low=Infinity,high=-Infinity;for(const row of grid.values)for(const p of row){low=Math.min(low,p);high=Math.max(high,p);}result.chart={intervalMb:interval,lowMb:Math.floor(low/interval)*interval,highMb:Math.ceil(high/interval)*interval};
  const analyses=fixes.map(({storm,fix})=>({sid:storm.id,name:storm.name,season:storm.season,designation:storm.atcf.map(a=>designation(a,storm)).join(' / '),track:fix,...extractPociRoci(grid,fix,{interval})}));
  const centers=new Map();for(const a of analyses)if(a.status==='estimated'){const key=a.center.lat+','+a.center.lon;if(!centers.has(key))centers.set(key,[]);centers.get(key).push(a);}
  for(const shared of centers.values())if(shared.length>1)for(const a of shared){a.status='unresolved';delete a.pociMb;delete a.rociNmi;delete a.contour;a.message='Multiple active cyclone tracks map to the same grid minimum. Individual POCI / ROCI cannot be separated at this resolution.';}
  result.results=analyses.filter(a=>!sid||a.sid===sid).sort((a,b)=>(b.track.windKnots??0)-(a.track.windKnots??0)||a.name.localeCompare(b.name));return result;
}
