const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const model = import('data:text/javascript;base64,' + fs.readFileSync(path.join(__dirname,'../cyclones.js')).toString('base64'));
const example = {name:'Hurricane Patricia',year:'2015',peak_winds_mph:'215',lowest_pressure_mb:'872'};

test('chronological cyclone views retain year boundaries and share the saved within-year order',async()=>{
  const {compareCycloneYear}=await model;
  const rows=[{id:'b',year:2015,year_order:2},{id:'new',year:2020},{id:'a',year:2015,year_order:3},{id:'old',year:1990},{id:'c',year:2015,year_order:1}];
  assert.deepEqual([...rows].sort((a,b)=>compareCycloneYear(a,b,'newest')).map(row=>row.id),['new','c','b','a','old']);
  assert.deepEqual([...rows].sort((a,b)=>compareCycloneYear(a,b,'oldest')).map(row=>row.id),['old','c','b','a','new']);
  assert.deepEqual([{id:'b',year:2015},{id:'a',year:2015,year_order:0}].sort(compareCycloneYear).map(row=>row.id),['a','b']);
});

test('cyclone moves require an acknowledged atomic save and preserve server errors',async()=>{
  const {moveCyclone}=await model;const calls=[],rows=[{id:'a',year_order:2},{id:'b',year_order:1}];
  const client={rpc:async(name,args)=>{calls.push({name,args});return {data:rows,error:null};}};
  assert.deepEqual(await moveCyclone(client,'a','b'),rows);
  assert.deepEqual(calls,[{name:'utwx_move_cyclone',args:{p_cyclone_id:'a',p_neighbor_id:'b'}}]);
  for(const data of [null,[],[rows[0]]])await assert.rejects(()=>moveCyclone({rpc:async()=>({data})},'a','b'),/not confirmed/);
  const error={code:'42501',message:'Only the owner can change cyclone order.'};
  await assert.rejects(()=>moveCyclone({rpc:async()=>({error})},'a','b'),value=>value===error);
});

test('cyclone media places Research between Recon and Damage and retains retired categories in Misc',async()=>{
  const {CYCLONE_CATEGORIES,cycloneMediaCategory,cycloneMediaCategoryLabel,cycloneImageCategory}=await model;
  assert.deepEqual(CYCLONE_CATEGORIES,[['photos','Pictures'],['satellite','Satellite imagery'],['track','Track'],['recon','Recon'],['research','Research'],['damage','Damage'],['radar','Radar'],['models','Models'],['misc','Misc']]);
  for(const [key,label] of CYCLONE_CATEGORIES){assert.equal(cycloneMediaCategory(key),key);assert.equal(cycloneMediaCategoryLabel(key),label);}
  for(const retired of ['environment','text_accounts']){assert.equal(cycloneMediaCategory(retired),'misc');assert.equal(cycloneMediaCategoryLabel(retired),'Misc');}
  assert.equal(cycloneImageCategory('satellite'),true);assert.equal(cycloneImageCategory('track'),false);assert.equal(cycloneImageCategory('recon'),false);assert.equal(cycloneImageCategory('research'),false);assert.equal(cycloneImageCategory('models'),false);
});

test('cyclone submissions preserve required fields and leave unknown eye temperature unset', async()=>{
  const {validateCyclone}=await model;
  assert.deepEqual(validateCyclone({...example,name:' Hurricane Patricia '}),{name:'Hurricane Patricia',year:2015,peak_winds_mph:215,lowest_pressure_mb:872,eye_temperature_c:null});
});

test('cyclone winds accept knots and consistently use the last edited unit',async()=>{
  const {validateCyclone,cycloneWindKnots}=await model;
  assert.equal(validateCyclone({...example,peak_winds_mph:'',peak_winds_kts:'185'}).peak_winds_mph,215);
  assert.equal(validateCyclone({...example,peak_winds_kts:'185',wind_input_unit:'kts'}).peak_winds_mph,215);
  assert.equal(validateCyclone({...example,peak_winds_kts:'185',wind_input_unit:'mph'}).peak_winds_mph,215);
  assert.equal(cycloneWindKnots(212.89),'185');assert.equal(cycloneWindKnots(215),'185');assert.equal(cycloneWindKnots(0),'0');
  assert.equal(validateCyclone({...example,peak_winds_kts:'185'}).peak_winds_mph,215);
  assert.throws(()=>validateCyclone({...example,peak_winds_kts:'165'}),/same speed/);
  assert.equal(validateCyclone({...example,peak_winds_mph:'',peak_winds_kts:'435'}).peak_winds_mph,500);
  for(const invalid of ['bad',Infinity,-1,440])assert.throws(()=>validateCyclone({...example,peak_winds_mph:'',peak_winds_kts:invalid}));
});

