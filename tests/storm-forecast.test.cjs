const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const m=import(pathToFileURL(path.join(__dirname,'../storm-forecast-model.js')).href);
const api=import(pathToFileURL(path.join(__dirname,'../api/live-storms.js')).href);
const fixture=n=>fs.readFileSync(path.join(__dirname,'fixtures/live-storms',n+'.txt'),'utf8');
const now=new Date('2026-11-08T18:00:00Z');
const storm={id:'WP312026',latitude:22.4,longitude:136.5,windKt:65,pressureMb:989,validAt:'2026-11-08T12:00:00.000Z',agency:'JTWC',forecast:[]};
const record=(code,cycle,h,lat,lon,wind=60,p=990)=>`WP,31,${cycle},03,${code},${h},${lat},${lon},${wind},${p}`;
test('real guidance selects one representative per family, uses recent cycles, and excludes official forecasts from the blend',async()=>{
  const model=await m,g=model.parseGuidance(fixture('awp312026'),storm,now);assert.deepEqual(g.map(v=>v.code),['AEMN','UKM','CMC','NGX']);assert.equal(g[0].cycle,'2026-11-08T06:00:00.000Z');assert.equal(g[1].cycle,'2026-11-08T00:00:00.000Z');
  const cp={...storm,id:'CP042026',latitude:11.6,longitude:-156.1,windKt:40,pressureMb:1002,validAt:'2026-11-08T15:00:00.000Z',agency:'CPHC / NHC'};const models=model.parseGuidance(fixture('acp042026'),cp,now);assert.equal(models.filter(g=>g.family==='hafs').length,1);assert.equal(models.some(g=>g.code==='OFCL'),false);
  const official=model.officialGuidance(fixture('acp042026'),cp);assert.equal(official.cycle,'2026-11-08T12:00:00.000Z');assert.equal(official.points[0].hours,0);assert.equal(official.points[0].pressureMb,1002);assert.equal(official.points[1].hours,9);assert.equal(official.points[1].validAt,'2026-11-09T00:00:00.000Z');
});
test('cycles later than the advisory or as-of time and negative lead analyses cannot leak into the baseline',async()=>{
  const model=await m,lines=[record('AVNO','2026110818',0,'224N','1365E'),record('AVNO','2026110818',24,'234N','1375E'),record('CARQ','2026110812',24,'234N','1375E'),record('AVNO','2026110812',-6,'224N','1365E')].join('\n');assert.equal(model.parseGuidance(lines,storm,now).length,0);
  assert.equal(model.parseGuidance(fixture('awp312026'),storm,new Date('2026-11-07T00:00Z')).length,0);
});
test('guidance from another storm, stale cycles and remote centers is rejected',async()=>{
  const model=await m,lines=[record('AVNO','2026110600',0,'224N','1365E'),record('AVNO','2026110600',72,'234N','1375E'),record('AVNO','2026110812',0,'600N','0500W'),record('AVNO','2026110812',24,'610N','0500W')].join('\n');assert.equal(model.parseGuidance(lines,storm,now).length,0);assert.equal(model.parseGuidance(fixture('acp042026'),storm,now).length,0);assert.throws(()=>model.guidanceUrl({id:'../secret'}));
});
test('change consensus anchors exactly to the advisory and preserves independently predicted wind and pressure changes',async()=>{
  const model=await m,text=[record('AVNO','2026110812',0,'220N','1360E',50,1000),record('AVNO','2026110812',24,'230N','1370E',70,980),record('CMC','2026110812',0,'224N','1365E',55,995),record('CMC','2026110812',24,'244N','1385E',65,985)].join('\n'),g=model.parseGuidance(text,storm,now),f=model.buildForecast(storm,g,{asOf:now}),p=f.points.find(p=>p.hours===24);
  assert.equal(f.points[0].windKt,65);assert.equal(f.points[0].pressureMb,989);assert.equal(p.windKt,80);assert.equal(p.pressureMb,974);assert.equal(p.windMinKt,75);assert.equal(p.windMaxKt,85);assert.equal(p.pressureCount,2);assert.equal(f.verified,false);assert.equal(f.points.at(-1).hours,24);assert.equal(f.points.length,5);assert.ok(f.notes.some(v=>v.includes('not calibrated')));
});
test('radii duplicates do not count as extra forecast models',async()=>{
  const model=await m,text=[record('AVNO','2026110812',0,'224N','1365E'),record('AVNO','2026110812',24,'234N','1375E')].join('\n'),g=model.parseGuidance(text+'\n'+text,storm,now);const f=model.buildForecast(storm,g,{asOf:now});assert.equal(g.length,1);assert.equal(f.points.at(-1).modelCount,1);assert.equal(f.points.at(-1).windCount,1);
});
test('missing pressure stays null instead of becoming zero or a pressure–wind inversion',async()=>{
  const model=await m,g=model.parseGuidance(fixture('awp312026'),storm,now),f=model.buildForecast({...storm,pressureMb:null},g,{asOf:now});assert.ok(f.points.every(p=>p.pressureMb===null&&p.pressureCount===0));
  const partial=model.parseGuidance([record('AVNO','2026110812',0,'224N','1365E',60,0),record('AVNO','2026110812',24,'234N','1375E',70,0)].join('\n'),storm,now);assert.ok(model.buildForecast(storm,partial).points.every(p=>p.pressureMb===null));
});
test('interpolation crosses the dateline locally and never extrapolates a missing forecast tail',async()=>{
  const model=await m,points=[{validAt:'2026-11-08T12:00Z',latitude:10,longitude:179,windKt:50,pressureMb:990},{validAt:'2026-11-09T12:00Z',latitude:12,longitude:-179,windKt:60,pressureMb:980}],mid=model.interpolate(points,Date.parse('2026-11-09T00:00Z'));assert.equal(mid.longitude,-180);assert.equal(mid.latitude,11);assert.equal(mid.windKt,55);assert.equal(mid.interpolated,true);assert.equal(model.interpolate(points,Date.parse('2026-11-10T00:00Z')),null);assert.equal(model.sphericalMean([{latitude:10,longitude:179},{latitude:10,longitude:-179}]).longitude,-180);
});
test('actual 2027 southern-season guidance works at calendar-year 2026 times',async()=>{
  const model=await m,s={...storm,id:'SH032027',latitude:-12.9,longitude:51.3,windKt:35,pressureMb:1008,validAt:'2026-11-08T06:00:00.000Z'},g=model.parseGuidance(fixture('ash032027'),s,now);assert.ok(g.length>=2);assert.equal(model.buildForecast(s,g).points[0].windKt,35);assert.ok(model.guidanceUrl(s).endsWith('ash032027.dat'));
});
function airPayload(plan,{lowSpeed=20,lowDirection=270,highSpeed=30,highDirection=90}={}){return plan.samples.map(p=>({hourly_units:{wind_speed_850hPa:'kn',wind_speed_500hPa:'kn',wind_speed_200hPa:'kn',relative_humidity_700hPa:'%',relative_humidity_500hPa:'%'},hourly:{time:[p.validAt],wind_speed_850hPa:[lowSpeed],wind_direction_850hPa:[lowDirection],wind_speed_200hPa:[highSpeed],wind_direction_200hPa:[highDirection],wind_speed_500hPa:[10],wind_direction_500hPa:[270],relative_humidity_700hPa:[60],relative_humidity_500hPa:[40]}}));}
test('environment samples the moving forecast path at eight geodesic points 500 km from each center',async()=>{
  const model=await m,f=model.buildForecast(storm,model.parseGuidance(fixture('awp312026'),storm,now)),plan=model.environmentPlan(f);assert.equal(plan.samples.length,48);assert.equal(plan.url.hostname,'api.open-meteo.com');assert.equal(plan.url.searchParams.get('models'),'gfs_global');assert.equal(plan.url.searchParams.get('wind_speed_unit'),'kn');for(const sample of plan.samples){const center=plan.steps.find(p=>p.hours===sample.hours);assert.ok(Math.abs(model.distanceKm(sample,center)-500)<.01);}
});
test('shear uses vector differences, humidity uses 700/500 hPa and 500-hPa flow reports the towards bearing',async()=>{
  const model=await m,plan=model.environmentPlan({points:[{...storm,hours:0}]}),result=model.parseEnvironment(airPayload(plan),plan,now);assert.equal(result.rows[0].shearKt,50);assert.equal(result.rows[0].humidityPct,50);assert.equal(result.rows[0].flow500Towards,90);assert.equal(result.rows[0].samples,8);assert.equal(result.modelCycle,null);
  const equal=model.parseEnvironment(airPayload(plan,{highSpeed:20,highDirection:270}),plan,now);assert.equal(equal.rows[0].shearKt,0);
  assert.equal(result.rows[0].shearTowards,270);assert.equal(equal.rows[0].shearTowards,null);
});
test('fewer than six valid environmental samples, wrong units or misaligned valid times cannot become plausible diagnostics',async()=>{
  const model=await m,plan=model.environmentPlan({points:[{...storm,hours:0}]}),data=airPayload(plan);for(let i=0;i<3;i++)data[i].hourly.wind_speed_200hPa=[null];assert.throws(()=>model.parseEnvironment(data,plan),/unavailable/);
  data[2]=airPayload(plan)[2];assert.equal(model.parseEnvironment(data,plan).rows[0].samples,6);for(const r of data)r.hourly_units.wind_speed_850hPa='km/h';assert.throws(()=>model.parseEnvironment(data,plan),/unavailable/);assert.throws(()=>model.parseEnvironment([],plan),/Incomplete/);
});
test('ocean forecast selects the matching future valid time and keeps missing or remote land-adjacent grid values null',async()=>{
  const model=await m,plan=model.marinePlan({points:[{...storm,hours:0}]}),row={latitude:22.4,longitude:136.5,hourly_units:{sea_surface_temperature:'°C'},hourly:{time:[storm.validAt,'2026-11-09T12:00Z'],sea_surface_temperature:[28.3,26]}};
  assert.equal(model.parseMarine([row],plan)[0].temperatureC,28.3);row.hourly.sea_surface_temperature[0]=null;assert.equal(model.parseMarine(row,plan)[0].oceanStatus,'missing');row.hourly.sea_surface_temperature[0]=29;row.longitude=140;assert.equal(model.parseMarine(row,plan)[0].temperatureC,null);row.longitude=136.5;row.hourly_units.sea_surface_temperature='K';assert.equal(model.parseMarine(row,plan)[0].temperatureC,null);
});
function fakeRead({noGuidance=false,noAir=false,noOcean=false,calls=[]}={}){return async(url,options={})=>{url=String(url);calls.push({url,options});let body;
  if(url.includes('CurrentStorms'))body=fixture('nhc');else if(url.endsWith('jtwc.rss'))body=fixture('jtwc');else if(url.endsWith('floaters.html'))body='<html>floater</html>';else if(url.endsWith('wp3126web.txt'))body=fixture('cempaka');else if(url.endsWith('sh0327web.txt'))body=fixture('three');else if(url.endsWith('bwp312026.dat'))body=fixture('wp31-bdeck');else if(url.endsWith('awp312026.dat')){if(noGuidance)return new Response('',{status:503});body=fixture('awp312026');}else if(url.startsWith('https://api.open-meteo.com/')){if(noAir)return new Response('',{status:429});const model=await m,f=model.buildForecast(storm,model.parseGuidance(fixture('awp312026'),storm,now));body=JSON.stringify(airPayload(model.environmentPlan(f)));}else if(url.startsWith('https://marine-api.open-meteo.com/')){if(noOcean)return new Response('',{status:503});const model=await m,f=model.buildForecast(storm,model.parseGuidance(fixture('awp312026'),storm,now));body=JSON.stringify(model.marinePlan(f).steps.map(p=>({latitude:p.latitude,longitude:p.longitude,hourly_units:{sea_surface_temperature:'°C'},hourly:{time:[p.validAt],sea_surface_temperature:[28]}})));}else return new Response('',{status:404});return new Response(body,{headers:{'Content-Type':'application/json'}});
};}
test('forecast API uses bounded public guidance, exact matching pressure anchors and coalesced cache',async()=>{
  const {createLiveStormsHandler}=await api,calls=[],handler=createLiveStormsHandler({read:fakeRead({calls}),now:()=>now}),url='https://test/api/live-storms?view=forecast&storm=WP312026';const result=await Promise.all([handler.fetch(new Request(url)),handler.fetch(new Request(url))]);for(const r of result){assert.equal(r.status,200);const d=await r.json();assert.equal(d.pressureAnchorMb,989);assert.equal(d.points.length,21);assert.equal(d.official.agency,'JTWC');assert.equal(d.verified,false);}const decks=calls.filter(c=>c.url.endsWith('awp312026.dat'));assert.equal(decks.length,1);assert.equal(decks[0].options.headers.Range,'bytes=-3000000');assert.match(result[0].headers.get('Cache-Control'),/max-age=300/);
});
test('an environmental source outage leaves guidance usable and unavailable SST is distinct from a land pixel',async()=>{
  const {createLiveStormsHandler}=await api,handler=createLiveStormsHandler({read:fakeRead({noAir:true,noOcean:true}),now:()=>now});const r=await handler.fetch(new Request('https://test/api/live-storms?view=environment&storm=WP312026'));assert.equal(r.status,200);const d=await r.json();assert.equal(d.airAvailable,false);assert.equal(d.oceanAvailable,false);assert.ok(d.rows.every(r=>r.shearKt===null&&r.temperatureC===null&&r.oceanStatus==='unavailable'));assert.equal((await handler.fetch(new Request('https://test/api/live-storms?view=forecast&storm=WP312026'))).status,200);
});
test('environment API combines real-source-style diagnostics at the forecast times',async()=>{
  const {createLiveStormsHandler}=await api,handler=createLiveStormsHandler({read:fakeRead(),now:()=>now}),r=await handler.fetch(new Request('https://test/api/live-storms?view=environment&storm=WP312026'));assert.equal(r.status,200);const d=await r.json();assert.equal(d.airAvailable,true);assert.equal(d.oceanAvailable,true);assert.equal(d.rows.length,6);assert.equal(d.rows[1].hours,24);assert.equal(d.rows[1].shearKt,50);assert.equal(d.rows[1].temperatureC,28);
});

