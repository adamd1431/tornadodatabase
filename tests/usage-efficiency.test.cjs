const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../usage-efficiency.js')).toString('base64');
const fresh=()=>import('data:text/javascript;base64,'+source+'#'+crypto.randomUUID());
const url='https://project.test/rest/v1/tornadoes?status=eq.approved';

test('simultaneous identical reads share one request and independent response bodies',async()=>{
  const {createCoalescedFetch}=await fresh();let count=0,release;
  const gate=new Promise(resolve=>release=resolve);
  const read=createCoalescedFetch(async()=>{count++;await gate;return new Response('[{"id":1}]',{headers:{'content-range':'0-0/1'}});},'https://project.test');
  const first=read(url),second=read(url);await Promise.resolve();assert.equal(count,1);release();
  const [a,b]=await Promise.all([first,second]);assert.deepEqual(await a.json(),[{id:1}]);assert.deepEqual(await b.json(),[{id:1}]);assert.equal(a.headers.get('content-range'),'0-0/1');
  await read(url);assert.equal(count,2,'reads after completion must remain fresh');
});

test('accounts, filters, ranges, and request semantics are isolated',async()=>{
  const {createCoalescedFetch}=await fresh();let count=0;
  const read=createCoalescedFetch(async()=>{count++;return new Response('[]');},'https://project.test');
  await Promise.all([
    read(url,{headers:{Authorization:'Bearer alice'}}),read(url,{headers:{Authorization:'Bearer bob'}}),
    read(url,{headers:{Range:'0-9'}}),read(url,{headers:{Range:'10-19'}}),
    read(url+'&name=eq.Joplin'),read(url,{redirect:'manual'}),read(url)
  ]);assert.equal(count,7);
});

test('writes, Auth, Storage, and cancellable requests are never combined',async()=>{
  const {createCoalescedFetch}=await fresh();const seen=[];
  const request=createCoalescedFetch(async(input,init)=>{seen.push([input,init]);return new Response('{}');},'https://project.test');
  const signal=new AbortController().signal;
  await Promise.all([
    request(url,{method:'PATCH',body:'{"name":"A"}'}),request(url,{method:'PATCH',body:'{"name":"A"}'}),
    request('https://project.test/auth/v1/user'),request('https://project.test/auth/v1/user'),
    request('https://project.test/storage/v1/object/public/uploads/a.png'),request('https://project.test/storage/v1/object/public/uploads/a.png'),
    request(url,{signal}),request(url,{signal})
  ]);assert.equal(seen.length,8);assert.equal(seen[0][1].body,'{"name":"A"}');assert.equal(seen[6][1].signal,signal);
});

test('a read started after a mutation cannot join an earlier read',async()=>{
  const {createCoalescedFetch}=await fresh();let reads=0,release;
  const gate=new Promise(resolve=>release=resolve);
  const request=createCoalescedFetch(async(_url,init)=>{if(init.method==='PATCH')return new Response('{}');reads++;const version=reads;await gate;return new Response(String(version));},'https://project.test');
  const old=request(url);await request(url,{method:'PATCH'});const updated=request(url);await Promise.resolve();assert.equal(reads,2);release();assert.equal(await (await old).text(),'1');assert.equal(await (await updated).text(),'2');
});

test('failed reads can be retried normally',async()=>{
  const {createCoalescedFetch}=await fresh();let calls=0;
  const request=createCoalescedFetch(async()=>{if(++calls===1)throw new Error('Offline');return new Response('ok');},'https://project.test');
  await assert.rejects(()=>request(url),/Offline/);assert.equal(await (await request(url)).text(),'ok');
});

test('aggregated counts keep exact totals without reading file URLs',async()=>{
  const {loadAggregateUploadCounts}=await fresh();let fallback=0;
  const client={rpc:async(name,args,options)=>{assert.equal(name,'approved_upload_counts');assert.equal(options.get,true);return {data:{counts:[{tornado_id:1,upload_count:320},{tornado_id:2,upload_count:80}],total:400},error:null};}};
  const result=await loadAggregateUploadCounts(client,()=>{fallback++;});assert.equal(result.counts.get('1'),320);assert.equal(result.total,400);assert.equal(fallback,0);
});

test('empty aggregated counts are valid; malformed counts use the original query',async()=>{
  const {loadAggregateUploadCounts}=await fresh();const fallback=()=>({original:true});
  const empty=await loadAggregateUploadCounts({rpc:async()=>({data:{counts:[],total:0}})},fallback);assert.equal(empty.total,0);
  const invalid=await loadAggregateUploadCounts({rpc:async()=>({data:{counts:[{tornado_id:1,upload_count:7}],total:8}})},fallback);assert.deepEqual(invalid,{original:true});
});

test('missing optional SQL falls back without repeated failing requests',async()=>{
  const {loadAggregateUploadCounts}=await fresh();let calls=0,fallbacks=0;
  const client={rpc:async()=>{calls++;return {error:{code:'PGRST202'}};}};
  const fallback=()=>{fallbacks++;return {counts:new Map(),total:0};};
  await loadAggregateUploadCounts(client,fallback);await loadAggregateUploadCounts(client,fallback);assert.equal(calls,1);assert.equal(fallbacks,2);
});

test('long media caching changes metadata only',async()=>{
  const {IMMUTABLE_UPLOAD_CACHE_CONTROL}=await fresh();assert.equal(IMMUTABLE_UPLOAD_CACHE_CONTROL,'31536000');
});

test('room presence retries failures, updates changed players, and restores after reconnect',async()=>{
  const vm=require('node:vm');
  const html=fs.readFileSync(path.join(__dirname,'../versus.html'),'utf8');
  const code=html.slice(html.indexOf('async function trackRoomPresence('),html.indexOf('function sendLobby('));
  let calls=0,player={id:'player',ready:false};
  const channel={track:async()=>++calls===1?'timed out':'ok'};
  const context=vm.createContext({channel,realtimeReady:true,trackedPresenceChannel:null,trackedPresenceSignature:'',currentPlayer:()=>({...player})});
  vm.runInContext(code,context);
  await context.trackRoomPresence();await context.trackRoomPresence();await context.trackRoomPresence();
  assert.equal(calls,2,'failed tracking must retry; successful unchanged tracking should be reused');
  player.ready=true;await context.trackRoomPresence();assert.equal(calls,3);
  await context.trackRoomPresence(true);assert.equal(calls,4,'reconnection must force tracking even with unchanged metadata');
  context.channel={track:async()=>{calls++;return 'ok';}};
  await context.trackRoomPresence();assert.equal(calls,5,'a new room channel must always track');
});
