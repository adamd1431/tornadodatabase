const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),zlib=require('node:zlib'),path=require('node:path'),{pathToFileURL}=require('node:url');
const load=name=>import(pathToFileURL(path.join(__dirname,'../'+name+'.js')).href),quality=load('satellite-scene-quality'),model=load('satellite-dvorak-model');
const fixture=name=>JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/dvorak/'+name+'.json.gz'))));
function synthetic(fn){const grid={width:241,height:241,temperature:[],latitude:[],longitude:[],timestamp:'2024-01-02T12:00:00Z'};for(let y=-240;y<=240;y+=2)for(let x=-240;x<=240;x+=2){grid.temperature.push(fn(x,y,Math.hypot(x,y)));grid.latitude.push(y/111.195);grid.longitude.push(x/111.195);}return grid;}
const center={latitude:0,longitude:0,version:'9.1',domain:'pacific'};

test('the same real measured contrast, symmetry and ring support both tools; a poorly resolved eye is flagged',async()=>{
 const {assessSatelliteScene}=await quality,{analyzeEyeDvorak}=await model;
 for(const name of ['bolaven','patricia','haiyan','lekima']){const f=fixture(name),eye=analyzeEyeDvorak(f.grid,{...f.center,atcf:f.atcf,autoCenter:true,version:'9.1'}),scene=assessSatelliteScene(f.grid,eye);assert.ok(scene.accepted,name);assert.equal(scene.eyeContrastC,eye.eye-eye.cloud);assert.equal(scene.asymmetryC,eye.symmetry);assert.equal(scene.measuredEyeC,eye.eye);assert.equal(scene.eyeTemperatureAdjusted,false);assert.ok(scene.ring.narrowestWidthKm>=scene.ring.requiredWidthKm);if(name==='patricia'){assert.equal(scene.status,'resolution-limited');assert.ok(scene.pixelsAcrossEye<3);}}
});

test('a broken or thin cold ring loses its higher EIR rating; extra outer CDO spread gives no bonus',async()=>{
 const {assessSatelliteScene}=await quality,{calculateEyeDvorak}=await model;
 const scene=fn=>{const grid=synthetic(fn),eye=calculateEyeDvorak(grid,center);return {eye,scene:assessSatelliteScene(grid,eye)};};
 const thick=scene((x,y,d)=>d<18?20:d<110?-78:-55),thin=scene((x,y,d)=>d<18?20:d<55?-78:-55),broken=scene((x,y,d)=>d<18?20:x>0&&Math.abs(y)<12?-55:d<110?-78:-55),spread=scene((x,y,d)=>d<18?20:d<110?-78:d>210?-78:-55);
 assert.ok(thin.scene.ring.dataT<thick.scene.ring.dataT);assert.ok(broken.scene.ring.dataT<thick.scene.ring.dataT);assert.ok(broken.eye.symmetry>thick.eye.symmetry);assert.equal(spread.eye.rawT,thick.eye.rawT);assert.equal(spread.scene.ring.dataT,thick.scene.ring.dataT);
});

test('current pinhole diagnostics preserve the measured temperature without changing legacy replay',async()=>{
 const {eyeRegression,calculateEyeDvorak}=await model,grid=synthetic((x,y,d)=>d<18?20:d<110?-78:-55),regular=calculateEyeDvorak(grid,center),pinhole=calculateEyeDvorak(grid,{...center,pinhole:true});
 assert.equal(pinhole.eyeUsed,pinhole.eye);assert.equal(pinhole.rawT,regular.rawT);assert.notEqual(eyeRegression({eye:25,cloud:-80,symmetry:0,pinhole:true}),eyeRegression({eye:25,cloud:-80,symmetry:0}));
});

test('enlarging a screenshot cannot establish sensor resolution or resolve a pinhole',async()=>{
 const {assessSatelliteScene,satelliteSceneFacts}=await quality,{calculateEyeDvorak}=await model,grid=synthetic((x,y,d)=>d<8?20:d<110?-78:-55);grid.calibration='Approximate picture';const eye=calculateEyeDvorak(grid,center),unknown=assessSatelliteScene(grid,eye),coarse=assessSatelliteScene(grid,eye,{sourcePixelKm:8}),fine=assessSatelliteScene(grid,eye,{sourcePixelKm:2});
 assert.equal(unknown.resolutionUnknown,true);assert.equal(unknown.pixelsAcrossEye,null);assert.match(satelliteSceneFacts(unknown).find(([k])=>k==='Original source pixel spacing')[1],/Unknown/);assert.equal(coarse.resolutionLimited,true);assert.equal(fine.resolutionLimited,false);assert.equal(coarse.measuredEyeC,fine.measuredEyeC);assert.equal(coarse.ring.dataT,fine.ring.dataT);
});

test('thermal changes require strictly earlier observations in the six-hour window; sampling differences stay explicit',async()=>{
 const {assessSatelliteScene,satelliteSceneFacts}=await quality,{calculateEyeDvorak}=await model,grid=synthetic((x,y,d)=>d<18?20:d<110?-78:-55),eye=calculateEyeDvorak(grid,center),prior={timestamp:'2024-01-02T06:00:00Z',eye:18,cloud:-75,officialWind:999,ownerPressure:800};
 const a=assessSatelliteScene(grid,eye,{thermalHistory:prior});assert.equal(a.evolution.hours,6);assert.equal(a.evolution.eyeChangeC,2);assert.equal(a.evolution.cloudChangeC,eye.cloud+75);assert.equal(a.evolution.samplingComparable,false);assert.match(satelliteSceneFacts(a).at(-1)[1],/Context only/);
 assert.equal(assessSatelliteScene(grid,eye,{thermalHistory:{...prior,samplingVersion:'9.1'}}).evolution.samplingComparable,true);
 for(const time of ['2024-01-02T13:00:00Z','2024-01-02T07:00:00Z','2024-01-02T04:00:00Z'])assert.equal(assessSatelliteScene(grid,eye,{thermalHistory:{...prior,timestamp:time}}).evolution,null);
 assert.deepEqual(assessSatelliteScene(grid,eye,{thermalHistory:{...prior,officialWind:1,ownerPressure:1050}}),a);
});

test('an unresolved enclosing structure withholds final intensity while preserving temperature diagnostics',async()=>{
 const {estimateIntensity}=await load('satellite-intensity-model'),{estimatePictureIntensity}=await load('satellite-intensity-image'),grid=synthetic((x,y,d)=>d<18?20:x>20&&Math.abs(y)<2.1?NaN:-78),native=estimateIntensity(grid,{...center,atcf:'WP012024'}),picture=estimatePictureIntensity({grid:{...grid,calibration:'Approximate picture'},quality:{}},{basin:'WP'});
 for(const result of [native,picture]){assert.equal(result.sceneQuality.accepted,false);assert.equal(result.windKt,null);assert.equal(result.pressureMb,null);assert.ok(result.eye.rawT>0);assert.ok(Number.isFinite(result.eye.eye));assert.match(result.sceneQuality.explanation,/withheld/);}
});
