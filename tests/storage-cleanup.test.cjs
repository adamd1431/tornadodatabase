const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const model=import('data:text/javascript;base64,'+fs.readFileSync(path.join(__dirname,'../storage-cleanup.js')).toString('base64'));
const origin='https://project.supabase.co',now=Date.parse('2026-10-29T12:00:00Z');
const url=(bucket,path)=>`${origin}/storage/v1/object/public/${bucket}/${encodeURIComponent(path)}`;
const file=(bucket,path,createdAt='2026-10-25T00:00:00Z')=>({bucket,path,bytes:100,createdAt,item:{}});
test('both buckets protect covers, originals, pending media, raw cyclone paths, embedded links and encoded names',async()=>{
  const {classifyStorageFiles,storageFileKey}=await model;
  const files=['display.png','original.png','cover.png','linked space.png','bare.png','unused.png'].map(p=>file('uploads',p));
  files.push(...['raw.png','cover.png','unused.png'].map(p=>file('cyclone-uploads',p)));
  const tables={uploads:[{id:'1',status:'pending',file_url:url('uploads','display.png'),original_file_url:url('uploads','original.png')}],tornadoes:[{path_image:'bare.png',cover_image:url('uploads','cover.png'),description:`[source](${url('uploads','linked space.png')})`}],cyclone_uploads:[{storage_path:'raw.png',status:'pending'}],tropical_cyclones:[{cover_image:url('cyclone-uploads','cover.png')}]};
  const scan=classifyStorageFiles({tables,files,origin,now});
  assert.deepEqual(scan.orphanFiles.map(storageFileKey),['uploads/unused.png','cyclone-uploads/unused.png']);assert.equal(scan.originalFiles.length,0);assert.equal(scan.totalBytes,900);
});
test('original backups are removable only when their displayed file exists and no other cover or media uses them',async()=>{
  const {classifyStorageFiles}=await model;
  const tables={uploads:[{id:'1',status:'approved',file_url:url('uploads','display.png'),original_file_url:url('uploads','original.png')}],tornadoes:[]};
  const files=['display.png','original.png'].map(p=>file('uploads',p));
  assert.deepEqual(classifyStorageFiles({tables,files,origin,now}).originalFiles[0].uploadIds,['1']);
  tables.tornadoes.push({cover_image:url('uploads','original.png')});assert.equal(classifyStorageFiles({tables,files,origin,now}).originalFiles.length,0);
  tables.tornadoes=[];assert.equal(classifyStorageFiles({tables,files:files.slice(1),origin,now}).originalFiles.length,0);
  assert.equal(classifyStorageFiles({tables,files:[files[0],file('uploads','original.png','2026-10-29T00:00:00Z')],origin,now}).originalFiles.length,0);
});
test('recent, recently updated and undated files never become orphan cleanup targets',async()=>{
  const {classifyStorageFiles}=await model;
  const files=[file('uploads','new','2026-10-29T00:00:00Z'),file('uploads','unknown',''),{...file('uploads','updated'),item:{updated_at:'2026-10-29T11:00:00Z'}},file('uploads','old')];
  assert.deepEqual(classifyStorageFiles({tables:{},files,origin,now}).orphanFiles.map(f=>f.path),['old']);
});
test('storage breakdown ranks actual byte totals and identifies the storm for large files',async()=>{
  const {classifyStorageFiles}=await model;
  const files=[{...file('cyclone-uploads','storm/large.gif'),bytes:40000000},{...file('uploads','photo.jpeg'),bytes:2000000},{...file('uploads','photo.jpg'),bytes:1000000}];
  const tables={tropical_cyclones:[{id:'storm',name:'Sinlaku',year:2026}],cyclone_uploads:[{cyclone_id:'storm',storage_path:'storm/large.gif',filename:'animation.gif'}]};
  const scan=classifyStorageFiles({tables,files,origin,now});assert.deepEqual(scan.formats,[{extension:'gif',count:1,bytes:40000000},{extension:'jpg',count:2,bytes:3000000}]);assert.equal(scan.largestFiles[0].label,'Sinlaku (2026)');assert.equal(scan.largestFiles[0].filename,'animation.gif');
});
function fixture({owner=true,readError=false,referenced=false}={}) {
  const calls=[];
  const client={auth:{getUser:async()=>({data:{user:{id:'owner'}}})},rpc:async()=>({data:owner}),from(table){let start,end;const q={select(){return q},order(){return q},range(a,b){start=a;end=b;return q},then(resolve,reject){const rows=table==='uploads'?Array.from({length:1001},(_,i)=>({id:String(i),file_url:referenced&&i===1000?url('uploads','orphan.png'):null})):[];return Promise.resolve({data:rows.slice(start,end+1),error:readError?new Error('Read failed'):null}).then(resolve,reject)}};return q;},storage:{from(bucket){return{getPublicUrl:p=>({data:{publicUrl:url(bucket,p)}}),list:async()=>({data:bucket==='uploads'?[{id:'object',name:'orphan.png',created_at:'2020-01-01T00:00:00Z',metadata:{size:100}}]:[]}),remove:async paths=>{calls.push({bucket,paths});return{error:null}}}}}};
  return {client,calls};
}
test('owner permission and all reference pages must be checked before scanning or deleting',async()=>{
  const {scanStorage,removeScannedStorageFiles}=await model;
  const denied=fixture({owner:false});await assert.rejects(()=>scanStorage(denied.client),/Only the Owner/);assert.equal(denied.calls.length,0);
  const broken=fixture({readError:true});await assert.rejects(()=>removeScannedStorageFiles(broken.client,[file('uploads','orphan.png')],'orphan'),/Read failed/);assert.equal(broken.calls.length,0);
  const changed=fixture({referenced:true});await assert.rejects(()=>removeScannedStorageFiles(changed.client,[file('uploads','orphan.png')],'orphan'),/now in use/);assert.equal(changed.calls.length,0,'a reference on the second page prevents deletion');
  const good=fixture();assert.equal((await scanStorage(good.client)).orphanFiles.length,1);await removeScannedStorageFiles(good.client,[file('uploads','orphan.png')],'orphan');assert.deepEqual(good.calls,[{bucket:'uploads',paths:['orphan.png']}]);
});
