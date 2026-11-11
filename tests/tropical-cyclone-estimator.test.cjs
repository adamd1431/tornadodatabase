const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {gunzipSync}=require('node:zlib');
const {pathToFileURL}=require('node:url');
const root=path.join(__dirname,'..'),mod=n=>import(pathToFileURL(path.join(root,n+'.js')).href);
const manifest=JSON.parse(fs.readFileSync(path.join(root,'ibtracs-data/index.json'),'utf8'));
const rows=JSON.parse(gunzipSync(fs.readFileSync(path.join(root,'ibtracs-data/2013.json.gz')))).storms.find(s=>s.id==='2013306N07162').records;

test('estimator links carry the chosen cyclone, agency and exact time independently of numeric CKZ inputs',async()=>{
  const m=await mod('tropical-cyclone-estimator-model'),link=m.estimatorUrl({sid:'2013306N07162',at:'2013-11-07T18:00:00Z',agency:'TOKYO'}),url=new URL(link,'https://site.test');
  assert.equal(url.pathname,'/tropical-cyclone-estimator.html');assert.equal(url.searchParams.get('sid'),'2013306N07162');assert.equal(url.searchParams.get('at'),'2013-11-07T18:00:00Z');assert.equal(url.searchParams.get('agency'),'TOKYO');assert.equal(url.searchParams.has('pressureMb'),false);
  assert.equal(new URL(m.estimatorUrl({sid:'2013306N07162',at:'bad date',source:'motis'}),'https://site.test').searchParams.has('at'),false);
});
test('a selected agency record stays at the requested time; an unselected storm starts at the agency peak',async()=>{
  const m=await mod('tropical-cyclone-estimator-model'),b=await mod('ibtracs-model'),col=b.columnMap(manifest.columns),peak=m.estimatorSelection(rows,col),selected=m.estimatorSelection(rows,col,{agency:'TOKYO',at:'2013-11-07T18:00:00Z'});
  assert.equal(b.recordTime(rows[peak.index],col),'2013-11-07T12:00:00Z');assert.equal(selected.agency,'TOKYO');assert.equal(b.recordTime(rows[selected.index],col),'2013-11-07T18:00:00Z');assert.equal(selected.notice,'');
  const invalid=m.estimatorSelection(rows,col,{agency:'UNAVAILABLE',at:'1900-01-01T00:00:00Z'});assert.equal(invalid.agency,'USA');assert.ok(invalid.notice.includes('unavailable'));assert.equal(invalid.index,peak.index);
});
test('returning from a MOTIS calculation retains the real scan time and independently selects a nearby agency record',async()=>{
  const m=await mod('tropical-cyclone-estimator-model'),b=await mod('ibtracs-model'),col=b.columnMap(manifest.columns),input={sid:'2013306N07162',at:'2013-11-07T17:05:00Z',agency:'USA',source:'motis'},url=new URL(m.estimatorUrl(input),'https://site.test'),selected=m.estimatorSelection(rows,col,Object.fromEntries(url.searchParams));
  assert.equal(selected.source,'motis');assert.equal(selected.scanAt,input.at);assert.equal(b.recordTime(rows[selected.index],col),'2013-11-07T18:00:00Z');
  const draft=(await mod('ckz-setup-model')).ckzSetupDraft({storm:'HAIYAN',season:2013,...input,pressureMb:895,latitude:10.6,pociMb:1000,rociNmi:220,motionKnots:22.01});assert.equal(draft.source,'motis');assert.equal(draft.agency,'USA');assert.equal(draft.ready,true);
});
