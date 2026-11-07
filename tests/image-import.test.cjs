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
const tabTransfer=import(asModule(fs.readFileSync(path.join(root,'browser-extension/image-import/tab-transfer.js'),'utf8')
  .replace("'./common.js'",JSON.stringify(commonUrl)).replace("'./delivery.js'",JSON.stringify(asModule(deliverySource)))));

function currentTabHarness(options={}) {
  const calls=[],updated=new Set(),removed=new Set(),extension='chrome-extension://fixture/',tabId=42;
  let tab={id:tabId,status:'complete',url:extension+'send.html#'+id};
  const api={runtime:{id:'fixture',getURL:file=>extension+file},permissions:{contains:async()=>options.granted!==false},
    tabs:{get:async()=>({...tab}),create:async()=>{throw Error('Must not create a tab');},
      update:async(target,edits)=>{calls.push(['update',target,edits]);tab={...tab,...edits,url:options.redirect||edits.url};return tab;},
      onUpdated:{addListener:fn=>updated.add(fn),removeListener:fn=>updated.delete(fn)},
      onRemoved:{addListener:fn=>removed.add(fn),removeListener:fn=>removed.delete(fn)}},
    scripting:{executeScript:async request=>{calls.push(['script',request]);return [{result:options.accepted!==false}];}}};
  return {api,calls,updated,removed,tabId,sender:{id:'fixture',url:tab.url,tab:{id:tabId}},message:{tabId,site:'https://tornadodatabase.vercel.app/',payload},setUrl:url=>{tab.url=url;}};
}

test('Continue reuses the sender tab and delivers identical image bytes after navigation',async()=>{
  const {prepareCurrentTabImport}=await tabTransfer,h=currentTabHarness();
  const run=await prepareCurrentTabImport(h.api,h.message,h.sender);
  assert.equal(h.calls.length,0,'Preparation must finish before the sender is navigated away.');
  await run();
  assert.equal(h.calls[0][0],'update');assert.equal(h.calls[0][1],h.tabId);
  assert.equal(h.calls[0][2].url,'https://tornadodatabase.vercel.app/image-import.html#capture='+id);
  const request=h.calls[1][1];assert.equal(request.target.tabId,h.tabId);
  assert.equal(request.args[0].base64,payload.base64);assert.equal(request.args[0].pageUrl,payload.pageUrl);
  assert.equal(h.updated.size,0);assert.equal(h.removed.size,0);
});

test('same-tab handoff rejects unrelated senders, tabs, missing access and invalid payloads before navigation',async()=>{
  const {prepareCurrentTabImport}=await tabTransfer;
  const cases=[h=>{h.sender.id='other';},h=>{h.sender.url='https://unrelated.example/';},h=>{h.sender.tab.id=7;},h=>{h.message.tabId=-1;},
    h=>h.setUrl('https://unrelated.example/'),h=>{h.message.payload={...payload,id:'bad'};},h=>{h.message.payload={...payload,mime:'image/svg+xml'};}];
  for(const edit of cases){const h=currentTabHarness();edit(h);await assert.rejects(()=>prepareCurrentTabImport(h.api,h.message,h.sender));assert.equal(h.calls.length,0);}
  const denied=currentTabHarness({granted:false});await assert.rejects(()=>prepareCurrentTabImport(denied.api,denied.message,denied.sender),/Allow access/);assert.equal(denied.calls.length,0);
  const changed=currentTabHarness(),run=await prepareCurrentTabImport(changed.api,changed.message,changed.sender);
  changed.setUrl('https://unrelated.example/');await assert.rejects(run,/sender tab has changed/);assert.equal(changed.calls.length,0);
});

test('redirected picker pages never receive the image and failed acceptance remains an error',async()=>{
  const {prepareCurrentTabImport}=await tabTransfer,h=currentTabHarness({redirect:'https://unrelated.example/'});
  await assert.rejects(async()=>(await prepareCurrentTabImport(h.api,h.message,h.sender))(),/redirected/);
  assert.equal(h.calls.filter(call=>call[0]==='script').length,0);
  const failed=currentTabHarness({accepted:false});await assert.rejects(async()=>(await prepareCurrentTabImport(failed.api,failed.message,failed.sender))(),/did not confirm/);
  assert.equal(failed.calls.filter(call=>call[0]==='update').length,1);
});

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
  const result=await uploadImportedImage(record,'research',client,async(input,category,options)=>{
    assert.equal(category,'research');assert.equal(input.files.length,1);assert.equal(input.files[0].name,'photo.png');
    assert.deepEqual(options,{scanDuplicates:true});
    assert.equal(input.files[0].type,'image/png');assert.deepEqual(Buffer.from(await input.files[0].arrayBuffer()),png);
    return {saved:1};
  });
  assert.deepEqual(result,{saved:1});
  await assert.rejects(()=>uploadImportedImage(record,'photos',client,async()=>{throw new Error('duplicate scan failed');}),/duplicate scan failed/);
});

