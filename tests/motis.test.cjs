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
  const p=m.normalizeMotisPoints([valid])[0];assert.equal(p.windKnots,undefined);assert.equal(p.pociMb,1001.95);assert.equal(p.rociNmi,undefined);assert.equal(p.at,'2002-07-04T04:25:00Z');
});
test('full published CSV matches scan POCI by identity, position and pressure without nearest-time substitution',async()=>{
  const m=await mod,csv=gunzipSync(fs.readFileSync(path.join(root,'motis-data/source-260212.csv.gz'))),{createHash}=require('node:crypto');assert.equal(createHash('md5').update(csv).digest('hex'),'d811ce73d49dbeb352ebff60731fd7e6');
  const p=raw.find(p=>p.name==='Megi'&&p.scanTime==='2010-10-17 17:05Z'),[enriched]=m.augmentMotisPoci([p],csv.toString());assert.equal(enriched.poci,1007.984);assert.equal(enriched.pressure,876.984);
  for(const patch of [{scanTime:'2010-10-17 17:00Z'},{pressure:880},{lon:124},{satellite:'TERRA'}])assert.equal(m.augmentMotisPoci([{...p,...patch}],csv.toString())[0].poci,null);
  assert.throws(()=>m.augmentMotisPoci([p],'Name,Year\nMegi,2010'),/missing/);
});
test('MOTIS CKZ links resolve the exact scan from source data, import POCI unchanged and leave unsupported fields blank',async()=>{
  const t=await import(pathToFileURL(path.join(root,'motis-transfer.js')).href),m=await mod,storm=manifest.storms.find(s=>s.name==='MEGI'&&s.season===2010),scan=m.normalizeMotisPoints(raw).find(p=>p.name==='Megi'&&p.at==='2010-10-17T17:05:00Z'),link=t.motisCkzLink(storm,scan);
  const read=async url=>url.endsWith('index.json')?new Response(JSON.stringify(manifest)):new Response(fs.readFileSync(path.join(root,url.split('?')[0])));
  const {preset}=await t.loadMotisCkzPreset(new URL(link,'https://site.test').search+'&pressureMb=850&environmentMb=1015',read);
  assert.equal(preset.fields.pressureMb,'876.984');assert.equal(preset.fields.environmentMb,'1007.984');assert.equal(preset.fields.latitude,'17.608');assert.equal(preset.fields.knackRociNmi,'');assert.equal(preset.fields.motionKnots,'');assert.equal(preset.fields.windKnots,'');assert.equal(preset.at,scan.at);assert.deepEqual(preset.missing,['ROCI','six-hour forward speed']);
  const earlier=t.motisCkzPreset(storm,m.normalizeMotisPoints(raw).find(p=>p.name==='Megi'&&p.at==='2010-10-17T14:20:00Z'));assert.equal(earlier.fields.environmentMb,'1008.806');assert.equal(earlier.fields.pressureMb,'885.806');
  await assert.rejects(t.loadMotisCkzPreset(new URL(link,'https://site.test').search.replace('17%3A05','17%3A00'),read),/exact MOTIS scan/);
  await assert.rejects(t.loadMotisCkzPreset('?motis=../../secret&scan=x',()=>{throw Error('Must not read');}),/Invalid/);assert.equal(await t.loadMotisCkzPreset('',read),null);
});
