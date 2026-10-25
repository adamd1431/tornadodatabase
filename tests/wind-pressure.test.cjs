const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const model=import('data:text/javascript;base64,'+fs.readFileSync(path.join(__dirname,'../wind-pressure-model.js')).toString('base64'));
const defaults={method:'ckz-published',mode:'wind',latitude:20,environmentMb:1010,radiusType:'r34',radiusNmi:100,motionKnots:11};
const near=(actual,expected,tolerance=1e-7)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);

test('Brown reproduces the paper’s regional and 12-hour trend examples',async()=>{
  const {windsFromPressure}=await model;
  for(const [brownFit,pressure,wind] of [['gulf',920,133],['caribbean',920,138],['atlantic',920,142],['weakening',940,113],['steady',940,118],['strengthening',940,122]]) {
    near(windsFromPressure(pressure,{method:'brown2006',brownFit})[0].windKnots,wind,.6);
  }
});

test('all nine Brown fits match independently evaluated 100-knot reference pressures',async()=>{
  const {pressureFromWind,BROWN_FITS}=await model;
  const references={all:958.912781672471,south25:960.9422355372567,north25:955.2870671229397,strengthening:961.358076308343,steady:958.3151709521802,weakening:954.328112197151,gulf:956.4326367743943,caribbean:961.4548982997414,atlantic:959.0467746460762};
  assert.deepEqual(Object.keys(BROWN_FITS).sort(),Object.keys(references).sort());
  for(const [brownFit,expected] of Object.entries(references))near(pressureFromWind(100,{method:'brown2006',brownFit}).pressureMb,expected);
});

test('Brown inverses and curves agree across every fit, including calculation endpoints',async()=>{
  const {pressureFromWind,windsFromPressure,windPressureCurve,BROWN_FITS}=await model;
  for(const brownFit of Object.keys(BROWN_FITS)) {
    const input={method:'brown2006',brownFit},points=windPressureCurve(input);
    assert.equal(points[0].windKnots,25);assert.equal(points.at(-1).windKnots,250);
    for(const wind of [25,34,65,100,140,170,200,250]) {
      const result=pressureFromWind(wind,input),solutions=windsFromPressure(result.pressureMb,input);
      assert.equal(solutions.length,1);near(solutions[0].windKnots,wind);
      near(points.find(point=>point.windKnots===wind).pressureMb,result.pressureMb);
    }
    assert.ok(points.every((point,i)=>i===0 || point.pressureMb<points[i-1].pressureMb));
  }
});

test('Brown validates its own inputs and ignores unused CKZ fields',async()=>{
  const {calculateWindPressure,pressureFromWind,windsFromPressure,normalizeWindPressureOptions,BROWN_FITS}=await model;
  const input={method:'brown2006',brownFit:'all',mode:'pressure',pressureMb:940};
  near(calculateWindPressure({...input,latitude:'',environmentMb:'',radiusType:'bad',radiusNmi:-1,motionKnots:Infinity}).solutions[0].windKnots,119.282096578219);
  for(const brownFit of ['',undefined,'bad','constructor','__proto__'])assert.throws(()=>normalizeWindPressureOptions({...input,brownFit}),error=>error.field==='brownFit');
  for(const [brownFit,fit] of Object.entries(BROWN_FITS))for(const pressure of [fit.b,fit.b+1])assert.throws(()=>windsFromPressure(pressure,{...input,brownFit}),error=>error.field==='pressureMb');
  for(const pressure of ['',null,-1,Infinity,1101,400])assert.throws(()=>windsFromPressure(pressure,input));
  for(const wind of ['',null,24,251,Infinity])assert.throws(()=>pressureFromWind(wind,input));
  assert.throws(()=>calculateWindPressure({...input,mode:'ci',ci:6}),/Wind → pressure or Pressure → wind/);
});

test('CKZ reproduces the paper’s rounded table 2 CI6 pressure changes',async()=>{
  const {pressureFromWind}=await model;
  // Table 2 uses a rounded 10-minute wind of 100 kt for CI6; Eq.6 gives V1=100/.88.
  const cases=[[12,60,5,-62],[12,60,15,-58],[12,150,5,-64],[12,150,15,-60],[25,60,5,-67],[25,60,15,-64],[25,150,5,-70],[25,150,15,-66]];
  for(const [latitude,radiusNmi,motionKnots,change] of cases)near(pressureFromWind(100/.88,{...defaults,latitude,radiusNmi,motionKnots}).pressureMb-1010,change,.75);
});

