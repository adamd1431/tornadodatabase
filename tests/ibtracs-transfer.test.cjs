const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {gunzipSync}=require('node:zlib');
const {pathToFileURL}=require('node:url');
const root=path.join(__dirname,'..'),mod=n=>import(pathToFileURL(path.join(root,n+'.js')).href);
const manifest=JSON.parse(fs.readFileSync(path.join(root,'ibtracs-data/index.json'),'utf8'));
const haiyan=manifest.storms.find(s=>s.name==='HAIYAN'&&s.season===2013);
const records=JSON.parse(gunzipSync(fs.readFileSync(path.join(root,'ibtracs-data/2013.json.gz')))).storms.find(s=>s.id===haiyan.id).records;

test('CKZ transfer resolves the exact selected record and agency, ignoring numeric URL overrides',async()=>{
  const m=await mod('ibtracs-model'),t=await mod('ibtracs-transfer'),col=m.columnMap(manifest.columns),index=records.findIndex(r=>m.rawValue(r,col,'ISO_TIME')==='2013-11-07 12:00:00');
  const link=t.observationLink('wind-pressure.html',haiyan,records[index],col,'USA'),read=async url=>url.endsWith('index.json')?new Response(JSON.stringify(manifest)):new Response(fs.readFileSync(path.join(root,url)));
  const loaded=await t.loadIbtracsObservation(new URL(link,'https://test.invalid').search+'&pressureMb=800&lat=99',read),preset=t.ckzObservation(loaded);
  assert.equal(loaded.index,index);assert.equal(preset.at,'2013-11-07T12:00:00Z');assert.equal(preset.fields.pressureMb,'895');assert.equal(preset.fields.latitude,'10.2');assert.equal(preset.fields.windKnots,'170');
  assert.equal(preset.fields.knackRociNmi,'200');assert.equal(preset.fields.environmentMb,'1003');assert.equal(preset.poci,1003);assert.equal(preset.fields.motionKnots,'20.6');assert.notEqual(+preset.fields.motionKnots,m.numberValue(records[index],col,'STORM_SPEED'));assert.deepEqual(preset.missing,[]);
  const eveningIndex=records.findIndex(r=>m.rawValue(r,col,'ISO_TIME')==='2013-11-07 18:00:00'),evening=t.ckzObservation({...loaded,index:eveningIndex});assert.equal(evening.fields.environmentMb,'1000');assert.equal(evening.fields.knackRociNmi,'220');
  const early=t.ckzObservation({...loaded,index:index-2});assert.notEqual(early.fields.pressureMb,preset.fields.pressureMb);assert.notEqual(early.at,preset.at);
  const tokyo=t.ckzObservation({...loaded,agency:'TOKYO'});assert.equal(tokyo.fields.pressureMb,'895');assert.equal(tokyo.fields.windKnots,'');assert.equal(tokyo.fields.environmentMb,'');assert.equal(tokyo.fields.knackRociNmi,'');assert.ok(tokyo.missing.includes('ROCI'));
  assert.equal(await t.loadIbtracsObservation('',read),null);
  await assert.rejects(t.loadIbtracsObservation('?ibtracs=../../secret&at=2013-11-07%2012:00:00',()=>{throw Error('Must not fetch');}),/Invalid/);
  await assert.rejects(t.loadIbtracsObservation('?ibtracs='+haiyan.id+'&at=2013-11-30%2012:00:00',read),/not in/);
  await assert.rejects(t.loadIbtracsObservation(new URL(link,'https://test.invalid').search.replace('agency=USA','agency=FAKE'),read),/Invalid/);
});

test('missing pressure, size, environment and six-hour speed remain blank instead of importing plausible defaults',async()=>{
  const m=await mod('ibtracs-model'),t=await mod('ibtracs-transfer'),col=m.columnMap(['ISO_TIME','USA_LAT','USA_LON','USA_PRES','USA_POCI','USA_ROCI','STORM_SPEED']),rows=[['2020-01-01 00:00:00','0','170','0','','0','15']];
  const preset=t.ckzObservation({storm:{name:'TEST'},records:rows,col,index:0,agency:'USA'});assert.equal(preset.fields.latitude,'0');
  for(const key of ['pressureMb','windKnots','environmentMb','knackRociNmi','motionKnots'])assert.equal(preset.fields[key],'');
  assert.deepEqual(preset.missing,['central pressure','POCI / environmental pressure','ROCI','six-hour forward speed']);
});

