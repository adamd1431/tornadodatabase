const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const model = import('data:text/javascript;base64,' + fs.readFileSync(path.join(__dirname,'../cyclones.js')).toString('base64'));
const example = {name:'Hurricane Patricia',year:'2015',peak_winds_mph:'215',lowest_pressure_mb:'872'};

test('cyclone media uses the requested six tabs and retains retired categories in Misc',async()=>{
  const {CYCLONE_CATEGORIES,cycloneMediaCategory,cycloneMediaCategoryLabel,cycloneImageCategory}=await model;
  assert.deepEqual(CYCLONE_CATEGORIES,[['photos','Pictures'],['satellite','Satellite imagery'],['damage','Damage'],['radar','Radar'],['models','Models'],['misc','Misc']]);
  for(const [key,label] of CYCLONE_CATEGORIES){assert.equal(cycloneMediaCategory(key),key);assert.equal(cycloneMediaCategoryLabel(key),label);}
  for(const retired of ['environment','research','text_accounts']){assert.equal(cycloneMediaCategory(retired),'misc');assert.equal(cycloneMediaCategoryLabel(retired),'Misc');}
  assert.equal(cycloneImageCategory('satellite'),true);assert.equal(cycloneImageCategory('models'),false);
});

test('cyclone submissions preserve the four fields with numeric values', async()=>{
  const {validateCyclone}=await model;
  assert.deepEqual(validateCyclone({...example,name:' Hurricane Patricia '}),{name:'Hurricane Patricia',year:2015,peak_winds_mph:215,lowest_pressure_mb:872});
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
  assert.equal(calls[0].args.p_status,undefined);
});

test('a failed or unconfirmed submission is not treated as saved',async()=>{
  const {submitCyclone}=await model;
  await assert.rejects(()=>submitCyclone({rpc:async()=>({data:null,error:null})},example),/did not confirm/);
  await assert.rejects(()=>submitCyclone({rpc:async()=>{throw new Error('Offline');}},example),/Offline/);
});

test('public listings request approved records and admins can review pending ones',async()=>{
  const {loadCyclones}=await model;
  const calls=[];const q={select(){return q;},order(){return q;},eq(...args){calls.push(['eq',...args]);return q;},neq(...args){calls.push(['neq',...args]);return q;},then(resolve){resolve({data:[],error:null});}};
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
