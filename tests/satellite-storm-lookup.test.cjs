const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const model=import(pathToFileURL(path.join(__dirname,'../satellite-storm-lookup.js')).href);
const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../satellite-tracks/2023.json'),'utf8'));

test('the NOAA CSV export parser preserves quoted commas, empty cells and column names',async()=>{
  const {csvFields}=await import(pathToFileURL(path.join(__dirname,'../scripts/refresh-satellite-tracks.mjs')).href);
  assert.deepEqual(csvFields('SID,NAME,LAT,LON'),['SID','NAME','LAT','LON']);
  assert.deepEqual(csvFields('"quoted, name", ,"a""b",-112.4'),['quoted, name','','a"b','-112.4']);
});

test('the supplied Jova command resolves the NOAA USA position and contemporary GOES satellite',async()=>{
  const m=await model,q=m.parseStormCommand('!mcfetch_nc Jova 2023 0000 07/09/2023'),matches=m.findStorms(data.rows,q);
  assert.deepEqual(q,{query:'Jova',year:2023,date:'2023-09-07',time:'00:00'});
  assert.equal(matches.length,1);assert.equal(matches[0].id,'2023248N12257');
  assert.deepEqual(m.positionAt(matches[0],q.date,q.time),{latitude:15.3,longitude:-112.4,method:'record',source:'IBTrACS USA position',times:['2023-09-07T00:00:00.000Z']});
  assert.equal(m.suggestSatellite(q.date,-112.4),'GOES18');
});
test('designation, ATCF and SID select the same storm without substring name collisions',async()=>{
  const m=await model;
  for(const query of ['11E','EP112023','EP11','2023248N12257','Hurricane Jova'])assert.equal(m.findStorms(data.rows,{query,year:2023,date:'2023-09-07'})[0].name,'JOVA');
  assert.equal(m.findStorms(data.rows,{query:'Jo',year:2023,date:'2023-09-07'}).length,0);
  assert.equal(m.findStorms(data.rows,{query:'Jova',year:2023,date:'2023-10-07'}).length,0);
});
test('command dates mean day/month/year and reject impossible dates, times and arbitrary command text',async()=>{
  const {parseStormCommand:p}=await model;
  assert.equal(p('!mcfetch_nc Jova 2023 0000 07/09/2023 1.').date,'2023-09-07');
  assert.equal(p('!mcfetch_nc "Kong-rey" 2018 1205 30/09/2018 bd').time,'12:05');
  for(const text of ['!mcfetch_nc Jova 2023 2400 07/09/2023','!mcfetch_nc Jova 2023 0061 07/09/2023','!mcfetch_nc Jova 2023 0000 31/02/2023','fetch("other.test")'])assert.throws(()=>p(text));
});
test('interpolation follows the dateline rather than crossing the world',async()=>{
  const {positionAt}=await model,start=Date.parse('2023-01-01T00:00:00Z')/60000;
  const s={start,points:[[0,10,179,0],[180,12,-179,0]]},p=positionAt(s,'2023-01-01','01:30');
  assert.equal(p.latitude,11);assert.equal(p.longitude,-180);assert.equal(p.method,'interpolated');assert.equal(p.times.length,2);
});
test('missing USA positions are labelled as merged; gaps, source changes and extrapolation are refused',async()=>{
  const {positionAt}=await model,start=Date.parse('2023-01-01T00:00:00Z')/60000;
  const s={start,points:[[0,10,100,1],[180,12,101,1]]};assert.equal(positionAt(s,'2023-01-01','01:30').source,'IBTrACS merged position');
  assert.throws(()=>positionAt(s,'2022-12-31','23:59'),/outside/);assert.throws(()=>positionAt(s,'2023-01-01','03:01'),/outside/);
  assert.throws(()=>positionAt({...s,points:[[0,10,100,0],[420,12,101,0]]},'2023-01-01','01:30'),/gap/);
  assert.throws(()=>positionAt({...s,points:[[0,10,100,0],[180,12,101,1]]},'2023-01-01','01:30'),/sources change/);
});
test('duplicate names remain ambiguous instead of silently picking the first track',async()=>{
  const m=await model,s=data.rows.find(r=>r.name==='JOVA');
  assert.equal(m.findStorms([s,{...s,id:'other'}],{query:'Jova',year:2023,date:'2023-09-07'}).length,2);
});
test('year data is fetched once, failed requests retry, and an invalid year cannot form a URL',async()=>{
  const {createTrackLoader}=await model;let calls=0;
  const load=createTrackLoader(async url=>{calls++;assert.equal(url,'satellite-tracks/2023.json');return {ok:calls>1,json:async()=>data};});
  await assert.rejects(load(2023));assert.equal((await load(2023)).length,data.rows.length);await load(2023);assert.equal(calls,2);
  await assert.rejects(load('../other'));assert.equal(calls,2);
});
test('historical and regional satellites are suggested without assigning modern satellites before their era',async()=>{
  const {suggestSatellite:s}=await model;
  assert.equal(s('1992-11-21',156),'GMS4');assert.equal(s('2004-06-18',130),'GOES9');assert.equal(s('2010-10-17',123),'MTSAT2');assert.equal(s('2013-11-07',128),'MTSAT2');
  assert.equal(s('2016-09-13',122),'HIMAWARI8');assert.equal(s('2026-07-01',130),'HIMAWARI9');assert.equal(s('2018-08-07',-130),'GOES15');assert.equal(s('2025-10-01',-75),'GOES19');
  assert.equal(s('1975-01-01',130),'');
});
