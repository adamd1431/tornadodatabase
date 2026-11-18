const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),zlib=require('node:zlib'),path=require('node:path'),{pathToFileURL}=require('node:url');
const load=name=>import(pathToFileURL(path.join(__dirname,'../'+name+'.js')).href),model=load('satellite-dvorak-model'),eir=load('satellite-dvorak-eir');
const fixture=name=>JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/dvorak/'+name+'.json.gz'))));
function synthetic(temperature){const grid={width:241,height:241,temperature:[],latitude:[],longitude:[]};for(let y=-240;y<=240;y+=2)for(let x=-240;x<=240;x+=2){grid.temperature.push(temperature(x,y,Math.hypot(x,y)));grid.latitude.push(y/111.195);grid.longitude.push(x/111.195);}return grid;}
const center={latitude:0,longitude:0,eye:20};
test('EIR uses published shade, thickness and eye-adjustment rules independently of basin regressions',async()=>{
 const {bdShade,eirEyeAdjustment}=await eir;
 for(const [temperature,shade]of [[20,'WMG'],[0,'OW'],[-35,'DG'],[-45,'MG'],[-60,'LG'],[-66,'B'],[-72,'W'],[-79,'CMG'],[-85,'CDG']])assert.equal(bdShade(temperature),shade);
 assert.equal(eirEyeAdjustment(20,'CMG'),1);assert.equal(eirEyeAdjustment(0,'CMG'),.5);assert.equal(eirEyeAdjustment(20,'CMG',{largeEye:true}),0);assert.equal(eirEyeAdjustment(20,'CMG',{elongated:true}),0);assert.throws(()=>bdShade(NaN),/calibrated/);
});
test('a complete thick CMG eyewall qualifies, but a thin cold ring cannot get E6.5',async()=>{
 const {measureEirEye}=await eir;
 const thick=measureEirEye(synthetic((x,y,d)=>d<18?20:d<110?-78:-55),center);
 assert.equal(thick.ringShade,'CMG');assert.equal(thick.eNumber,6.5);assert.equal(thick.dataT,7.5);assert.ok(thick.narrowestWidthKm>85);assert.equal(thick.banding,0);
 const thin=measureEirEye(synthetic((x,y,d)=>d<18?20:d<55?-78:-55),center);
 assert.equal(thin.profiles[0].qualifies,false);assert.ok(thin.eNumber<6.5);assert.ok(thin.dataT<thick.dataT);
});
test('a broken cold arc cannot pass as a complete cold ring and missing sectors abstain',async()=>{
 const {measureEirEye}=await eir;
 const broken=measureEirEye(synthetic((x,y,d)=>d<18?20:x>0&&Math.abs(y)<12?-55:d<110?-78:-55),center);
 assert.equal(broken.profiles[0].qualifies,false);assert.notEqual(broken.ringShade,'CMG');
 assert.throws(()=>measureEirEye(synthetic((x,y,d)=>d<18?20:x>20&&Math.abs(y)<12?NaN:-78),center),/complete cold ring/);
});
test('resolved large and elongated eyes do not receive the positive eye adjustment',async()=>{
 const {measureEirEye}=await eir;
 const large=measureEirEye(synthetic((x,y,d)=>d<48?20:-78),center);assert.equal(large.largeEye,true);assert.equal(large.eyeAdjustment,0);
 const elongated=measureEirEye(synthetic((x,y)=>x*x/(28*28)+y*y/100<1?20:-78),center);assert.equal(elongated.elongated,true);assert.equal(elongated.eyeAdjustment,0);
});
test('banding cannot silently add a half number without the required analyst history context',async()=>{
 const {eirBanding}=await eir;
 assert.equal(eirBanding(7.5),7.5);assert.throws(()=>eirBanding(7.5,{banding:.5}),/MET/);assert.throws(()=>eirBanding(7.5,{banding:.5,met:7.5}),/MET/);
 assert.equal(eirBanding(7.5,{banding:.5,met:8}),8);assert.equal(eirBanding(7.5,{banding:1,met:8.5}),8.5);assert.throws(()=>eirBanding(7.5,{banding:1,met:8}),/MET/);
});
test('Bolaven 09Z reproduces measured temperatures and a documented EIR T7.5 before any analyst banding',async()=>{
 const {analyzeEyeDvorak}=await model,{measureEirEye,eirBanding}=await eir,f=fixture('bolaven'),eye=analyzeEyeDvorak(f.grid,{...f.center,atcf:f.atcf,autoCenter:true}),row=measureEirEye(f.grid,eye);
 assert.ok(Math.abs(eye.eye-21.89)<.02);assert.equal(eye.rawT,7.4);assert.equal(row.dataT,7.5);assert.equal(row.ringShade,'CMG');assert.ok(row.narrowestWidthKm>70&&row.narrowestWidthKm<80);assert.equal(eirBanding(row.centralFeature,{banding:.5,met:8}),8);
 const other=measureEirEye(f.grid,{...eye,atcf:'AL012000',officialWind:999,ownerWind:999,targetT:8});assert.equal(other.dataT,row.dataT);assert.equal(other.narrowestWidthKm,row.narrowestWidthKm);
});
test('real comparison scans retain the original ADT regressions and new EIR measurements stay separate',async()=>{
 const {analyzeEyeDvorak}=await model,{measureEirEye}=await eir;
 for(const name of ['lekima','haiyan','patricia']){const f=fixture(name),eye=analyzeEyeDvorak(f.grid,{...f.center,atcf:f.atcf,autoCenter:true}),before=eye.rawT,r=measureEirEye(f.grid,eye);assert.equal(eye.rawT,before);assert.ok(r.dataT>=4&&r.dataT<=7.5);assert.ok(r.narrowestWidthKm>=r.requiredWidthKm);if(name==='patricia')assert.ok(eye.rawT>8);}
});
test('ADT 9.1 uses its published three-region Table 5 coefficients without changing the fitted legacy default',async()=>{
 const {eyeRegression,dvorakDomain}=await model,base={eye:20,cloud:-80,symmetry:0};
 assert.equal(eyeRegression({...base,domain:'pacific',version:'9.1'}),7.8);
 assert.equal(eyeRegression({...base,domain:'other',version:'9.1'}),7.5);
 assert.equal(eyeRegression({...base,domain:'atlantic',version:'9.1'}),8.5);
 assert.equal(eyeRegression({...base,domain:'pacific'}),7.5);
 assert.equal(dvorakDomain('SH112005',-15,-170,'9.1'),'other');assert.equal(dvorakDomain('IO052025',15,80,'9.1'),'other');assert.equal(dvorakDomain('WP152023',18,143,'9.1'),'pacific');assert.equal(dvorakDomain('EP202015',17,-105,'9.1'),'atlantic');
 assert.throws(()=>eyeRegression({...base,version:'unsupported'}),/supported/);
});
test('the ADT 9.1 archive calculation uses movable-sector cloud and symmetry sampling and does not force the supplied reference rating',async()=>{
 const {analyzeEyeDvorak}=await model,f=fixture('bolaven');
 const legacy=analyzeEyeDvorak(f.grid,{...f.center,atcf:f.atcf,autoCenter:true}),current=analyzeEyeDvorak(f.grid,{...f.center,atcf:f.atcf,autoCenter:true,version:'9.1'});
 assert.equal(legacy.rawT,7.4);assert.equal(current.version,'9.1');assert.equal(current.symmetryInner,current.inner);assert.equal(current.symmetryOuter,current.outer);assert.ok(current.rawT>legacy.rawT&&current.rawT<8);
 const renamed=analyzeEyeDvorak(f.grid,{...f.center,atcf:'WP012000',autoCenter:true,version:'9.1',targetT:8,ownerWind:300});assert.equal(renamed.rawT,current.rawT);
});