test('Add cyclone always uses lifetime USA peaks, with independent wind and pressure times and source knots preserved',async()=>{
  const m=await mod('ibtracs-model'),t=await mod('ibtracs-transfer'),c=await mod('cyclones'),col=m.columnMap(['ISO_TIME','USA_STATUS','USA_WIND','USA_PRES','TOKYO_WIND','TOKYO_PRES','BASIN','USA_ATCF_ID']);
  const rows=[['2020-01-01 00:00:00','TD','25','1005','20','1006','WP','WP012020'],['2020-01-01 06:00:00','ST','167','910','130','900','WP','WP012020'],['2020-01-01 12:00:00','TY','150','905','120','895','WP','WP012020']];
  const storm={...haiyan,name:'TEST',season:2020,atcf:['WP012020']},draft=t.cyclonePeakDraft(storm,rows,col);
  assert.equal(draft.values.name,'Super Typhoon Test');assert.equal(draft.values.peak_winds_kts,167);assert.equal(draft.values.peak_winds_mph,190);assert.equal(draft.values.lowest_pressure_mb,905);assert.equal(draft.values.jtwc_designation,'Super Typhoon 01W');assert.equal(draft.values.basin,'Western Pacific');
  assert.equal(draft.windAt,'2020-01-01T06:00:00Z');assert.equal(draft.pressureAt,'2020-01-01T12:00:00Z');assert.equal(c.validateCyclone(draft.values).peak_winds_mph,190);
  const southern=t.cyclonePeakDraft({...storm,name:'OLAF',basins:['SP'],atcf:['SH192020']},rows.map(r=>r.map((v,i)=>i===col.BASIN?'SP':i===col.USA_ATCF_ID?'SH192020':v)),col);assert.equal(southern.values.name,'Cyclone Olaf');assert.equal(southern.values.jtwc_designation,'Cyclone 19P');
  assert.match(c.cycloneFields(draft.values),/name="peak_winds_kts"[^>]*value="167"/);assert.match(c.cycloneFields(draft.values),/name="wind_input_unit" value="kts"/);
  const noUSA=t.cyclonePeakDraft(storm,[['2020-01-01 00:00:00','','','','130','900','WP','WP012020']],col);assert.equal(noUSA.values.peak_winds_mph,'');assert.equal(noUSA.values.lowest_pressure_mb,'');assert.equal(noUSA.missing.length,2);
});

test('peak imports classify older generic HU statuses by basin and keep super typhoons distinct',async()=>{
  const {stormType,cycloneBasinName}=await mod('ibtracs-transfer');
  for(const [status,basin,wind,type]of [['HU','WP',185,'Super Typhoon'],['HU','WP',130,'Super Typhoon'],['HU','WP',125,'Typhoon'],['ST','EP',170,'Hurricane'],['HU','NA',140,'Hurricane'],['HU','SP',140,'Cyclone'],['TY','NI',100,'Cyclone'],['TS','WP',50,'Tropical Storm'],['TD','WP',30,'Tropical Depression']])assert.equal(stormType(status,basin,wind),type);
  for(const [basin,label]of [['WP','Western Pacific'],['EP','Eastern Pacific'],['NI','Northern Indian'],['SI','Southern Indian'],['SP','Southern Pacific'],['NA','Northern Atlantic'],['SA','Southern Atlantic']])assert.equal(cycloneBasinName(basin),label);
  assert.equal(cycloneBasinName('EP','CP012020'),'Central Pacific');
});

test('draft names include only the matching Wikipedia alias and the basin at lifetime peak',async()=>{
  const m=await mod('ibtracs-model'),t=await mod('ibtracs-transfer'),col=m.columnMap(manifest.columns),identity={sid:haiyan.id,alternateName:'Yolanda',sourceUrl:'https://en.wikipedia.org/wiki/Typhoon_Haiyan'};
  assert.equal(t.cyclonePeakDraft(haiyan,records,col,{identity}).values.name,'Super Typhoon Haiyan (Yolanda)');
  assert.equal(t.cyclonePeakDraft(haiyan,records,col,{identity:{...identity,sid:'1961250N07173'}}).values.name,'Super Typhoon Haiyan');
  const rita=manifest.storms.find(s=>s.name==='RITA'&&s.season===1978),r=JSON.parse(gunzipSync(fs.readFileSync(path.join(root,'ibtracs-data/1978.json.gz')))).storms.find(s=>s.id===rita.id).records;
  assert.equal(rita.basins[0],'EP');assert.equal(t.cyclonePeakDraft(rita,r,col).values.basin,'Western Pacific');assert.match(t.cyclonePeakDraft(rita,r,col).values.name,/^Super Typhoon/);
});

