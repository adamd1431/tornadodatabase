const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const model=import('data:text/javascript;base64,'+fs.readFileSync(path.join(__dirname,'../wind-pressure-model.js')).toString('base64'));
const input={method:'schloemer',mode:'station',environmentMb:1009.5,stationMb:909.4,rmwNmi:25,distanceNmi:20,hollandB:1};
const near=(actual,expected,tolerance=1e-7)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);

test('SCH reproduces the screenshot with B=100 and the original Schloemer case with B=1',async()=>{
  const {calculateWindPressure}=await model;
  const screenshot=calculateWindPressure({...input,hollandB:100});
  near(screenshot.solutions[0].pressureMb,909.4);assert.equal(screenshot.solutions[0].amplification,1);
  // Independently evaluated with 60-digit decimal arithmetic.
  near(calculateWindPressure(input).solutions[0].pressureMb,869.2047330388493);
});

test('station observations recover known centers across RMWs, distances, and profile shapes',async()=>{
  const {centralPressureFromStation}=await model;
  for(const rmwNmi of [5,25,80])for(const hollandB of [.5,1,1.5,2.5,10,100])for(const ratio of [0,.5,1,2,4]) {
    const environmentMb=1010,centralMb=900,distanceNmi=ratio*rmwNmi;
    const stationMb=ratio===0?centralMb:centralMb+(environmentMb-centralMb)*Math.exp(-Math.pow(1/ratio,hollandB));
    // At extreme B and large distance the observation rounds to the environment;
    // a finite-precision observation then cannot determine the central pressure.
    if(environmentMb-stationMb<1e-7)continue;
    near(centralPressureFromStation({...input,environmentMb,stationMb,rmwNmi,distanceNmi,hollandB}).pressureMb,centralMb,1e-5);
  }
});

test('the radial curve passes through the station and central pressures and is monotonic',async()=>{
  const {schloemerPressureCurve,centralPressureFromStation}=await model;
  for(const hollandB of [1,1.5,100]) {
    const current={...input,hollandB},center=centralPressureFromStation(current),curve=schloemerPressureCurve(current);
    near(curve[0].pressureMb,center.pressureMb);
    near(curve.find(point=>point.distanceNmi===20).pressureMb,input.stationMb);
    near(curve.find(point=>point.distanceNmi===25).pressureMb,center.pressureMb+(input.environmentMb-center.pressureMb)/Math.E);
    assert.ok(curve.every((point,index)=>Number.isFinite(point.pressureMb) && point.pressureMb<=input.environmentMb && (!index || point.pressureMb>=curve[index-1].pressureMb-1e-10)));
  }
});

test('distance units cancel consistently and the reported station sensitivity matches a pressure change',async()=>{
  const {centralPressureFromStation,RADIUS_FACTORS}=await model;
  const result=centralPressureFromStation(input);
  near(centralPressureFromStation({...input,rmwNmi:25*RADIUS_FACTORS.km,distanceNmi:20*RADIUS_FACTORS.km}).pressureMb,result.pressureMb);
  const far={...input,distanceNmi:100,stationMb:1000},base=centralPressureFromStation(far);
  near(centralPressureFromStation({...far,stationMb:1001}).pressureMb-base.pressureMb,base.amplification);
});

test('SCH ignores unused wind inputs, handles the center, and rejects invalid or indeterminate observations',async()=>{
  const {calculateWindPressure,centralPressureFromStation,pressureFromWind,windsFromPressure}=await model;
  const result=calculateWindPressure({...input,latitude:'',windKnots:Infinity,radiusNmi:'',motionKnots:null});
  assert.ok(Number.isFinite(result.solutions[0].pressureMb));
  near(centralPressureFromStation({...input,distanceNmi:0}).pressureMb,input.stationMb);
  for(const field of ['environmentMb','stationMb','rmwNmi','distanceNmi','hollandB'])for(const value of ['',null,true,NaN,Infinity,-1]) {
    assert.throws(()=>centralPressureFromStation({...input,[field]:value}),error=>error.field===field);
  }
  for(const edit of [{rmwNmi:0},{hollandB:0},{stationMb:1009.5},{stationMb:1010},{distanceNmi:100,hollandB:100}])assert.throws(()=>centralPressureFromStation({...input,...edit}));
  assert.throws(()=>calculateWindPressure({...input,mode:'wind'}),/Station → central pressure/);
  assert.throws(()=>pressureFromWind(100,input),/station observation/);
  assert.throws(()=>windsFromPressure(900,input),/station observation/);
});