test('environment schema revision gives direction-aware clients a distinct validated CDN URL',async()=>{
  const {createLiveStormsHandler}=await api,handler=createLiveStormsHandler({read:fakeRead(),now:()=>now});
  const url='https://test/api/live-storms?view=environment&storm=WP312026&schema=2',r=await handler.fetch(new Request(url));
  assert.equal(r.status,200);assert.equal((await r.json()).rows[0].shearTowards,270);
  assert.equal((await handler.fetch(new Request(url.replace('schema=2','schema=3')))).status,400);
  assert.equal((await handler.fetch(new Request(url+'&schema=2'))).status,400);
  assert.equal((await handler.fetch(new Request(url.replace('view=environment','view=forecast')))).status,400);
});
test('forecast failure never fabricates a fallback prediction and endpoint does not accept arbitrary coordinates or sources',async()=>{
  const {createLiveStormsHandler}=await api,handler=createLiveStormsHandler({read:fakeRead({noGuidance:true}),now:()=>now}),url='https://test/api/live-storms?view=forecast&storm=WP312026';assert.equal((await handler.fetch(new Request(url))).status,503);assert.equal((await handler.fetch(new Request(url+'&latitude=0'))).status,400);assert.equal((await handler.fetch(new Request(url+'&url=https://evil.test'))).status,400);assert.equal((await handler.fetch(new Request(url+'&storm=SH032027'))).status,400);assert.equal((await handler.fetch(new Request(url,{method:'POST'}))).status,405);
});
test('environment cache is bound to the actual guidance path, not just an advisory timestamp',async()=>{
  const model=await m,g=model.parseGuidance(fixture('awp312026'),storm,now),first=model.buildForecast(storm,g,{asOf:now}),same=model.buildForecast(storm,g,{asOf:new Date(+now+1000)});assert.equal(first.runId,same.runId);g[0].points[3].latitude+=1;assert.notEqual(first.runId,model.buildForecast(storm,g).runId);
  const {createLiveStormsHandler}=await api,handler=createLiveStormsHandler({read:fakeRead(),now:()=>now});assert.equal((await handler.fetch(new Request('https://test/api/live-storms?view=environment&storm=WP312026&run=00000000'))).status,409);assert.equal((await handler.fetch(new Request('https://test/api/live-storms?view=environment&storm=WP312026&run=garbage'))).status,400);
});

