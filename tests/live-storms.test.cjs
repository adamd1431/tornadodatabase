const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const model=import(pathToFileURL(path.join(__dirname,'../live-storms-model.js')).href);
const api=import(pathToFileURL(path.join(__dirname,'../api/live-storms.js')).href);
const fixture=name=>fs.readFileSync(path.join(__dirname,'fixtures/live-storms',name+'.txt'),'utf8');
const at=new Date('2026-11-08T18:00:00Z');
test('NHC source preserves published knots and pressure and rejects arbitrary advisory links',async()=>{
  const m=await model,data=JSON.parse(fixture('nhc')),s=m.parseNhc(data)[0];assert.equal(s.id,'CP042026');assert.equal(s.windKt,40);assert.equal(s.pressureMb,1002);assert.equal(s.longitude,-156.1);assert.equal(s.agency,'CPHC / NHC');
  data.activeStorms[0].publicAdvisory.url='javascript:alert(1)';assert.equal(m.parseNhc(data)[0].sourceUrl,m.LIVE_SOURCES.nhc);data.activeStorms[0].pressure='';assert.equal(m.parseNhc(data)[0].pressureMb,null);assert.throws(()=>m.parseNhc({}),/could not/);
});
test('real JTWC RSS discovers warned systems only and retains the southern season ID',async()=>{
  const m=await model,f=m.parseJtwcFeed(fixture('jtwc'));assert.equal(f.products.length,3);assert.deepEqual(f.products.map(p=>p.id),['WP312026','CP042026','SH032027']);assert.equal(f.products[0].image,'https://www.metoc.navy.mil/jtwc/products/31W_081200sair.jpg');assert.equal(f.products.some(p=>/abpw/.test(p.url)),false);
  assert.equal(m.parseJtwcFeed('<rss><link>https://evil.test/jtwc/products/wp3126web.txt</link></rss>').products.length,0);
});
test('JTWC current analysis stays distinct from forecast winds and does not invent pressure',async()=>{
  const m=await model,p=m.parseJtwcFeed(fixture('jtwc')).products[0],s=m.parseJtwcWarning(fixture('cempaka'),p);
  assert.equal(s.windKt,65);assert.equal(s.gustKt,80);assert.equal(s.pressureMb,null);assert.equal(s.latitude,22.4);assert.equal(s.validAt,'2026-11-08T12:00:00.000Z');assert.equal(s.issuedAt,'2026-11-08T15:00:00.000Z');assert.equal(s.forecast[0].windKt,80);assert.equal(s.forecast[0].hours,12);assert.equal(s.forecast[0].validAt,'2026-11-09T00:00:00.000Z');assert.equal(s.forecast.length,7);assert.equal(s.radii34.NE,90);
  assert.throws(()=>m.parseJtwcWarning(fixture('three'),p),/matching/);
});
test('warning timestamps cross months correctly without invalid days rolling forward',async()=>{
  const {nearbyUtc}=await model;assert.equal(nearbyUtc('312100','2026-11-01T00:00Z'),'2026-10-31T21:00:00.000Z');assert.equal(nearbyUtc('010000','2026-12-31T23:00Z'),'2027-01-01T00:00:00.000Z');assert.equal(nearbyUtc('002400',at),null);
});
test('merging keeps agency precedence and excludes old warnings instead of presenting them as current',async()=>{
  const m=await model,nhc=m.parseNhc(JSON.parse(fixture('nhc'))),copy={...nhc[0],agency:'JTWC',pressureMb:900};const rows=m.mergeStorms(nhc,[copy],['04C'],at);assert.equal(rows.length,1);assert.equal(rows[0].agency,'CPHC / NHC');assert.equal(rows[0].pressureMb,1002);assert.equal(rows[0].hasImagery,true);
  assert.equal(m.mergeStorms(nhc,[],[],new Date('2026-11-10T12:00Z')).length,0);assert.equal(m.mergeStorms(nhc,[],[],new Date('2026-11-09T07:00Z'))[0].stale,true);
});
test('satellite product URLs are fixed to known NOAA products and the active storm designation',async()=>{
  const m=await model,s={designation:'31W',hasImagery:true};assert.equal(m.imageUrl(s,'bd'), 'https://ospo.noaa.gov/tropical-floaters/31W/imagery/bd0-lalo.gif');assert.match(m.imageUrl(s,'wv',true),/wv_lalo-animated.gif$/);assert.throws(()=>m.imageUrl(s,'../other'));
  assert.equal(m.imageUrl({hasImagery:false,jtwcImage:'https://evil.test/a.jpg'}),null);
});
test('daily SST grids retain their own timestamp and Celsius units, including missing sea pixels',async()=>{
  const m=await model,s={latitude:22.4,longitude:136.5},grid={table:{columnNames:['time','latitude','longitude','analysed_sst'],columnUnits:['UTC','degrees_north','degrees_east','degree_C'],rows:[['2026-11-07T09:00:00Z',22.4,136.5,28.375],['2026-11-07T09:00:00Z',22.9,136.5,29]]}};
  let ocean=m.parseOcean([grid],s);assert.equal(ocean.temperatureC,28.375);assert.equal(ocean.sampledAt,'2026-11-07T09:00:00Z');grid.table.rows[0][3]=null;assert.equal(m.parseOcean([grid],s).temperatureC,null);grid.table.columnUnits[3]='K';assert.throws(()=>m.parseOcean([grid],s),/units/);
  assert.equal(m.oceanQueries({latitude:12,longitude:179}).urls.length,2);for(const u of m.oceanQueries({latitude:12,longitude:179}).urls)assert.equal(u.hostname,'coastwatch.pfeg.noaa.gov');
});
test('operational ATCF structure adds sourced RMW, POCI and ROCI without offsets or time mixing',async()=>{
  const m=await model,p=m.parseJtwcFeed(fixture('jtwc')).products[0],storm=m.parseJtwcWarning(fixture('cempaka'),p),s=m.parseStructure(fixture('wp31-bdeck'),storm);
  assert.equal(s.pressureMb,989);assert.equal(s.rmwNmi,15);assert.equal(s.pociMb,1014);assert.equal(s.rociNmi,120);assert.equal(s.pressureMatchesAdvisory,true);assert.equal(s.validAt,storm.validAt);assert.equal(s.radii[34].NW,100);
  const earlier=m.parseStructure(fixture('wp31-bdeck'),{...storm,validAt:'2026-11-08T06:00:00.000Z'});assert.equal(earlier.validAt,'2026-11-08T06:00:00.000Z');assert.equal(earlier.pressureMb,985);assert.equal(earlier.pressureMatchesAdvisory,false);
  assert.throws(()=>m.parseStructure(fixture('wp31-bdeck'),{...storm,validAt:'2026-11-09T06:00:00.000Z'}),/No matching/);
  const nhc=m.parseNhc(JSON.parse(fixture('nhc')))[0],n=m.parseStructure(fixture('cp04-bdeck'),nhc);assert.equal(n.validAt,'2026-11-08T12:00:00.000Z');assert.equal(n.pressureMatchesAdvisory,false);assert.equal(n.rmwNmi,20);assert.match(n.sourceUrl,/ftp.nhc.noaa.gov/);
});
test('wind footprint uses geodesic quadrant radii and keeps older ATCF centers separate',async()=>{
  const {radiusDestination,windFootprint}=await import(pathToFileURL(path.join(__dirname,'../live-storms-radii.js')).href),p=radiusDestination(0,0,90,60);assert.ok(Math.abs(p[0])<1e-6);assert.ok(Math.abs(p[1]-1)<.002);
  const storm={latitude:22.4,longitude:136.5,validAt:'2026-11-08T12:00Z',agency:'JTWC',radii:{34:{NE:90,SE:70,SW:60,NW:100}}},structure={latitude:22,longitude:137.4,validAt:'2026-11-08T06:00Z',radii:{34:{NE:100,SE:60,SW:50,NW:100}},rmwNmi:15};
  const f=windFootprint(storm,structure);assert.equal(f.validAt,storm.validAt);assert.equal(f.radii[34].NE,90);assert.equal(f.rmwNmi,null);assert.equal(windFootprint({...storm,radii:{}},structure).longitude,137.4);
});
function fakeRead(m,fail=[]){return async(url,options)=>{const u=String(url);if(fail.some(part=>u.includes(part)))throw Error('Source failed');if(u===m.LIVE_SOURCES.nhc)return new Response(fixture('nhc'));if(u===m.LIVE_SOURCES.jtwc)return new Response(fixture('jtwc'));if(u===m.LIVE_SOURCES.imagery)return new Response('<a href="/tropical-floaters/31W/imagery/avn0-lalo.gif">floater</a>');if(u.endsWith('/bwp312026.dat'))return new Response(fixture('wp31-bdeck'));if(u.endsWith('wp3126web.txt'))return new Response(fixture('cempaka'));if(u.endsWith('sh0327web.txt'))return new Response(fixture('three'));if(options?.method==='HEAD')return new Response(null,{headers:{'Content-Type':'image/gif','Last-Modified':'Sun, 08 Nov 2026 16:52:25 GMT'}});throw Error('Unexpected external request');};}
test('live endpoint caches public feeds, validates requests, and can never proxy caller-supplied URLs',async()=>{
  const m=await model,{createLiveStormsHandler}=await api;let calls=0;const read=fakeRead(m),handler=createLiveStormsHandler({now:()=>at,read:async(...args)=>{calls++;return read(...args);}}),request=query=>new Request('https://site.test/api/live-storms'+query);
  let r=await handler.fetch(request('')),d=await r.json();assert.equal(r.status,200);assert.equal(d.storms.length,3);const first=calls;await handler.fetch(request(''));assert.equal(calls,first);
  r=await handler.fetch(request('?view=structure&storm=WP312026'));assert.equal(r.status,200);const structure=await r.json();assert.equal(structure.pressureMb,989);assert.equal(structure.pociMb,1014);assert.equal(structure.rmwNmi,15);
  r=await handler.fetch(request('?view=imagery&storm=WP312026&product=bd'));assert.equal(r.status,200);assert.match((await r.json()).imageUrl,/ospo.noaa.gov/);
  for(const q of ['?url=https://evil.test','?view=imagery&storm=WP312026&product=../a','?view=ocean&storm=https://evil.test','?view=ocean&storm=WP992026','?view=imagery&view=storms'])assert.notEqual((await handler.fetch(request(q))).status,200);
});
test('a failed advisory source is visible and does not blank working agency data; no outage is reported as an empty live ocean',async()=>{
  const m=await model,{createLiveStormsHandler}=await api,h=createLiveStormsHandler({now:()=>at,read:fakeRead(m,['jtwc.rss'])}),r=await h.fetch(new Request('https://site.test/api/live-storms')),d=await r.json();assert.equal(r.status,200);assert.equal(d.storms.length,1);assert.equal(d.sources.find(s=>s.id==='jtwc').available,false);
  const failure=createLiveStormsHandler({now:()=>at,read:async()=>{throw Error('No network');}});assert.equal((await failure.fetch(new Request('https://site.test/api/live-storms'))).status,503);
});
