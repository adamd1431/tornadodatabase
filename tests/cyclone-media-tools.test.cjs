const {test} = require('node:test');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const path = require('node:path'), crypto = require('node:crypto');
const load = name => import(pathToFileURL(path.join(__dirname,'../'+name)).href);
const crop = load('cyclone-cropper.js'), duplicates = load('cyclone-duplicates.js'), hashes = load('media-image-hash.js');
const hash = 'v2:0000000000000000:0000000000000000:0000000000000000';
const different = 'v2:ffffffffffffffff:ffffffffffffffff:ffffffffffffffff';
const check = (name, fingerprint='', imageHash=hash, type='image/png') => ({file:{name,size:50,type},fingerprint,imageHash,repeat_scan:false,repeatReasons:[]});

test('cyclone thumbnail and cover crops stay independent with safe legacy defaults',async()=>{
  const {cycloneCropSettings,cycloneCropUpdates,cycloneCropStyle}=await crop;
  const row={cover_position:'40% 70%',thumbnail_position:'20% 90%',thumbnail_fit:'contain',thumbnail_zoom:1.6,cover_fit:'cover',cover_zoom:1.2};
  assert.deepEqual(cycloneCropSettings(row),{fit:'contain',zoom:1.6,x:20,y:90});
  assert.deepEqual(cycloneCropSettings(row,'cover'),{fit:'cover',zoom:1.2,x:40,y:70});
  assert.deepEqual(cycloneCropSettings({cover_position:'40% 70%',thumbnail_zoom:null}),{fit:'cover',zoom:1,x:40,y:70});
  assert.deepEqual(cycloneCropSettings({thumbnail_fit:'bad',thumbnail_zoom:99,thumbnail_position:'-10% 200%'}),{fit:'cover',zoom:2.5,x:0,y:100});
  const updates=cycloneCropUpdates({fit:'contain',zoom:1.231,x:24.26,y:80.03});
  assert.deepEqual(updates,{thumbnail_fit:'contain',thumbnail_zoom:1.23,thumbnail_position:'24.3% 80%'});
  assert.equal(updates.cover_position,undefined);
  assert.match(cycloneCropStyle(row),/object-position:20% 90%;transform:scale\(1.6\)/);
  assert.equal(cycloneCropUpdates({zoom:1},'cover','new.png').cover_image,'new.png');
});

test('crop saving rechecks admin permissions and requires a confirmed database row',async()=>{
  const {saveCycloneCrop}=await crop;
  let owner=false,updated,reply={id:'cyclone'};
  const profile={select(){return profile;},eq(){return profile;},maybeSingle:async()=>({data:{role:owner?'owner':'user'}})};
  const q={update(value){updated=value;return q;},eq(){return q;},select(){return q;},single:async()=>({data:reply})};
  const client={auth:{getUser:async()=>({data:{user:{id:'member'}}})},from:table=>table==='profiles'?profile:q};
  await assert.rejects(()=>saveCycloneCrop(client,{id:'cyclone'},{x:20,y:80,zoom:1,fit:'cover'},'cover','new.png'),/Only admins/);
  assert.equal(updated,undefined);owner=true;
  await saveCycloneCrop(client,{id:'cyclone'},{x:20,y:80,zoom:1,fit:'cover'},'cover','new.png');
  assert.deepEqual(updated,{cover_fit:'cover',cover_zoom:1,cover_position:'20% 80%',cover_image:'new.png'});
  reply=null;await assert.rejects(()=>saveCycloneCrop(client,{id:'cyclone'},{},'thumbnail'),/did not confirm/);
});

test('shared image matching retains tornado hash formats and all three distance thresholds',async()=>{
  const {imageHashesLookSame}=await hashes;
  assert.equal(imageHashesLookSame(hash,hash),true);assert.equal(imageHashesLookSame(hash,different),false);
  assert.equal(imageHashesLookSame('0000000000000000','00000000000000ff'),true);
  assert.equal(imageHashesLookSame('0000000000000000','00000000000001ff'),false);
  assert.equal(imageHashesLookSame(hash,'v2:ffffffffffffffff:ffffffffffffffff:00000000000003ff'),true);
  assert.equal(imageHashesLookSame(hash,'v2:ffffffffffffffff:ffffffffffffffff:00000000000007ff'),false);
  assert.equal(imageHashesLookSame('bad','bad'),false);
});

test('shared fingerprints use the original byte sampling and ignore renamed files',async()=>{
  const {createUploadFingerprint}=await hashes;
  for(const size of [6,1024*1024+123,3*1024*1024]) {
    const bytes=Buffer.alloc(size);for(let i=0;i<size;i++)bytes[i]=(i*31)%251;
    const first=bytes.subarray(0,1024*1024),last=size>1024*1024?bytes.subarray(Math.max(1024*1024,size-1024*1024)):Buffer.alloc(0);
    const expected=crypto.createHash('sha256').update(Buffer.concat([Buffer.from(size+'|'),first,last])).digest('hex').slice(0,12);
    assert.equal(await createUploadFingerprint(new File([bytes],'one.png')),expected);
    assert.equal(await createUploadFingerprint(new File([bytes],'renamed.jpg')),expected);
  }
});

