const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),{pathToFileURL}=require('node:url');
const root=path.join(__dirname,'..'),load=file=>import(pathToFileURL(path.join(root,file)).href),read=file=>JSON.parse(fs.readFileSync(path.join(root,file))),fixture=name=>JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/dvorak/'+name+'.json.gz'))));
const base=read('intensity-data/tree-model.json'),wp=read('intensity-data/pacific-tree-model.json'),bundle={...base,westernPacific:wp};

test('the updated native diagnostic and fitted feature sampler stay explicitly separate',async()=>{
  const {estimateIntensity,estimateIntensityLegacy}=await load('satellite-intensity-model.js'),f=fixture('bolaven'),options={...f.center,atcf:f.atcf,autoCenter:true};
  const old=estimateIntensityLegacy(f.grid,options,bundle),current=estimateIntensity(f.grid,options,bundle);
  assert.equal(current.baselineAdtVersion,'9.1');assert.equal(current.featureAdtVersion,'8.2.1');assert.equal(current.modelEye.version,'8.2.1');assert.equal(current.eye.rawT,7.8);assert.ok(current.eye.rawT>current.modelEye.rawT);
  assert.deepEqual(current.features,old.features);assert.equal(current.windKt,old.windKt);assert.equal(current.pressureMb,old.pressureMb);assert.equal(current.eye.latitude,current.modelEye.latitude);assert.equal(current.eye.longitude,current.modelEye.longitude);
});

test('real Atlantic and Pacific trained estimates preserve their fitted inputs after the baseline update',async()=>{
  const {estimateIntensity,estimateIntensityLegacy}=await load('satellite-intensity-model.js');
  for(const name of ['patricia','haiyan','lekima']){const f=fixture(name),options={...f.center,atcf:f.atcf,autoCenter:true},old=estimateIntensityLegacy(f.grid,options,bundle),current=estimateIntensity(f.grid,options,bundle);assert.deepEqual(current.features,old.features);assert.equal(current.windKt,old.windKt);assert.equal(current.pressureMb,old.pressureMb);assert.equal(current.eye.version,'9.1');}
});

test('baseline-only native scans use the same updated method as the archive without inventing table pressure above T8',async()=>{
  const {estimateIntensity}=await load('satellite-intensity-model.js'),{analyzeEyeDvorak}=await load('satellite-dvorak-model.js'),{ciToWind}=await load('wind-pressure-model.js'),f=fixture('patricia'),options={...f.center,atcf:f.atcf,autoCenter:true};
  const r=estimateIntensity(f.grid,options),eye=analyzeEyeDvorak(f.grid,{...options,version:'9.1'});
  assert.equal(r.eye.rawT,eye.rawT);assert.equal(r.eye.rawT,8.4);assert.equal(r.windKt,ciToWind(eye.rawT));assert.equal(r.pressureMb,null);assert.equal(r.members.treeWind,null);
});

test('Indian and Southern native fallback scenes use the other-basin ADT 9.1 coefficients',async()=>{
  const {estimateIntensity}=await load('satellite-intensity-model.js'),f=fixture('bolaven');
  for(const atcf of ['IO012020','SH012020']){const r=estimateIntensity(f.grid,{...f.center,atcf,autoCenter:true},bundle);assert.equal(r.eye.domain,'other');assert.equal(r.eye.version,'9.1');assert.equal(r.members.treeWind,null);assert.equal(r.pressureMb,null);}
});

test('caller versions, identities and comparison numbers cannot redirect the released estimator',async()=>{
  const {estimateIntensity}=await load('satellite-intensity-model.js'),f=fixture('bolaven'),options={...f.center,atcf:f.atcf,autoCenter:true},a=estimateIntensity(f.grid,options,bundle),b=estimateIntensity(f.grid,{...options,version:'8.2.1',atcf:'WP022016',name:'NEPARTAK',ownerWind:250,motisPressure:870.1,officialPressure:800},bundle);
  assert.equal(b.eye.version,'9.1');assert.deepEqual(a.features,b.features);assert.equal(a.windKt,b.windKt);assert.equal(a.pressureMb,b.pressureMb);
});

test('the published transition review retains existing predictions when a candidate fails the release checks',()=>{
  const r=read('intensity-data/adt91-transition-benchmark.json');assert.equal(r.sample.accepted,119);assert.equal(r.sample.failures.length,0);assert.equal(r.backboneDigests.westernPacific,wp.trainingDigest);assert.equal(r.maximumTrainedPredictionChange.wind,0);assert.equal(r.maximumTrainedPredictionChange.pressure,0);assert.match(r.scope,/not a fresh independent/);
  for(const key of ['wind','pressure']){assert.equal(r.release[key],false);assert.equal(r.correction[key].eligible,false);assert.ok(r.correction[key].validation.mae>r.summary.validation.legacy[key].mae);}
});
