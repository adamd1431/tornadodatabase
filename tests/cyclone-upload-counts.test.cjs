const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const model=import('data:text/javascript;base64,'+fs.readFileSync(path.join(__dirname,'../cyclones.js')).toString('base64'));

function catalogClient(records) {
  const calls=[];
  return {calls,from(table) {
    assert.equal(table,'tropical_cyclones');
    const call={filters:[],range:[0,999]};
    const query={
      select(value){call.select=value;return query;},
      order(){return query;},
      range(start,end){call.range=[start,end];return query;},
      eq(key,value){call.filters.push(['eq',key,value]);return query;},
      neq(key,value){call.filters.push(['neq',key,value]);return query;},
      then(resolve,reject){return Promise.resolve().then(()=>{
        calls.push(call);
        const rows=records.filter(row=>call.filters.every(([op,key,value])=>key.startsWith('cyclone_uploads.') || (op==='eq' ? row[key]===value : row[key]!==value)));
        return {data:rows.slice(call.range[0],call.range[1]+1),error:null};
      }).then(resolve,reject);}
    };
    return query;
  }};
}

test('approved cyclone counts page all records, retain zero-upload storms, and do not fetch individual files',async()=>{
  const {loadCyclones}=await model;
  const records=Array.from({length:1001},(_,i)=>({id:String(i),status:'approved',cyclone_uploads:[{count:i===1000?2400:i%3}]}));
  records.push({id:'pending',status:'pending',cyclone_uploads:[{count:7}]},{id:'rejected',status:'rejected',cyclone_uploads:[{count:8}]});
  const client=catalogClient(records);
  const rows=await loadCyclones(client,false,{uploadCounts:true});
  assert.equal(rows.length,1001);
  assert.equal(rows[0].upload_count,0);
  assert.equal(rows[1000].upload_count,2400,'embedded counts must not be capped by the media row limit');
  assert.equal(rows.some(row=>row.id==='pending'||row.id==='rejected'),false);
  assert.equal(rows.some(row=>'cyclone_uploads' in row),false);
  assert.deepEqual(client.calls.map(call=>call.range),[[0,999],[1000,1999]]);
  for(const call of client.calls) {
    assert.equal(call.select,'*,cyclone_uploads(count)');
    assert.ok(call.filters.some(([op,key,value])=>op==='eq'&&key==='cyclone_uploads.status'&&value==='approved'));
    assert.ok(!call.select.includes('!inner'),'storms without uploads must remain in the catalog');
    assert.ok(!call.select.includes('file_url'));
  }
});

test('admin listings include pending cyclones but still count only approved media',async()=>{
  const {loadCyclones}=await model;
  const client=catalogClient([
    {id:'approved',status:'approved',cyclone_uploads:[{count:2}]},
    {id:'pending',status:'pending',cyclone_uploads:[{count:0}]},
    {id:'rejected',status:'rejected',cyclone_uploads:[{count:5}]}
  ]);
  const rows=await loadCyclones(client,true,{uploadCounts:true});
  assert.deepEqual(rows.map(row=>[row.id,row.upload_count]),[['approved',2],['pending',0]]);
  assert.ok(client.calls[0].filters.some(([op,key,value])=>op==='eq'&&key==='cyclone_uploads.status'&&value==='approved'));
});

test('upload sorting works in both directions, includes zero, and breaks ties with shared chronological order',async()=>{
  const {compareCycloneUploads}=await model;
  const rows=[
    {id:'one',year:2026,upload_count:1},
    {id:'older-zero',year:2000,upload_count:0},
    {id:'ten',year:1990,upload_count:10},
    {id:'newer-zero',year:2025,upload_count:0},
    {id:'tie-2',year:2026,year_order:2,upload_count:1},
    {id:'tie-1',year:2026,year_order:1,upload_count:1}
  ];
  assert.deepEqual([...rows].sort((a,b)=>compareCycloneUploads(a,b,'most_uploaded')).map(row=>row.id),['ten','one','tie-1','tie-2','newer-zero','older-zero']);
  assert.deepEqual([...rows].sort((a,b)=>compareCycloneUploads(a,b,'least_uploaded')).map(row=>row.id),['newer-zero','older-zero','one','tie-1','tie-2','ten']);
  const filtered=rows.filter(row=>row.year===2026);
  assert.deepEqual(filtered.sort((a,b)=>compareCycloneUploads(a,b,'least_uploaded')).map(row=>row.id),['one','tie-1','tie-2']);
});

test('count loading propagates failures so a failed request cannot masquerade as an empty catalog',async()=>{
  const {loadCyclones}=await model;
  const error={message:'Connection failed'};
  const q={select(){return q;},order(){return q;},range(){return q;},eq(){return q;},then(resolve){return Promise.resolve({data:null,error}).then(resolve);}};
  await assert.rejects(()=>loadCyclones({from:()=>q},false,{uploadCounts:true}),value=>value===error);
});