test('duplicate scanning catches renamed and reencoded photos across tabs without relying on image filenames',async()=>{
  const {findCycloneDuplicateWarnings}=await duplicates;
  const checks=[check('renamed.png','abc123'),check('new-compression.jpg','different'),check('same-name.png','unique',different)];
  const existing=[{id:'old',filename:'same-name.png',upload_fingerprint:'abc123',image_hash:hash,category:'satellite',status:'pending'}];
  const warnings=findCycloneDuplicateWarnings(checks,existing);
  assert.equal(checks[0].repeat_scan,true);assert.equal(checks[1].repeat_scan,true);assert.equal(checks[2].repeat_scan,false);
  assert.ok(warnings.some(value=>/Satellite imagery.*pending/.test(value)));
  const legacy=[check('copy.png','abcdef123456','')];
  findCycloneDuplicateWarnings(legacy,[{storage_path:'owner/cyclone/abcdef123456-12345678-aaaa-bbbb-cccc-123456789012-old.png',category:'photos',status:'approved'}]);
  assert.equal(legacy[0].repeat_scan,true);
});

test('selected duplicates flag later copies while retaining the first clean original',async()=>{
  const {findCycloneDuplicateWarnings}=await duplicates;
  const checks=[check('first.png','one'),check('second.png','two'),check('third.png','three',different)];
  findCycloneDuplicateWarnings(checks,[]);
  assert.deepEqual(checks.map(row=>row.repeat_scan),[false,true,false]);
  const document=check('report.pdf','','','application/pdf');
  findCycloneDuplicateWarnings([document],[{filename:'report.pdf',category:'models'}]);assert.equal(document.repeat_scan,true);
});

test('scan queries include pending/rejected media and page through all records for the current cyclone',async()=>{
  const {loadCycloneScanUploads}=await duplicates;
  const calls=[],rows=Array.from({length:1001},(_,i)=>({id:i,status:i%2?'pending':'rejected'}));
  let from=0,to=0;
  const q={select(){return q;},eq(key,value){calls.push([key,value]);return q;},order(){return q;},range(a,b){from=a;to=b;return q;},then(resolve){resolve({data:rows.slice(from,to+1)});}};
  assert.equal((await loadCycloneScanUploads({from:()=>q},'cyclone')).length,1001);
  assert.deepEqual(calls,[['cyclone_id','cyclone'],['cyclone_id','cyclone']]);
});

test('optional duplicate metadata falls back only for missing columns and never retries denied writes',async()=>{
  const {insertCycloneUpload}=await duplicates;
  const writes=[];let error={code:'PGRST204',message:'upload_fingerprint is missing'};
  const q={insert(row){writes.push(row);return q;},select(){return q;},single:async()=>{const reply={data:{id:'saved'},error};error=null;return reply;}};
  const row={id:'saved',filename:'photo.png',upload_fingerprint:'abc',image_hash:hash,repeat_scan:true,repeat_reason:'Existing photo'};
  await insertCycloneUpload({from:()=>q},row);assert.equal(writes.length,2);assert.equal(writes[1].image_hash,undefined);assert.equal(writes[1].filename,'photo.png');
  writes.length=0;error={code:'42501',message:'Denied'};
  await assert.rejects(()=>insertCycloneUpload({from:()=>q},row),value=>value.code==='42501');assert.equal(writes.length,1);
});

test('the cyclone upload flow scans before uploading, preserves original bytes, and carries repeat metadata',async()=>{
  const fs=require('node:fs'),vm=require('node:vm');
  const source=fs.readFileSync(path.join(__dirname,'../cyclone-page.js'),'utf8').replace(/^import .*;\r?\n/gm,'')
    .replace(/supabase\.auth\.onAuthStateChange\([^\n]+\);\s*load\(\);\s*$/,'');
  const elements=new Map();
  function element(key){if(!elements.has(key))elements.set(key,{textContent:'',addEventListener(){},querySelectorAll:()=>[]});return elements.get(key);}
  const original=new File(['unchanged original bytes'],'photo.png',{type:'image/png'}),copy=new File(['duplicate'],'copy.png',{type:'image/png'});
  let cancel=false,storedFile,storedOptions,inserted,uploads=0;
  const state={document:{getElementById:element},location:{search:'?id=cyclone'},URLSearchParams,crypto:globalThis.crypto,
    cycloneMediaCategoryLabel:String,cycloneImageCategory:()=>true,IMMUTABLE_UPLOAD_CACHE_CONTROL:'31536000',cycloneError:(error,fallback)=>fallback,
    safeCycloneFilename:(await duplicates).safeCycloneFilename,
    prepareCycloneUpload:async()=>cancel?null:[{file:original,fingerprint:'abc123',imageHash:hash,repeat_scan:true,repeatReasons:['Existing photo']}],
    insertCycloneUpload:async(client,row)=>{inserted=row;return row;},
    supabase:{storage:{from:()=>({upload:async(path,file,options)=>{uploads++;storedFile=file;storedOptions=options;return {error:null};},getPublicUrl:()=>({data:{publicUrl:'https://example.test/photo.png'}})})}}};
  const context=vm.createContext(state);vm.runInContext(source,context);
  vm.runInContext("actor={user:{id:'owner'},name:'Owner',isOwner:true,isAdmin:true};requireUser=async()=>true;renderMedia=()=>{};",context);
  const input={files:[original,copy],value:'selected'};state.testInput=input;
  await vm.runInContext('uploadFiles(testInput)',context);
  assert.equal(uploads,1);assert.equal(storedFile,original);assert.equal(storedOptions.upsert,false);
  assert.equal(inserted.image_hash,hash);assert.equal(inserted.repeat_scan,true);assert.equal(inserted.repeat_reason,'Existing photo');
  assert.match(inserted.storage_path,/abc123-.*-repeat-photo\.png$/);assert.match(element('cycloneUploadStatus').textContent,/Skipped 1 duplicate/);
  assert.equal(vm.runInContext('busy',context),false);
  cancel=true;await vm.runInContext('uploadFiles(testInput)',context);assert.equal(uploads,1);
  assert.match(element('cycloneUploadStatus').textContent,/Upload canceled/);assert.equal(vm.runInContext('busy',context),false);
});
