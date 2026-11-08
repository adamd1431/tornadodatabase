const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const model=import(pathToFileURL(path.join(__dirname,'../mcfetch-model.js')).href);
const api=import(pathToFileURL(path.join(__dirname,'../api/mcfetch.js')).href);
const png=fs.readFileSync(path.join(__dirname,'fixtures/image-import.png'));
const key='test-key-not-a-real-access-key';
const input={satellite:'HIMAWARI8',date:'2016-09-13',time:'17:15',latitude:21.5,longitude:121.4,band:13,width:900,height:700,magLine:-1,magElement:-2,map:true,enhancement:'BD',coverage:'FD'};
function request(body={...input,apiKey:key},options={}){return new Request('https://site.test/api/mcfetch',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://site.test',...options.headers},body:typeof body==='string'?body:JSON.stringify(body)});}

test('McFETCH coordinates flip east-positive longitude exactly once, with height then width',async()=>{
  const m=await model,u=m.mcfetchUrl(input,key);
  assert.equal(u.origin+u.pathname,m.MCFETCH_ENDPOINT);
  assert.equal(u.searchParams.get('lat'),'21.5 -121.4');
  assert.equal(u.searchParams.get('size'),'700 900');
  assert.equal(u.searchParams.get('time'),'17:15');
  assert.ok(u.search.includes('time=17:15'));assert.equal(u.search.includes('%3A'),false);
  assert.equal(u.searchParams.get('output'),'GIF');
  assert.equal(u.searchParams.get('eu'),'BD');
  assert.equal(m.mcfetchUrl({...input,longitude:-63.2},key).searchParams.get('lat'),'21.5 63.2');
});
test('settings reject impossible dates, future dates, missing coordinates and excess dimensions',async()=>{
  const m=await model;
  for(const patch of [{date:'2016-02-30'},{date:'2019-02-29'},{date:'2999-01-01'},{date:'1973-12-31'},{time:'25:00'},{latitude:''},{longitude:181},{width:1601},{height:63},{band:0},{band:1.5},{magLine:0},{enhancement:'../SECRET'},{coverage:'https://other.test'},{satellite:'other.test'}])assert.throws(()=>m.normalizeMcfetch({...input,...patch}),undefined,JSON.stringify(patch));
  assert.equal(m.normalizeMcfetch({...input,date:'2016-02-29'}).date,'2016-02-29');
});
test('normalization and exported names never carry the supplied access key',async()=>{
  const m=await model,s=m.normalizeMcfetch({...input,apiKey:key,url:'https://other.test'});
  assert.equal('apiKey'in s,false);assert.equal('url'in s,false);
  assert.equal(m.mcfetchFilename(s,'Super Typhoon Meranti'),'super-typhoon-meranti-himawari8-2016-09-13-1715z-band13.gif');
  assert.equal(JSON.stringify(s).includes(key),false);
});
test('proxy retrieves one image, preserves its bytes, and strips upstream headers and credentials',async()=>{
  const {createMcfetchHandler}=await api;const calls=[];
  const handler=createMcfetchHandler({read:async(url,opts)=>{calls.push({url,opts});return new Response(png,{headers:{'Content-Type':'image/png','Set-Cookie':'private=upstream','Location':'https://other.test/?dkey='+key}});}});
  const response=await handler.fetch(request());
  assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
  assert.equal(calls.length,1);assert.equal(calls[0].url.searchParams.get('dkey'),key);
  assert.equal(calls[0].opts.redirect,'error');assert.equal(calls[0].opts.headers.Authorization,undefined);
  assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Set-Cookie'),null);assert.equal(response.headers.get('Location'),null);
  assert.equal(JSON.stringify([...response.headers]).includes(key),false);
});
test('invalid requests and cross-origin callers never reach McFETCH',async()=>{
  const {createMcfetchHandler}=await api;let calls=0;const h=createMcfetchHandler({read:()=>{calls++;throw Error('Unexpected fetch');}});
  assert.equal((await h.fetch(new Request('https://site.test/api/mcfetch'))).status,405);
  assert.equal((await h.fetch(request({...input,apiKey:key},{headers:{Origin:'https://other.test'}}))).status,403);
  assert.equal((await h.fetch(request('plain text',{headers:{'Content-Type':'text/plain'}}))).status,415);
  assert.equal((await h.fetch(request({padding:'x'.repeat(9000)}))).status,413);
  assert.equal((await h.fetch(request('{broken'))).status,400);
  assert.equal((await h.fetch(request({...input,apiKey:''}))).status,400);
  assert.equal((await h.fetch(request({...input,apiKey:key,latitude:''}))).status,400);
  assert.equal(calls,0);
});
test('upstream errors, including HTML with echoed keys, never expose their contents',async()=>{
  const {createMcfetchHandler}=await api;
  for(const upstream of [()=>new Response('<html>'+key+'</html>',{headers:{'Content-Type':'text/html'}}),()=>new Response(key,{status:403}),()=>new Response('<html>not PNG</html>',{headers:{'Content-Type':'image/png'}}),()=>{throw Error('Failed URL ?dkey='+key);}]){
    const h=createMcfetchHandler({read:async()=>upstream()}),r=await h.fetch(request());
    assert.notEqual(r.status,200);assert.equal((await r.text()).includes(key),false);
  }
});
test('oversized streamed responses stop reading, even without Content-Length',async()=>{
  const {createMcfetchHandler}=await api;const m=await model;let cancelled=false;
  const stream=new ReadableStream({pull(c){c.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled=true;}});
  const h=createMcfetchHandler({read:async()=>new Response(stream,{headers:{'Content-Type':'image/png'}})});
  const response=await h.fetch(request());assert.equal(response.status,413);assert.equal(cancelled,true);
});
test('valid image bytes work with generic upstream content types and preserve scan seconds',async()=>{
  const {createMcfetchHandler}=await api;const h=createMcfetchHandler({read:async()=>new Response(png,{headers:{'Content-Type':'application/octet-stream'}})});
  const response=await h.fetch(request({...input,apiKey:key,time:'17:15:30'}));assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'image/png');assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
  const m=await model;assert.match(m.mcfetchFilename({...input,time:'17:15:30'}),/-171530z-/);
  assert.ok(m.mcfetchUrl({...input,time:'17:15:30'},key).search.includes('time=17:15:30'));
});
test('credential and quota errors are distinguished without returning echoed secrets',async()=>{
  const {createMcfetchHandler}=await api;
  for(const [text,code,status]of [[`Invalid dkey: ${key}`,'key',403],[`Daily transaction limit exceeded: ${key}`,'quota',429]]){
    const h=createMcfetchHandler({read:async()=>new Response(text,{headers:{'Content-Type':'text/html'}})}),r=await h.fetch(request());const d=await r.json();assert.equal(r.status,status);assert.equal(d.code,code);assert.equal(JSON.stringify(d).includes(key),false);
  }
});
