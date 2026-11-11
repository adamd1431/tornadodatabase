const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const mod=n=>import(pathToFileURL(path.join(__dirname,'../'+n+'.js')).href),sid='2005041S13181',uid='11111111-1111-4111-8111-111111111111',cid='22222222-2222-4222-8222-222222222222';
const storm={id:sid,name:'OLAF',season:2005,start:'2005-02-10 00:00:00',end:'2005-02-25 00:00:00',basins:['SP']};
const photo={kind:'photo',sid,url:'https://upload.wikimedia.org/wikipedia/commons/6/61/Olaf_2005.jpg',sourcePage:'https://commons.wikimedia.org/wiki/File:Olaf_2005.jpg',title:'Olaf 2005.jpg',author:'NASA',license:'Public domain'};
const track={...photo,kind:'track',url:'https://upload.wikimedia.org/wikipedia/commons/8/86/Olaf_2005_path.png',title:'Olaf 2005 path.png'};
const satellite={...photo,kind:'satellite',url:`https://ncics.org/ibtracs/hursat/2005/${sid}.OLAF.2005.02.16.1200.43.GOE-10.124.hursat-b1.v07.png`,sourcePage:'https://ncics.org/ibtracs/index.php?name=v04r01-'+sid,title:'IBTrACS Olaf',author:'NOAA / NCICS',at:'2005-02-16T12:00:00Z'};

test('Wikipedia extraction distinguishes the infobox picture and track from decorations and other storms',async()=>{
  const {wikiImageNames}=await mod('ibtracs-media-sources'),parsed={title:'Cyclone Olaf',properties:[{name:'defaultsort','*':'Olaf (2005)'},{name:'page_image_free','*':'Olaf_2005.jpg'}],images:['Commons-logo.svg','Olaf_2005.jpg','Olaf_2005_path.png','Nancy_2005_track.png','2005_season_summary.png']};
  assert.deepEqual(wikiImageNames(parsed,storm),{photo:'Olaf 2005.jpg',track:'Olaf 2005 path.png'});assert.equal(wikiImageNames({...parsed,title:'Cyclone Olaf (2003)'},storm),null);assert.equal(wikiImageNames({...parsed,title:'Cyclone Nancy (2005)'},storm),null);
});

test('Wikipedia alternate names come from the matching storm caption or explicit lead alias',async()=>{
  const {wikiStormIdentity}=await mod('ibtracs-media-sources'),s={...storm,name:'HAIYAN',season:2013,start:'2013-11-02',end:'2013-11-11'},page={title:'Typhoon Haiyan',properties:[{name:'defaultsort','*':'Haiyan (2013)'}],text:{'*':'<caption class="infobox-title">Typhoon Haiyan (Yolanda)</caption>'}};
  assert.equal(wikiStormIdentity(page,s,'https://en.wikipedia.org/wiki/Typhoon_Haiyan').alternateName,'Yolanda');
  const n={...s,name:'NANCY',season:1961},nancy={title:'Typhoon Nancy (1961)',text:{'*':'<caption class="infobox-title">Typhoon Nancy<br/><small>2nd Muroto Typhoon</small></caption>'}};
  assert.equal(wikiStormIdentity(nancy,n,'https://en.wikipedia.org/wiki/Typhoon_Nancy_(1961)').alternateName,'2nd Muroto Typhoon');
  const lead={...page,text:{'*':'<table></table><p><b>Typhoon Haiyan</b>, known in the Philippines as <b>Super Typhoon Yolanda</b>, was powerful.</p>'}};
  assert.equal(wikiStormIdentity(lead,s,'https://en.wikipedia.org/wiki/Typhoon_Haiyan').alternateName,'Yolanda');
  assert.equal(wikiStormIdentity({...page,title:'Typhoon Haiyan (2001)'},s,''),null);
});

