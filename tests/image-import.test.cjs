const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const asModule=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const commonSource=fs.readFileSync(path.join(root,'browser-extension/image-import/common.js'),'utf8');
const commonUrl=asModule(commonSource),common=import(commonUrl);
const bridge=import(asModule(fs.readFileSync(path.join(root,'image-import-bridge.js'),'utf8').replace("'./browser-extension/image-import/common.js'",JSON.stringify(commonUrl))));
const deliverySource=fs.readFileSync(path.join(root,'browser-extension/image-import/delivery.js'),'utf8');
const png=fs.readFileSync(path.join(root,'tests/fixtures/image-import.png'));
const id='2c1f040e-ff2a-4bf5-b9f6-fecf17c6b96c';
const payload={id,name:'photo.png',mime:'image/png',base64:png.toString('base64'),imageUrl:'https://images.example/storm.png',pageUrl:'https://example.test/storm'};

test('database settings accept HTTPS and local previews and reject unsafe destinations',async()=>{
  const {DEFAULT_SITE,siteUrl,webUrl}=await common;
  assert.equal(DEFAULT_SITE,'https://tornadodatabase.vercel.app/');
  assert.equal(siteUrl('https://example.test/database/index.html?id=x#test'),'https://example.test/database/');
  assert.equal(siteUrl('http://127.0.0.1:8765'),'http://127.0.0.1:8765/');
  for(const url of ['javascript:alert(1)','file:///C:/secret.png','https://name:password@example.test/','http://example.test/'])assert.throws(()=>siteUrl(url));
  for(const url of ['blob:https://example.test/abc','data:image/png;base64,AAAA','https://user:secret@example.test/p.png'])assert.throws(()=>webUrl(url));
});
test('image names use the actual media type and cannot escape into paths',async()=>{
  const {imageName}=await common;
  assert.equal(imageName('https://example.test/path/photo.jpg?format=png','image/png'),'photo.png');
  assert.equal(imageName('https://example.test/%2e%2e%2fstorm%22%3e.png','image/png'),'storm-.png');
  assert.equal(imageName('https://example.test/','image/jpeg'),'web-image.jpg');
  assert.throws(()=>imageName('https://example.test/a.svg','image/svg+xml'));
});
test('streamed image downloads enforce byte limits and reject nonimage responses',async()=>{
  const {readImageResponse,MAX_IMAGE_BYTES}=await common;
  const image=await readImageResponse(new Response(png,{headers:{'content-type':'image/png'}}));
  assert.equal(image.type,'image/png');assert.deepEqual(Buffer.from(await image.arrayBuffer()),png);
  await assert.rejects(()=>readImageResponse(new Response(png,{status:403})),/403/);
  await assert.rejects(()=>readImageResponse(new Response('<html>not an image</html>',{headers:{'content-type':'text/html'}})),/supported image/);
  await assert.rejects(()=>readImageResponse(new Response(png,{headers:{'content-type':'image/png','content-length':String(MAX_IMAGE_BYTES+1)}})),/20 MB/);
  await assert.rejects(()=>readImageResponse(new Response(new Uint8Array(MAX_IMAGE_BYTES+1),{headers:{'content-type':'image/png'}})),/20 MB/);
  await assert.rejects(()=>readImageResponse(new Response('not a PNG',{headers:{'content-type':'image/png'}})),/does not match/);
});
test('transfer payloads preserve the exact original bytes, source, filename, and expiry timestamp',async()=>{
  const {prepareImageImport}=await bridge;
  const record=prepareImageImport(payload,12345);
  assert.equal(record.id,id);assert.equal(record.name,'photo.png');assert.equal(record.createdAt,12345);
  assert.equal(record.pageUrl,payload.pageUrl);assert.equal(record.imageUrl,payload.imageUrl);
  assert.deepEqual(Buffer.from(await record.blob.arrayBuffer()),png);
});
test('malformed or executable transfer payloads fail before browser storage or uploads',async()=>{
  const {prepareImageImport}=await bridge;
  for(const edit of [{id:'../target'},{mime:'image/svg+xml'},{base64:'!invalid'},{base64:''},{base64:Buffer.from('<script>alert(1)</script>').toString('base64')},{imageUrl:'file:///C:/private'},{pageUrl:'javascript:alert(1)'}])assert.throws(()=>prepareImageImport({...payload,...edit}));
});
test('import destinations encode record IDs and bind a staged image to one storm and category',async()=>{
  const {importDestinationUrl,matchesImportDestination}=await bridge;
  const url=new URL(importDestinationUrl('tornado','123',id,'https://example.test/database/image-import.html'));
  assert.equal(url.pathname,'/database/tornado.html');assert.equal(url.searchParams.get('id'),'123');assert.equal(url.searchParams.get('imageImport'),id);
  const record={destination:{kind:'cyclone',targetId:'storm-1',category:'satellite'}};
  assert.equal(matchesImportDestination(record,'cyclone','storm-1',[['satellite','Satellite']]),true);
  for(const [kind,target,categories] of [['tornado','storm-1',[['satellite','Satellite']]],['cyclone','storm-2',[['satellite','Satellite']]],['cyclone','storm-1',[['photos','Photos']]]])assert.equal(matchesImportDestination(record,kind,target,categories),false);
  for(const kind of ['outbreak','constructor',''])assert.throws(()=>importDestinationUrl(kind,'1',id,'https://example.test/'));
  assert.throws(()=>importDestinationUrl('tornado','../../other',id,'https://example.test/'));
});
test('signed-out users and failed authentication never reach the existing upload handler',async()=>{
  const {prepareImageImport,uploadImportedImage}=await bridge;
  let calls=0;
  for(const result of [{data:{user:null},error:null},{data:{user:{id:'user'}},error:new Error('expired')}]) {
    const client={auth:{getUser:async()=>result}};
    await assert.rejects(()=>uploadImportedImage(prepareImageImport(payload),'photos',client,()=>{calls++;}),/Log in/);
  }
  assert.equal(calls,0);
});
test('authenticated imports reuse the existing file pipeline without bypassing approval or duplicate checks',async()=>{
  const {prepareImageImport,uploadImportedImage}=await bridge;
  const record=prepareImageImport(payload),client={auth:{getUser:async()=>({data:{user:{id:'user'}},error:null})}};
  const result=await uploadImportedImage(record,'research',client,async(input,category)=>{
    assert.equal(category,'research');assert.equal(input.files.length,1);assert.equal(input.files[0].name,'photo.png');
    assert.equal(input.files[0].type,'image/png');assert.deepEqual(Buffer.from(await input.files[0].arrayBuffer()),png);
    return {saved:1};
  });
  assert.deepEqual(result,{saved:1});
  await assert.rejects(()=>uploadImportedImage(record,'photos',client,async()=>{throw new Error('duplicate scan failed');}),/duplicate scan failed/);
});