test('current environmental diagnostics remain available without inventing a forecast when guidance is missing',async()=>{
  const model=await m,{createLiveStormsHandler}=await api,base=fakeRead({noGuidance:true}),plan=model.environmentPlan({points:[{...storm,hours:0}]}),waterPlan=model.marinePlan({points:[{...storm,hours:0}]});
  const read=async(url,options)=>{
    if(String(url).startsWith('https://api.open-meteo.com/'))return new Response(JSON.stringify(airPayload(plan)));
    if(String(url).startsWith('https://marine-api.open-meteo.com/'))return new Response(JSON.stringify(waterPlan.steps.map(p=>({latitude:p.latitude,longitude:p.longitude,hourly_units:{sea_surface_temperature:'°C'},hourly:{time:[p.validAt],sea_surface_temperature:[28]}}))));
    return base(url,options);
  };
  const handler=createLiveStormsHandler({read,now:()=>now}),r=await handler.fetch(new Request('https://test/api/live-storms?view=environment&storm=WP312026'));
  assert.equal(r.status,200);const d=await r.json();assert.equal(d.rows.length,1);assert.equal(d.rows[0].hours,0);assert.equal(d.rows[0].shearKt,50);assert.equal(d.rows[0].shearTowards,270);
  assert.equal((await handler.fetch(new Request('https://test/api/live-storms?view=forecast&storm=WP312026'))).status,503);
  assert.equal((await handler.fetch(new Request('https://test/api/live-storms?view=environment&storm=WP312026&run=00000000'))).status,503);
});