test('Wikipedia identity is retained even when a matching article has no usable images',async()=>{
  const {wikipediaProfile}=await mod('ibtracs-media-sources'),s={...storm,name:'NANCY',season:1961};
  const result=await wikipediaProfile(s,async()=>Response.json({parse:{title:'Typhoon Nancy (1961)',text:{'*':'<caption class="infobox-title">Typhoon Nancy<br><small>2nd Muroto Typhoon</small></caption>'},images:[]}}));
  assert.equal(result.identity.alternateName,'2nd Muroto Typhoon');assert.deepEqual(result.items,[]);
});

test('Wikipedia season redirects extract the exact storm section instead of the season image',async()=>{
  const {wikipediaSources}=await mod('ibtracs-media-sources'),calls=[];
  const read=async value=>{const u=new URL(value),p=u.searchParams;calls.push(p);
    if(p.get('action')==='query')return Response.json({query:{pages:[{title:'File:Olaf 2005.jpg',imageinfo:[{url:photo.url,descriptionurl:photo.sourcePage,extmetadata:{Artist:{value:'<a href="https://example.com">NASA</a>'},LicenseShortName:{value:'Public domain'}}}]},{title:'File:Olaf 2005 path.png',imageinfo:[{url:track.url,descriptionurl:track.sourcePage}]}]}});
    if(p.get('section')==='7')return Response.json({parse:{title:'2004–05 South Pacific cyclone season',text:{'*':'<td class="infobox-image"><a href="/wiki/File:Olaf_2005.jpg">Photo</a></td>'},images:['Olaf_2005.jpg','Olaf_2005_path.png']}});
    return Response.json({parse:{title:'2004–05 South Pacific cyclone season',text:{'*':''},properties:[{name:'page_image_free','*':'Season_summary.png'}],sections:[{line:'Cyclone Nancy',index:'6',anchor:'Nancy'},{line:'Severe Tropical Cyclone Olaf',index:'7',anchor:'Olaf'}]}});
  };
  const items=await wikipediaSources(storm,read);assert.equal(items.length,2);assert.equal(items[0].kind,'photo');assert.equal(items[0].author,'NASA');assert.equal(items[1].kind,'track');assert.match(items[0].article,/#Olaf$/);assert.equal(calls.find(p=>p.has('section')).get('section'),'7');assert.ok(!calls.some(p=>p.get('titles')?.includes('Season_summary')));
});

test('NCICS extraction keeps the original satellite URL and its actual UTC, not the selected best-track observation',async()=>{
  const {ncicsSatelliteSource}=await mod('ibtracs-media-sources'),html=`<img src="html/plots/v04r01.${sid}.png"><img src="hursat/2005/${sid}.OLAF.2005.02.16.1200.43.GOE-10.124.hursat-b1.v07.png">`,source=ncicsSatelliteSource(html,storm);
  assert.equal(source.url,satellite.url);assert.equal(source.at,'2005-02-16T12:00:00Z');assert.equal(source.kind,'satellite');assert.equal(ncicsSatelliteSource(html,{...storm,id:'2009325N06148'}),null);assert.equal(ncicsSatelliteSource('<img src="https://evil.example/test.png">',storm),null);
});

test('a Wikipedia outage retains available IBTrACS imagery and surfaces a retryable source warning',async()=>{
  const {gatherIbtracsMedia}=await mod('ibtracs-media-sources'),result=await gatherIbtracsMedia(storm,async url=>url.startsWith('https://ncics.org/')?new Response(`<img src="${satellite.url}">`):new Response('',{status:503}));
  assert.equal(result.items.length,1);assert.equal(result.items[0].kind,'satellite');assert.match(result.warnings[0],/Wikipedia/);
});

test('source locators preserve provenance and reject private destinations, cross-storm satellites and invalid encodings',async()=>{
  const m=await mod('ibtracs-media-model'),locator=m.importedSourcePath(uid,cid,photo),url=m.importedSourceUrl(locator),saved=m.sourceFromImportUrl(url);
  assert.equal(saved.url,photo.url);assert.equal(saved.userId,uid);assert.equal(saved.cycloneId,cid);assert.equal(saved.license,'Public domain');assert.match(m.sourceCredit(saved),/NASA/);
  for(const value of ['http://upload.wikimedia.org/wikipedia/commons/a/a.png','https://127.0.0.1/private.png','https://upload.wikimedia.org.evil.test/wikipedia/commons/a/a.png','https://upload.wikimedia.org:444/wikipedia/commons/a/a.png','https://upload.wikimedia.org/wikipedia/commons/a/a.svg'])assert.equal(m.safeSourceImage(value),null);
  assert.throws(()=>m.normalizeSource({...satellite,sid:'2009325N06148'}));assert.throws(()=>m.normalizeSource({...photo,kind:'toString'}));assert.equal(m.sourceFromImportPath(uid+'/'+cid+'/ibtracs-source/NOTJSON.png'),null);assert.equal(m.sourceFromImportUrl(url.replace('tornadodatabase.vercel.app','evil.test')),null);
});

function fixture(){const rows=new Map(),calls=[],state={cover:null};return {rows,calls,state,client:{from(table){const filter={},q={row:null,patch:null,select(){return q;},eq(k,v){filter[k]=v;return q;},is(){return q;},insert(row){q.row=row;return q;},update(value){q.patch=value;return q;},async maybeSingle(){return {data:rows.get(filter.id)||null};},async single(){calls.push(['insert',q.row.category]);rows.set(q.row.id,{...q.row});return {data:rows.get(q.row.id)};},then(resolve,reject){calls.push(['cover',q.patch]);const data=state.cover===null?(state.cover=q.patch.cover_image,[{id:filter.id,cover_image:state.cover}]):[];return Promise.resolve({data}).then(resolve,reject);}};return q;}}};}
const admin=async()=>({user:{id:uid},name:'Owner',isAdmin:true,isOwner:true});

test('source import saves photo, track and satellite categories, sets the photo thumbnail, and never uploads storage bytes',async()=>{
  const {importCycloneSources}=await mod('ibtracs-media-import'),{sourceFromImportUrl}=await mod('ibtracs-media-model'),f=fixture();let heads=0;
  const result=await importCycloneSources(f.client,cid,[photo,track,satellite],{getActor:admin,read:async()=>{heads++;return new Response(null,{headers:{'Content-Type':'image/png'}});}});
  assert.equal(result.count,3);assert.equal(heads,3);assert.deepEqual([...f.rows.values()].map(r=>r.category).sort(),['photos','satellite','track']);assert.ok([...f.rows.values()].every(r=>r.status==='approved'&&r.user_id===uid));assert.equal(sourceFromImportUrl(f.state.cover).kind,'photo');
});

test('partial image failures retry only missing imports without duplicating completed media or replacing an existing cover',async()=>{
  const {importCycloneSources}=await mod('ibtracs-media-import'),m=await mod('ibtracs-media-model'),f=fixture();let fail=true,heads=[];
  const options={getActor:admin,read:async url=>{const kind=m.sourceFromImportUrl(url).kind;heads.push(kind);if(kind==='satellite'&&fail){fail=false;return new Response('',{status:503});}return new Response(null,{headers:{'Content-Type':'image/png'}});}};
  await assert.rejects(importCycloneSources(f.client,cid,[photo,track,satellite],options),e=>e.code==='CYCLONE_MEDIA_IMPORT'&&/Cyclone saved/.test(e.message));assert.equal(f.rows.size,2);
  f.state.cover='https://site.test/manual-cover.jpg';await importCycloneSources(f.client,cid,[photo,track,satellite],options);assert.equal(f.rows.size,3);assert.equal(f.calls.filter(c=>c[0]==='insert').length,3);assert.deepEqual(heads.sort(),['photo','satellite','satellite','track']);assert.equal(f.state.cover,'https://site.test/manual-cover.jpg');
});

test('member imports retain pending approval and guests cannot write media',async()=>{
  const {importCycloneSources,setImportedCycloneCover}=await mod('ibtracs-media-import'),f=fixture(),read=async()=>new Response(null,{headers:{'Content-Type':'image/png'}});
  await importCycloneSources(f.client,cid,[photo],{read,getActor:async()=>({user:{id:uid},name:'Member',isAdmin:false})});assert.equal([...f.rows.values()][0].status,'pending');assert.equal(f.state.cover,null);assert.equal(await setImportedCycloneCover(f.client,[...f.rows.values()][0]),false);
  const g=fixture();await assert.rejects(importCycloneSources(g.client,cid,[photo],{read,getActor:async()=>({user:null})}),/Sign in/);assert.equal(g.calls.length,0);
});

test('source delivery streams identical source bytes without forwarding credentials and imported locators need no storage cleanup',async()=>{
  const m=await mod('ibtracs-media-model'),api=(await mod('api/media')).default,{cleanupCycloneFiles}=await mod('owner-deletion'),locator=m.importedSourcePath(uid,cid,satellite),original=global.fetch,bytes=Uint8Array.from([137,80,78,71,13,10,0,255]);let fetched;
  try{global.fetch=async(url,options)=>{fetched={url,options};return new Response(bytes,{headers:{'Content-Type':'image/png','Set-Cookie':'private'}});};const r=await api.fetch(new Request(m.importedSourceUrl(locator),{headers:{Authorization:'Bearer private',Cookie:'secret'}}));assert.equal(fetched.url,satellite.url);assert.equal(fetched.options.headers.Authorization,undefined);assert.equal(r.headers.get('set-cookie'),null);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),bytes);}finally{global.fetch=original;}
  let cleaned;assert.deepEqual(await cleanupCycloneFiles({storage:{from:()=>({remove:async paths=>{cleaned=paths;return {};}})}},[locator,'normal/upload.jpg']),[]);assert.deepEqual(cleaned,['normal/upload.jpg']);
});

