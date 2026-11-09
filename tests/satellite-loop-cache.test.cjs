const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const m=import(pathToFileURL(path.join(__dirname,'../satellite-loop-cache.js')).href);
const flush=()=>new Promise(r=>setImmediate(r));
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const hash=async s=>createHash('sha256').update(s).digest('hex');
function fakeStorage(){const entries=new Map();let opens=0;return {entries,get opens(){return opens;},async open(name){assert.equal(name,'tornado-satellite-png-v1');opens++;return {async keys(){return [...entries.keys()].map(url=>new Request(url));},async match(input){return entries.get(String(input.url||input))?.clone();},async put(input,response){entries.set(String(input.url||input),response.clone());},async delete(input){return entries.delete(String(input.url||input));}};}};}
const row=(data='png')=>({blob:new Blob([data],{type:'image/png'}),validAt:'2026-11-09T04:31:41.332Z'});

test('lossless PNG bytes and scan times survive a new page cache instance without any network call',async()=>{
  const {createLoopDiskCache}=await m,storage=fakeStorage(),a=createLoopDiskCache({storage,hash}),original=row();assert.equal(await a.set('frame-1',original),true);
  const b=createLoopDiskCache({storage,hash}),restored=await b.get('frame-1');assert.equal(await restored.blob.text(),await original.blob.text());assert.equal(restored.validAt,original.validAt);assert.equal(storage.entries.size,1);assert.ok([...storage.entries.keys()][0].endsWith(await hash('frame-1')+'.png'));
});
test('cache age, byte and entry limits evict only this feature’s saved plots',async()=>{
  const {createLoopDiskCache}=await m,storage=fakeStorage();storage.entries.set('https://foreign.test/keep',new Response('untouched'));
  let time=1000;const cache=createLoopDiskCache({storage,hash,now:()=>time,maxBytes:6,maxEntries:2,ttl:100});
  await cache.set('a',row());time++;await cache.set('b',row());time++;await cache.set('c',row());assert.equal(await cache.get('a'),null);assert.ok(await cache.get('b'));assert.ok(await cache.get('c'));assert.ok(storage.entries.has('https://foreign.test/keep'));
  time=1200;assert.equal(await cache.get('b'),null);assert.equal(await cache.set('oversize',row('way too large')),false);assert.ok(storage.entries.has('https://foreign.test/keep'));
});
test('blocked browser storage and write failures fall back cleanly instead of breaking the loop',async()=>{
  const {createLoopDiskCache}=await m,cache=createLoopDiskCache({storage:{open:async()=>{throw Error('Unavailable');}},hash});assert.equal(await cache.get('x'),null);assert.equal(await cache.set('x',row()),false);
  const full=createLoopDiskCache({storage:{open:async()=>({put:async()=>{throw Error('QuotaExceeded');}})},hash});assert.equal(await full.set('x',row()),false);await full.flush();
});
test('render keys invalidate saved plots when advisory values, geometry, band or scan change',async()=>{
  const {renderedLoopKey}=await m,s={id:'WP312026',name:'CEMPAKA',windKt:75,pressureMb:982,validAt:'2026-11-09T00:00Z',latitude:23.8,longitude:135},f={scan:'one',bounds:{west:129,east:141,south:18,north:30}},original=renderedLoopKey(s,'spectrum',f);
  for(const [storm,product,frame]of [[{...s,pressureMb:980},'spectrum',f],[{...s,windKt:80},'spectrum',f],[{...s,longitude:136},'spectrum',f],[s,'wv',f],[s,'spectrum',{...f,scan:'two'}]])assert.notEqual(renderedLoopKey(storm,product,frame),original);
});
test('two parallel lanes overlap frame preparation without exceeding the worker limit',async()=>{
  const {runLoopJobs}=await m,gates=[gate(),gate(),gate()],started=[];let active=0,peak=0;
  const job=runLoopJobs([0,1,2],{concurrency:2,work:async(i,lane)=>{started.push([i,lane]);active++;peak=Math.max(peak,active);await gates[i].promise;active--;}});await flush();assert.deepEqual(started,[[0,0],[1,1]]);gates[0].resolve();await flush();assert.deepEqual(started[2],[2,0]);gates[1].resolve();gates[2].resolve();await job;assert.equal(peak,2);
});
test('cancelled loads stop assigning new frame jobs',async()=>{
  const {runLoopJobs}=await m,g=gate(),controller=new AbortController(),started=[];
  const job=runLoopJobs([0,1,2,3],{concurrency:2,signal:controller.signal,work:async i=>{started.push(i);await g.promise;}});await flush();controller.abort();g.resolve();await job;assert.deepEqual(started,[0,1]);
});
