const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const mod=n=>import(pathToFileURL(path.join(__dirname,'../'+n+'.js')).href);
const fixture=n=>fs.readFileSync(path.join(__dirname,'fixtures/live-primary',n));
const storm={id:'WP312026',name:'CEMPAKA',designation:'31W',latitude:22.9,longitude:135.7,validAt:'2026-11-08T18:00:00Z'};
const now=new Date('2026-11-09T01:25:00Z');
test('bilinear scalar resampling preserves linear fields, exact pixels, missing masks and bounds',async()=>{
  const {bilinearSampler,resampleGrid}=await mod('live-storms-resample'),sample=bilinearSampler(3,3,(x,y)=>2+3*x+5*y);
  assert.equal(sample(.25,.75),6.5);assert.equal(sample(1,1),10);assert.ok(Number.isNaN(sample(-1,0)));
  const original={width:2,height:2,values:Float32Array.from([0,10,20,30])},g=resampleGrid(original,12);assert.equal(g.width,12);assert.equal(original.values.length,4);assert.ok([...g.values].every(t=>t>=0&&t<=30));
  const masked=bilinearSampler(2,2,(x,y)=>[0,NaN,20,30][y*2+x]);assert.equal(masked(0,0),0);assert.ok(Number.isNaN(masked(.5,.5)));assert.throws(()=>resampleGrid(original,3000),/Invalid/);
});
test('HSD geographic resampling uses calibrated neighboring pixels without filling masked observations',async()=>{
  const {readHsd,sampleHsd}=await mod('live-storms-primary'),s=readHsd(fixture('hsd-header-pixels.bin')),p={...s.projection,coff:1.5,loff:1.5},calibration={...s.calibration,band:3,bits:11,gain:1,offset:0,c0:.01};
  const tiny={width:2,height:2,firstLine:0,projection:p,calibration,count:(x,y)=>[10,20,30,40][y*2+x]},bounds={west:140.6999999,east:140.7000001,south:-.0000001,north:.0000001};
  const values=sampleHsd(tiny,bounds,2);for(const v of values)assert.ok(Math.abs(v-25)<.001);
  const missing=sampleHsd({...tiny,count:(x,y)=>x===1&&y===1?65535:20},bounds,2);assert.ok([...missing].every(Number.isNaN));
});
test('JMA HSD calibration matches independent Planck calculation and rejects source error/outside/invalid counts',async()=>{
  const {readHsd,calibrateHsd}=await mod('live-storms-primary'),s=readHsd(fixture('hsd-header-pixels.bin'));
  assert.equal(s.width,3);assert.equal(s.height,3);assert.equal(s.firstLine,1100);assert.equal(s.calibration.band,13);
  assert.ok(Math.abs(calibrateHsd(3000,s.calibration)-(-22.490056726622214))<1e-9);
  for(const n of [65535,65534,4096])assert.ok(Number.isNaN(calibrateHsd(n,s.calibration)));
  assert.throws(()=>readHsd(fixture('hsd-header-pixels.bin').subarray(0,1530)),/truncated/);
  const c={...s.calibration,band:3,gain:1,offset:0,c0:.01,bits:11};assert.equal(calibrateHsd(20,c),20);
});
test('geostationary projection uses the correct scan axes, nadir origin, horizon and native segment bounds',async()=>{
  const m=await mod('live-storms-primary'),s=m.readHsd(fixture('hsd-header-pixels.bin')),p=s.projection;
  assert.deepEqual(m.hsdPixel(0,140.7,p),[2749.5,2749.5]);assert.ok(m.hsdPixel(20,140.7,p)[1]<2749.5);assert.ok(m.hsdPixel(0,150,p)[0]>2749.5);assert.equal(m.hsdPixel(0,-40,p),null);
  assert.deepEqual(m.hsdSegments(m.plotBounds(storm),20),[3,4]);assert.deepEqual(m.hsdSegments(m.plotBounds(storm),5),[3,4]);assert.throws(()=>m.plotBounds({latitude:NaN,longitude:0}));
});
test('the decoder reads all concatenated bzip2 streams and checks truncation and output bounds',async()=>{
  const {initBzip2,decompress}=await mod('assets/vendor/bzip2');await initBzip2(fs.readFileSync(path.join(__dirname,'../assets/vendor/bzip2.wasm')));const b=fixture('concatenated.bz2');assert.equal(new TextDecoder().decode(await decompress(b)),'native segment onenative segment two');await assert.rejects(decompress(b.subarray(0,25)));await assert.rejects(decompress(b,10),/limit/);
});
test('native file discovery requires every segment and uses only fixed NOAA S3 band paths',async()=>{
  const m=await mod('live-storms-primary'),plan=m.hsdPlan(storm,'spectrum','202611090110');assert.equal(plan.files.length,2);assert.ok(plan.files.every(s=>s.startsWith(m.HSD_ROOT)&&s.includes('_B13_FLDK_R20_')));assert.equal(m.hsdAvailable('<Key>'+plan.files[0].slice(m.HSD_ROOT.length)+'</Key>',plan),false);assert.equal(m.hsdAvailable(plan.files.map(s=>'<Key>'+s.slice(m.HSD_ROOT.length)+'</Key>').join(''),plan),true);assert.throws(()=>m.hsdPlan(storm,'../secret','202611090110'));
});
test('GOES subset retains CF calibration, validates XDR maps and decodes packed missing cells',async()=>{
  const m=await mod('live-storms-goes'),meta=m.goesMetadata(fixture('goes.das').toString(),fixture('goes.dds').toString());assert.equal(meta.satellite,'GOES-18');assert.equal(meta.band,13);assert.equal(meta.projection.subLon,-137);assert.equal(meta.units,'kelvin');
  const w={width:3,height:3,left:2000,top:1000,stride:1,bounds:{west:-137.0000001,east:-136.9999999,south:-.0000001,north:.0000001}},g=m.decodeGoesDods(fixture('goes-mini.dods'),{...meta,x0:-2001*meta.dx,y0:-1001*meta.dy},w,2);
  assert.ok(Math.abs(g.values[0]-(3147*.06145332+89.62-273.15))<.0001);assert.throws(()=>m.decodeGoesDods(fixture('goes-mini.dods'),meta,{...w,left:1999},2),/coordinate/);assert.throws(()=>m.decodeGoesDods(fixture('goes-mini.dods').subarray(0,390),meta,w,2),/Truncated/);
  const {decodePackedGrid}=await mod('live-storms-grid'),bytes=Buffer.alloc(4);bytes.writeInt16LE(-8123);bytes.writeInt16LE(-32768,2);assert.deepEqual([...decodePackedGrid({width:2,height:1,encoding:'int16-le-centi',packed:bytes.toString('base64')}).values].map(v=>Number.isNaN(v)?null:Math.round(v*100)),[-8123,null]);
});
test('NOAA CRW grids keep native coordinates, Celsius and analysis date; dateline queries split safely',async()=>{
  const {decodeCrw,pointSample}=await mod('live-storms-grid'),g=decodeCrw(fixture('crw-mini.nc'));assert.equal(g.width,21);assert.equal(g.height,21);assert.equal(g.validAt,'2026-11-07T12:00:00.000Z');assert.ok(pointSample([g],11,135)>20);assert.equal(pointSample([g],0,0),null);
  const {crwUrl}=await mod('live-storms-primary');for(const lon of [179,-179,0,359]){const q=crwUrl({...storm,longitude:lon});for(const u of q.urls)assert.ok(u.startsWith('https://oceanwatch.pifsc.noaa.gov/erddap/griddap/CRW_sst_v3_1.nc?'));}assert.equal(crwUrl({...storm,longitude:0}).urls.length,2);
});
test('direct discovery and API caches use original upstream sources without mirroring satellite bytes',async()=>{
  const {createLiveStormsHandler}=await mod('api/live-storms'),m=await mod('live-storms-primary'),calls=[];
  const f=n=>fs.readFileSync(path.join(__dirname,'fixtures/live-storms',n+'.txt'),'utf8');
  const read=async url=>{const u=String(url);calls.push(u);if(u.endsWith('CurrentStorms.json'))return new Response(f('nhc'));if(u.endsWith('jtwc.rss'))return new Response(f('jtwc'));if(u.endsWith('floaters.html'))return new Response('');if(u.endsWith('wp3126web.txt'))return new Response(f('cempaka'));if(u.endsWith('sh0327web.txt'))return new Response(f('three'));if(u.startsWith(m.HSD_ROOT+'?')){const prefix=new URL(u).searchParams.get('prefix');return new Response([3,4].map(n=>'<Key>'+prefix+'0'+n+'10.DAT.bz2</Key>').join(''));}throw Error('Unexpected upstream URL');};
  const h=createLiveStormsHandler({read,now:()=>now}),url='https://site.test/api/live-storms?view=charts&storm=WP312026';const results=await Promise.all([h.fetch(new Request(url)),h.fetch(new Request(url))]);for(const r of results){assert.equal(r.status,200);const d=await r.json();assert.equal(d.provider,'Tornado Database');assert.equal(d.satellite.kind,'hsd');assert.equal(d.satellite.frames.length,1);}
  assert.equal(calls.filter(u=>u.startsWith(m.HSD_ROOT)).length,1);assert.ok(!calls.some(u=>/\.bz2$|cyclonicwx/i.test(u)));for(const suffix of ['&url=https://evil.test','&product=../path','&view=grid','&scan=../../../secret']){const r=await h.fetch(new Request(url+suffix));assert.notEqual(r.status,200);}
});
