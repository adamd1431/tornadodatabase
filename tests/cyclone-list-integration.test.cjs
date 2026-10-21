const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const dataImport=source=>import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const model=dataImport(read('ranked-list-types.js').replace("'./cyclones.js'",JSON.stringify('data:text/javascript;base64,'+Buffer.from(read('cyclones.js')).toString('base64'))));
const contributions=dataImport(read('cyclone-contributions.js'));
function moduleBody(name){return read(name).match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*?;\r?\n/gm,'').replace(/\binit\(\);\s*$/,'');}
function functionSource(name,fn){const s=read(name),start=s.indexOf('function '+fn+'(');const open=s.indexOf('{',start); // Extract until the next top-level function.
 const next=s.indexOf('\nfunction ',open);const asyncNext=s.indexOf('\nasync function ',open);return s.slice(start,Math.min(...[next,asyncNext].filter(x=>x>=0)));}
function element(){return {value:'',textContent:'',className:'',innerHTML:'',style:{},dataset:{},disabled:false,options:[],classList:{toggle(){}},addEventListener(){},querySelectorAll:()=>[],focus(){this.focused=true;},reportValidity(){this.reported=true;}};}
function pageContext(extra={}){const elements=new Map();return {console,URL,URLSearchParams,crypto,location:{search:'',href:'https://site.test/user-lists.html',origin:'https://site.test',pathname:'/user-lists.html'},history:{replaceState(){}},localStorage:{getItem:()=>null,setItem(){}},window:{matchMedia:()=>({matches:true})},document:{addEventListener(){},getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},querySelectorAll:()=>[]},setTimeout,clearTimeout,...extra};}
function mockClient(tables,{errors={}}={}){const calls=[];return {calls,from(table){let filters=[],range=[0,999],payload,op='read',single=false;const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},order(){return q;},range(a,b){range=[a,b];return q;},insert(v){payload=v;op='insert';return q;},update(v){payload=v;op='update';return q;},single(){single=true;return q;},maybeSingle(){single=true;return q;},then(resolve,reject){return Promise.resolve().then(()=>{calls.push({table,filters,op,payload});if(errors[table])return {error:errors[table]};let rows=(tables[table]||[]).filter(r=>filters.every(([k,v])=>String(k==='tropical_cyclones.status'?r.parentStatus:r[k])===String(v)));if(op==='insert')rows=[{id:'new-list',...payload}];return {data:single?rows[0]||null:rows.slice(range[0],range[1]+1),error:null};}).then(resolve,reject);}};return q;}};}

test('legacy lists remain tornado lists; cyclone exports retain year, category, and official winds',async()=>{
 const m=await model;assert.equal(m.rankedListType({}),'tornadoes');assert.equal(m.rankedListLabel({list_type:'cyclones'},false),'tropical cyclone');
 const row={id:'c',name:'Hurricane Patricia',year:2015,peak_winds_mph:215,lowest_pressure_mb:872};const exported=m.rankedGeneratorRecord(row,{list_type:'cyclones'});
 assert.equal(exported.date,'2015');assert.equal(exported.intensity,'Category 5');assert.equal(exported._recordType,'cyclones');assert.equal(exported.peak_winds_mph,215);
 assert.match(m.rankedListSearchText(row,{list_type:'cyclones'}),/2015 215 872/);assert.equal(m.rankedGeneratorRecord(row,{}),row);
});

test('creating lists requires an explicit type and sends it to persistent storage',async()=>{
 const m=await model,client=mockClient({}),c=vm.createContext(pageContext({supabase:client,...m}));vm.runInContext(moduleBody('user-lists.html'),c);
 vm.runInContext("renderAll=()=>{};currentUser={id:'owner'};currentProfile={username:'Owner'};",c);
 await vm.runInContext('createList()',c);assert.equal(client.calls.length,0);assert.match(c.document.getElementById('statusBox').textContent,/Choose a tornado list/);
 c.document.getElementById('newListType').value='cyclones';await vm.runInContext('createList()',c);
 assert.equal(client.calls[0].payload.list_type,'cyclones');assert.equal(vm.runInContext('activeList.list_type',c),'cyclones');
});

test('list search and rank additions stay inside the chosen catalog, while legacy entries can be retained',async()=>{
 const m=await model,c=vm.createContext(pageContext({supabase:{},...m}));vm.runInContext(moduleBody('user-lists.html'),c);
 vm.runInContext("renderAll=()=>{};scheduleSave=()=>{};currentUser={id:'u'};allTornadoes=[{id:'t',name:'Tornado'}];allCyclones=[{id:'c',name:'Cyclone'}];activeList={id:'l',owner_id:'u',list_type:'cyclones',items:[{id:'missing',estimate:'210'}]};",c);
 assert.equal(vm.runInContext("findTornado('t')",c),undefined);vm.runInContext("setListRank('t')",c);assert.equal(vm.runInContext('activeList.items.length',c),1);
 vm.runInContext("setListRank('c',1);setListRank('missing',1)",c);assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(activeList.items)',c)),[{id:'missing',estimate:'210'},{id:'c'}]);
});

test('switching between list types during debounce saves each edited list to its own ID',async()=>{
 const m=await model,client=mockClient({}),timers=new Map();let id=0;
 const c=vm.createContext(pageContext({supabase:client,...m,setTimeout(fn){timers.set(++id,fn);return id;},clearTimeout(key){timers.delete(key);}}));vm.runInContext(moduleBody('user-lists.html'),c);
 vm.runInContext("currentUser={id:'u'};activeList={id:'t-list',owner_id:'u',items:[{id:'t'}],title:'Tornadoes'};scheduleSave();activeList={id:'c-list',owner_id:'u',list_type:'cyclones',items:[{id:'c'}],title:'Cyclones'};scheduleSave();",c);
 for(const fn of timers.values())fn();await new Promise(setImmediate);
 assert.deepEqual(client.calls.map(x=>[x.filters.find(([k])=>k==='id')[1],x.payload.items[0].id]),[['t-list','t'],['c-list','c']]);
});

