const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const palette=import(pathToFileURL(path.join(__dirname,'../live-storms-palette.js')).href);
const model=import(pathToFileURL(path.join(__dirname,'../live-storms-model.js')).href);
const api=import(pathToFileURL(path.join(__dirname,'../api/live-storms.js')).href);
const fixture=n=>fs.readFileSync(path.join(__dirname,'fixtures/live-storms',n+'.txt'),'utf8');
test('nominal IR conversion follows both documented McIDAS branches with no artificial discontinuity',async()=>{
  const {nominalTemperatureC:t}=await palette;assert.ok(Math.abs(t(0)-56.85)<1e-8);assert.ok(Math.abs(t(176)+31.15)<1e-8);assert.ok(Math.abs(t(177)+32.15)<1e-8);assert.ok(Math.abs(t(255)+110.15)<1e-8);assert.equal(t(-1),null);assert.equal(t(256),null);assert.equal(t(0.5),null);
});
test('the spectrum has defined cold/magenta, deep-convection/black, red, yellow, green and warm/navy transitions',async()=>{
  const {spectrumColor:c}=await palette;assert.deepEqual(c(-70),[4,3,5]);assert.deepEqual(c(-60),[255,23,8]);assert.deepEqual(c(-40),[251,245,32]);assert.deepEqual(c(-90),[202,18,212]);assert.deepEqual(c(0),[13,15,34]);assert.deepEqual(c(-200),c(-100));assert.deepEqual(c(200),c(50));for(let t=-110;t<=60;t+=.5)assert.ok(c(t).every(v=>Number.isInteger(v)&&v>=0&&v<=255));
});
test('enhancement preserves NOAA colored coastlines, transparent pixels, no-data black and the original scan-time footer',async()=>{
  const {recolorInfrared:r}=await palette,width=100,height=100,pixels=new Uint8ClampedArray(width*height*4);for(let i=0;i<pixels.length;i+=4){pixels[i]=pixels[i+1]=pixels[i+2]=220;pixels[i+3]=255;}
  pixels.set([255,0,255,255],4);pixels.set([100,100,100,0],8);pixels.set([0,0,0,255],12);const before=new Uint8ClampedArray(pixels),out=r(pixels,width,height,24);assert.notDeepEqual(out.slice(0,4),pixels.slice(0,4));assert.deepEqual(out.slice(4,16),pixels.slice(4,16));assert.deepEqual(out.slice(width*76*4),pixels.slice(width*76*4));assert.deepEqual(pixels,before);assert.throws(()=>r(pixels,720,480),/Unsupported/);
});
test('the custom palette uses only unenhanced NOAA infrared; native Dvorak and other products stay unchanged',async()=>{
  const m=await model,s={designation:'31W',hasImagery:true};assert.match(m.imageUrl(s,'spectrum'),/\/31W\/imagery\/ir0\.gif$/);assert.match(m.imageUrl(s,'spectrum',true),/ir-animated\.gif$/);assert.match(m.imageUrl(s,'bd'),/bd0-lalo\.gif$/);assert.match(m.imageUrl(s,'ir'),/ir0-lalo\.gif$/);assert.equal(m.imageUrl({hasImagery:false,designation:'31W'},'spectrum'),null);
});
function fakeRead({invalid=false,oversize=false,fail=false,calls=[]}={}){return async(url,options={})=>{url=String(url);calls.push({url,options});if(url.includes('CurrentStorms'))return new Response(fixture('nhc'));if(url.endsWith('jtwc.rss'))return new Response(fixture('jtwc'));if(url.endsWith('floaters.html'))return new Response('<a href="/tropical-floaters/31W/imagery/avn0-lalo.gif">floater</a>');if(url.endsWith('wp3126web.txt'))return new Response(fixture('cempaka'));if(url.endsWith('sh0327web.txt'))return new Response(fixture('three'));if(url.includes('/tropical-floaters/31W/imagery/ir')){if(fail)return new Response('',{status:503});if(options.method==='HEAD')return new Response(null,{headers:{'Content-Type':'image/gif','Last-Modified':'Sun, 08 Nov 2026 18:22:23 GMT'}});return new Response(oversize?new Uint8Array(5000001):new TextEncoder().encode(invalid?'<html>unavailable</html>':'GIF89a'+String.fromCharCode(1,0,1,0,0,0,0)),{headers:{'Content-Type':'image/gif'}});}throw Error('Unexpected source');};}
const request=q=>new Request('https://test/api/live-storms?'+q);
test('same-origin IR delivery is cached and restricted to fixed current-storm NOAA URLs',async()=>{
  const {createLiveStormsHandler}=await api,calls=[],h=createLiveStormsHandler({read:fakeRead({calls}),now:()=>new Date('2026-11-08T18:30Z')});
  const meta=await h.fetch(request('view=imagery&storm=WP312026&product=spectrum'));assert.equal(meta.status,200);assert.match((await meta.json()).imageUrl,/ir0.gif$/);
  for(let i=0;i<2;i++){const r=await h.fetch(request('view=infrared&storm=WP312026&animated=0'));assert.equal(r.status,200);assert.equal(r.headers.get('Content-Type'),'image/gif');assert.equal(r.headers.get('X-Content-Type-Options'),'nosniff');assert.match(r.headers.get('Cache-Control'),/max-age=240/);assert.equal((await r.text()).slice(0,6),'GIF89a');}
  assert.equal(calls.filter(c=>c.url.endsWith('/ir0.gif')&&c.options.method!=='HEAD').length,1);
  assert.equal((await h.fetch(request('view=infrared&storm=CP042026'))).status,404);assert.equal((await h.fetch(request('view=infrared&storm=WP312026&animated=bad'))).status,400);assert.equal((await h.fetch(request('view=infrared&storm=WP312026&url=https://evil.test'))).status,400);assert.equal((await h.fetch(request('view=infrared&storm=WP992026'))).status,404);
});
test('a bad, oversized or failed infrared response cannot be delivered as a valid image or blank the advisory feed',async()=>{
  const {createLiveStormsHandler}=await api;for(const options of [{invalid:true},{oversize:true},{fail:true}]){const h=createLiveStormsHandler({read:fakeRead(options),now:()=>new Date('2026-11-08T18:30Z')});assert.equal((await h.fetch(request('view=infrared&storm=WP312026'))).status,503);const r=await h.fetch(request(''));assert.equal(r.status,200);assert.ok((await r.json()).storms.length>0);}
});
