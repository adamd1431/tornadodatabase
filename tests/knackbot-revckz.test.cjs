const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const model=import('data:text/javascript;base64,'+fs.readFileSync(path.join(__dirname,'../wind-pressure-model.js')).toString('base64'));
const input={method:'ckz',mode:'pressure',pressureMb:885.79,latitude:17.6,environmentMb:1009.5,radiusType:'roci',radiusNmi:330,motionKnots:13};
const near=(actual,expected,tolerance=1e-7)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);

test('normal CKZ uses the matched calculation and preserves the old method alias',async()=>{
  const {calculateWindPressure,normalizeWindPressureOptions}=await model;
  const standard=calculateWindPressure(input),legacy=calculateWindPressure({...input,method:'knack-revckz'});
  assert.equal(standard.options.method,'ckz');
  assert.equal(legacy.options.method,'ckz');
  assert.equal(standard.solutions[0].windKnots.toFixed(4),'171.4398');
  near(legacy.solutions[0].windKnots,standard.solutions[0].windKnots);
  assert.equal(normalizeWindPressureOptions({...input,method:'ckz-published',radiusType:'r34',radiusNmi:100}).method,'ckz-published');
});

test('inferred REVCKZ reproduces every supplied KnackBot result to four decimals',async()=>{
  const {calculateWindPressure}=await model;
  // User-provided KnackBot outputs on 2026-10-22: seven latitude screenshots,
  // an earlier 17.6° screenshot, an earlier 440-nmi case, and an independently
  // requested 600-nmi check supplied after the size rule was inferred.
  const references=[
    [50,330,885.79,13,1009.5,159.7911],
    [-15,330,885.79,13,1009.5,171.4398],
    [18.5,330,885.79,13,1009.5,174.6226],
    [20,330,885.79,13,1009.5,173.9326],
    [0,330,885.79,13,1009.5,171.4398],
    [30,330,885.79,13,1009.5,169.2919],
    [10,330,885.79,13,1009.5,171.4398],
    [17.6,330,885.79,13,1009.5,171.4398],
    [23.2,440,898.2,6,1005,149.9528],
    [17.6,600,885.79,13,1009.5,168.3572]
  ];
  for(const [latitude,radiusNmi,pressureMb,motionKnots,environmentMb,wind] of references) {
    const result=calculateWindPressure({...input,latitude,radiusNmi,pressureMb,motionKnots,environmentMb});
    assert.equal(result.solutions.length,1);
    assert.equal(result.solutions[0].windKnots.toFixed(4),wind.toFixed(4));
    near(result.solutions[0].pressureMb,pressureMb);
  }
});

test('REVCKZ infers size directly from ROCI and preserves low-latitude invariance',async()=>{
  const {calculateWindPressure,normalizeWindPressureOptions}=await model;
  near(normalizeWindPressureOptions(input).size,.7875);
  near(normalizeWindPressureOptions({...input,radiusNmi:440}).size,1.0166666666666666);
  near(normalizeWindPressureOptions({...input,radiusNmi:600}).size,1.35);
  const expected=calculateWindPressure(input).solutions[0].windKnots;
  for(const latitude of [0,5,10,15,17.999,-5,-15,-17.999])near(calculateWindPressure({...input,latitude}).solutions[0].windKnots,expected);
  for(const latitude of [18,18.5,20,30,50,60])near(calculateWindPressure({...input,latitude}).solutions[0].windKnots,calculateWindPressure({...input,latitude:-latitude}).solutions[0].windKnots);
});

test('REVCKZ curve and inverse agree at endpoints and across the pressure range',async()=>{
  const {windPressureCurve,windsFromPressure,calculateWindPressure}=await model;
  for(const radiusNmi of [330,440,600])for(const latitude of [0,18.5,50])for(const motionKnots of [0,13,60]) {
    const options={...input,radiusNmi,latitude,motionKnots},curve=windPressureCurve(options);
    assert.ok(curve.length>100);assert.equal(curve.at(-1).windKnots,250);
    for(let i=0;i<curve.length;i++) {
      const row=curve[i];assert.ok(Number.isFinite(row.pressureMb));
      if(i>0)assert.ok(row.pressureMb<curve[i-1].pressureMb);
      if(i===0 || i===curve.length-1 || i%25===0)near(windsFromPressure(row.pressureMb,options)[0].windKnots,row.windKnots);
    }
  }
  const result=calculateWindPressure(input).solutions[0];
  near(result.relativeWind+result.translation,result.windKnots);
  near(result.deficit,input.environmentMb-input.pressureMb);
});