test('ADT agrees with independent reference calculations and uses its fixed 11-knot motion',async()=>{
  const {pressureFromWind}=await model;
  for(const [wind,latitude,radiusNmi,expected] of [[100,20,100,958.8052648963828],[140,15,60,926.5048960376031],[170,-25,150,886.667438038346],[65,30,100,979.8888736365121]]){
    const result=pressureFromWind(wind,{...defaults,method:'adt',latitude,radiusNmi,motionKnots:40});near(result.pressureMb,expected);assert.equal(result.motionKnots,11);
  }
});

test('hemispheres match; CKZ changes branch at 18° and uses unadjusted wind for size',async()=>{
  const {pressureFromWind}=await model;
  near(pressureFromWind(120,{...defaults,latitude:15}).pressureMb,pressureFromWind(120,{...defaults,latitude:-15}).pressureMb);
  assert.equal(pressureFromWind(120,{...defaults,latitude:17.99}).lowLatitude,true);
  assert.equal(pressureFromWind(120,{...defaults,latitude:18}).lowLatitude,false);
  assert.equal(pressureFromWind(120,{...defaults,latitude:15,method:'adt'}).lowLatitude,false);
  const paper=pressureFromWind(140,{...defaults,radiusNmi:250,motionKnots:20}),adt=pressureFromWind(140,{...defaults,method:'adt',radiusNmi:250});
  assert.notEqual(paper.size,adt.size);
});

test('ROCI conversions use nautical miles and the small-storm size floor stays 0.4',async()=>{
  const {pressureFromWind,WIND_FACTORS,RADIUS_FACTORS}=await model;
  const roci=pressureFromWind(100,{...defaults,radiusType:'roci',radiusNmi:200});near(roci.r34,84.1);
  near(roci.pressureMb,pressureFromWind(100,{...defaults,radiusNmi:84.1}).pressureMb);
  assert.equal(pressureFromWind(100,{...defaults,radiusNmi:0}).size,.4);
  near(WIND_FACTORS.mph*1609.344,1852);near(RADIUS_FACTORS.km,1.852);
});

test('original CKZ uses KnackBot ROCI size with the original equation at every latitude',async()=>{
  const {pressureFromWind,windsFromPressure}=await model;
  // Independently evaluated with Python Decimal at 50-digit precision using
  // Eq. 1 / 7b and S = ROCI / 480 + 0.1, with all winds in knots.
  for(const [wind,latitude,motionKnots,radiusNmi,environmentMb,expected] of [[165,11.1,9,425,1006,891.735577130702],[100,20,11,330,1010,953.9278023963827],[140,15,7,600,1010,912.9666752827991],[170,25,5,100,1010,890.4495331404893],[100,18,13,330,1009.5,954.9960181012501]]) {
    const input={...defaults,method:'ckz-original',radiusType:'roci',latitude,motionKnots,radiusNmi,environmentMb},original=pressureFromWind(wind,input);
    near(original.pressureMb,expected);assert.equal(original.lowLatitude,false);
    near(original.size,radiusNmi/480+.1);
    near(windsFromPressure(expected,input)[0].windKnots,wind);
    near(pressureFromWind(wind,{...input,latitude:-latitude}).pressureMb,expected);
    const normal=pressureFromWind(wind,{...input,method:'ckz'});
    if(latitude>18)near(normal.pressureMb,expected);
    else {assert.equal(normal.lowLatitude,true);assert.notEqual(normal.pressureMb,original.pressureMb);}
    near(pressureFromWind(wind,{...input,environmentMb:environmentMb+2}).pressureMb-original.pressureMb,2);
  }
});

test('CKZ unit normalization agrees for knots, mph, km/h, R34, and ROCI',async()=>{
  const {pressureFromWind,WIND_FACTORS,RADIUS_FACTORS}=await model;
  for(const method of ['ckz-published','adt'])for(const radiusType of ['r34','roci']) {
    const current={...defaults,method,latitude:11.1,motionKnots:9,environmentMb:1006,radiusType,radiusNmi:radiusType==='roci'?425:163.75},reference=pressureFromWind(165,current);
    for(const [unit,value] of [['kt',165],['mph',189.8786089238845],['kmh',305.58]])for(const [radiusUnit,radiusValue] of [['nmi',current.radiusNmi],['km',current.radiusNmi*1.852]]) {
      near(pressureFromWind(value/WIND_FACTORS[unit],{...current,radiusNmi:radiusValue/RADIUS_FACTORS[radiusUnit]}).pressureMb,reference.pressureMb);
    }
  }
});