test('cyclone contribution loading pages approved records and media, excludes unapproved parents, and supports account totals',async()=>{
 const {loadCycloneLeaderboardContributions:load}=await contributions;
 const client=mockClient({tropical_cyclones:Array.from({length:1001},(_,i)=>({id:String(i),status:'approved',created_by:'u'})),cyclone_uploads:[{id:'a',status:'approved',parentStatus:'approved',user_id:'u'},{id:'b',status:'pending',parentStatus:'approved',user_id:'u'},{id:'c',status:'approved',parentStatus:'pending',user_id:'u'},{id:'d',status:'approved',parentStatus:'approved',user_id:'other'}]});
 const result=await load(client,'u');assert.equal(result.cyclones.length,1001);assert.deepEqual(result.uploads.map(r=>r.id),['a']);assert.equal(client.calls.filter(x=>x.table==='tropical_cyclones').length,2);
 const missing=await load(mockClient({}, {errors:{tropical_cyclones:{code:'PGRST205'},cyclone_uploads:{code:'42P01'}}}));assert.equal(missing.unavailable,true);
 await assert.rejects(()=>load(mockClient({}, {errors:{tropical_cyclones:{code:'42501',message:'denied'}}})));
});

test('the shared leaderboard combines both databases under the same account without scoring pending records or videos',async()=>{
 const {loadCycloneLeaderboardContributions}=await contributions;
 const id='u',profile={id,username:'CurrentName',email:'person@example.test'};
 const client=mockClient({profiles:[profile],tornadoes:[{id:'t',status:'approved',user_id:id,submitted_by:'OldName'}],uploads:[{id:'p',status:'approved',category:'photos',user_id:id,uploaded_by:'OldName'},{id:'v',status:'approved',category:'photos',file_url:'https://site.test/video.mp4',user_id:id},{id:'w',status:'approved',category:'writeups',user_id:id}],tropical_cyclones:[{id:'c',status:'approved',created_by:id,submitted_by:'OldName'},{id:'pending',status:'pending',created_by:id}],cyclone_uploads:[{id:'cp',status:'approved',parentStatus:'approved',category:'satellite',user_id:id,uploaded_by:'OldName'},{id:'bad',status:'approved',parentStatus:'pending',user_id:id}]});
 const c=vm.createContext(pageContext({supabase:client,loadCycloneLeaderboardContributions}));vm.runInContext(moduleBody('leaderboard.html'),c);await vm.runInContext('init()',c);
 const rows=JSON.parse(vm.runInContext('JSON.stringify(leaderboardRows)',c));assert.equal(rows.length,1);assert.equal(rows[0].name,'CurrentName');assert.equal(rows[0].score,5);assert.equal(rows[0].uploads,2);assert.equal(rows[0].cyclones,1);assert.equal(rows[0].tornadoes,1);assert.equal(rows[0].writeups,1);
});

test('late tornado count results cannot replace the active cyclone counters',()=>{
 const c=vm.createContext(pageContext({currentIndexMode:'cyclones',cycloneTotals:{records:2,uploads:7},tornadoTotals:{records:50,uploads:100},lastTotalsKey:'',counterTimers:new WeakMap(),totalCountEl:element(),uploadCountEl:element(),clearInterval(){},animateCounter(el,value){el.textContent=String(value);}}));
 vm.runInContext(functionSource('index.html','syncIndexCounts'),c);vm.runInContext('syncIndexCounts();tornadoTotals.uploads=120;syncIndexCounts()',c);assert.equal(c.totalCountEl.textContent,'2');assert.equal(c.uploadCountEl.textContent,'7');vm.runInContext("currentIndexMode='outbreaks';syncIndexCounts()",c);assert.equal(c.totalCountEl.textContent,'50');assert.equal(c.uploadCountEl.textContent,'120');
});


test('typed catalogs page beyond the API row limit without mixing approval states or record types',async()=>{
 const {loadRankedListCatalog}=await model;
 for(const type of ['tornadoes','cyclones']) {
  const table=type==='cyclones'?'tropical_cyclones':'tornadoes';
  const client=mockClient({[table]:[...Array.from({length:1001},(_,i)=>({id:String(i),name:'Record '+i,status:'approved'})),{id:'pending',status:'pending'}]});
  const rows=await loadRankedListCatalog(client,{list_type:type});assert.equal(rows.length,1001);assert.equal(rows.some(row=>row.id==='pending'),false);assert.equal(client.calls.every(call=>call.table===table),true);
 }
});

test('a missing list-type migration keeps the creation draft and shows the required update',async()=>{
 const m=await model,client=mockClient({}, {errors:{user_top100_lists:{code:'PGRST204'}}}),c=vm.createContext(pageContext({supabase:client,...m}));vm.runInContext(moduleBody('user-lists.html'),c);
 vm.runInContext("currentUser={id:'owner'};currentProfile={username:'Owner'};",c);
 c.document.getElementById('newListType').value='cyclones';c.document.getElementById('newListTitle').value='Keep my draft';await vm.runInContext('createList()',c);
 assert.equal(c.document.getElementById('newListType').value,'cyclones');assert.equal(c.document.getElementById('newListTitle').value,'Keep my draft');assert.match(c.document.getElementById('statusBox').textContent,/supabase-user-list-types.sql/);assert.equal(c.document.getElementById('createListBtn').disabled,false);
});
