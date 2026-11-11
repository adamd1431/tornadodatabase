const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {gunzipSync}=require('node:zlib');
const {pathToFileURL}=require('node:url');
const root=path.join(__dirname,'..'),mod=import(pathToFileURL(path.join(root,'motis-model.js')).href),manifest=JSON.parse(fs.readFileSync(path.join(root,'ibtracs-data/index.json'))),raw=JSON.parse(gunzipSync(fs.readFileSync(path.join(root,'motis-data/points.json.gz'))));
test('MOTIS reads the original scan precision, real UTC time, sensor and quality',async()=>{
  const m=await mod,points=m.normalizeMotisPoints(raw),megi=points.find(p=>p.name==='Megi'&&p.at==='2010-10-17T01:45:00Z');
  assert.equal(points.length,raw.length);assert.equal(megi.pressureMb,909.006);assert.equal(megi.satellite,'TERRA');assert.equal(megi.eyeClarity,'Good');assert.equal(megi.latitude,18.672);assert.ok(Math.abs(megi.longitude-126.856)<1e-9);
});
test('storm matching separates reused names, seasons and scan times and leaves missing storms empty',async()=>{
  const m=await mod,points=m.normalizeMotisPoints(raw),megi=manifest.storms.find(s=>s.name==='MEGI'&&s.season===2010),scans=m.motisScansForStorm(points,megi);
  assert.ok(scans.length>=5);assert.ok(scans.every(p=>p.year===2010));assert.equal(m.nearestMotisScan(scans,'2010-10-17T12:05:15Z').at,'2010-10-17T14:20:00Z');assert.equal(m.nearestMotisScan(scans,'2010-10-17T12:05:15Z').pressureMb,885.806);
  assert.deepEqual(m.motisScansForStorm(points,manifest.storms.find(s=>s.name==='NORA'&&s.season===1973)),[]);assert.equal(m.nearestMotisScan([],megi.start),null);
  assert.ok(m.motisScansForStorm(points,{...megi,start:'2011-01-01 00:00:00',end:'2011-02-01 00:00:00'}).length===0);
});
test('MOTIS rejects malformed observations and never invents missing measurements',async()=>{
  const m=await mod,valid=raw[0];for(const patch of [{pressure:null},{scanTime:'2002-07-04 29:80Z'},{satellite:'UNKNOWN'},{lat:100},{category:9}])assert.throws(()=>m.normalizeMotisPoints([{...valid,...patch}]),/invalid/);
  const p=m.normalizeMotisPoints([valid])[0];assert.equal(p.windKnots,undefined);assert.equal(p.pociMb,undefined);assert.equal(p.rociNmi,undefined);assert.equal(p.at,'2002-07-04T04:25:00Z');
});