test('existing-cyclone matching respects names, aliases, basin, cross-year seasons, designations and submission status',async()=>{
  const {matchingDatabaseCyclones:match}=await mod('ibtracs-transfer');
  const rows=[{id:'existing',name:'Super Typhoon Haiyan (Yolanda)',year:2013,status:'approved'},{id:'pending',name:'Typhoon Haiyan',year:2013,status:'pending'},{id:'wrong-year',name:'Haiyan',year:2001},{id:'wrong-basin',name:'Haiyan',year:2013,basin:'Eastern Pacific'},{id:'rejected',name:'Haiyan',year:2013,status:'rejected'},{id:'code',name:'Different display name',year:2013,jtwc_designation:'Super Typhoon 31W'}];
  assert.deepEqual(match(rows,haiyan).map(r=>r.id),['existing','pending','code']);
  const sh={...haiyan,id:'1984001S10170',name:'TEST',season:1985,start:'1984-12-29 00:00:00',end:'1985-01-02 00:00:00',basins:['SP'],atcf:['SH301985']};assert.equal(match([{name:'Cyclone Test',year:1984,basin:'South Pacific'}],sh).length,1);
  const anon={...haiyan,name:'UNNAMED'};assert.equal(match([{name:'UNNAMED',year:2013}],anon).length,0);assert.equal(match([{ibtracs_sid:haiyan.id,name:'Custom name',year:2013}],anon).length,1);
});

test('existing-cyclone lookup paginates visible approved and pending candidates and surfaces lookup failures',async()=>{
  const {loadDatabaseCycloneCandidates}=await mod('ibtracs-transfer'),calls=[];let page=0;
  const query={select(value){calls.push(['select',value]);return this;},in(key,years){calls.push(['in',key,years]);return this;},neq(key,value){calls.push(['neq',key,value]);return this;},order(){return this;},async range(from,to){calls.push(['range',from,to]);return {data:page++? [{id:'pending',status:'pending'}]:Array.from({length:1000},(_,i)=>({id:i,status:'approved'}))};}};
  const rows=await loadDatabaseCycloneCandidates({from:()=>query},haiyan);assert.equal(rows.length,1001);assert.equal(rows.at(-1).status,'pending');assert.deepEqual(calls.filter(c=>c[0]==='range'),[['range',0,999],['range',1000,1999]]);assert.deepEqual(calls.find(c=>c[0]==='neq'),['neq','status','rejected']);
  query.range=async()=>({error:Error('Offline')});await assert.rejects(loadDatabaseCycloneCandidates({from:()=>query},haiyan),/Offline/);
});

test('a duplicate discovered before submitting blocks the database write and leaves the editable draft intact',async()=>{
  const {openCycloneForm}=await mod('cyclones'),originalDocument=global.document,originalFormData=global.FormData;let writes=0;
  const listeners={},fieldset={disabled:false},submit={disabled:false,textContent:''},cancel={disabled:false,addEventListener(){}},status={textContent:''};
  const input={name:'Typhoon Test',year:'2020',peak_winds_mph:'190',lowest_pressure_mb:'905'};
  const form={addEventListener(name,fn){(listeners[name]||=[]).push(fn);},querySelector:s=>s==='fieldset'?fieldset:submit,reset(){throw Error('A blocked draft must not reset');}};
  const dialog={dataset:{},setAttribute(){},addEventListener(){},querySelector:s=>s==='form'?form:s==='[role=status]'?status:cancel,showModal(){this.open=true;},close(){this.open=false;}};
  try{
    global.document={getElementById:()=>null,createElement:()=>dialog,body:{append(){}}};global.FormData=class{*[Symbol.iterator](){yield* Object.entries(input);}};
    openCycloneForm({rpc:async()=>{writes++;}},()=>{throw Error('Must not save');},{values:input,draftKey:'source-sid',sourceNote:'Safe <source>',beforeSubmit:async()=>{throw Object.assign(Error('Duplicate'),{code:'CYCLONE_EXISTS'});}});
    assert.match(dialog.innerHTML,/Safe &lt;source&gt;/);await listeners.submit[0]({preventDefault(){}});assert.equal(writes,0);assert.equal(dialog.open,true);assert.match(status.textContent,/already been added/);assert.equal(fieldset.disabled,false);assert.equal(submit.disabled,false);assert.equal(cancel.disabled,false);
  }finally{global.document=originalDocument;global.FormData=originalFormData;}
});

