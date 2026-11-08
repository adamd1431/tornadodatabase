const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const model=import(pathToFileURL(path.join(__dirname,'../mcfetch-inventory.js')).href);
const api=import(pathToFileURL(path.join(__dirname,'../api/mcfetch.js')).href);
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/ssec-durian-20061129.json'),'utf8'));
const input={satellite:'MTSAT1R',date:'2006-11-29',time:'12:00',latitude:13.6,longitude:127.5,band:2,enhancement:'BD',coverage:''};
test('Durian uses the real 11:33 full disk rather than the 12:00 southern scan',async()=>{
  const {selectInventoryScan}=await model;const scan=selectInventoryScan(fixture,input);
  assert.equal(scan.date,'2006-11-29');assert.equal(scan.time,'11:33:00');assert.equal(scan.coverage,'FD');assert.equal(scan.offsetMinutes,-27);assert.equal(scan.requested.time,'12:00');
  assert.equal(selectInventoryScan(fixture,{...input,latitude:-13.6}).time,'12:00:00');
  assert.throws(()=>selectInventoryScan(fixture,{...input,coverage:'NH'}),/No scan/);
});
test('only requested satellite, band, visibility, window and supported coverage can match',async()=>{
  const {selectInventoryScan,hasBand}=await model;
  for(const patch of [{satellite:'GOES18'},{band:13},{longitude:-60},{date:'2006-12-01'}])assert.throws(()=>selectInventoryScan(fixture,{...input,...patch}),/No scan/);
  assert.equal(hasBand('1, 3-5, 13',4),true);assert.equal(hasBand('2-5',1),false);
  assert.throws(()=>selectInventoryScan({},input),/could not be read/);
});
test('time selection crosses UTC midnight correctly and retains scan seconds',async()=>{
  const {selectInventoryScan}=await model;const data={data:[{n:'MTSAT-1R',h:['imagetime','bandmap','coverage'],d:[['2006-11-28 23:33:17','2','FD']]}]};
  const s=selectInventoryScan(data,{...input,time:'00:00'});assert.equal(s.date,'2006-11-28');assert.equal(s.time,'23:33:17');assert.ok(s.offsetMinutes<0);
});
test('inventory requests are fixed to SSEC, omit keys and cache public responses',async()=>{
  const {readInventory,INVENTORY_ENDPOINT}=await model;let calls=0;const cache=new Map();
  const read=async url=>{calls++;assert.equal(url.origin+url.pathname,INVENTORY_ENDPOINT);assert.equal(url.searchParams.get('satellite'),'MTSAT-1R');assert.equal(url.searchParams.has('dkey'),false);return new Response(JSON.stringify(fixture));};
  await readInventory({...input,apiKey:'not-forwarded'},{read,cache});await readInventory(input,{read,cache});assert.equal(calls,1);
});
test('public scan action needs no McFETCH key and never contacts the image service',async()=>{
  const {createMcfetchHandler}=await api;const {INVENTORY_ENDPOINT}=await model;
  const h=createMcfetchHandler({read:async url=>{assert.equal(url.origin+url.pathname,INVENTORY_ENDPOINT);return new Response(JSON.stringify(fixture));}});
  const r=await h.fetch(new Request('https://site.test/api/mcfetch',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://site.test'},body:JSON.stringify({...input,action:'scan'})}));assert.equal(r.status,200);const d=await r.json();assert.equal(d.time,'11:33:00');assert.equal('apiKey'in d,false);
});
test('unavailable and oversized inventory responses fail without producing a scan',async()=>{
  const {readInventory}=await model;
  await assert.rejects(readInventory(input,{read:async()=>new Response('',{status:503})}),/unavailable/);
  await assert.rejects(readInventory(input,{read:async()=>new Response('not JSON')}),/could not be read/);
  let cancelled=false;await assert.rejects(readInventory(input,{read:async()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(1048577));},cancel(){cancelled=true;}}))}),/too large/);assert.equal(cancelled,true);
});