test('infrared eye temperature is optional and preserves zero and negative measurements',async()=>{
  const {validateCyclone,cycloneEyeStat,cycloneEyeTemperature}=await model;
  for(const blank of [undefined,null,'',' '])assert.equal(validateCyclone({...example,eye_temperature_c:blank}).eye_temperature_c,null);
  for(const value of [0,-35.5,21.8])assert.equal(validateCyclone({...example,eye_temperature_c:String(value)}).eye_temperature_c,value);
  for(const invalid of ['bad',Infinity,-151,101])assert.throws(()=>validateCyclone({...example,eye_temperature_c:invalid}),/eye temperature/);
  assert.match(cycloneEyeStat({eye_temperature_c:0}),/0 °C/);assert.equal(cycloneEyeStat({}),'');assert.equal(cycloneEyeTemperature({eye_temperature_c:null}),'');
});

test('add and review forms include linked wind units and an optional infrared field',async()=>{
  const {cycloneFields}=await model;
  const fields=cycloneFields({...example,eye_temperature_c:0},'review-test');
  assert.match(fields,/Peak winds \(kts\)/);assert.match(fields,/name="peak_winds_kts"[^>]*value="185"/);
  const eye=fields.match(/<input[^>]+name="eye_temperature_c"[^>]*>/)[0];
  assert.ok(!eye.includes('required'));assert.match(eye,/value="0"/);assert.match(eye,/id="review-test-eye_temperature_c"/);
});

test('wind controls synchronize in either direction without accumulating listeners',async()=>{
  const {bindCycloneWindInputs}=await model;
  let listener,count=0;const root={addEventListener(name,fn){assert.equal(name,'input');listener=fn;count++;}};
  const fields={peak_winds_mph:{value:''},peak_winds_kts:{value:''},wind_input_unit:{value:'mph'}};
  const form={elements:{namedItem:name=>fields[name]}};
  const event=(name,value)=>({target:{name,value,validity:{badInput:false},closest:()=>form}});
  bindCycloneWindInputs(root);bindCycloneWindInputs(root);assert.equal(count,1);
  listener(event('peak_winds_kts','185'));assert.equal(fields.peak_winds_mph.value,'215');assert.equal(fields.wind_input_unit.value,'kts');
  listener(event('peak_winds_mph','215'));assert.equal(fields.peak_winds_kts.value,'185');assert.equal(fields.wind_input_unit.value,'mph');
  listener(event('peak_winds_kts','140'));assert.equal(fields.peak_winds_mph.value,'160');
  listener(event('peak_winds_kts','165'));assert.equal(fields.peak_winds_mph.value,'190');
  listener(event('peak_winds_mph','190'));assert.equal(fields.peak_winds_kts.value,'165');
  listener(event('peak_winds_kts','0'));assert.equal(fields.peak_winds_mph.value,'0');
  listener(event('peak_winds_mph',''));assert.equal(fields.peak_winds_kts.value,'');
});

test('blank, invalid, and out of range submission fields are rejected',async()=>{
  const {validateCyclone}=await model;
  for(const edits of [{name:''},{name:'x'.repeat(161)},{year:''},{year:'2015.5'},{year:10000},{peak_winds_mph:''},{peak_winds_mph:-1},{peak_winds_mph:Infinity},{lowest_pressure_mb:''},{lowest_pressure_mb:0},{lowest_pressure_mb:'bad'}]) assert.throws(()=>validateCyclone({...example,...edits}));
});

test('submissions reuse the request identifier and leave approval to the server',async()=>{
  const {submitCyclone}=await model;
  const calls=[],id='00000000-0000-0000-0000-000000000001';
  const client={rpc:async(name,args)=>{calls.push({name,args});return {data:{id,status:'pending'},error:null};}};
  await submitCyclone(client,example,id);await submitCyclone(client,example,id);
  assert.deepEqual(calls[0],calls[1]);
  assert.equal(calls[0].name,'submit_tropical_cyclone');
  assert.equal(calls[0].args.p_id,id);
  assert.equal(calls[0].args.p_peak_winds_mph,215);
  assert.equal(calls[0].args.p_eye_temperature_c,undefined);
  assert.equal(calls[0].args.p_status,undefined);
});

test('submissions send a supplied eye temperature, including zero, without altering approval',async()=>{
  const {submitCyclone}=await model;const calls=[];
  const client={rpc:async(name,args)=>{calls.push(args);return {data:{id:'saved',status:'pending'}};}};
  for(const value of [0,21.5,-5])await submitCyclone(client,{...example,eye_temperature_c:value},'request-id');
  assert.deepEqual(calls.map(args=>args.p_eye_temperature_c),[0,21.5,-5]);
  assert.ok(calls.every(args=>args.p_id==='request-id' && args.p_status===undefined));
});

test('a failed or unconfirmed submission is not treated as saved',async()=>{
  const {submitCyclone}=await model;
  await assert.rejects(()=>submitCyclone({rpc:async()=>({data:null,error:null})},example),/did not confirm/);
  await assert.rejects(()=>submitCyclone({rpc:async()=>{throw new Error('Offline');}},example),/Offline/);
});

