const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const model = import('data:text/javascript;base64,' + fs.readFileSync(path.join(__dirname,'../cyclones.js')).toString('base64'));
const example = {name:'Hurricane Patricia',year:'2015',peak_winds_mph:'215',lowest_pressure_mb:'872'};

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
