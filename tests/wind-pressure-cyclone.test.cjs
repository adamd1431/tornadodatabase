const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const model=import(pathToFileURL(path.join(__dirname,'../wind-pressure-cyclone.js')).href);
const id='11111111-1111-4111-8111-111111111111';
const estimates={owner_estimated_winds_mph:'200',owner_estimated_pressure_mb:'885.79'};

function fakeClient(options={}) {
  const calls=[],user=options.guest?null:{id:'signed-in-user'};
  const query={
    update(values){calls.push(['update',values]);return query;},
    eq(key,value){calls.push(['eq',key,value]);return query;},
    select(columns){calls.push(['select',columns]);return query;},
    single:async()=>options.reply??{data:{id,name:'Hurricane fixture',year:2015,owner_estimated_winds_mph:200,owner_estimated_pressure_mb:885.79}}
  };
  return {calls,auth:{getUser:async()=>({data:{user},error:options.authError})},rpc:async(name,args)=>{
    calls.push(['permission',name,args]);return {data:options.owner!==false,error:options.permissionError};
  },from:table=>{calls.push(['from',table]);return query;}};
}

test('calculator estimate saves recheck the owner and update only the two owner fields',async()=>{
  const {saveCalculatorCycloneEstimate}=await model,client=fakeClient();
  const result=await saveCalculatorCycloneEstimate(client,id,{...estimates,peak_winds_mph:999,lowest_pressure_mb:1,status:'approved',name:'Changed'});
  assert.equal(result.id,id);
  assert.deepEqual(client.calls[0],['permission','utwx_is_owner',{check_user_id:'signed-in-user'}]);
  assert.deepEqual(client.calls.find(row=>row[0]==='update'),['update',{owner_estimated_winds_mph:200,owner_estimated_pressure_mb:885.79}]);
  assert.deepEqual(client.calls.find(row=>row[0]==='eq'),['eq','id',id]);
  assert.equal(client.calls.filter(row=>row[0]==='update').length,1);
});

test('signed-out users, nonowners, failed permissions, and expired sessions cannot save',async()=>{
  const {saveCalculatorCycloneEstimate,cycloneEstimateOwner}=await model;
  for(const options of [{guest:true},{owner:false},{authError:new Error('Expired')},{permissionError:new Error('Offline')},{authError:{name:'AuthSessionMissingError'}}]) {
    const client=fakeClient(options);
    await assert.rejects(()=>saveCalculatorCycloneEstimate(client,id,estimates));
    assert.ok(!client.calls.some(row=>row[0]==='from' || row[0]==='update'));
  }
  assert.equal(await cycloneEstimateOwner(fakeClient({guest:true})),null);
  assert.equal(await cycloneEstimateOwner(fakeClient({owner:false})),null);
});

test('both manual estimates are required, bounds are checked, and official figures cannot be cleared',async()=>{
  const {saveCalculatorCycloneEstimate}=await model;
  for(const input of [
    {...estimates,owner_estimated_winds_mph:''},{...estimates,owner_estimated_pressure_mb:' '},
    {...estimates,owner_estimated_winds_mph:null},{...estimates,owner_estimated_pressure_mb:false},
    {...estimates,owner_estimated_winds_mph:-1},{...estimates,owner_estimated_winds_mph:501},
    {...estimates,owner_estimated_pressure_mb:0},{...estimates,owner_estimated_pressure_mb:2001},
    {...estimates,owner_estimated_winds_mph:'bad'},{...estimates,owner_estimated_pressure_mb:Infinity}
  ]) {
    const client=fakeClient();await assert.rejects(()=>saveCalculatorCycloneEstimate(client,id,input));
    assert.equal(client.calls.length,0);
  }
  for(const badId of ['',null,'not-a-cyclone'])await assert.rejects(()=>saveCalculatorCycloneEstimate(fakeClient(),badId,estimates),error=>error.field==='estimateCyclone');
  const zero=fakeClient({reply:{data:{id,owner_estimated_winds_mph:0,owner_estimated_pressure_mb:'885.79'}}});
  await saveCalculatorCycloneEstimate(zero,id,{...estimates,owner_estimated_winds_mph:'0'});
});

test('saves require matching server confirmation and preserve server errors for a safe retry',async()=>{
  const {saveCalculatorCycloneEstimate}=await model;
  for(const data of [null,{id:'other'},{id,owner_estimated_winds_mph:199,owner_estimated_pressure_mb:885.79},{id,owner_estimated_winds_mph:null,owner_estimated_pressure_mb:885.79}]) {
    await assert.rejects(()=>saveCalculatorCycloneEstimate(fakeClient({reply:{data}}),id,estimates),/did not confirm/);
  }
  const error={code:'42501',message:'Only the owner can edit cyclone estimates.'};
  await assert.rejects(()=>saveCalculatorCycloneEstimate(fakeClient({reply:{error}}),id,estimates),value=>value===error);
});

test('cyclone picker paginates lightweight rows and excludes rejected entries',async()=>{
  const {loadEstimateCyclones}=await model,calls=[];
  const source=Array.from({length:1001},(_,index)=>({id:String(index),name:'Cyclone '+index,year:2020}));
  const query={select(columns){calls.push(['select',columns]);return query;},neq(key,value){calls.push(['neq',key,value]);return query;},order(){return query;},range:async(from,to)=>{calls.push(['range',from,to]);return {data:source.slice(from,to+1)};}};
  const rows=await loadEstimateCyclones({from:table=>{assert.equal(table,'tropical_cyclones');return query;}});
  assert.equal(rows.length,1001);
  assert.deepEqual(calls.filter(row=>row[0]==='range'),[['range',0,999],['range',1000,1999]]);
  assert.ok(calls.filter(row=>row[0]==='select').every(row=>!row[1].includes('*') && !row[1].includes('description')));
  assert.ok(calls.filter(row=>row[0]==='neq').every(row=>row[1]==='status' && row[2]==='rejected'));
  const error=new Error('Offline');query.range=async()=>({error});await assert.rejects(()=>loadEstimateCyclones({from:()=>query}),value=>value===error);
});

test('calculator autofill converts knots to mph and handles pressure-only and ambiguous results',async()=>{
  const {calculatorEstimateValues}=await model;
  assert.deepEqual(calculatorEstimateValues({solutions:[{windKnots:171.43984330677455,pressureMb:885.79}]}),{owner_estimated_winds_mph:197.3,owner_estimated_pressure_mb:885.79});
  assert.deepEqual(calculatorEstimateValues({solutions:[{pressureMb:909.4}]}),{owner_estimated_winds_mph:null,owner_estimated_pressure_mb:909.4});
  assert.deepEqual(calculatorEstimateValues({solutions:[{windKnots:25,pressureMb:null}]}),{owner_estimated_winds_mph:28.8,owner_estimated_pressure_mb:null});
  for(const result of [null,{solutions:[]},{solutions:[{windKnots:100},{windKnots:120}]},{solutions:[{windKnots:Infinity,pressureMb:NaN}]},{solutions:[{pressureMb:.001}]}])assert.equal(calculatorEstimateValues(result),null);
});
