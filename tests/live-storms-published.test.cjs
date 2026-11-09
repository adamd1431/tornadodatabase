const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const mod=n=>import(pathToFileURL(path.join(__dirname,'../'+n+'.js')).href);
const fixture=n=>fs.readFileSync(path.join(__dirname,'fixtures/live-storms',n+'.txt'),'utf8');
const storm={id:'WP312026',name:'CEMPAKA',designation:'31W',validAt:'2026-11-08T12:00:00.000Z'},now=()=>new Date('2026-11-09T05:55Z');
const index='<div class="stormdivs" id="wp31"><h1>Typhoon CEMPAKA</h1>Updated November 08, 2026 at 12:00 UTC<div id="wp312026sst"></div><div class="stormdivs" id="ep12"><h1>OTHER</h1>';
const paths=Array.from({length:60},(_,i)=>'/data/sat/himawari9_31W_ir_'+new Date(Date.UTC(2026,10,8,20,i*10)).toISOString().replace(/[-:T]/g,'').slice(0,12)+'.png');
const page=(items=paths)=>'<title>Infrared Satellite Loop - Typhoon CEMPAKA | CyclonicWx</title><script>var imgUrls = '+JSON.stringify(items).replace(/\]$/,',]')+';</script>';
const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
test('published inventory matches name, full season and current advisory; reused short IDs and stale products are rejected',async()=>{
  const {verifyPublishedStorm:verify}=await mod('live-storms-published');verify(index,storm,now());
  for(const text of [index.replace('wp312026sst','wp312025sst'),index.replace('CEMPAKA','KALMAEGI'),index.replace('November 08','November 01'),index.replace('November 08','November 10'),index.replace('id="wp31"','id="wp32"')])assert.throws(()=>verify(text,storm,now()));
  assert.throws(()=>verify(index,{...storm,id:'https://evil.test'},now()));
});
test('literal image inventory accepts trailing commas but rejects executable code and foreign, stale, future or invalid dates',async()=>{
  const {publishedFrames}=await mod('live-storms-published');const noise=['https://evil.test/a.png','/data/sat/himawari9_32W_ir_202611090550.png','/data/sat/himawari9_31W_wv_202611090550.png','/data/sat/himawari9_31W_ir_202602300550.png','/data/sat/himawari9_31W_ir_202611100550.png','/data/sat/himawari9_31W_ir_202611070550.png',paths[0]];
  const rows=publishedFrames(page([...paths,...noise]),storm,'spectrum',now());assert.equal(rows.length,60);assert.equal(rows.at(-1).validAt,'2026-11-09T05:50:00.000Z');assert.ok(rows.every(r=>r.imageUrl.startsWith('https://cyclonicwx.com/data/sat/')));
  assert.throws(()=>publishedFrames(page().replace('var imgUrls = [','var imgUrls = [alert(1),'),storm,'spectrum',now()),/unreadable/);
  assert.throws(()=>publishedFrames(page().replace('CEMPAKA','OTHER'),storm,'spectrum',now()),/another storm/);
  assert.throws(()=>publishedFrames(page(paths.slice(0,2)),storm,'spectrum',now()),/recent/);
  assert.throws(()=>publishedFrames(page(),storm,'../../secret',now()),/Unsupported/);
});
test('published selection uses 30 actual chronological scans, skips from newest, and validates every image before fetching',async()=>{
  const {createPublishedService,PUBLISHED_ROOT}=await mod('live-storms-published'),fetched=[],service=createPublishedService({text:async u=>u.endsWith('/storms/')?index:page(),binary:async u=>{fetched.push(u);return png;},cached:(_k,_t,fn)=>fn(),now});
  const loop=await service.loop(storm,'spectrum');assert.equal(loop.frames.length,30);assert.equal(loop.provider,'CyclonicWx');assert.equal(loop.frames[0].validAt,'2026-11-09T01:00:00.000Z');assert.equal(loop.frames.at(-1).validAt,'2026-11-09T05:50:00.000Z');
  const skipped=await service.loop(storm,'spectrum',3,1);assert.deepEqual(skipped.frames.map(r=>r.validAt.slice(11,16)),['05:10','05:30','05:50']);
  assert.deepEqual(await service.image(storm,'spectrum',loop.frames[0].filename),png);assert.equal(fetched[0],PUBLISHED_ROOT+'/data/sat/'+loop.frames[0].filename);
  await assert.rejects(service.image(storm,'spectrum','himawari9_32W_ir_202611090550.png'),/matching/);assert.equal(fetched.length,1);
  const broken=createPublishedService({text:async u=>u.endsWith('/storms/')?index:page(),binary:async()=>new TextEncoder().encode('<html>error</html>'),cached:(_k,_t,fn)=>fn(),now});await assert.rejects(broken.image(storm,'spectrum',loop.frames[0].filename),/PNG/);
});
test('same-origin image endpoint returns unchanged PNG bytes with explicit source credit and rejects arbitrary paths',async()=>{
  const {createLiveStormsHandler}=await mod('api/live-storms'),m=await mod('live-storms-model'),calls=[];
  const read=async u=>{u=String(u);calls.push(u);if(u===m.LIVE_SOURCES.nhc)return new Response(fixture('nhc'));if(u===m.LIVE_SOURCES.jtwc)return new Response(fixture('jtwc'));if(u===m.LIVE_SOURCES.imagery)return new Response('');if(u.endsWith('wp3126web.txt'))return new Response(fixture('cempaka'));if(u.endsWith('sh0327web.txt'))return new Response(fixture('three'));if(u==='https://cyclonicwx.com/storms/')return new Response(index);if(u==='https://cyclonicwx.com/floater/31W/ir/')return new Response(page());if(u==='https://cyclonicwx.com'+paths.at(-1))return new Response(png);throw Error('Unexpected request: '+u);};
  const handler=createLiveStormsHandler({read,now}),request=q=>new Request('https://site.test/api/live-storms?'+q);
  let r=await handler.fetch(request('view=published-loop&storm=WP312026&product=spectrum&frames=30&skip=0'));assert.equal(r.status,200);const d=await r.json();assert.equal(d.frames.length,30);
  r=await handler.fetch(request('view=published-frame&storm=WP312026&product=spectrum&frame='+d.frames.at(-1).filename));assert.equal(r.status,200);assert.equal(r.headers.get('Content-Type'),'image/png');assert.equal(r.headers.get('X-Image-Source'),'CyclonicWx');assert.match(r.headers.get('Vercel-CDN-Cache-Control'),/max-age=86400/);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),png);
  const before=calls.length;for(const q of ['view=published-frame&storm=WP312026','view=published-frame&frame=https://evil.test/a.png','view=published-loop&frames=61','view=published-loop&frames=30&skip=6','view=published-frame&frame=x&frame=y','view=published-loop&url=https://evil.test','view=storms&frame=x'])assert.equal((await handler.fetch(request(q))).status,400);assert.equal(calls.length,before);
  r=await handler.fetch(request('view=published-frame&storm=WP312026&frame=himawari9_32W_ir_202611090550.png'));assert.notEqual(r.status,200);assert.ok(calls.every(u=>!u.includes('32W')));
  assert.equal((await handler.fetch(request('view=published-loop&storm=WP312025'))).status,404);
});
test('GIF export keeps the complete original rectangle and scales down without stretching or upscaling',async()=>{
  const {gifDimensions}=await mod('satellite-loop-model');assert.deepEqual(gifDimensions(1263,1224),{width:1263,height:1224});assert.deepEqual(gifDimensions(1263,1224,1200),{width:1200,height:1163});assert.deepEqual(gifDimensions(1800,1800,1200),{width:1200,height:1200});assert.deepEqual(gifDimensions(640,480,1200),{width:640,height:480});assert.throws(()=>gifDimensions(0,1200));assert.throws(()=>gifDimensions(1263,1224,1800));
});
