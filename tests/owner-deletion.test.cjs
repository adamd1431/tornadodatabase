const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const model = import('data:text/javascript;base64,' + fs.readFileSync(path.join(__dirname,'../owner-deletion.js')).toString('base64'));
const id = '10000000-0000-0000-0000-000000000001';

test('website archive locators are never passed to Supabase file deletion', async () => {
  const { cleanupCycloneFiles } = await model, f = fixture();
  assert.deepEqual(await cleanupCycloneFiles(f.client, ['https://tornadodatabase.vercel.app/media-archive/file.webp', 'owner/storm/file.png']), []);
  assert.deepEqual(f.calls.filter(call => call.op === 'storage').map(call => call.paths), [['owner/storm/file.png']]);
});

function fixture(options = {}) {
  const calls = [], rows = options.rows || [];
  const client = {
    auth: {getUser: async () => ({data:{user:options.guest ? null : {id:'owner'}},error:options.authError})},
    rpc: async (name,args) => {calls.push({op:'permission',name,args});return {data:options.owner !== false,error:options.permissionError};},
    from(table) {
      let op = 'read', filter, start = 0, end = Infinity;
      const q = {
        delete(){op='delete';return q;}, select(){return q;},
        eq(key,value){filter={key,value};return q;}, order(){return q;},
        range(a,b){start=a;end=b;return q;},
        async maybeSingle() {
          calls.push({op,table,filter});
          return {data:options.unconfirmed ? null : {id:options.wrongId || id},error:options.deleteError};
        },
        then(resolve,reject) {
          calls.push({op,table,filter,start,end});
          return Promise.resolve({data:rows.filter(row=>row[filter.key]===filter.value).slice(start,end+1),error:options.readError}).then(resolve,reject);
        }
      };
      return q;
    },
    storage: {from(bucket) {return {async remove(paths) {
      calls.push({op:'storage',bucket,paths});
      return options.remove ? options.remove(paths) : {error:null};
    }};}}
  };
  return {client,calls};
}

test('deletion rechecks the signed-in owner before accessing records',async()=>{
  const {deleteOutbreak,deleteTropicalCyclone} = await model;
  for(const action of [deleteOutbreak,deleteTropicalCyclone]) {
    for(const options of [{guest:true},{owner:false},{authError:new Error('Expired session')},{permissionError:new Error('Permission check failed')}]) {
      const {client,calls}=fixture(options);
      await assert.rejects(()=>action(client,id));
      assert.equal(calls.some(call=>call.table || call.bucket),false);
    }
  }
});

test('outbreak deletion affects only the grouping and requires a confirmed row',async()=>{
  const {deleteOutbreak}=await model;
  const {client,calls}=fixture();await deleteOutbreak(client,id);
  assert.deepEqual(calls.filter(call=>call.table),[{op:'delete',table:'outbreaks',filter:{key:'id',value:id}}]);
  assert.equal(calls.some(call=>call.bucket),false);
  const denied=fixture({unconfirmed:true});
  await assert.rejects(()=>deleteOutbreak(denied.client,id),/not confirmed/);
});

test('cyclone deletion captures every media page and cleans files only after the confirmed parent delete',async()=>{
  const {deleteTropicalCyclone}=await model;
  const rows=Array.from({length:1001},(_,index)=>({id:String(index).padStart(5,'0'),cyclone_id:id,storage_path:`owner/${id}/${index}.png`,status:index%2 ? 'pending' : 'rejected'}));
  rows.push({id:'other',cyclone_id:'another-cyclone',storage_path:'keep.png',status:'approved'});
  const {client,calls}=fixture({rows});
  assert.deepEqual(await deleteTropicalCyclone(client,id),[]);
  const reads=calls.filter(call=>call.op==='read');assert.equal(reads.length,2);
  assert.deepEqual(reads.map(call=>call.start),[0,1000]);
  const deletion=calls.findIndex(call=>call.op==='delete');
  const cleanups=calls.filter(call=>call.op==='storage');
  assert.ok(calls.findIndex(call=>call.op==='storage')>deletion);
  assert.equal(cleanups.length,2);assert.equal(cleanups.flatMap(call=>call.paths).length,1001);
  assert.equal(cleanups.some(call=>call.paths.includes('keep.png')),false);
});

test('missing rows, denied deletes, and failed media reads never delete stored files',async()=>{
  const {deleteTropicalCyclone}=await model;
  const rows=[{id:'upload',cyclone_id:id,storage_path:'keep.png'}];
  for(const options of [{unconfirmed:true},{wrongId:'different-record'},{deleteError:new Error('Denied')},{readError:new Error('Offline')}]) {
    const {client,calls}=fixture({...options,rows});
    await assert.rejects(()=>deleteTropicalCyclone(client,id));
    assert.equal(calls.some(call=>call.op==='storage'),false);
    if(options.readError)assert.equal(calls.some(call=>call.op==='delete'),false);
  }
});