test('media retries keep the created cyclone ID and never submit the cyclone twice',async()=>{
  const {openCycloneForm}=await mod('cyclones'),oldDoc=global.document,oldData=global.FormData,events={},fieldset={},button={},cancel={addEventListener(){}},status={},nameInput={disabled:false};let writes=0,mediaAttempts=0,saved=0,resets=0;
  const input={name:'Cyclone Test',year:'2005',peak_winds_mph:'190',lowest_pressure_mb:'905'},form={addEventListener(n,fn){(events[n]||=[]).push(fn);},querySelector:s=>s==='fieldset'?fieldset:button,querySelectorAll:()=>[nameInput],reset(){resets++;}},dialog={dataset:{},setAttribute(){},addEventListener(){},querySelector:s=>s==='form'?form:s==='[role=status]'?status:cancel,showModal(){this.open=true;},close(){this.open=false;}};
  try{global.document={getElementById:()=>null,createElement:()=>dialog,body:{append(){}}};global.FormData=class{*[Symbol.iterator](){yield* Object.entries(input);}};
    openCycloneForm({rpc:async()=>{writes++;return {data:{id:cid,status:'approved'}};}},()=>{saved++;},{afterSubmit:async result=>{assert.equal(result.id,cid);if(mediaAttempts++===0)throw Object.assign(Error('Cyclone saved. Retry images.'),{code:'CYCLONE_MEDIA_IMPORT'});}});
    await events.submit[0]({preventDefault(){}});assert.equal(writes,1);assert.equal(dialog.open,true);assert.equal(button.textContent,'Retry images');assert.equal(saved,0);assert.equal(nameInput.disabled,true);
    await events.submit[0]({preventDefault(){}});assert.equal(writes,1);assert.equal(mediaAttempts,2);assert.equal(saved,1);assert.equal(resets,1);assert.equal(dialog.open,false);assert.equal(nameInput.disabled,false);
  }finally{global.document=oldDoc;global.FormData=oldData;}
});
