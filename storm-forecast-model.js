// Experimental, uncalibrated change-consensus baseline. No fitted environmental
// coefficients or probability cone are implied by this product.
export const FORECAST_VERSION='change-consensus-v1';
export const FORECAST_METHOD='Experimental guidance blend';
export const GUIDANCE_SOURCE='https://hurricanes.ral.ucar.edu/repository/data/adecks_open/';
export const ENVIRONMENT_SOURCE='https://api.open-meteo.com/v1/gfs';
export const MODEL_FAMILIES=Object.freeze([
  {id:'gfs',name:'GFS / GEFS',codes:['AVNO','AEMN']},
  {id:'hafs',name:'HAFS',codes:['HFSA','HFSB','HAFA','HAFB']},
  {id:'ecmwf',name:'ECMWF',codes:['ECMF','EMX']},
  {id:'ukmet',name:'UKMET',codes:['UKM','UKX','EGRR']},
  {id:'canadian',name:'Canadian',codes:['CMC','CEMN']},
  {id:'navgem',name:'NAVGEM',codes:['NGX','NVGM']}
]);
const HOUR=3600000,RAD=Math.PI/180;
const numeric=(v,min,max)=>v!==null&&v!==undefined&&String(v).trim()!==''&&Number.isFinite(+v)&&+v>=min&&+v<=max?+v:null;
export const wrapLongitude=v=>((v+540)%360+360)%360-180;
export function guidanceUrl(storm){if(!/^(AL|EP|CP|WP|IO|SH)\d{6}$/.test(storm.id))throw Error('Invalid storm ID.');return GUIDANCE_SOURCE+'a'+storm.id.toLowerCase()+'.dat';}
function stamp(s){if(!/^\d{10}$/.test(s))return null;const iso=`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:00:00.000Z`;return Number.isFinite(Date.parse(iso))&&new Date(iso).toISOString()===iso?iso:null;}
export function distanceKm(a,b){const p=a.latitude*RAD,q=b.latitude*RAD,dp=q-p,dl=wrapLongitude(b.longitude-a.longitude)*RAD,h=Math.sin(dp/2)**2+Math.cos(p)*Math.cos(q)*Math.sin(dl/2)**2;return 12742*Math.asin(Math.sqrt(Math.min(1,h)));}
export function destination(point,bearing,km){const p=point.latitude*RAD,l=point.longitude*RAD,b=bearing*RAD,d=km/6371,q=Math.asin(Math.sin(p)*Math.cos(d)+Math.cos(p)*Math.sin(d)*Math.cos(b));return {latitude:q/RAD,longitude:wrapLongitude((l+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(p),Math.cos(d)-Math.sin(p)*Math.sin(q)))/RAD)};}
export function interpolate(points,at){
  const exact=points.find(p=>Date.parse(p.validAt)===at);if(exact)return {...exact,interpolated:false};
  const before=points.filter(p=>Date.parse(p.validAt)<at).at(-1),after=points.find(p=>Date.parse(p.validAt)>at);
  if(!before||!after||Date.parse(after.validAt)-Date.parse(before.validAt)>24*HOUR)return null;
  const f=(at-Date.parse(before.validAt))/(Date.parse(after.validAt)-Date.parse(before.validAt)),lerp=key=>before[key]===null||after[key]===null?null:before[key]+f*(after[key]-before[key]);
  return {validAt:new Date(at).toISOString(),latitude:lerp('latitude'),longitude:wrapLongitude(before.longitude+f*wrapLongitude(after.longitude-before.longitude)),windKt:lerp('windKt'),pressureMb:lerp('pressureMb'),interpolated:true};
}
export function parseGuidance(text,storm,asOf=new Date()){
  const rows=new Map(),cutoff=Math.min(+asOf,Date.parse(storm.validAt)),known=new Set(MODEL_FAMILIES.flatMap(f=>f.codes));
  for(const line of text.split(/\r?\n/)){
    const c=line.split(',').map(s=>s.trim());if(c.length<10||c[0]+c[1]!==storm.id.slice(0,4)||!known.has(c[4]))continue;
    const cycle=stamp(c[2]),lead=numeric(c[5],0,168),lat=c[6].match(/^(\d+)([NS])$/),lon=c[7].match(/^(\d+)([EW])$/);
    if(!cycle||lead===null||!lat||!lon||Date.parse(cycle)>cutoff||cutoff-Date.parse(cycle)>24*HOUR)continue;
    const latitude=+lat[1]/10*(lat[2]==='S'?-1:1),longitude=+lon[1]/10*(lon[2]==='W'?-1:1);if(Math.abs(latitude)>90||Math.abs(longitude)>180)continue;
    const key=c[4]+':'+cycle,group=rows.get(key)||{code:c[4],cycle,points:new Map()},point={validAt:new Date(Date.parse(cycle)+lead*HOUR).toISOString(),latitude,longitude,windKt:numeric(c[8],1,250),pressureMb:numeric(c[9],800,1100)};
    const old=group.points.get(lead);if(old){old.windKt??=point.windKt;old.pressureMb??=point.pressureMb;}else group.points.set(lead,point);rows.set(key,group);
  }
  const result=[];
  for(const family of MODEL_FAMILIES){
    const choices=[...rows.values()].filter(g=>family.codes.includes(g.code)).sort((a,b)=>Date.parse(b.cycle)-Date.parse(a.cycle)||family.codes.indexOf(a.code)-family.codes.indexOf(b.code));
    for(const group of choices){
      const points=[...group.points.values()].sort((a,b)=>Date.parse(a.validAt)-Date.parse(b.validAt)),initial=interpolate(points,Date.parse(storm.validAt));
      if(!initial||distanceKm(initial,storm)>500||!points.some(p=>Date.parse(p.validAt)>=Date.parse(storm.validAt)+12*HOUR))continue;
      result.push({family:family.id,name:family.name,code:group.code,cycle:group.cycle,initial,points});break;
    }
  }
  return result;
}
export function officialGuidance(text,storm){
  if(storm.forecast?.length)return {cycle:storm.validAt,agency:storm.agency,points:[{hours:0,validAt:storm.validAt,latitude:storm.latitude,longitude:storm.longitude,windKt:storm.windKt,pressureMb:storm.pressureMb},...storm.forecast.map(p=>({...p,pressureMb:null}))]};
  const rows=[];for(const line of text.split(/\r?\n/)){const c=line.split(',').map(s=>s.trim()),cycle=stamp(c[2]||''),lead=numeric(c[5],0,120),lat=c[6]?.match(/^(\d+)([NS])$/),lon=c[7]?.match(/^(\d+)([EW])$/);if(c[0]+c[1]!==storm.id.slice(0,4)||!['OFCL','JTWC'].includes(c[4])||!cycle||lead===null||!lat||!lon||Date.parse(cycle)>Date.parse(storm.validAt)||Date.parse(storm.validAt)-Date.parse(cycle)>6*HOUR)continue;
    const validAt=new Date(Date.parse(cycle)+lead*HOUR).toISOString(),hours=(Date.parse(validAt)-Date.parse(storm.validAt))/HOUR,latitude=+lat[1]/10*(lat[2]==='S'?-1:1),longitude=+lon[1]/10*(lon[2]==='W'?-1:1);if(hours<0||Math.abs(latitude)>90||Math.abs(longitude)>180)continue;
    rows.push({cycle,hours,validAt,latitude,longitude,windKt:numeric(c[8],1,250),pressureMb:numeric(c[9],800,1100)});
  }
  const latest=rows.map(r=>r.cycle).sort().at(-1),points=[...new Map(rows.filter(r=>r.cycle===latest).map(r=>[r.validAt,r])).values()].sort((a,b)=>a.hours-b.hours);return points.length?{cycle:latest,agency:storm.agency,points}:null;
}
export function sphericalMean(points){
  let x=0,y=0,z=0;for(const p of points){x+=Math.cos(p.latitude*RAD)*Math.cos(p.longitude*RAD);y+=Math.cos(p.latitude*RAD)*Math.sin(p.longitude*RAD);z+=Math.sin(p.latitude*RAD);}
  return {latitude:Math.atan2(z,Math.hypot(x,y))/RAD,longitude:wrapLongitude(Math.atan2(y,x)/RAD)};
}
function stats(values){return values.length?{mean:values.reduce((a,b)=>a+b,0)/values.length,min:Math.min(...values),max:Math.max(...values),count:values.length}:{mean:null,min:null,max:null,count:0};}
export function buildForecast(storm,guidance,{pressureMb=storm.pressureMb,asOf=new Date()}={}){
  const start=Date.parse(storm.validAt),members=guidance.map(g=>({family:g.family,name:g.name,code:g.code,cycle:g.cycle,points:[]})),points=[];
  for(let hours=0;hours<=120;hours+=6){
    const validAt=new Date(start+hours*HOUR).toISOString(),samples=[];
    for(let i=0;i<guidance.length;i++){
      const g=guidance[i],p=interpolate(g.points,start+hours*HOUR);if(!p)continue;
      const latitude=storm.latitude+p.latitude-g.initial.latitude,longitude=wrapLongitude(storm.longitude+wrapLongitude(p.longitude-g.initial.longitude));if(Math.abs(latitude)>90)continue;
      const windKt=storm.windKt!==null&&p.windKt!==null&&g.initial.windKt!==null?Math.max(0,storm.windKt+p.windKt-g.initial.windKt):null;
      const rawPressure=pressureMb!==null&&p.pressureMb!==null&&g.initial.pressureMb!==null?pressureMb+p.pressureMb-g.initial.pressureMb:null;
      const sample={hours,validAt,latitude,longitude,windKt,pressureMb:numeric(rawPressure,800,1100),interpolated:p.interpolated};samples.push(sample);members[i].points.push(sample);
    }
    if(!samples.length)break;
    const center=sphericalMean(samples),wind=stats(samples.filter(p=>p.windKt!==null).map(p=>p.windKt)),pressure=stats(samples.filter(p=>p.pressureMb!==null).map(p=>p.pressureMb));
    points.push({hours,validAt,...center,windKt:wind.mean,pressureMb:pressure.mean,windMinKt:wind.min,windMaxKt:wind.max,pressureMinMb:pressure.min,pressureMaxMb:pressure.max,windCount:wind.count,pressureCount:pressure.count,modelCount:samples.length,trackSpreadKm:Math.max(...samples.map(s=>distanceKm(center,s))),interpolated:samples.some(p=>p.interpolated)});
  }
  // A content fingerprint keeps cached environmental samples on this same path,
  // even when the guidance refreshes without a new advisory timestamp.
  let hash=2166136261;for(const c of JSON.stringify(members)+pressureMb){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619);}const runId=(hash>>>0).toString(16).padStart(8,'0');
  return {version:FORECAST_VERSION,method:FORECAST_METHOD,runId,stormId:storm.id,initializedAt:storm.validAt,retrievedAt:new Date(asOf).toISOString(),sourceUrl:guidanceUrl(storm),verified:false,points,members:members.filter(m=>m.points.length>1),pressureAnchorMb:pressureMb,notes:[
    'Equal-weight changes from one representative per model family, anchored to the current advisory. Families can have different cycles and are not independent.',
    'Six-hour values interpolate available guidance; no extrapolation beyond a model track. Contributors can change with forecast lead.',
    'Wind and pressure changes come from forecast guidance, not an inverted pressure–wind equation. Environmental diagnostics are displayed separately and do not adjust this baseline.',
    'Member ranges are model disagreement, not calibrated probabilities. Historical forecast skill has not been established.'
  ]};
}
export function environmentPlan(forecast){
  const steps=forecast.points.filter(p=>p.hours%24===0),samples=[];for(const point of steps)for(let bearing=0;bearing<360;bearing+=45)samples.push({...destination(point,bearing,500),hours:point.hours,validAt:point.validAt});
  if(!samples.length)throw Error('Forecast track unavailable.');
  const url=new URL(ENVIRONMENT_SOURCE);url.search=new URLSearchParams({latitude:samples.map(p=>p.latitude.toFixed(3)).join(','),longitude:samples.map(p=>p.longitude.toFixed(3)).join(','),hourly:'wind_speed_850hPa,wind_direction_850hPa,wind_speed_200hPa,wind_direction_200hPa,relative_humidity_700hPa,relative_humidity_500hPa,wind_speed_500hPa,wind_direction_500hPa',wind_speed_unit:'kn',models:'gfs_global',start_hour:steps[0].validAt.slice(0,16),end_hour:steps.at(-1).validAt.slice(0,16),temporal_resolution:'hourly_6',timezone:'GMT',cell_selection:'nearest',elevation:samples.map(()=> 'nan').join(',')});
  return {samples,steps,url};
}
export function windVector(speed,direction){if(numeric(speed,0,300)===null||numeric(direction,0,360)===null)return null;return {u:-speed*Math.sin(direction*RAD),v:-speed*Math.cos(direction*RAD)};}
export function parseEnvironment(payload,plan,now=new Date()){
  const records=Array.isArray(payload)?payload:[payload];if(records.length!==plan.samples.length)throw Error('Incomplete environmental grid.');
  const rows=[];for(const step of plan.steps){
    const valid=[];for(let i=0;i<records.length;i++){
      const sample=plan.samples[i];if(sample.hours!==step.hours)continue;const data=records[i],h=data.hourly,units=data.hourly_units;
      if(!h||!units||['850','500','200'].some(level=>units['wind_speed_'+level+'hPa']!=='kn')||units.relative_humidity_700hPa!=='%'||units.relative_humidity_500hPa!=='%')continue;
      const index=h.time?.findIndex(t=>Date.parse(t.endsWith('Z')?t:t+'Z')===Date.parse(step.validAt));if(index===undefined||index<0)continue;
      const vector=level=>windVector(h['wind_speed_'+level+'hPa']?.[index],h['wind_direction_'+level+'hPa']?.[index]),low=vector('850'),high=vector('200'),middle=vector('500'),rh7=numeric(h.relative_humidity_700hPa?.[index],0,100),rh5=numeric(h.relative_humidity_500hPa?.[index],0,100);
      if(low&&high&&middle&&rh7!==null&&rh5!==null)valid.push({du:high.u-low.u,dv:high.v-low.v,rh:(rh7+rh5)/2,u:middle.u,v:middle.v});
    }
    const average=key=>valid.reduce((s,p)=>s+p[key],0)/valid.length,usable=valid.length>=6;
    const shearKt=usable?Math.hypot(average('du'),average('dv')):null;
    rows.push({hours:step.hours,validAt:step.validAt,latitude:step.latitude,longitude:step.longitude,shearKt,shearTowards:shearKt>.1?(Math.atan2(average('du'),average('dv'))/RAD+360)%360:null,humidityPct:usable?average('rh'):null,flow500Kt:usable?Math.hypot(average('u'),average('v')):null,flow500Towards:usable?(Math.atan2(average('u'),average('v'))/RAD+360)%360:null,samples:valid.length,totalSamples:8});
  }
  if(!rows.some(r=>r.shearKt!==null))throw Error('GFS fields unavailable.');
  return {source:'NOAA GFS via Open-Meteo',sourceUrl:'https://open-meteo.com/en/docs/gfs-api',retrievedAt:new Date(now).toISOString(),modelCycle:null,ringKm:500,rows,method:'Eight points on a 500-km ring around the forecast center. Shear is the magnitude of the mean 200–850 hPa vector difference. Humidity is the mean of 700 and 500 hPa. At least six valid ring samples are required. The 500-hPa flow is a diagnostic, not a track prediction. The distributor does not return a model cycle.'};
}
export function marinePlan(forecast){
  const steps=forecast.points.filter(p=>p.hours%24===0);if(!steps.length)throw Error('Forecast track unavailable.');const url=new URL('https://marine-api.open-meteo.com/v1/marine');
  url.search=new URLSearchParams({latitude:steps.map(p=>p.latitude.toFixed(3)).join(','),longitude:steps.map(p=>p.longitude.toFixed(3)).join(','),hourly:'sea_surface_temperature',start_hour:steps[0].validAt.slice(0,16),end_hour:steps.at(-1).validAt.slice(0,16),timezone:'GMT',temporal_resolution:'hourly_6',cell_selection:'nearest'});return {steps,url};
}
export function parseMarine(payload,plan){
  const records=Array.isArray(payload)?payload:[payload];if(records.length!==plan.steps.length)throw Error('Incomplete ocean forecast.');
  return plan.steps.map((p,i)=>{const data=records[i],h=data.hourly,index=h?.time?.findIndex(t=>Date.parse(t.endsWith('Z')?t:t+'Z')===Date.parse(p.validAt)),value=index>=0&&data.hourly_units?.sea_surface_temperature==='°C'?numeric(h.sea_surface_temperature?.[index],-3,45):null;
    // Nearest-grid selection keeps inland nulls; reject an unexpected remote sea cell.
    const nearby=numeric(data.latitude,-90,90)!==null&&numeric(data.longitude,-180,180)!==null&&distanceKm(p,{latitude:data.latitude,longitude:data.longitude})<25;
    return {temperatureC:nearby?value:null,sstValidAt:p.validAt,oceanStatus:nearby&&value!==null?'available':'missing'};
  });
}