test('storage failures retain only unfinished paths for a safe cleanup retry',async()=>{
  const {deleteTropicalCyclone,cleanupCycloneFiles}=await model;
  const rows=[{id:'upload',cyclone_id:id,storage_path:'retry.png'}];
  const failed=fixture({rows,remove:()=>({error:new Error('Offline')})});
  const pending=await deleteTropicalCyclone(failed.client,id);
  assert.deepEqual(pending,['retry.png']);
  const retry=fixture();assert.deepEqual(await cleanupCycloneFiles(retry.client,[...pending,...pending,'']),[]);
  assert.deepEqual(retry.calls,[{op:'storage',bucket:'cyclone-uploads',paths:['retry.png']}]);
  const thrown=fixture({remove:()=>{throw new Error('Connection lost');}});
  assert.deepEqual(await cleanupCycloneFiles(thrown.client,pending),pending);
});

test('outbreak controls work for an empty grouping, cancel safely, and stay on failures',async()=>{
  const vm=require('node:vm');
  const html=fs.readFileSync(path.join(__dirname,'../outbreak.html'),'utf8');
  const source=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*;\r?\n/gm,'').replace(/\binit\(\);\s*$/,'');
  const elements=new Map();
  function element(key){if(!elements.has(key))elements.set(key,{hidden:true,disabled:false,textContent:'',innerHTML:'',listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},querySelectorAll:()=>[]});return elements.get(key);}
  let confirmed=false,deletes=0,fail=false;
  const state={document:{getElementById:element,body:{classList:{toggle(){}}}},location:{href:'outbreak.html'},console,
    confirm:()=>confirmed,alert(){},supabase:{},setTimeout,clearTimeout,
    deleteOutbreak:async()=>{deletes++;if(fail)throw new Error('Request failed');},ownerDeletionError:error=>error.message,outbreakErrorMessage:(error,fallback)=>fallback,
    normalizeOutbreakDates:dates=>dates || [],normalizeOutbreakOrder:order=>order || []};
  const context=vm.createContext(state);vm.runInContext(source,context);
  vm.runInContext(`renderHero=()=>{};renderAdminTools=()=>{};renderMembers=()=>{};isOwner=true;isAdmin=true;showLoaded({id:'${id}',name:'Empty outbreak',dates:['1900-01-01']});`,context);
  assert.equal(element('ownerTools').hidden,false);assert.equal(element('hero').hidden,false);
  assert.equal(element('memberSection').hidden,false);
  assert.equal(element('daySection').hidden,false);
  assert.match(element('outbreakDays').innerHTML,/No tornadoes or uploads yet/);
  await element('deleteOutbreak').listeners.click();assert.equal(deletes,0);
  confirmed=true;fail=true;await element('deleteOutbreak').listeners.click();
  assert.equal(deletes,1);assert.equal(state.location.href,'outbreak.html');
  assert.match(element('deleteStatus').textContent,/Request failed/);assert.equal(element('deleteOutbreak').disabled,false);
  fail=false;await element('deleteOutbreak').listeners.click();assert.equal(state.location.href,'index.html?view=outbreaks');
  vm.runInContext(`isOwner=false;showLoaded(currentOutbreak);`,context);
  assert.equal(element('ownerTools').hidden,true);
  await element('deleteOutbreak').listeners.click();assert.equal(deletes,2);
});

test('cyclone deletion waits for confirmation, reports failures, and retries cleanup without deleting twice',async()=>{
  const vm=require('node:vm');
  const source=fs.readFileSync(path.join(__dirname,'../cyclone-page.js'),'utf8').replace(/^import .*;\r?\n/gm,'')
    .replace(/supabase\.auth\.onAuthStateChange\([^\n]+\);\s*load\(\);\s*$/,'');
  const elements=new Map();
  function element(key){if(!elements.has(key))elements.set(key,{innerHTML:'',textContent:'',listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},querySelectorAll:()=>[]});return elements.get(key);}
  let confirm=false,fail=false,deleted=0;
  const state={document:{getElementById:element},location:{search:'?id='+id,href:'tropical-cyclone.html'},URLSearchParams,supabase:{},
    confirm:()=>confirm,ownerDeletionError:error=>error.message,cycloneError:(error,fallback)=>fallback,esc:String,cycloneMediaCategoryLabel:String,
    deleteTropicalCyclone:async()=>{deleted++;if(fail)throw new Error('Denied');return ['retry.png'];},cleanupCycloneFiles:async()=>[]};
  const context=vm.createContext(state);vm.runInContext(source,context);
  vm.runInContext("actor={isOwner:true};cyclone={name:'Hurricane fixture',year:2015};",context);
  const deleteButton={dataset:{},hasAttribute:name=>name==='data-delete-cyclone'};
  const click=element('cyclonePage').listeners.click;
  const event={target:{closest:selector=>selector.includes('[data-delete-cyclone]') ? deleteButton : null}};
  await click(event);assert.equal(deleted,0);
  confirm=true;fail=true;await click(event);assert.equal(deleted,1);
  assert.equal(element('cyclonePageStatus').textContent,'Denied');assert.equal(state.location.href,'tropical-cyclone.html');
  fail=false;await click(event);assert.equal(deleted,2);
  assert.match(element('cyclonePage').innerHTML,/Tropical cyclone deleted/);
  assert.match(element('cyclonePage').innerHTML,/Retry file cleanup/);
  await click({target:{closest:selector=>selector==='[data-retry-cleanup]' ? {} : null}});
  assert.equal(deleted,2);assert.match(element('cyclonePage').innerHTML,/All stored files have been cleaned up/);
  assert.ok(!element('cyclonePage').innerHTML.includes('Retry file cleanup'));
});