function importPageHarness(record) {
  const records=new Map([[record.id,record]]),transactions=[];
  let active=false,mounted=null;
  const pump=()=>{
    if(active || !transactions.length)return;
    active=true;
    const {transaction,operations}=transactions.shift();
    queueMicrotask(()=>{
      while(operations.length) {
        const {request,action}=operations.shift();request.result=action();request.onsuccess?.();
      }
      transaction.oncomplete?.();active=false;pump();
    });
  };
  const db={close(){},transaction(){
    const transaction={},operations=[];
    const request=action=>{const request={};operations.push({request,action});return request;};
    transaction.objectStore=()=>({
      get:key=>request(()=>records.get(key)),
      put:value=>request(()=>records.set(value.id,value)),
      delete:key=>request(()=>records.delete(key))
    });
    transactions.push({transaction,operations});pump();return transaction;
  }};
  class Element extends EventTarget {
    constructor(){super();this.textContent='';this.value='';this.disabled=false;this.hidden=false;this.children=[];this.nodes=new Map();}
    append(child){this.children.push(child);}
    querySelector(selector){if(!this.nodes.has(selector))this.nodes.set(selector,new Element());return this.nodes.get(selector);}
    remove(){if(mounted===this)mounted=null;}
  }
  const names=['indexedDB','document','location','history'],previous=Object.fromEntries(names.map(name=>[name,globalThis[name]]));
  const location={href:'https://example.test/tropical-cyclone.html?id=storm-1&imageImport='+record.id,search:'?id=storm-1&imageImport='+record.id};
  Object.assign(globalThis,{
    indexedDB:{open(){const request={};queueMicrotask(()=>{request.result=db;request.onsuccess();});return request;}},
    document:{getElementById:name=>name==='imageImportReview'?mounted:null,createElement:()=>new Element()},
    location,history:{replaceState(a,b,url){location.href=String(url);location.search=new URL(url).search;}}
  });
  return {records,section:()=>mounted,resetPage:()=>{mounted=null;},
    host:{before:section=>{mounted=section;},scrollIntoView(){}},
    restore(){for(const name of names)if(previous[name]===undefined)delete globalThis[name];else globalThis[name]=previous[name];}
  };
}

test('arriving on the selected storm automatically starts the scan pipeline once and clears successful transfers',async()=>{
  const {prepareImageImport,mountImageImport}=await bridge;
  const record={...prepareImageImport(payload),destination:{kind:'cyclone',targetId:'storm-1',category:'satellite'}};
  const page=importPageHarness(record);let calls=0;
  const options={kind:'cyclone',targetId:'storm-1',categories:[['satellite','Satellite imagery']],host:page.host,
    client:{auth:{getUser:async()=>({data:{user:{id:'owner'}}})}},
    upload:async(input,category,options)=>{
      calls++;assert.equal(category,'satellite');assert.equal(options.scanDuplicates,true);
      assert.ok(page.records.get(id).uploadStartedAt);
      assert.equal(page.section().querySelector('[data-import-upload]').hidden,true);
      assert.equal(page.section().querySelector('select').disabled,true);
      return {saved:1};
    }};
  try {
    await Promise.all([mountImageImport(options),mountImageImport(options)]);
    assert.equal(calls,1);assert.equal(page.records.has(id),false);
    assert.equal(new URL(location.href).searchParams.has('imageImport'),false);
    assert.equal(page.section().querySelector('h2').textContent,'Image uploaded');
    page.resetPage();await mountImageImport(options);assert.equal(calls,1);
  } finally {page.restore();}
});

test('canceled scans retain the image, reloads do not resubmit it, and an explicit retry can finish',async()=>{
  const {prepareImageImport,mountImageImport}=await bridge;
  const record={...prepareImageImport(payload),destination:{kind:'tornado',targetId:'123',category:'research'}};
  const page=importPageHarness(record);let calls=0;
  const options={kind:'tornado',targetId:'123',categories:[['research','Research']],host:page.host,
    client:{auth:{getUser:async()=>({data:{user:{id:'owner'}}})}},upload:async()=>({saved:++calls>1?1:0})};
  try {
    await mountImageImport(options);assert.equal(calls,1);assert.equal(page.records.has(id),true);
    assert.equal(page.section().querySelector('[data-import-upload]').hidden,false);
    page.resetPage();await mountImageImport(options);assert.equal(calls,1);
    page.section().querySelector('[data-import-upload]').dispatchEvent(new Event('click'));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls,2);assert.equal(page.records.has(id),false);
  } finally {page.restore();}
});

test('automatic imports keep signed-out images available without calling the upload handler',async()=>{
  const {prepareImageImport,mountImageImport}=await bridge;
  const record={...prepareImageImport(payload),destination:{kind:'cyclone',targetId:'storm-1',category:'satellite'}};
  const page=importPageHarness(record);let calls=0;
  try {
    await mountImageImport({kind:'cyclone',targetId:'storm-1',categories:[['satellite','Satellite']],host:page.host,
      client:{auth:{getUser:async()=>({data:{user:null}})}},upload:async()=>{calls++;}});
    assert.equal(calls,0);assert.equal(page.records.has(id),true);
    assert.match(page.section().querySelector('[data-import-status]').textContent,/Log in/);
    assert.equal(page.section().querySelector('[data-import-upload]').hidden,false);
  } finally {page.restore();}
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
