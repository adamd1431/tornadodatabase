const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{gunzipSync}=require('node:zlib'),{pathToFileURL}=require('node:url');
const mod=n=>import(pathToFileURL(path.join(__dirname,'../'+n+'.js')).href),at='2005-02-16T06:00:00Z',sid='2005041S13181';
const source=gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/noaa-prmsl-20050216T0600Z.ascii.gz'))).toString('utf8');
const gridPromise=mod('poci-roci-model').then(m=>m.parsePressureAscii(source,at));
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
  const m=await mod('poci-roci-model'),grid=await gridPromise,result=m.extractPociRoci(grid,{lat:-12.7,lon:-171.2});assert.equal(result.status,'estimated');assert.equal(result.pociMb,1002);assert.equal(result.nextContourMb,1004);assert.equal(result.rociNmi,430);assert.equal(result.radiusMinNmi,298);assert.equal(result.radiusMaxNmi,609);assert.equal(result.center.lat,-12);assert.equal(result.center.lon,-171);
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
  const api=await mod('api/poci-roci'),grid=await gridPromise,all=await api.analyzeTime('2005-02-16','0600',{readField:async()=>grid});assert.deepEqual(all.results.map(r=>r.name),['OLAF','NANCY']);assert.equal(all.results[0].pociMb,1002);assert.equal(all.results[0].track.pressureMb,892);assert.equal(all.results[0].track.reportedPociMb,null);
  const one=await api.analyzeTime('2005-02-16','0600',{sid,readField:async()=>grid});assert.equal(one.results.length,1);assert.equal(one.results[0].sid,sid);await assert.rejects(api.analyzeTime('2005-02-16','0600',{sid:'2013306N07162',readField:async()=>{throw Error('Must not fetch');}}),/no track/);
  const bad=await api.default.fetch(new Request('https://site.test/api/poci-roci?date=2026-11-09&time=1200'));assert.equal(bad.status,400);
});
test('explicit CKZ transfer changes only the derived environment/size, never the actual intensity, latitude or motion',async()=>{
  const c=await mod('poci-roci-client'),preset={fields:{pressureMb:'892',windKnots:'145',latitude:'-12.7',motionKnots:'14.04',environmentMb:'',radiusNmi:'',knackRociNmi:''},missing:['POCI / environmental pressure','ROCI'],poci:null},data={at,results:[{sid,status:'estimated',pociMb:1002,rociNmi:430,track:{at,interpolated:false}}]},derived=c.applyDerivedCkz(preset,data,sid);
  assert.equal(derived.fields.environmentMb,'1004');assert.equal(derived.fields.knackRociNmi,'430');assert.equal(derived.fields.pressureMb,'892');assert.equal(derived.fields.latitude,'-12.7');assert.equal(derived.fields.motionKnots,'14.04');assert.deepEqual(derived.missing,[]);assert.match(derived.pressureSource,/NOAA 20CRv3/);assert.equal(preset.fields.environmentMb,'');
  const link=c.analysisCkzLink(data.results[0]);assert.equal(new URL(link,'https://site.test').searchParams.get('pressureSource'),'20cr');assert.equal(c.analysisCkzLink({...data.results[0],track:{at,interpolated:true}}),null);assert.throws(()=>c.applyDerivedCkz(preset,{...data,results:[{...data.results[0],status:'unresolved'}]},sid),/did not return/);
});
