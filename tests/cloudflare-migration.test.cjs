const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const root=path.join(__dirname,'..'),mod=name=>import(pathToFileURL(path.join(root,name+'.js')).href);
const sid='2022266N12294',storm={id:sid,name:'IAN',season:2022,start:'2022-09-23 00:00:00',end:'2022-09-30 18:00:00',atcf:['AL092022']};

test('Cloudflare redirect compatibility refuses redirects without contacting another destination',async()=>{
  const {installRedirectCompatibility}=await mod('cloudflare/fetch-compat'),calls=[];
  const target={fetch:async(input,options)=>{calls.push({input,options});return new Response(null,{status:302,headers:{Location:'https://untrusted.test/'}});}};
  installRedirectCompatibility(target);
  await assert.rejects(()=>target.fetch('https://www.nhc.noaa.gov/source',{redirect:'error'}),/redirect was refused/);
  assert.equal(calls.length,1);assert.equal(calls[0].options.redirect,'manual');assert.equal(calls[0].input,'https://www.nhc.noaa.gov/source');
});

test('Cloudflare recon keeps requests below the free subrequest limit and validates every batch',async()=>{
  const {createCloudflareArchiveHandler}=await mod('cloudflare/recon-archive');let reads=0;
  const filenames=Array.from({length:31},(_,i)=>`AHONT1-KWBC.20220928${String(Math.floor(i/4)).padStart(2,'0')}${String((i%4)*15).padStart(2,'0')}.txt`);
  const handler=createCloudflareArchiveHandler('hdob',{storms:[storm],read:async url=>{reads++;return new Response(url.endsWith('/')?filenames.map(name=>`<a href="${name}">${name}</a>`).join(''):'original aircraft message');}});
  const url='https://site.test/api/recon-flights?sid='+sid+'&date=2022-09-28';
  const plan=await (await handler.fetch(new Request(url))).json();assert.equal(plan.total,31);assert.equal(plan.batchSize,12);assert.equal(plan.partial,false);
  reads=0;const batch=await (await handler.fetch(new Request(url+'&batch=1'))).json();assert.equal(reads,12);assert.equal(batch.messages.length,12);assert.equal(batch.partial,false);
  assert.equal((await handler.fetch(new Request(url+'&batch=99'))).status,400);
  assert.equal((await handler.fetch(new Request(url.replace('2022-09-28','2020-09-28')))).status,400);
});

test('browser recon assembly retains same-pass JWT observations and marks failed batches incomplete',async()=>{
  const {readReconArchive}=await mod('recon-archive-client');
  const text=fs.readFileSync(path.join(__dirname,'fixtures/recon/ian-2022-peak-vdm.txt'),'utf8');
  const initial={browserRecon:true,sid,date:'2022-09-28',start:storm.start,end:storm.end,kind:'vortex',total:13,batchSize:12,sources:[],partial:false};
  const result=await readReconArchive('/api/recon-data?view=passes',{read:async url=>!url.includes('batch=')?Response.json(initial):url.endsWith('batch=0')?Response.json({...initial,batch:0,messages:[{text,atcf:'AL092022',sourceUrl:'https://www.nhc.noaa.gov/source.txt',archive:'nhc'}]}):new Response('unavailable',{status:502})});
  assert.equal(result.status,'found');assert.equal(result.partial,true);assert.ok(result.passes.some(row=>row.flightWindKt===160&&row.rmwNmi===15));
});

test('Cloudflare pressure proxies only a validated NOAA time and preserves the exact numeric subset',async()=>{
  const {createCloudflarePressureHandler}=await mod('cloudflare/pressure');let calls=0;
  const bytes=Buffer.from([137,72,68,70,13,10,26,10]);
  const handler=createCloudflarePressureHandler({read:async url=>{calls++;assert.equal(new URL(url).hostname,'psl.noaa.gov');return new Response(bytes);}});
  assert.equal((await handler.fetch(new Request('https://site.test/api/poci-roci?date=../secret&mode=field'))).status,400);assert.equal(calls,0);
  const plan=await (await handler.fetch(new Request('https://site.test/api/poci-roci?date=1992-11-21&time=0000'))).json();assert.equal(plan.browserAnalysis,true);assert.equal(calls,0);
  const result=await handler.fetch(new Request('https://site.test/api/poci-roci?date=1992-11-21&time=0000&mode=field'));assert.deepEqual(Buffer.from(await result.arrayBuffer()),bytes);assert.equal(calls,1);
});

test('large archived images keep exact bytes and byte ranges without an R2 binding',async()=>{
  const {serveLargeAsset}=await mod('cloudflare/large-assets'),bytes=Buffer.from('original animation bytes'),chunks=[bytes.subarray(0,8),bytes.subarray(8,16),bytes.subarray(16)];
  let reads=0;const env={ASSETS:{fetch:async request=>{reads++;return new Response(chunks[Number(new URL(request.url).pathname.slice(1))]);}}};
  const asset={size:bytes.length,chunkSize:8,chunks:['/0','/1','/2'],mime:'image/webp',etag:'"original"'};
  const all=await serveLargeAsset(new Request('https://site.test/image.webp'),env,asset);assert.deepEqual(Buffer.from(await all.arrayBuffer()),bytes);
  const part=await serveLargeAsset(new Request('https://site.test/image.webp',{headers:{Range:'bytes=6-18'}}),env,asset);assert.equal(part.status,206);assert.deepEqual(Buffer.from(await part.arrayBuffer()),bytes.subarray(6,19));
  const before=reads;assert.equal((await serveLargeAsset(new Request('https://site.test/image.webp',{method:'HEAD'}),env,asset)).headers.get('Content-Length'),String(bytes.length));assert.equal(reads,before);
  assert.equal((await serveLargeAsset(new Request('https://site.test/image.webp',{headers:{Range:'bytes=99-100'}}),env,asset)).status,416);
});
