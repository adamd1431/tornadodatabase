const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const model=import(pathToFileURL(path.join(__dirname,'../live-storms-published.js')).href);
const storm={id:'WP312026',designation:'31W',name:'CEMPAKA',validAt:'2026-11-08T18:00:00Z'},now=new Date('2026-11-09T00:45:00Z');
const section=()=>`<div class="stormdivs" id="wp31"><h1>Typhoon CEMPAKA</h1><p>Updated November 08, 2026 at 18:00 UTC</p><div id="wp312026sst"><img src="/data/sst/crw_sst_31W.png"></div><img src="/data/sat/himawari9_31W_ir_202611090035.png"><img src="/data/tracks/31W_windradii.png"></div><div class="stormdivs" id="cp04"><h1>PENA</h1></div>`;
test('published plots retain their publisher URLs, acquisition time, full storm season and attribution',async()=>{
  const m=await model,r=m.publishedChartsFromPage(section(),storm,now);assert.equal(r.provider,'CyclonicWx');assert.equal(r.satellite.validAt,'2026-11-09T00:35:00.000Z');assert.equal(r.satellite.imageUrl,'https://cyclonicwx.com/data/sat/himawari9_31W_ir_202611090035.png');assert.equal(r.ocean,'https://cyclonicwx.com/data/sst/crw_sst_31W.png');assert.equal(r.radii,'https://cyclonicwx.com/data/tracks/31W_windradii.png');assert.equal(r.sourceUrl,'https://cyclonicwx.com/storms/#wp31');
});
test('reused designations, stale inventories and another storm name cannot masquerade as current plots',async()=>{
  const m=await model;for(const text of [section().replace('wp312026sst','wp312025sst'),section().replace('CEMPAKA','HAGIBIS'),section().replace('November 08','November 01')])assert.throws(()=>m.publishedChartsFromPage(text,storm,now));assert.throws(()=>m.publishedChartsFromPage(section(),{...storm,id:'../secret'},now));
});
test('only matching fixed publisher image paths are returned; unlisted plots stay absent',async()=>{
  const m=await model,s=section().replace('/data/sst/crw_sst_31W.png','https://evil.test/data/sst/crw_sst_31W.png').replace('/data/tracks/31W_windradii.png','/data/tracks/04C_windradii.png'),r=m.publishedChartsFromPage(s,storm,now);assert.equal(r.ocean,null);assert.equal(r.radii,null);
});
test('frame inventory accepts a publisher trailing comma but cannot evaluate scripts, fetch arbitrary URLs or use future/other-storm scans',async()=>{
  const m=await model,head='<title>Water Vapor Satellite Loop - Typhoon CEMPAKA | CyclonicWx</title>',paths=['/data/sat/himawari9_31W_wv_202611082335.png','/data/sat/himawari9_31W_wv_202611090035.png','/data/sat/himawari9_31W_wv_202611100035.png','/data/sat/himawari9_32W_wv_202611090035.png','https://evil.test/data/sat/himawari9_31W_wv_202611090035.png'];
  const r=m.publishedSatelliteFrames(head+'var imgUrls = '+JSON.stringify(paths).replace(/\]$/,',]')+';',storm,'wv',now);assert.equal(r.frames.length,2);assert.equal(r.validAt,'2026-11-09T00:35:00.000Z');assert.equal(r.sourceUrl,'https://cyclonicwx.com/floater/31W/wv/');
  assert.throws(()=>m.publishedSatelliteFrames(head+'var imgUrls=[process.exit()];',storm,'wv',now));assert.throws(()=>m.publishedSatelliteFrames(head.replace('CEMPAKA','PENA'),storm,'wv',now));assert.throws(()=>m.publishedSatelliteFrames(head,storm,'../path',now));
});
test('loop payloads are bounded to twelve sorted recent frames, with acquisition times rather than file modification times',async()=>{
  const m=await model,paths=Array.from({length:16},(_,i)=>`/data/sat/himawari9_31W_ir_20261108${String(21+Math.floor(i/6)).padStart(2,'0')}${String(i%6*10).padStart(2,'0')}.png`).reverse(),r=m.publishedSatelliteFrames('<title>CEMPAKA</title>var imgUrls='+JSON.stringify(paths)+';',storm,'spectrum',now);assert.equal(r.frames.length,12);assert.ok(Date.parse(r.frames[0].validAt)<Date.parse(r.frames.at(-1).validAt));
});
test('charts endpoint uses only fixed publisher inventory/pages, coalesces inventory and sends no image bytes through website hosting',async()=>{
  const {createLiveStormsHandler}=await import(pathToFileURL(path.join(__dirname,'../api/live-storms.js')).href),fixtures=n=>fs.readFileSync(path.join(__dirname,'fixtures/live-storms',n+'.txt'),'utf8'),calls=[];
  const read=async url=>{const u=String(url);calls.push(u);if(u.endsWith('CurrentStorms.json'))return new Response(fixtures('nhc'));if(u.endsWith('jtwc.rss'))return new Response(fixtures('jtwc'));if(u.endsWith('floaters.html'))return new Response('floater');if(u.endsWith('wp3126web.txt'))return new Response(fixtures('cempaka'));if(u.endsWith('sh0327web.txt'))return new Response(fixtures('three'));if(u==='https://cyclonicwx.com/storms/')return new Response(section().replace('18:00','12:00'));return new Response('',{status:404});};
  const handler=createLiveStormsHandler({read,now:()=>now}),url='https://site.test/api/live-storms?view=charts&storm=WP312026';for(const response of await Promise.all([handler.fetch(new Request(url)),handler.fetch(new Request(url))])){assert.equal(response.status,200);assert.equal((await response.json()).provider,'CyclonicWx');}
  assert.equal(calls.filter(u=>u==='https://cyclonicwx.com/storms/').length,1);assert.ok(!calls.some(u=>u.includes('/data/')));assert.equal((await handler.fetch(new Request(url+'&url=https://evil.test'))).status,400);assert.equal((await handler.fetch(new Request(url+'&product=../bad'))).status,400);
});
