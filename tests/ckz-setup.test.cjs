const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {gunzipSync}=require('node:zlib');
const {pathToFileURL}=require('node:url');
const root=path.join(__dirname,'..'),mod=n=>import(pathToFileURL(path.join(root,n+'.js')).href);
const manifest=JSON.parse(fs.readFileSync(path.join(root,'ibtracs-data/index.json'),'utf8'));
const records=(year,name)=>{const storm=manifest.storms.find(s=>s.name===name&&s.season===year),season=JSON.parse(gunzipSync(fs.readFileSync(path.join(root,'ibtracs-data',year+'.json.gz'))));return season.storms.find(s=>s.id===storm.id).records;};
const valid={storm:'MEGI',season:2010,sid:'2010285N13145',at:'2010-10-17T17:05:00Z',pressureMb:876.984,latitude:17.608,longitude:124.158,pociMb:1007.984,rociNmi:200,motionKnots:10.25,sources:{intensity:'MOTIS AQUA Good',isobars:'MOTIS POCI; measured ROCI',motion:'USA track, ±3 h'}};

test('agency observations use the exact same six-hour calculation and reported isobars as the archive',async()=>{
  const m=await mod('ckz-setup-model'),b=await mod('ibtracs-model'),col=b.columnMap(manifest.columns),rows=records(2013,'HAIYAN');
  for(const [time,poci,roci,speed] of [['2013-11-07T12:00:00Z',1003,200,20.60],['2013-11-07T18:00:00Z',1000,220,22.01]]){
    const i=rows.findIndex(r=>b.recordTime(r,col)===time),motion=m.sixHourMotionAt(rows,col,time),pair=m.reportedIsobarsAt(rows,col,time);
    assert.equal(motion.speedKnots,b.sixHourMotion(rows,col,i));assert.equal(motion.speedKnots,speed);assert.equal(motion.interpolated,false);
    assert.equal(pair.pociMb,poci);assert.equal(pair.rociNmi,roci);assert.equal(pair.interpolated,false);
  }
});
test('off-hour MOTIS motion uses interpolated positions exactly three hours before and after the scan',async()=>{
  const m=await mod('ckz-setup-model'),b=await mod('ibtracs-model'),col=b.columnMap(manifest.columns),rows=records(2010,'MEGI'),motion=m.sixHourMotionAt(rows,col,valid.at);
  assert.equal(motion.startAt,'2010-10-17T14:05:00.000Z');assert.equal(motion.endAt,'2010-10-17T20:05:00.000Z');assert.equal(motion.interpolated,true);
  // Independently interpolate the 12/15Z and 18/21Z best-track coordinates.
  const row=t=>rows.find(r=>b.recordTime(r,col)===`2010-10-17T${t}:00:00Z`),a=b.position(row('12'),col),c=b.position(row('15'),col),d=b.position(row('18'),col),e=b.position(row('21'),col);
  const start={lat:a.lat+(c.lat-a.lat)*125/180,lon:a.lon+(c.lon-a.lon)*125/180},end={lat:d.lat+(e.lat-d.lat)*125/180,lon:d.lon+(e.lon-d.lon)*125/180};
  const rad=Math.PI/180,h=Math.sin((end.lat-start.lat)*rad/2)**2+Math.cos(start.lat*rad)*Math.cos(end.lat*rad)*Math.sin((end.lon-start.lon)*rad/2)**2,speed=Math.round(6371.0088*2*Math.asin(Math.sqrt(h))/1.852/6*100)/100;
  assert.equal(motion.speedKnots,speed);assert.ok(Math.abs(motion.start.lon-start.lon)<1e-9);assert.ok(Math.abs(motion.end.lat-end.lat)<1e-9);
});
test('motion crosses the dateline locally, accepts stationary storms and refuses missing endpoints or mixed sources',async()=>{
  const m=await mod('ckz-setup-model'),b=await mod('ibtracs-model'),col=b.columnMap(['ISO_TIME','USA_LAT','USA_LON','LAT','LON']),rows=[['2020-01-01 00:00:00','0','179','',''],['2020-01-01 06:00:00','0','-179','','']];
  assert.equal(m.trackPositionAt(rows,col,'2020-01-01T03:00:00Z').lon,-180);assert.equal(m.sixHourMotionAt(rows,col,'2020-01-01T03:00:00Z').speedKnots,20.01);
  assert.equal(m.sixHourMotionAt(rows,col,'2020-01-01T00:00:00Z'),null);
  const still=rows.map(r=>[r[0],'10','20','','']);assert.equal(m.sixHourMotionAt(still,col,'2020-01-01T03:00:00Z').speedKnots,0);
  assert.equal(m.sixHourMotionAt([rows[0],['2020-01-01 12:00:00','0','-179','','']],col,'2020-01-01T06:00:00Z'),null);
  assert.equal(m.sixHourMotionAt([rows[0],['2020-01-01 06:00:00','','','0','-179']],col,'2020-01-01T03:00:00Z'),null);
});
test('reported isobars interpolate only bracketing records, identify their times, and leave missing fields missing',async()=>{
  const m=await mod('ckz-setup-model'),b=await mod('ibtracs-model'),col=b.columnMap(['ISO_TIME','USA_POCI','USA_ROCI','TOKYO_POCI','TOKYO_ROCI']),rows=[['2020-01-01 00:00:00','1000','200','',''],['2020-01-01 06:00:00','1004','240','','']];
  const p=m.reportedIsobarsAt(rows,col,'2020-01-01T01:30:00Z');assert.equal(p.pociMb,1001);assert.equal(p.rociNmi,210);assert.equal(p.interpolated,true);assert.deepEqual(p.bracket,['2020-01-01T00:00:00Z','2020-01-01T06:00:00Z']);
  assert.equal(m.reportedIsobarsAt(rows,col,'2020-01-01T01:30:00Z','TOKYO').pociMb,null);assert.equal(m.reportedIsobarsAt(rows,col,'2020-01-02T00:00:00Z').rociNmi,null);
  const missing=[rows[0],[rows[1][0],'1004','0','','']];assert.equal(m.reportedIsobarsAt(missing,col,'2020-01-01T01:30:00Z').rociNmi,null);
});
test('CKZ readiness requires every usable input and an actual calculator solution, with zero motion allowed',async()=>{
  const m=await mod('ckz-setup-model');assert.equal(m.ckzSetupDraft(valid).ready,true);
  for(const patch of [{rociNmi:''},{pociMb:null},{motionKnots:''},{latitude:null},{pressureMb:0},{at:'not a date'},{motionKnots:65},{latitude:70}])assert.equal(m.ckzSetupDraft({...valid,...patch}).ready,false);
  assert.equal(m.ckzSetupDraft({...valid,motionKnots:0}).ready,true);assert.equal(m.ckzSetupDraft({...valid,pociMb:850}).ready,false);
  const draft=m.ckzSetupDraft(valid);assert.equal(draft.fields.environmentMb,'1007.984');assert.equal(draft.fields.pressureMb,'876.984');assert.equal(draft.fields.motionKnots,'10.25');assert.equal(draft.fields.windKnots,'');
});
test('prepared CKZ transfer preserves inputs, scan time and separate source labels, rejects expired or invalid drafts',async()=>{
  const m=await mod('ckz-setup-model'),map=new Map(),storage={setItem:(k,v)=>map.set(k,v),getItem:k=>map.get(k)??null},link=m.saveCkzSetup(m.ckzSetupDraft(valid),storage),query=new URL(link,'https://site.test').search,p=m.readCkzSetup(query+'&pressureMb=800',storage);
  assert.equal(p.fields.pressureMb,'876.984');assert.equal(p.fields.environmentMb,'1007.984');assert.equal(p.fields.knackRociNmi,'200');assert.equal(p.fields.motionKnots,'10.25');assert.equal(p.fields.latitude,'17.608');assert.equal(p.at,valid.at);assert.deepEqual(p.sources,valid.sources);
  const [key]=map.keys(),saved=JSON.parse(map.get(key));saved.createdAt-=86400001;map.set(key,JSON.stringify(saved));assert.throws(()=>m.readCkzSetup(query,storage),/unavailable/);
  saved.createdAt=Date.now();saved.draft.fields.motionKnots='';map.set(key,JSON.stringify(saved));assert.throws(()=>m.readCkzSetup(query,storage),/incomplete/);
  saved.createdAt=undefined;map.set(key,JSON.stringify(saved));assert.throws(()=>m.readCkzSetup(query,storage),/unavailable/);
  assert.throws(()=>m.readCkzSetup('?setup=bad',storage),/Invalid/);assert.throws(()=>m.saveCkzSetup(m.ckzSetupDraft({...valid,rociNmi:''}),storage),/Complete/);assert.equal(m.readCkzSetup('',storage),null);
});