function deliveryHarness(onPost) {
  let receive;
  const window={addEventListener:(name,fn)=>{receive=fn;},removeEventListener:()=>{receive=null;},postMessage:(message,origin)=>{onPost(message,origin,dispatch);}};
  const origin='https://tornadodatabase.vercel.app';
  const dispatch=(data,overrides={})=>queueMicrotask(()=>receive?.({data,source:window,origin,...overrides}));
  const context={window,location:{origin},setInterval,clearInterval,setTimeout,clearTimeout,payload};
  return {run:()=>vm.runInNewContext(deliverySource.replace('export function','function')+'\ndeliverImage(payload,50);',context),window};
}
test('extension bridge sends bytes only after a matching same-origin readiness signal and waits for acceptance',async()=>{
  let transfers=0;
  const harness=deliveryHarness((message,origin,dispatch)=>{
    assert.equal(origin,'https://tornadodatabase.vercel.app');
    if(message.type==='utwx:image-offer') {
      dispatch({type:'utwx:image-ready',id:'wrong'});
      dispatch({type:'utwx:image-ready',id},{origin:'https://unrelated.example'});
      dispatch({type:'utwx:image-ready',id},{source:{}});
      dispatch({type:'utwx:image-ready',id});
    }
    if(message.type==='utwx:image-data'){transfers++;assert.equal(message.base64,payload.base64);dispatch({type:'utwx:image-accepted',id});}
  });
  assert.equal(await harness.run(),true);assert.equal(transfers,1);
});
test('extension bridge reports a missing receiver and propagates a rejected transfer',async()=>{
  await assert.rejects(()=>deliveryHarness(()=>{}).run(),/did not respond/);
  await assert.rejects(()=>deliveryHarness((message,origin,dispatch)=>{
    if(message.type==='utwx:image-offer')dispatch({type:'utwx:image-ready',id});
    if(message.type==='utwx:image-data')dispatch({type:'utwx:image-error',id,message:'storage unavailable'});
  }).run(),/storage unavailable/);
});
test('extension install requests image menus and optional per-host access without cookie or permanent all-site access',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'browser-extension/image-import/manifest.json'),'utf8'));
  assert.equal(manifest.manifest_version,3);assert.ok(manifest.permissions.includes('contextMenus'));
  assert.equal(manifest.permissions.includes('cookies'),false);assert.equal(manifest.host_permissions,undefined);
  assert.ok(manifest.optional_host_permissions.includes('https://*/*'));
});