test('CKZ peak selection keeps one complete fix, resolves wind ties by positive pressure then time, and supports minimum pressure',async()=>{
  const m=await mod('ibtracs-model'),t=await mod('ibtracs-transfer'),col=m.columnMap(['ISO_TIME','USA_WIND','USA_PRES','USA_LAT','USA_LON']);
  const rows=[['2005-02-16 12:00:00','145','892','-14','-172'],['2005-02-16 00:00:00','145','','-11','-170'],['2005-02-16 03:00:00','145','895','-12','-170.5'],['2005-02-16 06:00:00','145','892','-12.7','-171.2'],['2005-02-16 15:00:00','140','890','-15','-173'],['2005-02-15 21:00:00','145','0','-10','-169']];
  const wind=t.selectCkzPeak(haiyan,rows,col),preset=t.ckzObservation(wind);
  assert.equal(wind.index,3);assert.equal(wind.peakBasis,'wind');assert.equal(preset.fields.pressureMb,'892');assert.equal(preset.fields.latitude,'-12.7');assert.equal(preset.fields.windKnots,'145');assert.equal(preset.at,'2005-02-16T06:00:00Z');
  const pressure=t.selectCkzPeak(haiyan,rows,col,'pressure');assert.equal(pressure.index,4);assert.equal(t.ckzObservation(pressure).fields.windKnots,'140');assert.equal(pressure.agency,'USA');
  assert.throws(()=>t.selectCkzPeak(haiyan,rows,col,'made-up'),/valid peak/);
  assert.throws(()=>t.selectCkzPeak(haiyan,[['2005-02-16 00:00:00','','892','-12','-170']],col),/Try the minimum-pressure/);
  assert.throws(()=>t.selectCkzPeak(haiyan,[['2005-02-16 00:00:00','140','0','-12','-170']],col,'pressure'),/No USA/);
});

test('real Haiyan peak chooses its earliest tied wind/pressure peak and preserves the exact same-time track inputs',async()=>{
  const m=await mod('ibtracs-model'),t=await mod('ibtracs-transfer'),selected=t.selectCkzPeak(haiyan,records,m.columnMap(manifest.columns)),preset=t.ckzObservation(selected);
  assert.equal(preset.at,'2013-11-07T12:00:00Z');assert.equal(preset.fields.windKnots,'170');assert.equal(preset.fields.pressureMb,'895');assert.equal(preset.fields.motionKnots,'20.6');assert.equal(preset.fields.latitude,'10.2');
});

test('Schloemer import uses POCI directly and carries ROCI separately without changing RMW or station inputs',async()=>{
  const m=await mod('ibtracs-model'),t=await mod('ibtracs-transfer'),selected=t.selectCkzPeak(haiyan,records,m.columnMap(manifest.columns)),preset=t.ckzObservation(selected),imported=t.schloemerIsobarImport(preset);
  assert.deepEqual(imported.fields,{method:'schloemer',environmentMb:'1003'});assert.equal(imported.pociMb,1003);assert.equal(imported.rociNmi,200);
  const station={rmwNmi:'8',distanceNmi:'16.74',stationMb:'931',hollandB:'1',...imported.fields};assert.equal(station.rmwNmi,'8');assert.equal(station.distanceNmi,'16.74');assert.equal(station.stationMb,'931');
  const absent=t.schloemerIsobarImport({...preset,fields:{environmentMb:'',knackRociNmi:''}});assert.equal(absent.pociMb,null);assert.equal(absent.rociNmi,null);assert.equal(absent.fields.environmentMb,'');
  const derived=t.schloemerIsobarImport({...preset,fields:{environmentMb:'1008',knackRociNmi:'464'}});assert.equal(derived.pociMb,1008);assert.equal(derived.rociNmi,464);assert.equal(derived.fields.rmwNmi,undefined);
});

test('custom-time imports select the exact observation, rather than reverting to the cyclone peak',async()=>{
  const m=await mod('ibtracs-model'),t=await mod('ibtracs-transfer'),col=m.columnMap(manifest.columns),selection=t.selectCkzTime(haiyan,records,col,'2013-11-07 18:00:00'),preset=t.ckzObservation(selection);
  assert.equal(selection.peakBasis,'time');assert.equal(preset.at,'2013-11-07T18:00:00Z');assert.equal(preset.fields.environmentMb,'1000');assert.equal(preset.fields.knackRociNmi,'220');assert.equal(preset.fields.latitude,'10.6');assert.notEqual(selection.index,t.selectCkzPeak(haiyan,records,col).index);
  const earlier=t.ckzObservation(t.selectCkzTime(haiyan,records,col,'2013-11-07 03:00:00'));assert.equal(earlier.fields.pressureMb,'905');assert.equal(earlier.fields.environmentMb,'1005');assert.equal(earlier.fields.knackRociNmi,'200');
  assert.throws(()=>t.selectCkzTime(haiyan,records,col,'2013-11-07 17:15:00'),/no IBTrACS observation/);assert.throws(()=>t.selectCkzTime(haiyan,records,col,'2013-11-07T18:00:00Z'),/Choose an observation/);
});
