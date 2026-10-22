const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const model=import('data:text/javascript;base64,'+fs.readFileSync(path.join(__dirname,'../wind-pressure-model.js')).toString('base64'));
const input={method:'dvorak',dvorakBasin:'atlantic',mode:'ci',ci:6};
const near=(actual,expected,tolerance=1e-7)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);

test('Dvorak matches the published NHC wind and basin pressure reference values',async()=>{
  const {calculateWindPressure}=await model;
  const reference=[[1,25,null,null],[1.5,25,null,null],[2,30,1009,1000],[2.5,35,1005,997],[3,45,1000,991],[3.5,55,994,984],[4,65,987,976],[4.5,77,979,966],[5,90,970,954],[5.5,102,960,941],[6,115,948,927],[6.5,127,935,914],[7,140,921,898],[7.5,155,906,879],[8,170,890,858]];
  for(const [ci,wind,atlantic,westPacific] of reference)for(const [dvorakBasin,pressure] of [['atlantic',atlantic],['westPacific',westPacific]]) {
    const row=calculateWindPressure({...input,dvorakBasin,ci}).solutions[0];
    near(row.windKnots,wind);assert.equal(row.pressureMb,pressure);assert.equal(row.interpolated,false);
  }
});

test('Dvorak interpolates both tables and inverts pressures and winds consistently',async()=>{
  const {calculateWindPressure,pressureFromWind,windsFromPressure,windPressureCurve}=await model;
  for(const [dvorakBasin,pressure] of [['atlantic',945.4],['westPacific',924.4]]) {
    const current={...input,dvorakBasin,ci:6.1},row=calculateWindPressure(current).solutions[0];
    near(row.windKnots,117.4);near(row.pressureMb,pressure);assert.equal(row.interpolated,true);
    near(windsFromPressure(pressure,current)[0].windKnots,117.4);
    const curve=windPressureCurve(current);
    assert.equal(curve.length,13);assert.equal(curve[0].windKnots,30);assert.equal(curve.at(-1).windKnots,170);
    for(let wind=30;wind<=170;wind+=.5) {
      const direct=pressureFromWind(wind,current),inverse=windsFromPressure(direct.pressureMb,current)[0];
      near(inverse.windKnots,wind);near(inverse.ci,direct.ci);
    }
  }
});

test('low Dvorak CI values preserve missing pressures and the 25-knot CI ambiguity',async()=>{
  const {calculateWindPressure,pressureFromWind,WIND_FACTORS}=await model;
  for(const ci of [1,1.5,1.7,1.9]) {
    const row=calculateWindPressure({...input,ci}).solutions[0];
    assert.equal(row.pressureMb,null);assert.ok(row.windKnots>=25);
  }
  const low=pressureFromWind(25,input);assert.deepEqual(low.ciRange,[1,1.5]);assert.equal(low.pressureMb,null);
  assert.equal(pressureFromWind(27.5,input).pressureMb,null);
  assert.equal(pressureFromWind(30,input).pressureMb,1009);
  for(const unit of ['mph','kmh'])for(const wind of [25,170]) {
    const converted=Number((wind*WIND_FACTORS[unit]).toFixed(6))/WIND_FACTORS[unit];
    const result=pressureFromWind(converted,input);near(result.windKnots,wind);
    if(wind===25)assert.deepEqual(result.ciRange,[1,1.5]);
  }
});

test('Dvorak validates table bounds and ignores irrelevant CKZ and station inputs',async()=>{
  const {calculateWindPressure,pressureFromWind,windsFromPressure,normalizeWindPressureOptions}=await model;
  assert.equal(calculateWindPressure({...input,latitude:'',radiusNmi:-1,motionKnots:Infinity,environmentMb:null,stationMb:''}).solutions[0].pressureMb,948);
  for(const dvorakBasin of ['',undefined,'invalid','constructor','__proto__'])assert.throws(()=>normalizeWindPressureOptions({...input,dvorakBasin}),error=>error.field==='dvorakBasin');
  for(const ci of ['',null,true,0,8.1,9,5.25,Infinity])assert.throws(()=>calculateWindPressure({...input,ci}),error=>error.field==='ci');
  for(const wind of ['',null,true,24,171,Infinity])assert.throws(()=>pressureFromWind(wind,input),error=>error.field==='windKnots');
  for(const [dvorakBasin,minimum,maximum] of [['atlantic',890,1009],['westPacific',858,1000]]) {
    for(const pressure of ['',null,true,minimum-1,maximum+1,Infinity])assert.throws(()=>windsFromPressure(pressure,{...input,dvorakBasin}),error=>error.field==='pressureMb');
    assert.equal(windsFromPressure(minimum,{...input,dvorakBasin})[0].windKnots,170);
    assert.equal(windsFromPressure(maximum,{...input,dvorakBasin})[0].windKnots,30);
  }
});