test('mean gale radius has no upper cap and larger radii work in both calculation directions',async()=>{
  const {normalizeWindPressureOptions,pressureFromWind,windsFromPressure}=await model;
  for(const method of ['ckz-published','adt']) {
    for(const radiusNmi of [501,1000,2500])assert.equal(normalizeWindPressureOptions({...defaults,method,radiusNmi}).r34,radiusNmi);
    const input={...defaults,method,radiusNmi:1000};
    const pressure=pressureFromWind(100,input).pressureMb;
    assert.ok(Number.isFinite(pressure));
    assert.ok(windsFromPressure(pressure,input).some(row=>Math.abs(row.windKnots-100)<1e-5));
  }
  for(const radiusNmi of ['',null,-1,NaN,Infinity,'bad'])assert.throws(()=>normalizeWindPressureOptions({...defaults,radiusNmi}),error=>error.field==='radiusNmi' && /finite number/.test(error.message));
});

test('CI values map to the documented ADT wind table without accepting invalid precision',async()=>{
  const {ciToWind,calculateWindPressure}=await model;
  for(const [ci,wind] of [[1,25],[1.5,25],[2,30],[3.5,55],[4,65],[4.5,77],[4.6,79.6],[5,90],[6,115],[7,140],[8,170],[9,200]])near(ciToWind(ci),wind);
  assert.throws(()=>ciToWind(5.25),/0.1/);
  const result=calculateWindPressure({...defaults,mode:'ci',ci:6});near(result.solutions[0].windKnots,115);
});

test('forward and inverse calculations round-trip across methods, latitudes and sizes',async()=>{
  const {pressureFromWind,windsFromPressure}=await model;
  for(const method of ['ckz-published','adt'])for(const latitude of [8,18,25,-35])for(const radiusNmi of [0,60,150,400])for(const wind of [40,65,100,140,170,230]){
    const input={...defaults,method,latitude,radiusNmi},pressure=pressureFromWind(wind,input).pressureMb;
    const solutions=windsFromPressure(pressure,input);assert.ok(solutions.some(row=>Math.abs(row.windKnots-wind)<1e-5),`${method},${latitude},${radiusNmi},${wind}`);
  }
});

test('inverse preserves multiple roots and catches close roots near a turning point',async()=>{
  const {pressureFromWind,windsFromPressure}=await model;
  const input={...defaults,method:'adt',latitude:25,radiusNmi:500};
  const roots=windsFromPressure(965.6,input);assert.equal(roots.length,2);for(const row of roots)near(pressureFromWind(row.windKnots,input).pressureMb,965.6);
  let lo=40,hi=44;for(let i=0;i<80;i++){const a=lo+(hi-lo)/3,b=hi-(hi-lo)/3;if(pressureFromWind(a,input).pressureMb<pressureFromWind(b,input).pressureMb)lo=a;else hi=b;}
  const peak=pressureFromWind((lo+hi)/2,input).pressureMb;
  assert.equal(windsFromPressure(peak-1e-5,input).length,2);assert.ok(windsFromPressure(peak,input).length>=1);
});

test('weak-system adjustment and impossible or blank inputs never become plausible results',async()=>{
  const {pressureFromWind,windsFromPressure,calculateWindPressure}=await model;
  const weak=pressureFromWind(25,{...defaults,method:'adt',latitude:0,radiusNmi:0});assert.equal(weak.floorApplied,true);assert.equal(weak.pressureMb,1008);
  assert.throws(()=>windsFromPressure(1008,{...defaults,method:'adt',radiusNmi:0}),/unique/);
  assert.throws(()=>windsFromPressure(1010,defaults),/lower/);
  assert.throws(()=>pressureFromWind(25,defaults),/R34 = 0/);
  for(const edit of [{latitude:''},{latitude:61},{environmentMb:null},{radiusNmi:-1},{motionKnots:Infinity},{windKnots:''},{windKnots:251},{method:'bad'}])assert.throws(()=>calculateWindPressure({...defaults,windKnots:100,...edit}));
});