test('public listings request approved records and admins can review pending ones',async()=>{
  const {loadCyclones}=await model;
  const calls=[];const q={select(){return q;},order(){return q;},range(){return q;},eq(...args){calls.push(['eq',...args]);return q;},neq(...args){calls.push(['neq',...args]);return q;},then(resolve){resolve({data:[],error:null});}};
  await loadCyclones({from:()=>q});assert.deepEqual(calls.pop(),['eq','status','approved']);
  await loadCyclones({from:()=>q},true);assert.deepEqual(calls.pop(),['neq','status','rejected']);
});

test('record names are escaped in editable fields and URL parameters',async()=>{
  const {cycloneFields,cycloneUrl}=await model;
  const fields=cycloneFields({name:'"><img src=x onerror=alert(1)>'});
  assert.ok(fields.includes('&quot;&gt;&lt;img'));
  assert.ok(!fields.includes('<img'));
  assert.equal(cycloneUrl({id:'a&other=b'}),'tropical-cyclone.html?id=a%26other%3Db');
});

test('cyclone categories follow official wind boundaries and the existing EF1–EF5 palette',async()=>{
  const {cyclonePeak}=await model;
  const homepage=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const functionSource=homepage.slice(homepage.indexOf('function getEFColor('),homepage.indexOf('function getIntensityBg('));
  const efColor=new Function(functionSource+';return getEFColor;')();
  for(const [wind,expected] of [[0,0],[38,0],[39,0],[73,0],[74,1],[95,1],[96,2],[110,2],[111,3],[129,3],[130,4],[156,4],[157,5],[215,5]]) {
    const peak=cyclonePeak(wind);assert.equal(peak.category,expected);assert.equal(peak.color,efColor('EF'+expected));
  }
  assert.equal(cyclonePeak(73).label,'Tropical storm');assert.equal(cyclonePeak(38).label,'Tropical depression');
  for(const invalid of [null,undefined,'','bad',-1,Infinity]) assert.equal(cyclonePeak(invalid).category,null);
});

test('owner estimates are optional and cannot replace the official submission fields',async()=>{
  const {validateCycloneEstimates,validateCyclone}=await model;
  assert.deepEqual(validateCycloneEstimates({owner_estimated_winds_mph:'230',owner_estimated_pressure_mb:'865',peak_winds_mph:999}),{owner_estimated_winds_mph:230,owner_estimated_pressure_mb:865});
  assert.deepEqual(validateCycloneEstimates({owner_estimated_winds_mph:' ',owner_estimated_pressure_mb:''}),{owner_estimated_winds_mph:null,owner_estimated_pressure_mb:null});
  assert.equal(validateCycloneEstimates({owner_estimated_winds_mph:0}).owner_estimated_winds_mph,0);
  assert.equal(validateCyclone({...example,owner_estimated_winds_mph:230}).owner_estimated_winds_mph,undefined);
  for(const invalid of [-1,501,Infinity,'bad']) assert.throws(()=>validateCycloneEstimates({owner_estimated_winds_mph:invalid}));
  for(const invalid of [0,-1,2001,Infinity,'bad']) assert.throws(()=>validateCycloneEstimates({owner_estimated_pressure_mb:invalid}));
});

test('owner estimate displays label independent figures and omit unset values',async()=>{
  const {cycloneEstimateStats,cycloneEstimateFields}=await model;
  assert.equal(cycloneEstimateStats({peak_winds_mph:215}), '');
  const stats=cycloneEstimateStats({owner_estimated_winds_mph:0,owner_estimated_pressure_mb:865,peak_winds_mph:215});
  assert.match(stats,/Owner estimates/);assert.match(stats,/0 mph/);assert.match(stats,/865 mb/);assert.ok(!stats.includes('215'));
  assert.ok(!cycloneEstimateFields().includes(' required'));
  assert.ok(!cycloneEstimateStats({owner_estimated_winds_mph:'<img>'}).includes('<img>'));
});


test('cyclone wind conversions round to five-unit increments and submit the same mph shown in the form',async()=>{
  const {cycloneWindMph,cycloneWindKnots,submitCyclone}=await model;
  for(const [knots,mph] of [[140,160],[165,190],[185,215],[0,0]]) {
    assert.equal(cycloneWindMph(knots),String(mph));
    assert.equal(cycloneWindKnots(mph),String(knots));
    let saved;
    await submitCyclone({rpc:async(_name,args)=>{saved=args;return {data:{id:args.p_id,status:'pending'}};}},{...example,peak_winds_mph:String(mph),peak_winds_kts:String(knots),wind_input_unit:'kts'},'rounding-test');
    assert.equal(saved.p_peak_winds_mph,mph);
  }
  for(const blank of [null,undefined,'',' ',NaN,Infinity,'bad']) {
    assert.equal(cycloneWindKnots(blank),'');assert.equal(cycloneWindMph(blank),'');
  }
});
