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

test('empty calendar days submit without requiring tornadoes or uploads; invalid dates are rejected',async()=>{
  const {submitSharedOutbreak,isOutbreakDate}=await model;let submitted;
  const q={insert(value){submitted=value;return q;},select(){return q;},single:async()=>({data:{...submitted,id:'empty-outbreak'}})};
  const client={from(table){assert.equal(table,'outbreaks');return q;}};
  const saved=await submitSharedOutbreak(client,{name:'Empty days',dates:['1900-01-01','1900-01-02']},{id:'member'},false);
  assert.deepEqual(saved.dates,['1900-01-01','1900-01-02']);assert.equal(saved.status,'pending');assert.deepEqual(saved.tornado_order,[]);
  assert.equal(isOutbreakDate('2024-02-29'),true);
  for(const date of ['2026-02-29','2026-04-31','0000-01-01','bad']){
    assert.equal(isOutbreakDate(date),false);
    await assert.rejects(()=>submitSharedOutbreak(client,{name:'Invalid day',dates:[date]},{id:'member'},false),/valid calendar day/);
  }
});

function editorClient({user={id:'owner'},owner=true,error=null,result}={}) {
  const calls=[];let payload;
  const q={update(value){payload=value;calls.push(value);return q;},eq(){return q;},select(){return q;},single:async()=>({data:result===undefined?{id:'outbreak-id',...payload}:result,error})};
  return {calls,auth:{getUser:async()=>({data:{user}})},rpc:async(name,args)=>{
    assert.equal(name,'utwx_is_owner');assert.equal(args.check_user_id,user.id);return {data:owner};
  },from(table){assert.equal(table,'outbreaks');return q;}};
}

test('editing rechecks ownership and fails before writes for signed-out users, members, or nonowner admins',async()=>{
  const {updateSharedOutbreak}=await model;
  for(const options of [{user:null},{owner:false},{owner:false,user:{id:'admin'}}]){
    const client=editorClient(options);
    await assert.rejects(()=>updateSharedOutbreak(client,'outbreak-id',{name:'Changed'}),/owner/);
    assert.equal(client.calls.length,0);
  }
});

test('owner edits normalize dates and names, preserve empty days, and require a matching confirmation',async()=>{
  const {updateSharedOutbreak}=await model,client=editorClient();
  const saved=await updateSharedOutbreak(client,'outbreak-id',{name:'  Renamed outbreak  ',dates:['1900-01-02','1900-01-01','1900-01-02'],tornado_order:[]});
  assert.equal(saved.name,'Renamed outbreak');assert.deepEqual(saved.dates,['1900-01-01','1900-01-02']);
  for(const changes of [{dates:[]},{dates:['2026-02-30']},{name:'  '},{status:'approved'}])await assert.rejects(()=>updateSharedOutbreak(client,'outbreak-id',changes));
  assert.equal(client.calls.length,1);
  for(const result of [null,{id:'other-outbreak'}])await assert.rejects(()=>updateSharedOutbreak(editorClient({result}),'outbreak-id',{name:'Renamed'}),/did not confirm/);
  await assert.rejects(()=>updateSharedOutbreak(editorClient({error:{message:'Offline'}}),'outbreak-id',{name:'Renamed'}),error=>error.message==='Offline');
});

test('owner day editor keeps failed drafts, retries, and removes days without deleting tornadoes',async()=>{
  const vm=require('node:vm'),helpers=await model;
  const html=fs.readFileSync(path.join(__dirname,'../outbreak.html'),'utf8');
  const source=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*;\r?\n/gm,'').replace(/\binit\(\);\s*$/,'');
  const elements=new Map();
  function element(key){if(!elements.has(key))elements.set(key,{hidden:true,disabled:false,value:'',textContent:'',innerHTML:'',listeners:{},addEventListener(event,fn){this.listeners[event]=fn;},querySelectorAll:()=>[]});return elements.get(key);}
  let fail=true,writes=0,saved,url;
  const state={...helpers,document:{getElementById:element,body:{classList:{toggle(){}}}},history:{replaceState(a,b,value){url=value;}},location:{},console:{warn(){}},supabase:{},
    updateSharedOutbreak:async(client,id,changes)=>{writes++;if(fail)throw new Error('Offline');return saved={id,...changes};}};
  const context=vm.createContext(state);vm.runInContext(source,context);
  vm.runInContext("renderHero=()=>{};renderAdminTools=()=>{};renderMembers=()=>{};isOwner=true;isAdmin=true;allTornadoes=[{id:1,date:'2011-05-24'}];showLoaded({id:'outbreak-id',name:'May outbreak',dates:['2011-05-24'],cover_tornado_id:'1',tornado_order:['1']});",context);
  assert.match(element('outbreakDays').innerHTML,/1 tornado/);
  element('editOutbreakDate').value='1900-01-01';element('addOutbreakDay').listeners.click();
  assert.match(element('editOutbreakDays').innerHTML,/Jan 1, 1900/);
  element('editOutbreakDays').listeners.click({target:{closest:()=>({disabled:false,dataset:{removeDay:'2011-05-24'}})}});
  element('editOutbreakName').value='Empty outbreak';element('editOutbreakName').listeners.input();
  const submit=()=>element('outbreakEditForm').listeners.submit({preventDefault(){}});
  await submit();assert.equal(writes,1);assert.equal(element('editOutbreakName').value,'Empty outbreak');assert.match(element('editOutbreakStatus').textContent,/Offline.*still here/);
  assert.equal(element('saveOutbreakInfo').disabled,false);
  fail=false;await submit();assert.equal(writes,2);assert.deepEqual([...saved.dates],['1900-01-01']);assert.equal(saved.cover_tornado_id,null);assert.equal(saved.tornado_order.length,0);
  assert.match(url,/id=outbreak-id/);assert.equal(element('saveOutbreakInfo').disabled,true);assert.match(element('outbreakDays').innerHTML,/No tornadoes or uploads yet/);
  assert.equal(vm.runInContext('allTornadoes.length',context),1);
  vm.runInContext('isOwner=false;showLoaded(currentOutbreak)',context);assert.equal(element('outbreakEditor').hidden,true);
  element('editOutbreakDate').value='1900-01-02';element('addOutbreakDay').listeners.click();await submit();assert.equal(writes,2);
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
