const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{gunzipSync}=require('node:zlib'),{pathToFileURL}=require('node:url');
const mod=n=>import(pathToFileURL(path.join(__dirname,'../'+n+'.js')).href),at='2005-02-16T06:00:00Z',sid='2005041S13181';
const source=gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/noaa-prmsl-20050216T0600Z.ascii.gz'))).toString('utf8');
const gridPromise=mod('poci-roci-model').then(m=>m.parsePressureAscii(source,at));

test('Gay 1992 defaults to the supplied chart’s 5-mb isobars instead of silently selecting an intervening 2-mb contour',async()=>{
  const {parseNoaaPressureSubset}=await mod('noaa-pressure-subset'),api=await mod('api/poci-roci'),m=await mod('poci-roci-model'),at='1992-11-21T00:00:00Z';
  const grid=parseNoaaPressureSubset(gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/noaa-prmsl-19921121T0000Z.nc.gz'))),at);
  const data=await api.analyzeTime('1992-11-21','0000',{sid:'1992318N06182',readField:async()=>grid}),gay=data.results[0];
  assert.equal(data.contourIntervalMb,5);assert.equal(gay.pociMb,1005);assert.equal(gay.nextContourMb,1010);assert.equal(gay.contourIntervalMb,5);assert.ok(Math.abs(gay.rociNmi-248.6313)<.0001);assert.equal(gay.termination,'merged');
  assert.equal(gay.track.at,at);assert.equal(gay.track.reportedPociMb,null);assert.equal(gay.center.lat,12);assert.equal(gay.center.lon,156);assert.equal(data.chart.intervalMb,5);
  const finer=m.extractPociRoci(grid,gay.track,{interval:2});assert.equal(finer.pociMb,1008);assert.ok(Math.abs(finer.rociNmi-377.4425)<.0001);assert.equal(finer.contourIntervalMb,2);
  const {noaaPressureChartUrl}=await mod('noaa-pressure-chart'),url=new URL(noaaPressureChartUrl('1992-11-21','0000',{interval:data.chart.intervalMb,lowMb:data.chart.lowMb,highMb:data.chart.highMb}));
  assert.equal(url.searchParams.get('contourLevel'),'custom');assert.equal(url.searchParams.get('cint'),'500');assert.ok(Number(url.searchParams.get('lowr'))<=Math.min(...grid.values.flat())*100);assert.ok(Number(url.searchParams.get('highr'))>=Math.max(...grid.values.flat())*100);
});
test('NOAA date requests use Gregorian UTC indices, the correct historical directory, and only available 3-hour observations',async()=>{
  const m=await mod('poci-roci-model');assert.equal(m.validateAnalysisTime('2005-02-16','0600').index,370);assert.equal(m.validateAnalysisTime('2004-03-01','0600').index,482);assert.equal(m.validateAnalysisTime('2015-12-31','2100').index,2919);
  assert.match(m.pressureDataUrl('1973-10-06','1200'),/miscSI\/prmsl\.1973/);assert.match(m.pressureDataUrl('2005-02-16','0600'),/miscMO\/prmsl\.2005/);assert.ok(decodeURIComponent(m.pressureDataUrl('2005-02-16','0600')).endsWith('prmsl[370:1:370][0:1:180][0:1:359]'));
  for(const [date,time]of [['2005-02-29','0600'],['2016-01-01','0000'],['1805-12-31','2100'],['2005-02-16','1201'],['2005-02-16','2400'],['../../secret','0000']])assert.throws(()=>m.validateAnalysisTime(date,time));
});
test('NOAA ASCII parsing verifies time and actual coordinate order, preserving the Pa-to-hPa conversion',async()=>{
  const m=await mod('poci-roci-model'),grid=await gridPromise;assert.equal(grid.lat[0],-90);assert.equal(grid.lat[180],90);assert.equal(grid.lon[359],359);assert.equal(grid.values[78][189],947.5619);
  assert.throws(()=>m.parsePressureAscii(source,'2005-02-16T09:00:00Z'),/time/);assert.throws(()=>m.parsePressureAscii(source.replace(/^\[0\]\[50\].*$/m,''),at),/coordinates/);assert.throws(()=>m.parsePressureAscii(source.replace('94756.19','-9.96921e36'),at),/invalid pressure grid/);
});
test('Olaf benchmark matches independent ContourPy geometry and geodesic-radius calculations',async()=>{
  const m=await mod('poci-roci-model'),grid=await gridPromise,result=m.extractPociRoci(grid,{lat:-12.7,lon:-171.2});assert.equal(result.status,'estimated');assert.equal(result.pociMb,1002);assert.equal(result.nextContourMb,1004);assert.equal(Math.round(result.rociNmi),430);assert.equal(result.radiusMinNmi,298);assert.equal(result.radiusMaxNmi,609);assert.equal(result.center.lat,-12);assert.equal(result.center.lon,-171);
  const independent={1000:325.3651,1002:429.8965};for(const level of [1000,1002]){const ring=m.pressureContours(result.region,level).find(r=>r.closed&&m.containsPoint(r.points,[-171,-12]));assert.ok(ring);assert.ok(Math.abs(m.contourRadius(ring.points,{lat:-12,lon:-171}).meanNmi-independent[level])<.01);assert.equal(m.containsPoint(ring.points,[-159,-23]),false);}
  const merged=m.pressureContours(result.region,1004).find(r=>r.closed&&m.containsPoint(r.points,[-171,-12]));assert.ok(m.containsPoint(merged.points,[-159,-23]));
});
test('dateline representations produce the same pressure basin instead of a world-spanning radius',async()=>{
  const m=await mod('poci-roci-model'),grid=await gridPromise,a=m.extractPociRoci(grid,{lat:-12.7,lon:-171.2}),b=m.extractPociRoci(grid,{lat:-12.7,lon:188.8});assert.equal(a.pociMb,b.pociMb);assert.equal(a.rociNmi,b.rociNmi);assert.ok(Math.max(...b.contour.map(p=>p[0]))-Math.min(...b.contour.map(p=>p[0]))<30);
});
test('mean contour radius is a geodesic radius, not a diameter or a degrees-to-km shortcut',async()=>{
  const m=await mod('poci-roci-model'),center={lat:30,lon:179},distance=370.4,angle=distance/m.EARTH_KM,phi=center.lat*Math.PI/180,lambda=center.lon*Math.PI/180;
  const ring=Array.from({length:360},(_,i)=>{const theta=i*Math.PI/180,lat=Math.asin(Math.sin(phi)*Math.cos(angle)+Math.cos(phi)*Math.sin(angle)*Math.cos(theta)),lon=lambda+Math.atan2(Math.sin(theta)*Math.sin(angle)*Math.cos(phi),Math.cos(angle)-Math.sin(phi)*Math.sin(lat));return [lon*180/Math.PI,lat*180/Math.PI];});
  const radius=m.contourRadius(ring,center);assert.ok(Math.abs(radius.meanNmi-200)<.001);assert.ok(Math.abs(radius.maxNmi-200)<.001);
});
test('flat fields and low centers outside the track search range never yield invented POCI / ROCI',async()=>{
  const m=await mod('poci-roci-model'),grid=await gridPromise,flat={...grid,values:grid.values.map(row=>row.map(()=>1010))};const result=m.extractPociRoci(flat,{lat:0,lon:0});assert.equal(result.status,'unresolved');assert.equal(result.pociMb,undefined);assert.equal(result.rociNmi,undefined);
  assert.throws(()=>m.extractPociRoci(grid,{lat:80,lon:0}),/valid tropical/);assert.throws(()=>m.extractPociRoci(grid,{lat:-12.7,lon:-171.2},{interval:10}),/2-mb/);
});
test('marching squares connects open contours and resolves diagonal saddles without creating a false closed low',async()=>{
  const {pressureContours}=await mod('poci-roci-model'),plane={lon:[0,1,2],lat:[0,1,2],values:[[0,1,2],[0,1,2],[0,1,2]]},lines=pressureContours(plane,.5);assert.equal(lines.length,1);assert.equal(lines[0].closed,false);assert.ok(lines[0].points.every(p=>Math.abs(p[0]-.5)<1e-6));
  const saddle={lon:[0,1],lat:[0,1],values:[[0,3],[3,0]]};assert.ok(pressureContours(saddle,1).every(r=>!r.closed));
});
test('date-only API identifies Olaf and Nancy, while a SID query isolates the selected cyclone',async()=>{
  const api=await mod('api/poci-roci'),grid=await gridPromise,all=await api.analyzeTime('2005-02-16','0600',{interval:2,readField:async()=>grid});assert.deepEqual(all.results.map(r=>r.name),['OLAF','NANCY']);assert.equal(all.results[0].pociMb,1002);assert.equal(all.results[0].track.pressureMb,892);assert.equal(all.results[0].track.reportedPociMb,null);
  const one=await api.analyzeTime('2005-02-16','0600',{sid,interval:2,readField:async()=>grid});assert.equal(one.results.length,1);assert.equal(one.results[0].sid,sid);await assert.rejects(api.analyzeTime('2005-02-16','0600',{sid:'2013306N07162',readField:async()=>{throw Error('Must not fetch');}}),/no track/);
  const bad=await api.default.fetch(new Request('https://site.test/api/poci-roci?date=2026-11-09&time=1200'));assert.equal(bad.status,400);
});
test('explicit CKZ transfer changes only the derived environment/size, never the actual intensity, latitude or motion',async()=>{
  const c=await mod('poci-roci-client'),preset={fields:{pressureMb:'892',windKnots:'145',latitude:'-12.7',motionKnots:'14.04',environmentMb:'',radiusNmi:'',knackRociNmi:''},missing:['POCI / environmental pressure','ROCI'],poci:null},data={at,results:[{sid,status:'estimated',pociMb:1002,rociNmi:430,track:{at,interpolated:false}}]},derived=c.applyDerivedCkz(preset,data,sid);
  assert.equal(derived.fields.environmentMb,'1002');assert.equal(derived.fields.knackRociNmi,'430');assert.equal(derived.fields.pressureMb,'892');assert.equal(derived.fields.latitude,'-12.7');assert.equal(derived.fields.motionKnots,'14.04');assert.deepEqual(derived.missing,[]);assert.match(derived.pressureSource,/NOAA 20CRv3/);assert.equal(preset.fields.environmentMb,'');
  const link=c.analysisCkzLink(data.results[0]);assert.equal(new URL(link,'https://site.test').searchParams.get('pressureSource'),'20cr');assert.equal(c.analysisCkzLink({...data.results[0],track:{at,interpolated:true}}),null);assert.throws(()=>c.applyDerivedCkz(preset,{...data,results:[{...data.results[0],status:'unresolved'}]},sid),/did not return/);
});
test('NOAA rate limits return a clear retry message and stop further upstream requests during the cooldown',async()=>{
  const api=await mod('api/poci-roci'),originalFetch=global.fetch;let requests=0;
  global.fetch=async()=>{requests++;return new Response('',{status:429,headers:{'Retry-After':'120'}});};
  try{
    const first=await api.default.fetch(new Request('https://site.test/api/poci-roci?date=2005-02-16&time=0600'));
    assert.equal(first.status,503);assert.match((await first.json()).error,/temporarily limiting/);assert.ok(Number(first.headers.get('Retry-After'))>0);
    const second=await api.default.fetch(new Request('https://site.test/api/poci-roci?date=2005-02-16&time=0900'));
    assert.equal(second.status,503);assert.equal(requests,1);
  }finally{global.fetch=originalFetch;}
});

test('Durian and Haiyan retain their last closed isobar when the next contour is open on the full globe',async()=>{
  const m=await mod('poci-roci-model');
  for(const c of [{fixture:'20061129T1200Z',at:'2006-11-29T12:00:00Z',position:{lat:13.3,lon:126.2},center:{lat:13,lon:127},radius:291.773566,rounded:292},{fixture:'20131107T1200Z',at:'2013-11-07T12:00:00Z',position:{lat:10.2,lon:129},center:{lat:10,lon:129},radius:464.024661,rounded:464}]){
    const source=gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/noaa-prmsl-'+c.fixture+'.ascii.gz'))).toString('utf8'),grid=m.parsePressureAscii(source,c.at),result=m.extractPociRoci(grid,c.position);
    assert.equal(result.status,'estimated');assert.equal(result.termination,'open');assert.equal(result.pociMb,1008);assert.equal(result.nextContourMb,1010);assert.equal(Math.round(result.rociNmi),c.rounded);assert.equal(result.center.lat,c.center.lat);assert.equal(result.center.lon,c.center.lon);assert.ok(Math.abs(m.contourRadius(result.contour,c.center).meanNmi-c.radius)<.01);assert.equal(result.pendingContour,undefined);
  }
});

test('a large closed isobar clipped by the regional window is not mistaken for a genuinely open global isobar',async()=>{
  const m=await mod('poci-roci-model'),original=await gridPromise,grid={...original,values:original.lat.map(lat=>original.lon.map(lon=>900+.01*(lat*lat+(((lon+180)%360)-180)**2)))};
  const result=m.extractPociRoci(grid,{lat:0,lon:0});assert.equal(result.status,'boundary-limited');assert.equal(result.pociMb,undefined);assert.equal(result.rociNmi,undefined);
});

test('Haiyan 18Z resolves a global merger outside the regional chart and keeps its own reported values',async()=>{
  const m=await mod('poci-roci-model'),{parseNoaaPressureSubset}=await mod('noaa-pressure-subset'),api=await mod('api/poci-roci'),at='2013-11-07T18:00:00Z';
  const grid=parseNoaaPressureSubset(gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/noaa-prmsl-20131107T1800Z.nc.gz'))),at),data=await api.analyzeTime('2013-11-07','1800',{interval:2,readField:async()=>grid}),result=data.results.find(r=>r.name==='HAIYAN');
  assert.equal(result.status,'estimated');assert.equal(result.termination,'merged');assert.equal(result.pociMb,1006);assert.equal(result.nextContourMb,1008);assert.equal(Math.round(result.rociNmi),575);assert.equal(result.track.reportedPociMb,1000);assert.equal(result.track.reportedRociNmi,220);assert.equal(result.track.at,at);
  // The globally verified 1008-mb contour encloses a distinct low over Australia;
  // it cannot be assigned to Haiyan alone. The last isolated contour is 1006 mb.
  const world=m.regionalGrid(grid,{lat:0,lon:150},60),enclosing=m.pressureContours(world,1008).find(l=>l.closed&&m.containsPoint(l.points,[127,10]));
  assert.ok(enclosing);assert.equal(m.containsPoint(enclosing.points,[126,-20]),true);assert.equal(m.containsPoint(result.contour,[126,-20]),false);
});

test('Zeb and Rita continue beyond a clipped regional window and match independent full-global ContourPy radii',async()=>{
  const m=await mod('poci-roci-model'),{parseNoaaPressureSubset}=await mod('noaa-pressure-subset'),api=await mod('api/poci-roci');
  for(const c of [
    {sid:'1998281N11151',at:'1998-10-13T18:00:00Z',file:'19981013T1800Z',poci:1008,next:1010,radius:787.6138117092398,termination:'open',center:{lat:17,lon:124}},
    {sid:'1978288N10185',at:'1978-10-23T06:00:00Z',file:'19781023T0600Z',poci:1010,next:1012,radius:1476.4501164955514,termination:'merged',center:{lat:12,lon:147}}
  ]){
    const grid=parseNoaaPressureSubset(gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/noaa-prmsl-'+c.file+'.nc.gz'))),c.at),data=await api.analyzeTime(c.at.slice(0,10),c.at.slice(11,13)+'00',{sid:c.sid,interval:2,readField:async()=>grid}),result=data.results[0];
    assert.equal(result.status,'estimated');assert.equal(result.pociMb,c.poci);assert.equal(result.nextContourMb,c.next);assert.equal(result.termination,c.termination);assert.equal(Math.round(result.rociNmi),Math.round(c.radius));assert.ok(Math.abs(m.contourRadius(result.contour,c.center).meanNmi-c.radius)<.01);assert.equal(result.pendingContour,undefined);
    const original=m.regionalGrid(grid,result.track,40);
    assert.ok(result.contour.some(([x,y])=>x<original.lon[0]||x>original.lon.at(-1)||y<original.lat[0]||y>original.lat.at(-1)));
    // The expanded display region must contain the complete selected isobar.
    assert.ok(result.contour.every(([x,y])=>x>=result.region.lon[0]&&x<=result.region.lon.at(-1)&&y>=result.region.lat[0]&&y<=result.region.lat.at(-1)));
    assert.equal(m.containsPoint(result.contour,[c.center.lon,c.center.lat]),true);
    if(c.termination==='merged'){
      const lon=Array.from({length:361},(_,i)=>c.center.lon-180+i),lat=grid.lat.slice(1,-1),world={lon,lat,values:lat.map(y=>lon.map(x=>grid.values[y+90][((x%360)+360)%360]))},next=m.pressureContours(world,c.next).find(l=>l.closed&&m.containsPoint(l.points,[c.center.lon,c.center.lat]));
      assert.ok(next);assert.equal(m.containsPoint(next.points,[206,16]),true);assert.equal(m.containsPoint(result.contour,[206,16]),false);
    }
  }
});

test('Durian API returns its chart-derived outer isobar while preserving the observed best-track central pressure',async()=>{
  const m=await mod('poci-roci-model'),api=await mod('api/poci-roci'),raw=gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/noaa-prmsl-20061129T1200Z.ascii.gz'))).toString('utf8'),grid=m.parsePressureAscii(raw,'2006-11-29T12:00:00Z'),data=await api.analyzeTime('2006-11-29','1200',{interval:2,readField:async()=>grid}),durian=data.results.find(r=>r.name==='DURIAN');
  assert.equal(durian.pociMb,1008);assert.equal(Math.round(durian.rociNmi),292);assert.equal(durian.track.pressureMb,904);assert.equal(durian.center.pressureMb,968.1);
});
