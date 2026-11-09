const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const core=import(pathToFileURL(path.join(__dirname,'../storm-forecast-core.js')).href);
const model=import(pathToFileURL(path.join(__dirname,'../storm-forecast-calibrated.js')).href);
test('deployed calibration is the exact frozen model and whole-storm test assignments never overlap fitting',async()=>{
  const crypto=require('node:crypto'),root=path.join(__dirname,'../forecast-study'),bytes=fs.readFileSync(path.join(root,'selected-model-frozen.json')),frozen=JSON.parse(bytes),deployed=(await import(pathToFileURL(path.join(__dirname,'../storm-forecast-calibration.js')).href)).default;
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),deployed.frozenModelSha256);const {frozenModelSha256,...content}=deployed;assert.deepEqual(content,frozen);
  assert.deepEqual(frozen.trainingSplits,['train','validation']);assert.deepEqual(frozen.excludedSplits,['test2024global','test2025']);
  const protocol=JSON.parse(fs.readFileSync(path.join(root,'protocol-v2.json'))),splits=new Map();for(const s of protocol.splitAssignments){if(splits.has(s.sid))assert.equal(splits.get(s.sid),s.split);splits.set(s.sid,s.split);}
  for(const region of Object.values(frozen.model))for(const [target,c]of Object.entries(region))for(const p of Object.values(c.leads)){const w=Object.values(p.weights);assert.ok(w.every(v=>v>=0)&&w.reduce((a,b)=>a+b,0)<=1+1e-8);assert.ok(p.bias.every(v=>Math.abs(v)<=(target==='track'?100:10)));}
  const report=JSON.parse(fs.readFileSync(path.join(root,'backtest-report.json')));assert.equal(report.frozenModelSha256,frozenModelSha256);assert.equal(report.caseSha256,frozen.caseSha256);
  for(const row of report.summaries){assert.equal(row.v1.cases,row.v2.cases);assert.equal(row.v1.storms,row.v2.storms);if(row.officialCommon.official)assert.equal(row.officialCommon.official.cases,row.officialCommon.v2.cases);}
});
const fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/forecast-study/parity.json')));
const record=(code,cycle,h,lat='150N',lon='1500E',wind=60,p=990)=>`WP,01,${cycle},03,${code},${h},${lat},${lon},${wind},${p},TY`;
const storm={id:'WP012024',validAt:'2024-01-01T12:00:00Z',latitude:15,longitude:150,windKt:60,pressureMb:990};
test('frozen JavaScript predictions match Python backtest at every tested lead in both regions',async()=>{
  const c=await core,m=await model;
  for(const row of fixtures){const s={id:row.id,validAt:row.at,latitude:row.initial[0],longitude:row.initial[1],windKt:row.initial[2],pressureMb:row.initial[3],trendWind12:row.trend[0],trendPressure12:row.trend[1]};
    const features=row.x.map(x=>({id:c.FORECAST_FAMILIES[x[0]].id,track:x[1]===null?null:{raw:[x[1],x[2]],offset:[x[3],x[4]]},wind:x[5]===null?null:{raw:x[5],offset:x[6]},pressure:x[7]===null?null:{raw:x[7],offset:x[8]}}));
    const out=m.calibratePoint({latitude:row.v1[0],longitude:row.v1[1],windKt:row.v1[2],pressureMb:row.v1[3]},features,s,row.lead);
    for(const [i,key]of ['latitude','longitude','windKt','pressureMb'].entries())row.expected[i]===null?assert.equal(out[key],null):assert.ok(Math.abs(out[key]-row.expected[i])<1e-7,`${row.id} +${row.lead} ${key}: ${out[key]} vs ${row.expected[i]}`);
  }
});
test('raw models require six hours, early guidance three hours, and future cycles are rejected',async()=>{
  const c=await core,text=['AVNO','AVNI'].flatMap(code=>[record(code,'2024010112',0),record(code,'2024010112',24)]).join('\n'),deck=c.parseForecastDeck(text,storm.id);
  assert.equal(c.selectForecastSources(deck,storm,new Date('2024-01-01T14:59Z')).length,0);
  assert.equal(c.selectForecastSources(deck,storm,new Date('2024-01-01T15:00Z'))[0].sources.wind.code,'AVNI');
  assert.equal(c.selectForecastSources(deck,storm,new Date('2024-01-01T18:00Z'))[0].sources.wind.code,'AVNO');
  assert.equal(c.selectForecastSources(deck,{...storm,validAt:'2024-01-01T06:00Z'},new Date('2024-01-01T18:00Z')).length,0);
});
test('wind and pressure can use separate eligible cycles; wind-only guidance cannot create a 0N 0E track',async()=>{
  const c=await core,text=[record('AVNI','2024010112',0,'150N','1500E',60,0),record('AVNI','2024010112',24,'160N','1510E',80,0),record('AVNO','2024010106',6),record('AVNO','2024010106',30),record('LGEM','2024010112',0,'000N','0000E',60,0),record('LGEM','2024010112',24,'000N','0000E',85,0)].join('\n');
  const rows=c.selectForecastSources(c.parseForecastDeck(text,storm.id),storm,new Date('2024-01-01T15:00Z'));
  assert.equal(rows[0].sources.wind.code,'AVNI');assert.equal(rows[0].sources.pressure.code,'AVNO');assert.equal(rows.find(r=>r.id==='lgem').sources.track,undefined);
});
test('only past operational CARQ analysis produces tendency; best track is not a predictor',async()=>{
  const c=await core,text=[record('CARQ','2024010112',-12,'140N','1490E',40,1000),record('CARQ','2024010112',0),record('BEST','2024010112',0,'150N','1500E',100,940)].join('\n');
  const s=c.operationalInitials(c.parseForecastDeck(text,storm.id),storm.id)[0];assert.equal(s.windKt,60);assert.equal(s.pressureMb,990);assert.equal(s.trendWind12,20);assert.equal(s.trendPressure12,-10);
});
test('no native analysis means explicit uncalibrated fallback; unknown pressure remains missing',async()=>{
  const m=await model,text=[record('AVNO','2024010106',6),record('AVNO','2024010106',30)].join('\n');
  const f=m.buildCalibratedForecast({...storm,pressureMb:null},text,{asOf:new Date('2024-01-01T15:00Z')});assert.equal(f.calibrationApplied,false);assert.match(f.method,/Uncalibrated/);assert.ok(f.points.every(p=>p.pressureMb===null));
});
test('calibrated runs anchor at the native analysis and ignore later-cycle data even when retrieved later',async()=>{
  const m=await model,lines=[record('CARQ','2024010112',-12),record('CARQ','2024010112',0),record('AVNO','2024010106',6),record('AVNO','2024010106',30,'160N','1510E',80,980)],late=[record('AVNO','2024010112',0),record('AVNO','2024010112',24,'300N','1600E',130,900)];
  const first=m.buildCalibratedForecast(storm,lines.join('\n'),{asOf:new Date('2024-01-01T15:00Z')}),second=m.buildCalibratedForecast(storm,[...lines,...late].join('\n'),{asOf:new Date('2024-01-01T23:00Z')});
  assert.deepEqual(first.points,second.points);assert.equal(first.runId,second.runId);assert.equal(first.calibrationApplied,true);assert.equal(first.points[0].windKt,storm.windKt);assert.equal(first.points[0].pressureMb,storm.pressureMb);assert.equal(first.points[0].latitude,storm.latitude);assert.equal(first.points.at(-1).hours,24);
});
test('coefficient interpolation preserves the zero-hour anchor and never extrapolates past 120 hours',async()=>{
  const m=await model,c={promotedFromValidation:true,leads:{12:{weights:{gfs:.6},bias:[4],trendGain:.4},24:{weights:{gfs:.2,lgem:.5},bias:[2],trendGain:0}}};
  assert.equal(m.parametersAt(c,0),null);assert.equal(m.parametersAt(c,121),null);assert.equal(m.parametersAt(c,6).weights.gfs,.3);assert.equal(m.parametersAt(c,18).bias[0],3);assert.equal(m.parametersAt({...c,promotedFromValidation:false},12),null);
});
