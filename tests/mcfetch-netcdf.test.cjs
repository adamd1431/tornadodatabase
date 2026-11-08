const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const model=import(pathToFileURL(path.join(__dirname,'../mcfetch-model.js')).href);
const reader=import(pathToFileURL(path.join(__dirname,'../mcfetch-netcdf.js')).href);
const api=import(pathToFileURL(path.join(__dirname,'../api/mcfetch.js')).href);
const nc=fs.readFileSync(path.join(__dirname,'fixtures/durian-temperature-subset.nc'));
test('UTC clock accepts exactly 0000–2359 without AM/PM or a locale-specific time picker',async()=>{
  const {utcClock}=await model;assert.equal(utcClock('0000'),'00:00');assert.equal(utcClock('1200'),'12:00');assert.equal(utcClock('2359'),'23:59');
  for(const value of ['2400','0060','1260','12:00','1200 PM','600','-100','12aa'])assert.throws(()=>utcClock(value),/four-digit/);
});
test('NetCDF requests use physical temperature, native sampling and keep raw image requests available',async()=>{
  const {mcfetchUrl,normalizeMcfetch}=await model,input={satellite:'MTSAT1R',date:'2006-11-29',time:'11:16:00',latitude:13.3,longitude:126.2,band:2,enhancement:'BD',renderMode:'plot',coverage:'NH'};
  const url=mcfetchUrl(input,'test-key-not-real');assert.equal(url.searchParams.get('output'),'NETCDF');assert.equal(url.searchParams.get('unit'),'TEMP');assert.equal(url.searchParams.get('mag'),'1 1');assert.equal(url.searchParams.get('eu'),null);assert.equal(url.searchParams.get('map'),null);assert.equal(url.searchParams.get('coverage'),'NH');assert.ok(url.search.includes('time=11:16:00'));
  assert.throws(()=>normalizeMcfetch({...input,width:501}),/Image width/);assert.throws(()=>normalizeMcfetch({...input,enhancement:'MB'}),/Original image/);
  assert.equal(mcfetchUrl({...input,renderMode:'image'},'test-key-not-real').searchParams.get('output'),'GIF');
});
test('real Durian data decodes to the reference 1116 scan and 1.51 Celsius center maximum',async()=>{
  const {decodeTemperatureGrid,centerMaximum}=await reader,g=decodeTemperatureGrid(nc);
  assert.equal(g.timestamp,'2006-11-29T11:16:00.000Z');assert.equal(g.band,2);assert.equal(g.width,16);assert.equal(g.height,16);assert.equal(g.sensor,'MTSAT-1R');assert.ok(Math.abs(centerMaximum(g,13.3,126.2)-1.51)<0.0001);
  assert.equal(centerMaximum(g,-45,-100),null);
});
test('corrupt or truncated NetCDF cannot become a fabricated temperature plot',async()=>{
  const {decodeTemperatureGrid,readClassicNetcdf}=await reader;
  for(const bytes of [Buffer.from('not netcdf'),nc.subarray(0,400),nc.subarray(0,nc.length-20)])assert.throws(()=>decodeTemperatureGrid(bytes));
  const hdf=Buffer.from(nc);hdf[3]=5;assert.throws(()=>readClassicNetcdf(hdf),/classic/);
});
test('API validates the NetCDF signature and returns identical source bytes without credentials',async()=>{
  const {createMcfetchHandler}=await api,input={satellite:'MTSAT1R',date:'2006-11-29',time:'11:16:00',latitude:13.3,longitude:126.2,band:2,renderMode:'plot',enhancement:'BD',coverage:'NH',apiKey:'test-key-not-real'};
  const request=()=>new Request('https://site.test/api/mcfetch',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://site.test'},body:JSON.stringify(input)});
  const handler=createMcfetchHandler({read:async url=>{assert.equal(url.searchParams.get('output'),'NETCDF');return new Response(nc,{headers:{'Content-Type':'application/octet-stream'}});}}),r=await handler.fetch(request());
  assert.equal(r.status,200);assert.equal(r.headers.get('Content-Type'),'application/x-netcdf');assert.deepEqual(Buffer.from(await r.arrayBuffer()),nc);
  const bad=createMcfetchHandler({read:async()=>new Response('not netcdf',{headers:{'Content-Type':'application/x-netcdf'}})});assert.equal((await bad.fetch(request())).status,422);
});
