const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{gunzipSync}=require('node:zlib');
const root=path.join(__dirname,'..'),mod=name=>import(pathToFileURL(path.join(root,name+'.js')).href),manifest=JSON.parse(fs.readFileSync(path.join(root,'ibtracs-data/index.json'))),fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/jtwc-report-pages.json')));
const storm=(name,year)=>manifest.storms.find(s=>s.name===name&&s.season===year);
const records=s=>JSON.parse(gunzipSync(fs.readFileSync(path.join(root,`ibtracs-data/${s.season}.json.gz`)))).storms.find(r=>r.id===s.id).records;
function reportPages(year){const saved=fixtures[year],pages=Array.from({length:Math.max(...saved.map(p=>p.page))},()=>({text:'',lines:[]}));for(const p of saved)pages[p.page-1]=p;return pages;}

test('official report fixtures recover Nancy 882, Holly 898 and Rita 878 with exact PDF citations',async()=>{
  const {extractJtwcPressure}=await mod('jtwc-report-model');
  for(const [name,year,pressure,page]of [['NANCY',1961,882,34],['HOLLY',1987,898,28],['RITA',1978,878,64]]){const result=extractJtwcPressure(reportPages(year),storm(name,year),year);assert.equal(result.pressureMb,pressure);assert.equal(result.pdfPage,page);assert.equal(result.sid,storm(name,year).id);assert.equal(result.sourceUrl,`https://www.metoc.navy.mil/jtwc/products/atcr/${year}atcr.pdf#page=${page}`);}
  // The 1961 report explicitly assigns the same dropsonde minimum to both.
  assert.equal(extractJtwcPressure(reportPages(1961),storm('VIOLET',1961),1961).pressureMb,882);
});

test('PDF table reconstruction matches by coordinates rather than aligning separate text columns by index',async()=>{
  const {pdfTextLines}=await mod('jtwc-report-model'),item=(str,x,y)=>({str,transform:[1,0,0,1,x,y]});
  assert.deepEqual(pdfTextLines([item('HOLLY',10,100),item('LYNN',10,90),item('898',120,100),item('898',120,90)]),['HOLLY 898','LYNN 898']);
});

test('report extraction rejects unrelated pressure mentions, ambiguous rows and contradictory readings',async()=>{
  const {extractJtwcPressure}=await mod('jtwc-report-model'),s=storm('HOLLY',1987);
  for(const text of ['Holly was followed by Typhoon Lynn. MINIMUM SLP 898 MBS BEST TRACK','TYPHOON LYNN BEST TRACK MINIMUM SLP 898 MBS; Holly was also active.','1987 ESTIMATED MSLP - MB\n15W STY HOLLY 05 SEP - 15 SEP 900 898','Holly had 1000 mb environmental pressure.'])assert.equal(extractJtwcPressure([{text}],s,1987),null);
  const different={text:'SUPER TYPHOON HOLLY BEST TRACK MINIMUM SLP 900 MBS',lines:[]};assert.equal(extractJtwcPressure([...reportPages(1987),different],s,1987),null);
  assert.equal(extractJtwcPressure(reportPages(1987),storm('NANCY',1961),1961),null);
});

test('Add cyclone fills only absent JTWC lifetime pressure and keeps the IBTrACS records unchanged',async()=>{
  const {columnMap}=await mod('ibtracs-model'),{prepareCyclonePeakDraft}=await mod('ibtracs-transfer'),{extractJtwcPressure}=await mod('jtwc-report-model'),col=columnMap(manifest.columns),nancy=storm('NANCY',1961),rows=records(nancy),before=JSON.stringify(rows),report=extractJtwcPressure(reportPages(1961),nancy,1961);let calls=0;
  const draft=await prepareCyclonePeakDraft(nancy,rows,col,{identity:{sid:nancy.id,alternateName:'2nd Muroto Typhoon',sourceUrl:'https://en.wikipedia.org/wiki/Typhoon_Nancy_(1961)'},read:async url=>{calls++;assert.match(url,/sid=1961250N07173/);return Response.json(report);}});
  assert.equal(draft.values.name,'Super Typhoon Nancy (2nd Muroto Typhoon)');assert.equal(draft.values.lowest_pressure_mb,882);assert.equal(draft.values.jtwc_designation,'Super Typhoon 18W');assert.equal(draft.values.basin,'Western Pacific');assert.equal(draft.values.peak_winds_kts,185);assert.equal(draft.pressureAt,null);assert.equal(draft.pressureReport.pdfPage,34);assert.deepEqual(draft.missing,[]);assert.equal(calls,1);assert.equal(JSON.stringify(rows),before);
  const haiyan=storm('HAIYAN',2013),existing=await prepareCyclonePeakDraft(haiyan,records(haiyan),col,{read:()=>{throw Error('Must not fetch a report when IBTrACS pressure exists');}});assert.equal(existing.values.lowest_pressure_mb,895);assert.equal(existing.pressureReport,null);
});

test('failed or mismatched report lookups stay blank rather than substituting JMA pressure',async()=>{
  const {columnMap}=await mod('ibtracs-model'),{prepareCyclonePeakDraft}=await mod('ibtracs-transfer'),col=columnMap(manifest.columns),s=storm('NANCY',1961),rows=records(s);
  for(const read of [async()=>Response.json({sid:s.id,status:'not-found',message:'No readable minimum.'}),async()=>{throw Error('Offline');},async()=>Response.json({sid:'1987244N11177',status:'found',pressureMb:898,sourceUrl:'https://www.metoc.navy.mil/jtwc/products/atcr/1987atcr.pdf#page=28'})]){const draft=await prepareCyclonePeakDraft(s,rows,col,{read});assert.equal(draft.values.lowest_pressure_mb,'');assert.ok(draft.missing.includes('USA lowest pressure'));assert.ok(draft.reportWarning);}
});

test('report endpoint validates storms and distinguishes a missing report from a source outage',async()=>{
  const {default:api,lookupJtwcPressure}=await mod('api/jtwc-report'),nancy=storm('NANCY',1961);
  assert.equal((await api.fetch(new Request('https://example.test/api/jtwc-report?sid=../secret'))).status,404);
  assert.equal((await api.fetch(new Request('https://example.test/api/jtwc-report?sid='+nancy.id,{method:'POST'}))).status,405);
  const found=await lookupJtwcPressure(nancy,{readReport:async y=>reportPages(y)});assert.equal(found.pressureMb,882);
  assert.equal((await lookupJtwcPressure(nancy,{readReport:async()=>null})).status,'not-found');
  await assert.rejects(lookupJtwcPressure(nancy,{readReport:async()=>{throw Error('Offline');}}),/Offline/);
  assert.equal((await lookupJtwcPressure(storm('PATRICIA',2015),{readReport:()=>{throw Error('Must not request JTWC for NHC storm');}})).status,'not-applicable');
});
