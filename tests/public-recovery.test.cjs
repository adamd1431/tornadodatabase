const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
let sequence=0;
const fresh=()=>import(pathToFileURL(path.join(__dirname,'../public-recovery.js')).href+'?test='+(sequence++));
const origin='https://project.test',base='https://site.test/index.html';
const denied=()=>new Response('{"message":"Project restricted"}',{status:402,headers:{'Content-Type':'application/json'}});

test('restricted public reads preserve filtering, projection, ordering, pagination and single-row semantics',async()=>{
  const m=await fresh(),notices=[];
  const data={generatedAt:'2026-11-01T03:20:55Z',resources:{cyclones:{rows:[{id:'one',status:'approved',name:'One',year:2010,owner_estimated_winds_mph:170,user_id:'private'},{id:'two',status:'approved',name:'Two',year:2020,owner_estimated_winds_mph:200}]}}};
  const fetch=m.createPublicRecoveryFetch(denied,origin,{base,read:async()=>new Response(JSON.stringify(data)),onRecovery:value=>notices.push(value)});
  const response=await fetch(origin+'/rest/v1/tropical_cyclones?select=id,name&status=eq.approved&owner_estimated_winds_mph=gte.0&order=year.desc&limit=1');
  assert.deepEqual(await response.json(),[{id:'two',name:'Two'}]);assert.equal(response.headers.get('Content-Range'),'0-0/2');assert.equal(notices.length,1);
  const one=await fetch(origin+'/rest/v1/tropical_cyclones?id=eq.one',{headers:{Accept:'application/vnd.pgrst.object+json'}});
  const row=await one.json();assert.equal(row.id,'one');assert.equal(row.user_id,undefined);
  const absent=await fetch(origin+'/rest/v1/tropical_cyclones?id=eq.missing',{headers:{Accept:'application/vnd.pgrst.object+json'}});assert.equal(absent.status,406);
});

test('gallery recovery is scoped to an approved parent and never exposes review queues, profiles or writes',async()=>{
  const m=await fresh(),seen=[],reads=[];
  const fetch=m.createPublicRecoveryFetch(async(input,init)=>{seen.push(init?.method||'GET');return denied();},origin,{base,onRecovery(){},read:async url=>{reads.push(url);return new Response(JSON.stringify({resource:'cyclone_uploads',parentId:'one',generatedAt:'2026-11-01T03:20:55Z',rows:[{id:'photo',cyclone_id:'one',status:'approved',category:'satellite',file_url:'https://site.test/media-archive/photo.jpg',repeat_reason:'private'}]}));}});
  const response=await fetch(origin+'/rest/v1/cyclone_uploads?cyclone_id=eq.one&status=neq.rejected&select=*');
  const rows=await response.json();assert.equal(rows.length,1);assert.equal(rows[0].repeat_reason,undefined);assert.ok(reads[0].endsWith('/cyclone/one.json'));
  assert.equal((await fetch(origin+'/rest/v1/cyclone_uploads?cyclone_id=eq.one&status=eq.pending')).status,402);
  assert.equal((await fetch(origin+'/rest/v1/profiles?select=*')).status,402);
  assert.equal((await fetch(origin+'/rest/v1/cyclone_uploads',{method:'POST',body:'{}'})).status,402);assert.ok(seen.includes('POST'));
  assert.equal((await fetch(origin+'/rest/v1/cyclone_uploads?select=*')).status,402);
});

test('healthy backend responses remain authoritative and invalid snapshots fail closed',async()=>{
  const m=await fresh();let reads=0;
  const fetch=m.createPublicRecoveryFetch(async()=>new Response('[{"id":"live"}]'),origin,{base,read:async()=>{reads++;throw Error('Must not load snapshot');}});
  assert.deepEqual(await(await fetch(origin+'/rest/v1/tornadoes')).json(),[{id:'live'}]);assert.equal(reads,0);
  const bad=m.createPublicRecoveryFetch(denied,origin,{base,read:async()=>new Response('{"resources":{"tornadoes":{"rows":[{"id":"hidden","status":"pending"}]}}}')});
  assert.equal((await bad(origin+'/rest/v1/tornadoes')).status,402);
});

test('published recovery files exclude private fields and every gallery stays within approved parents',()=>{
  const root=path.join(__dirname,'../public-data'),catalog=JSON.parse(fs.readFileSync(path.join(root,'catalogs.json'),'utf8'));
  const forbidden=['user_id','created_by','submitted_by','pending_description','repeat_reason','repeat_scan','upload_fingerprint','image_hash'];
  for(const key of ['tornadoes','cyclones','outbreaks'])for(const row of catalog.resources[key].rows){assert.equal(row.status,'approved');for(const field of forbidden)assert.equal(Object.hasOwn(row,field),false);}
  for(const [kind,resource,parentField] of [['tornado','tornadoes','tornado_id'],['cyclone','cyclones','cyclone_id']])for(const parent of catalog.resources[resource].rows){
    const gallery=JSON.parse(fs.readFileSync(path.join(root,'galleries',kind,parent.id+'.json'),'utf8'));
    assert.equal(gallery.parentId,parent.id);for(const row of gallery.rows){assert.equal(row.status,'approved');assert.equal(row[parentField],parent.id);for(const field of forbidden)assert.equal(Object.hasOwn(row,field),false);}
  }
});
