const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const model=import(pathToFileURL(path.join(__dirname,'../lossless-storage.js')).href);
const origin='https://project.supabase.co';
const sourceUrl=origin+'/storage/v1/object/public/uploads/source.png';
const image=new File(['smaller lossless bytes'],'optimized.webp',{type:'image/webp'});
const digest=file=>crypto.createHash('sha256').update(file).digest('hex');
const entry=async()=>({id:'image',bucket:'uploads',sourcePath:'source.png',sourceUrl,originalFilename:'source.png',originalSHA256:'a'.repeat(64),originalBytes:50000,sourceETag:'"original"',replacementFilename:image.name,replacementSHA256:digest(Buffer.from(await image.arrayBuffer())),replacementBytes:image.size,replacementMimeType:'image/webp',label:'Storm',verification:{pixels:true,frames:1}});
const plan=entries=>({version:1,lossless:true,projectUrl:origin,entries});

function fixture(options={}) {
  const calls=[],objects=new Map([['uploads/source.png',{id:'original-id',metadata:{size:50000,eTag:'"original"'}}]]);
  const tables={uploads:[{id:'media',file_url:sourceUrl,display_file_size:50000,status:'approved'}],tornadoes:[{id:'storm',cover_image:sourceUrl,path_image:null}],cyclone_uploads:[],tropical_cyclones:[]};
  const client={
    auth:{getUser:async()=>({data:{user:options.guest?null:{id:'owner'}}})},
    rpc:async()=>({data:options.owner!==false}),
    from(table) {
      let updates=null,filters=[],offset=0,end=999;
      const q={select(){return q},order(){return q},range(a,b){offset=a;end=b;return q},update(value){updates=value;return q},eq(field,value){filters.push([field,value]);return q},
        async maybeSingle() {
          calls.push({op:'update',table,updates,filters});
          if(options.denyUpdate)return {error:new Error('Denied update')};
          const row=tables[table].find(row=>filters.every(([field,value])=>row[field]===value));
          if(!row)return {data:null};Object.assign(row,updates);
          return options.unconfirmed?{data:null}:{data:{id:row.id}};
        },
        then(resolve,reject){
          if(options.readError)return Promise.reject(new Error('Read failed')).then(resolve,reject);
          return Promise.resolve({data:structuredClone(tables[table].slice(offset,end+1))}).then(resolve,reject);
        }
      };return q;
    },
    storage:{from(bucket){return {
      getPublicUrl:path=>({data:{publicUrl:`${origin}/storage/v1/object/public/${bucket}/${path}`}}),
      async list(folder,{search}) {
        return {data:[...objects.entries()].filter(([stored])=>stored.startsWith(bucket+'/')).map(([stored,row])=>({path:stored.slice(bucket.length+1),...row})).filter(row=>row.path.slice(0,Math.max(0,row.path.lastIndexOf('/')))===folder && row.path.split('/').pop()===search).map(row=>({...row,name:row.path.split('/').pop()}))};
      },
      async upload(path,file,settings) {
        calls.push({op:'upload',bucket,path,file,settings});
        if(options.uploadError)return {error:new Error('Upload failed')};
        objects.set(bucket+'/'+path,{id:'new-id',metadata:{size:file.size+(options.wrongSize?1:0),eTag:'"new-etag"'}});
        if(options.lateCover)tables.tornadoes.push({id:'new-cover',cover_image:sourceUrl});
        return {data:{path}};
      },
      async remove(paths) {
        calls.push({op:'remove',bucket,paths});
        if(!options.silentRemove)for(const path of paths)objects.delete(bucket+'/'+path);
        return {error:null};
      }
    };}}
  };
  return {client,calls,objects,tables,options};
}

test('batch preparation binds every selected file to its source project and exact verified bytes',async()=>{
  const {prepareLosslessBatch}=await model,e=await entry();
  const ready=await prepareLosslessBatch(plan([e]),[image],origin);assert.equal(ready.savedBytes,50000-image.size);
  for(const bad of [{...e,replacementSHA256:'b'.repeat(64)},{...e,sourceUrl:'https://foreign.test/storage/v1/object/public/uploads/source.png'},{...e,sourcePath:'../source.png'},{...e,verification:{pixels:true,frames:3}},{...e,replacementBytes:50001}])await assert.rejects(()=>prepareLosslessBatch(plan([bad]),[image],origin));
  await assert.rejects(()=>prepareLosslessBatch(plan([e]),[],origin),/Missing or changed/);
  await assert.rejects(()=>prepareLosslessBatch(plan([e,e]),[image],origin),/invalid/);
});

