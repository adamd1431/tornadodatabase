const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const mod=n=>import(pathToFileURL(path.join(__dirname,'../'+n+'.js')).href);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const storm={id:'WP312026',name:'CEMPAKA',validAt:'2026-11-09T00:00:00Z',latitude:23.8,longitude:135};
const now=()=>Date.parse('2026-11-09T02:00:00Z');
const frame=n=>({files:['https://source.test/'+n],band:13,bounds:{west:129,east:141,south:18,north:30},validAt:`2026-11-09T01:${String(n*10).padStart(2,'0')}:00Z`});
const grid=n=>({width:1,height:1,bounds:frame(n).bounds,values:new Float32Array([n]),validAt:frame(n).validAt});
const descriptor=frames=>({kind:'hsd',source:'JMA / NOAA',sourceUrl:'https://source.test/',satellite:'Himawari-9',band:13,method:'calibrated',frames});
function clock(){let id=0;const tasks=new Map();return {schedule(fn){tasks.set(++id,fn);return id;},cancel(i){tasks.delete(i);},next(){const e=tasks.entries().next().value;if(e){tasks.delete(e[0]);e[1]();}},get count(){return tasks.size;}};}
test('decoded scan cache is bounded by bytes and recency; geometry and advisory changes have distinct keys',async()=>{
  const {createFrameCache,observationContext,observationKey}=await mod('live-storms-frame-cache'),cache=createFrameCache({maxBytes:12,maxEntries:2});cache.set('a',grid(0));cache.set('b',grid(1));cache.get('a');cache.set('c',grid(2));assert.equal(cache.get('b'),null);assert.equal(cache.size,2);assert.equal(cache.bytes,8);
  cache.set('large',{values:new Float32Array(10)});assert.equal(cache.size,2);assert.equal(cache.get('large'),null);
  assert.notEqual(observationKey(observationContext(storm,'wv'),frame(0)),observationKey(observationContext({...storm,longitude:136},'wv'),frame(0)));cache.clear();assert.equal(cache.bytes,0);
});
test('switching bands back and toggling animation reuses decoded latest scans without fetching again',async()=>{
  const {createPrimaryPlayer}=await mod('live-storms-primary-player'),calls=[],native=[],events=[],timers=clock();
  const player=createPrimaryPlayer({}, {now,api:async p=>{calls.push(p);return {satellite:descriptor([frame(2)])};},nativeClient:{load:async f=>{native.push(f);return grid(2);},close(){}},render(){},getCoastlines:()=>null,isHidden:()=>false,schedule:timers.schedule,cancel:timers.cancel});
  const opts={onFrame:(g,d)=>events.push(d)};await player.load(storm,'spectrum',false,opts);await player.load(storm,'wv',false,opts);const count=calls.length,n=native.length;
  await player.load(storm,'spectrum',false,opts);assert.equal(calls.length,count);assert.equal(native.length,n);assert.equal(events.at(-1).fromCache,true);assert.equal(player.hasFrame(storm,'spectrum'),true);
  await player.load(storm,'spectrum',true,opts);await flush();assert.equal(native.length,n);assert.equal(calls.filter(c=>c.animated==='1').length,1);player.dispose();
});
test('loop playback begins with two frames while the third is still loading; latest is decoded only once',async()=>{
  const {createPrimaryPlayer}=await mod('live-storms-primary-player'),middle=deferred(),oldest=deferred(),native=[],events=[],timers=clock();
  const player=createPrimaryPlayer({}, {now,api:async p=>({satellite:descriptor(p.animated==='1'?[frame(0),frame(1),frame(2)]:[frame(2)])}),nativeClient:{load:async f=>{const n=Number(f.files[0].split('/').at(-1));native.push(n);return n===2?grid(2):n===1?middle.promise:oldest.promise;},close(){}},render(){},getCoastlines:()=>null,isHidden:()=>false,schedule:timers.schedule,cancel:timers.cancel});
  await player.load(storm,'spectrum',true,{onFrame:(g,d)=>events.push({g,d})});await flush();assert.deepEqual(native,[2,1]);assert.equal(events[0].g.validAt,grid(2).validAt);
  middle.resolve(grid(1));await flush();assert.deepEqual(native,[2,1,0]);assert.equal(timers.count,1);timers.next();assert.equal(events.at(-1).d.loopFrames,2);assert.equal(events.at(-1).g.validAt,grid(1).validAt);
  oldest.resolve(grid(0));await flush();timers.next();assert.equal(events.at(-1).d.loopFrames,3);assert.equal(native.filter(n=>n===2).length,1);player.dispose();
});
test('cached frames appear before an expired inventory refresh, and failed refreshes retain the dated scan',async()=>{
  const {createPrimaryPlayer}=await mod('live-storms-primary-player');let time=now(),pending=null;const events=[];
  const player=createPrimaryPlayer({}, {now:()=>time,api:async()=>pending?pending.promise:{satellite:descriptor([frame(2)])},nativeClient:{load:async()=>grid(2),close(){}},render(){},getCoastlines:()=>null});
  await player.load(storm,'spectrum',false,{onFrame:(g,d)=>events.push(d)});time+=61000;pending=deferred();const loading=player.load(storm,'spectrum',false,{onFrame:(g,d)=>events.push(d)});assert.equal(events.at(-1).fromCache,true);assert.equal(events.at(-1).checking,true);
  pending.reject(Error('Offline'));await loading;assert.match(events.at(-1).loopNote,/Update check unavailable/);player.dispose();
});
test('switching while a scan is pending aborts it and its late result cannot replace the selected band',async()=>{
  const {createPrimaryPlayer}=await mod('live-storms-primary-player'),slow=deferred(),signals=[],events=[];let loads=0;
  const player=createPrimaryPlayer({}, {now,api:async()=>({satellite:descriptor([frame(2)])}),nativeClient:{load:async(f,o)=>{signals.push(o.signal);return ++loads===1?slow.promise:grid(2);},close(){}},render(){},getCoastlines:()=>null});
  const old=player.load(storm,'spectrum',false,{onFrame:()=>events.push('old')});await flush();await player.load(storm,'wv',false,{onFrame:()=>events.push('new')});assert.equal(signals[0].aborted,true);slow.resolve(grid(2));await old;assert.deepEqual(events,['new']);player.dispose();
});
test('native decoder workers are reused after completion and replaced after cancellation',async()=>{
  const {createHsdClient}=await mod('live-storms-hsd-client'),workers=[];
  const makeWorker=()=>{const w={messages:[],terminated:false,postMessage(m){this.messages.push(m);},terminate(){this.terminated=true;}};workers.push(w);return w;},client=createHsdClient({makeWorker});
  let result=client.load(frame(2));let w=workers[0];w.onmessage({data:{id:w.messages[0].id,grid:grid(2)}});await result;
  result=client.load(frame(1));assert.equal(workers.length,1);w.onmessage({data:{id:w.messages[1].id,grid:grid(1)}});await result;
  const controller=new AbortController();result=client.load(frame(0),{signal:controller.signal});controller.abort();await assert.rejects(result,{name:'AbortError'});assert.equal(w.terminated,true);
  result=client.load(frame(2));w=workers[1];w.onmessage({data:{id:w.messages[0].id,grid:grid(2)}});await result;assert.equal(workers.length,2);client.close();assert.equal(w.terminated,true);
});