test('REVCKZ accepts converted radius inputs without a hidden environmental adjustment',async()=>{
  const {calculateWindPressure,RADIUS_FACTORS}=await model;
  const km=600*RADIUS_FACTORS.km;
  assert.equal(calculateWindPressure({...input,radiusNmi:km/RADIUS_FACTORS.km}).solutions[0].windKnots.toFixed(4),'168.3572');
  const base=calculateWindPressure(input).solutions[0];
  near(calculateWindPressure({...input,pressureMb:input.pressureMb+2,environmentMb:input.environmentMb+2}).solutions[0].windKnots,base.windKnots);
  assert.notEqual(calculateWindPressure({...input,environmentMb:input.environmentMb+2}).solutions[0].windKnots.toFixed(4),base.windKnots.toFixed(4));
});

test('ROCI CKZ forward pressures match independent equation evaluations',async()=>{
  const {calculateWindPressure,pressureFromWind}=await model;
  // Independently evaluated with Python using the same documented coefficients.
  for(const [wind,latitude,radiusNmi,motionKnots,environmentMb,expected] of [
    [100,17.6,330,13,1009.5,959.7880723385812],
    [115,17.6,330,13,1009.5,946.7900039049243],
    [165,20,330,13,1009.5,895.021790088938],
    [140,-30,600,5,1010,904.8007818565807],
    [250,50,440,60,1012,797.0498652325075],
    [34,0,100,0,1005,996.3203138064555]
  ]) {
    const options={...input,latitude,radiusNmi,motionKnots,environmentMb};
    near(pressureFromWind(wind,options).pressureMb,expected);
    for(const method of ['ckz','knack-revckz'])near(calculateWindPressure({...options,method,mode:'wind',windKnots:wind}).solutions[0].pressureMb,expected);
  }
});

test('ROCI CKZ supports CI and round-trips winds through the same equation in both directions',async()=>{
  const {calculateWindPressure,pressureFromWind,windsFromPressure,ciToWind,windPressureCurve}=await model;
  for(const ci of [1,4,6,8,9]) {
    const result=calculateWindPressure({...input,mode:'ci',ci});
    near(result.ci,ci);near(result.solutions[0].windKnots,ciToWind(ci));
    near(result.solutions[0].pressureMb,pressureFromWind(ciToWind(ci),input).pressureMb);
  }
  near(calculateWindPressure({...input,mode:'ci',ci:6}).solutions[0].pressureMb,946.7900039049243);
  for(const radiusNmi of [100,330,440,600])for(const latitude of [0,17.6,18.5,30,-50])for(const motionKnots of [0,13,60]) {
    const options={...input,radiusNmi,latitude,motionKnots};
    for(const wind of [25,34,65,100,165,200,250]) {
      let forward;
      try{forward=pressureFromWind(wind,options);}catch(error){assert.match(error.message,/below the environment/);continue;}
      const reverse=windsFromPressure(forward.pressureMb,options);
      assert.equal(reverse.length,1);near(reverse[0].windKnots,wind);
      near(windPressureCurve(options).find(row=>row.windKnots===wind).pressureMb,forward.pressureMb);
    }
  }
});

test('ROCI CKZ validates pressure, wind, CI, and shared storm inputs',async()=>{
  const {calculateWindPressure,normalizeWindPressureOptions,windsFromPressure,pressureFromWind}=await model;
  for(const radiusNmi of ['',null,true,-1,0,1501,Infinity])assert.throws(()=>normalizeWindPressureOptions({...input,radiusNmi}),error=>error.field==='knackRociNmi');
  assert.throws(()=>normalizeWindPressureOptions({...input,radiusType:'r34'}),error=>error.field==='radiusType');
  for(const latitude of ['',null,-61,61,Infinity])assert.throws(()=>normalizeWindPressureOptions({...input,latitude}),error=>error.field==='latitude');
  for(const motionKnots of ['',null,-1,61,Infinity])assert.throws(()=>normalizeWindPressureOptions({...input,motionKnots}),error=>error.field==='motionKnots');
  for(const environmentMb of ['',null,799,1101,Infinity])assert.throws(()=>normalizeWindPressureOptions({...input,environmentMb}),error=>error.field==='environmentMb');
  for(const pressure of ['',null,399,1101,Infinity,input.environmentMb,400])assert.throws(()=>windsFromPressure(pressure,input),error=>error.field==='pressureMb');
  assert.throws(()=>windsFromPressure(1009.49,{...input,latitude:60,radiusNmi:1500}),error=>error.field==='pressureMb');
  for(const mode of ['station','bad'])assert.throws(()=>calculateWindPressure({...input,mode}),error=>error.field==='mode');
  for(const wind of ['',null,24,251,Infinity])assert.throws(()=>pressureFromWind(wind,input),error=>error.field==='windKnots');
  for(const ci of ['',null,.9,9.1,5.25,Infinity])assert.throws(()=>calculateWindPressure({...input,mode:'ci',ci}),error=>error.field==='ci');
  assert.equal(calculateWindPressure({...input,windKnots:'',ci:'',ckkRadiusMode:'',brownFit:'',stationMb:''}).solutions[0].windKnots.toFixed(4),'171.4398');
});
