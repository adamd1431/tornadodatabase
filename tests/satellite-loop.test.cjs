const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const mod=n=>import(pathToFileURL(path.join(__dirname,'../'+n+'.js')).href);
const frame=(n,slot=n)=>({slot,validAt:new Date(Date.UTC(2026,10,9,0,n*10)).toISOString()});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function clock(){let serial=0;const tasks=new Map();return {schedule(fn,delay){tasks.set(++serial,{fn,delay});return serial;},cancel(id){tasks.delete(id);},async next(){const [id,task]=tasks.entries().next().value;tasks.delete(id);await task.fn();return task.delay;},get size(){return tasks.size;},get delay(){return tasks.values().next().value?.delay;}};}
test('dedicated viewer defaults are 30 real frames, 10 fps and no skipped scans; invalid bounds are rejected',async()=>{
  const m=await mod('satellite-loop-model');assert.deepEqual(m.LOOP_DEFAULTS,{frames:30,fps:10,skip:0});assert.deepEqual(m.loopSettings(),m.LOOP_DEFAULTS);for(const v of [{frames:1},{frames:61},{fps:0},{fps:31},{skip:-1},{skip:6},{skip:.5}])assert.throws(()=>m.loopSettings(v));
  assert.equal(m.satelliteLoopUrl({id:'WP312026'},'wv'),'satellite-loop.html?storm=WP312026&product=wv');
});
test('frame selection anchors skipping at the latest scan and returns chronological unique source frames',async()=>{
  const m=await mod('satellite-loop-model'),all=Array.from({length:60},(_,i)=>frame(i));assert.deepEqual(m.selectLoopFrames(all,30).map(p=>p.slot),Array.from({length:30},(_,i)=>i+30));assert.deepEqual(m.selectLoopFrames(all,3,1).map(p=>p.slot),[55,57,59]);assert.equal(m.selectLoopFrames(all.slice(0,2),30).length,2);
});
test('playback holds the newest scan until the complete loop is sealed, then uses every frame at 100 ms',async()=>{
  const {createLoopPlayback}=await mod('satellite-loop-playback'),timers=clock(),shown=[],player=createLoopPlayback({onFrame:f=>shown.push(f.slot),schedule:timers.schedule,cancel:timers.cancel,now:()=>0});
  await player.add(frame(29));await player.add(frame(28));await player.add(frame(27));player.setPlaying(true);assert.equal(timers.size,0);assert.deepEqual(shown,[29]);assert.equal(player.getState().ready,false);await player.seek(1);assert.deepEqual(shown,[29]);
  player.finishLoading();assert.equal(timers.delay,100);await timers.next();assert.equal(shown.at(-1),27);await timers.next();assert.equal(shown.at(-1),28);await timers.next();assert.equal(shown.at(-1),29);assert.equal(timers.delay,100);
  await player.add(frame(26));assert.equal(player.getFrames().length,3);player.dispose();assert.equal(timers.size,0);
});
test('pausing, manual stepping and seeking stop autoplay; changing fps changes timers without reloading observations',async()=>{
  const {createLoopPlayback}=await mod('satellite-loop-playback'),timers=clock(),shown=[],p=createLoopPlayback({onFrame:f=>shown.push(f.slot),schedule:timers.schedule,cancel:timers.cancel,now:()=>0});await p.add(frame(0));await p.add(frame(1));p.finishLoading();p.setPlaying(false);assert.equal(timers.size,0);await p.step(-1);assert.equal(shown.at(-1),1);assert.equal(p.getState().playing,false);await p.seek(0);p.setSpeed(20);p.setPlaying(true);assert.equal(timers.delay,50);assert.equal(p.getFrames().length,2);p.dispose();
});
test('pausing while buffering is respected when loading finishes, and a single available scan stays still',async()=>{
  const {createLoopPlayback}=await mod('satellite-loop-playback'),timers=clock(),p=createLoopPlayback({onFrame(){},schedule:timers.schedule,cancel:timers.cancel,now:()=>0});await p.add(frame(0));await p.add(frame(1));p.setPlaying(false);p.finishLoading();assert.equal(timers.size,0);assert.equal(p.getState().playing,false);p.setPlaying(true);assert.equal(timers.delay,100);p.dispose();
  const one=createLoopPlayback({onFrame(){},schedule:timers.schedule,cancel:timers.cancel});await one.add(frame(0));one.finishLoading();assert.equal(timers.size,0);assert.equal(one.getState().playing,false);one.dispose();
});
test('disposing during a pending render cannot restart an obsolete loop',async()=>{
  const {createLoopPlayback}=await mod('satellite-loop-playback'),timers=clock();let resolve;const pending=new Promise(r=>resolve=r),p=createLoopPlayback({onFrame:()=>pending,schedule:timers.schedule,cancel:timers.cancel,now:()=>0});const job=p.add(frame(0));p.dispose();resolve();await job;await flush();assert.equal(timers.size,0);
});
test('native history discovers 30 complete scans with bounded hourly listings and real missing frames remain missing',async()=>{
  const {createPrimaryService}=await mod('live-storms-upstream'),m=await mod('live-storms-primary'),storm={id:'WP312026',latitude:23.8,longitude:135,validAt:'2026-11-09T00:00Z'},now=()=>new Date('2026-11-09T05:55Z'),calls=[];
  const keys=[];for(let i=0;i<36;i++){const date=new Date(Date.UTC(2026,10,9,0,i*10)),stamp=date.toISOString().replace(/[-:T]/g,'').slice(0,12);keys.push(...m.hsdPlan(storm,'spectrum',stamp).files.map(s=>s.slice(m.HSD_ROOT.length)));}
  const text=async url=>{calls.push(url);const prefix=new URL(url).searchParams.get('prefix');return keys.filter(k=>k.startsWith(prefix)).map(k=>'<Key>'+k+'</Key>').join('');};
  const service=createPrimaryService({text,cached:(_k,_t,fn)=>fn(),now}),result=await service.charts(storm,'spectrum',true,{frames:30,skip:0});assert.equal(result.satellite.frames.length,30);assert.ok(calls.length<12);assert.equal(result.satellite.frames.at(-1).validAt,'2026-11-09T05:50:00.000Z');assert.ok(result.satellite.frames.every(f=>f.files.length===2));
  keys.splice(0,keys.length,...keys.slice(-3));const sparse=await service.charts(storm,'spectrum',true,{frames:30,skip:0});assert.equal(sparse.satellite.frames.length,1);
});
test('loop query parameters are bounded and cannot expand unrelated endpoints or accept arbitrary source paths',async()=>{
  const {createLiveStormsHandler}=await mod('api/live-storms'),handler=createLiveStormsHandler({read:async()=>{throw Error('Should not fetch invalid input');}});
  for(const suffix of ['view=charts&frames=100','view=charts&frames=-1','view=charts&frames=30&skip=6','view=storms&frames=30','view=charts&skip=0','view=charts&frames=30&frames=30'])assert.equal((await handler.fetch(new Request('https://test/api/live-storms?'+suffix))).status,400);
});
test('GOES history preserves chronological order and a scan outside the selected inventory cannot be proxied',async()=>{
  const {createPrimaryService}=await mod('live-storms-upstream'),storm={id:'CP042026',latitude:11.6,longitude:-157.2,validAt:'2026-11-09T06:00Z'},folder='satellite/goes/west/products/CloudAndMoistureImagery/FullDisk/Channel13/current/',files=Array.from({length:48},(_,i)=>{
    const d=new Date(Date.UTC(2026,10,9,0,i*10)),day=Math.floor((d-Date.UTC(2026,0,1))/86400000)+1,scan=String(d.getUTCFullYear())+String(day).padStart(3,'0')+String(d.getUTCHours()).padStart(2,'0')+String(d.getUTCMinutes()).padStart(2,'0')+'000';return `${folder}OR_ABI-L2-CMIPF-M6C13_G18_s${scan}_e${scan}_c${scan}.nc`;
  }),cache=new Map(),text=async url=>url.endsWith('.das')?fs.readFileSync(path.join(__dirname,'fixtures/live-primary/goes.das'),'utf8'):url.endsWith('.dds')?fs.readFileSync(path.join(__dirname,'fixtures/live-primary/goes.dds'),'utf8'):files.map(p=>`<dataset urlPath="${p}"/>`).join('');
  const service=createPrimaryService({text,binary:()=>{throw Error('Must not fetch unknown scans');},cached:async(k,t,fn)=>{if(!cache.has(k))cache.set(k,await fn());return cache.get(k);},now:()=>new Date('2026-11-09T08:00Z')});
  const d=await service.charts(storm,'spectrum',true,{frames:30,skip:0});assert.equal(d.satellite.frames.length,30);assert.ok(Date.parse(d.satellite.frames[0].validAt)<Date.parse(d.satellite.frames.at(-1).validAt));
  await assert.rejects(service.grid(storm,'spectrum','20250010000000',{frames:30,skip:0}),/recent inventory/);
});
test('local GIF encoder preserves frame count, canvas dimensions and 100 ms frame delays',async()=>{
  const {GIFEncoder}=await mod('assets/vendor/gifenc'),gif=GIFEncoder();for(let i=0;i<30;i++)gif.writeFrame(new Uint8Array([i%2,1,0,1]),2,2,{palette:[[0,0,0],[255,255,255]],delay:100,repeat:0});gif.finish();const bytes=gif.bytes();assert.equal(Buffer.from(bytes.subarray(0,6)).toString(),'GIF89a');assert.equal(bytes[6]+256*bytes[7],2);const controls=[];for(let i=0;i<bytes.length-7;i++)if(bytes[i]===33&&bytes[i+1]===249&&bytes[i+2]===4)controls.push(bytes[i+4]+256*bytes[i+5]);assert.equal(controls.length,30);assert.ok(controls.every(v=>v===10));
});
