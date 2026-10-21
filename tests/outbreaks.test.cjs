const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const model=import('data:text/javascript;base64,'+fs.readFileSync(path.join(__dirname,'../outbreaks.js')).toString('base64'));
const row={name:'April outbreak',dates:['2011-04-27','2011-04-26','2011-04-27'],cover_tornado_id:'tornado-1',tornado_order:['tornado-1','tornado-2','tornado-1']};

test('missing outbreak tables or columns identify the required setup instead of blaming the form',async()=>{
  const {outbreakErrorMessage}=await model;
  for(const code of ['PGRST205','PGRST204','42P01','42703'])assert.match(outbreakErrorMessage({code}),/supabase-outbreaks\.sql/);
  assert.equal(outbreakErrorMessage({code:'42501'},'Please sign in again.'),'Please sign in again.');
});

test('member submissions preserve dates, cover and order and wait for approval',async()=>{
  const {submitSharedOutbreak}=await model;let submitted;
  const q={insert(value){submitted=value;return q;},select(){return q;},single:async()=>({data:{...submitted,id:'saved-id'}})};
  const result=await submitSharedOutbreak({from:()=>q},row,{id:'member'},false);
  assert.equal(submitted.created_by,'member');assert.equal(submitted.status,'pending');
  assert.deepEqual(result.dates,['2011-04-26','2011-04-27']);assert.equal(result.cover_tornado_id,'tornado-1');assert.deepEqual(result.tornado_order,['tornado-1','tornado-2']);
});

test('admin submissions publish immediately; anonymous or dateless submissions are rejected',async()=>{
  const {submitSharedOutbreak}=await model;let submitted;
  const q={insert(value){submitted=value;return q;},select(){return q;},single:async()=>({data:{...submitted,id:'saved-id'}})};
  const client={from:()=>q};await submitSharedOutbreak(client,row,{id:'owner'},true);assert.equal(submitted.status,'approved');
  await assert.rejects(()=>submitSharedOutbreak(client,row,null,false),/Log in/);
  await assert.rejects(()=>submitSharedOutbreak(client,{...row,dates:[]},{id:'member'},false),/at least one day/);
});

test('failed or unconfirmed submissions cannot clear the form as a successful save',async()=>{
  const {submitSharedOutbreak}=await model;
  const q={insert(){return q;},select(){return q;},single:async()=>({data:null,error:null})};
  await assert.rejects(()=>submitSharedOutbreak({from:()=>q},row,{id:'member'},false),/did not confirm/);
  q.single=async()=>({error:{code:'PGRST205',message:'Missing table'}});
  await assert.rejects(()=>submitSharedOutbreak({from:()=>q},row,{id:'member'},false),error=>error.code==='PGRST205');
});

test('public outbreak loading requests approved rows and admin review includes pending rows',async()=>{
  const {loadSharedOutbreaks}=await model;const calls=[];
  const q={select(){return q;},eq(...args){calls.push(['eq',...args]);return q;},neq(...args){calls.push(['neq',...args]);return q;},order:async()=>({data:[]})};
  await loadSharedOutbreaks({from:()=>q});assert.deepEqual(calls.pop(),['eq','status','approved']);
  await loadSharedOutbreaks({from:()=>q},true);assert.deepEqual(calls.pop(),['neq','status','rejected']);
});

test('the submission form keeps its draft after missing setup and can save after setup without reloading',async()=>{
  const vm=require('node:vm'),{outbreakErrorMessage}=await model;
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const code=html.slice(html.indexOf('window.createOutbreak = async function()'),html.indexOf('function getStoredTop100PublicVisible()'));
  let missing=true,calls=0;
  const state={window:{applyFilters(){}},console:{warn(){}},currentUser:{id:'owner'},isAdmin:true,supabase:{},outbreakSubmitInFlight:false,outbreakLoadError:'Missing setup',
    selectedOutbreakDates:new Set(['2011-05-24']),outbreakNameInput:{value:'May outbreak'},outbreakCoverSelect:{value:'1'},createOutbreakBtn:{disabled:false,textContent:'Create outbreak'},
    allOutbreaks:[],currentIndexMode:'outbreaks',outbreakErrorMessage,renderOutbreakDateChips(){},syncIndexModeUi(){},setOutbreakStatus(message){state.notice=message;},
    selectedOutbreakDateList:()=>[...state.selectedOutbreakDates],selectedOutbreakMembers:()=>[{id:1}],
    submitSharedOutbreak:async()=>{calls++;if(missing)throw {code:'PGRST205'};return {id:'saved-id',status:'approved'};}
  };
  const context=vm.createContext(state);vm.runInContext(code,context);
  await state.window.createOutbreak();assert.match(state.notice,/supabase-outbreaks\.sql/);assert.match(state.notice,/entries are still here/);
  assert.equal(state.outbreakNameInput.value,'May outbreak');assert.equal(state.outbreakCoverSelect.value,'1');assert.equal(state.selectedOutbreakDates.size,1);assert.equal(state.createOutbreakBtn.disabled,false);assert.equal(state.outbreakSubmitInFlight,false);
  missing=false;await state.window.createOutbreak();assert.equal(calls,2);assert.equal(state.allOutbreaks.length,1);assert.equal(state.outbreakLoadError,'');assert.match(state.notice,/visible to everyone/);
  assert.equal(state.outbreakNameInput.value,'');assert.equal(state.selectedOutbreakDates.size,0);assert.equal(state.createOutbreakBtn.disabled,false);
});