test('owner permission, persistent recovery storage and file hashes precede every cloud write',async()=>{
  const {prepareLosslessBatch,applyLosslessBatch}=await model,e=await entry(),batch=await prepareLosslessBatch(plan([e]),[image],origin);
  for(const options of [{owner:false},{guest:true},{readError:true}]) {
    const f=fixture(options);await assert.rejects(()=>applyLosslessBatch(f.client,batch));assert.equal(f.calls.length,0);
  }
  const f=fixture();const result=await applyLosslessBatch(f.client,batch,{onReceipt:()=>{throw new Error('Recovery storage unavailable')}});
  assert.equal(f.calls.length,0);assert.match(result.failures[0],/Recovery storage/);
  batch.entries[0].file=new File(['changed bytes'],'optimized.webp');await assert.rejects(()=>applyLosslessBatch(f.client,batch),/Missing or changed/);assert.equal(f.calls.length,0);
});

test('compression preserves media rows, categories and cover links, and verifies replacements before removing originals',async()=>{
  const {prepareLosslessBatch,applyLosslessBatch}=await model,e=await entry(),f=fixture();let recovery=[];
  const result=await applyLosslessBatch(f.client,await prepareLosslessBatch(plan([e]),[image],origin),{onReceipt:rows=>{recovery=structuredClone(rows)}});
  assert.deepEqual(result.failures,[]);assert.equal(result.savedBytes,50000-image.size);
  const upload=f.calls.find(c=>c.op==='upload');assert.equal(upload.settings.upsert,false);assert.equal(upload.settings.contentType,'image/webp');
  assert.equal(f.tables.uploads.length,1);assert.equal(f.tables.uploads[0].status,'approved');assert.equal(f.tables.uploads[0].display_file_size,image.size);
  assert.equal(f.tables.tornadoes[0].cover_image,f.tables.uploads[0].file_url);assert.equal(f.objects.has('uploads/source.png'),false);assert.equal(f.objects.has('uploads/'+upload.path),true);
  assert.equal(recovery[0].status,'finished');assert.equal(recovery[0].changes[0].before.file_url,sourceUrl);
  assert.ok(f.calls.findIndex(c=>c.op==='remove')>f.calls.map(c=>c.op).lastIndexOf('update'));
});

test('changed source objects, failed uploads, incorrect stored sizes and unconfirmed row updates never remove originals',async()=>{
  const {prepareLosslessBatch,applyLosslessBatch}=await model,e=await entry(),batch=await prepareLosslessBatch(plan([e]),[image],origin);
  for(const options of [{uploadError:true},{wrongSize:true},{unconfirmed:true},{denyUpdate:true}]) {
    const f=fixture(options),result=await applyLosslessBatch(f.client,batch);
    assert.ok(result.failures.length);assert.equal(f.objects.has('uploads/source.png'),true);assert.equal(f.calls.some(c=>c.op==='remove'),false);
  }
  const f=fixture();f.objects.get('uploads/source.png').metadata.eTag='changed';await applyLosslessBatch(f.client,batch);assert.equal(f.calls.length,0);
});

test('new cover references and silent storage denials prevent false space-recovery claims',async()=>{
  const {prepareLosslessBatch,applyLosslessBatch}=await model,e=await entry(),batch=await prepareLosslessBatch(plan([e]),[image],origin);
  for(const options of [{lateCover:true},{silentRemove:true}]) {
    const f=fixture(options),result=await applyLosslessBatch(f.client,batch);
    assert.ok(result.failures.length);assert.equal(result.savedBytes,0);assert.equal(f.objects.has('uploads/source.png'),true);
    if(options.lateCover)assert.equal(f.calls.some(c=>c.op==='remove'),false);
  }
});

test('a resumed batch finishes an interrupted replacement without uploading another copy',async()=>{
  const {prepareLosslessBatch,applyLosslessBatch}=await model,e=await entry(),batch=await prepareLosslessBatch(plan([e]),[image],origin),f=fixture({unconfirmed:true});let recovery=[];
  const first=await applyLosslessBatch(f.client,batch,{onReceipt:rows=>recovery=structuredClone(rows)});assert.ok(first.failures.length);assert.equal(recovery[0].status,'uploaded');
  f.options.unconfirmed=false;
  const second=await applyLosslessBatch(f.client,batch,{previous:recovery});assert.deepEqual(second.failures,[]);assert.equal(second.savedBytes,50000-image.size);assert.equal(f.calls.filter(c=>c.op==='upload').length,1);assert.equal(f.objects.has('uploads/source.png'),false);
});
