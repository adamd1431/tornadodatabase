const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const model=import('data:text/javascript;base64,'+fs.readFileSync(path.join(__dirname,'../wind-pressure-model.js')).toString('base64'));
const defaults={method:'ckz',mode:'wind',latitude:20,environmentMb:1010,radiusType:'r34',radiusNmi:100,motionKnots:11};
const near=(actual,expected,tolerance=1e-7)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);

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

test('CI values map to the documented ADT wind table without accepting invalid precision',async()=>{
  const {ciToWind,calculateWindPressure}=await model;
  for(const [ci,wind] of [[1,25],[1.5,25],[2,30],[3.5,55],[4,65],[4.5,77],[4.6,79.6],[5,90],[6,115],[7,140],[8,170],[9,200]])near(ciToWind(ci),wind);
  assert.throws(()=>ciToWind(5.25),/0.1/);
  const result=calculateWindPressure({...defaults,mode:'ci',ci:6});near(result.solutions[0].windKnots,115);
});

test('forward and inverse calculations round-trip across methods, latitudes and sizes',async()=>{
  const {pressureFromWind,windsFromPressure}=await model;
  for(const method of ['ckz','adt'])for(const latitude of [8,18,25,-35])for(const radiusNmi of [0,60,150,400])for(const wind of [40,65,100,140,170,230]){
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
