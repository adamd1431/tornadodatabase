const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {gzipSync,gunzipSync}=require('node:zlib');
const {pathToFileURL}=require('node:url');
const root=path.join(__dirname,'..'),mod=n=>import(pathToFileURL(path.join(root,n+'.js')).href);
const manifest=JSON.parse(fs.readFileSync(path.join(root,'ibtracs-data/index.json'),'utf8'));
const season=y=>JSON.parse(gunzipSync(fs.readFileSync(path.join(root,'ibtracs-data',y+'.json.gz'))));
const haiyan=manifest.storms.find(s=>s.name==='HAIYAN'&&s.season===2013),records=season(2013).storms.find(s=>s.id===haiyan.id).records;
test('global search finds names, seasons, full SIDs and basin-correct designations without combining repeated names',async()=>{
  const m=await mod('ibtracs-model');assert.equal(m.searchStorms(manifest.storms,{query:'Haiyan 2013'})[0].id,haiyan.id);assert.equal(m.searchStorms(manifest.storms,{query:haiyan.id})[0].id,haiyan.id);assert.ok(m.searchStorms(manifest.storms,{query:'31W',year:'2013',basin:'WP'}).some(s=>s.id===haiyan.id));assert.equal(m.searchStorms(manifest.storms,{query:'Haiyan 2013',basin:'NA'}).length,0);
  assert.equal(m.designation('SH171985',{basins:['SP']}),'17P');assert.equal(m.designation('IO012025',{subbasins:['AS']}),'01A');assert.equal(m.designation('SH171985'),'SH171985');assert.ok(m.searchStorms(manifest.storms,{year:1842}).length);
  assert.equal(m.bareName('Super Typhoon Haiyan (Yolanda)'),'Haiyan');assert.equal(m.bareName('Super Typhoon / Cyclone Gay (Kavali Cyclone)'),'Gay');
});
test('each agency retains its own intensity, missing values and separate peak wind/minimum pressure timestamps',async()=>{
  const m=await mod('ibtracs-model'),col=m.columnMap(manifest.columns),peak=m.peakRecords(records,col,'USA');assert.equal(peak.wind.value,170);assert.equal(peak.wind.time,'2013-11-07T12:00:00Z');assert.equal(peak.pressure.value,895);assert.equal(m.peakRecords(records,col,'TOKYO').wind.value,125);
  const row=records[peak.wind.index];assert.equal(m.numberValue(row,col,'USA_POCI'),1003);assert.equal(m.numberValue(row,col,'USA_ROCI'),200);assert.equal(m.numberValue(row,col,'BOM_POCI'),null);assert.equal(m.rawValue(row,col,'IFLAG'),'OOOO___________');assert.equal(m.rawValue(row,col,'BOM_POCI'),'');
  const smallCol=m.columnMap(['USA_WIND','USA_PRES','ISO_TIME']),peaks=m.peakRecords([['100','950','2020-01-01 00:00:00'],['90','940','2020-01-01 06:00:00'],['','0','2020-01-01 12:00:00']],smallCol,'USA');assert.equal(peaks.wind.index,0);assert.equal(peaks.pressure.index,1);
});
test('six-hour motion uses three hours before and after, wraps the dateline, and refuses edges or missing intervals',async()=>{
  const m=await mod('ibtracs-model'),col=m.columnMap(['ISO_TIME','USA_LAT','USA_LON']),rows=[['2020-01-01 00:00:00','0','179'],['2020-01-01 03:00:00','0','180'],['2020-01-01 06:00:00','0','-179']];assert.equal(m.sixHourMotion(rows,col,1),20.01);assert.equal(m.sixHourMotion(rows,col,0),null);assert.equal(m.sixHourMotion(rows,col,2),null);
  const gap=[rows[0],['2020-01-02 00:00:00','0','-175']];assert.equal(m.sixHourMotion(gap,col,0),null);assert.equal(m.position(['2020-01-01 00:00:00','',''],col),null);
});
test('downloads preserve all source fields, units, blanks and quoting independently of display filters',async()=>{
  const m=await mod('ibtracs-model'),{csvFields}=await import(pathToFileURL(path.join(root,'scripts/refresh-satellite-tracks.mjs')).href),csv=m.stormCsv(manifest.columns,manifest.units,records),lines=csv.trimEnd().split('\r\n');assert.equal(lines.length,records.length+2);assert.deepEqual(csvFields(lines[0]),manifest.columns);assert.deepEqual(csvFields(lines[1]),manifest.units);assert.deepEqual(csvFields(lines[2]),records[0]);assert.equal(m.stormCsv(['NAME'],[''],[['A, B "C"']]),'"NAME"\r\n""\r\n"A, B ""C"""\r\n');
  const sample={version:1,storms:[{id:haiyan.id,records:[records[0]]}]};assert.deepEqual(await m.unpackSnapshot(new Response(gzipSync(JSON.stringify(sample)))),sample);assert.deepEqual(await m.unpackSnapshot(new Response(JSON.stringify(sample))),sample);
});
test('satellite links resolve the exact saved SID/time/agency and never trust coordinates supplied in the URL',async()=>{
  const m=await mod('ibtracs-model'),{loadIbtracsArchivePreset}=await mod('ibtracs-archive'),col=m.columnMap(manifest.columns),row=records.find(r=>m.rawValue(r,col,'ISO_TIME')==='2013-11-07 12:00:00'),link=m.archiveLink(haiyan,row,col,'TOKYO'),read=async url=>url.endsWith('index.json')?new Response(JSON.stringify(manifest)):new Response(fs.readFileSync(path.join(root,url)));
  const preset=await loadIbtracsArchivePreset(new URL(link,'https://site.test').search+'&lat=99&lon=99',read);assert.equal(preset.storm.id,haiyan.id);assert.equal(preset.values.lookupName,'HAIYAN');assert.equal(preset.values.scanTime,'1200');assert.equal(preset.position.latitude,m.position(row,col,'TOKYO').lat);assert.notEqual(preset.position.latitude,99);assert.match(preset.position.source,/TOKYO/);assert.equal(preset.satellite,'MTSAT2');
  assert.equal(await loadIbtracsArchivePreset('',read),null);await assert.rejects(loadIbtracsArchivePreset('?ibtracs=../../secret&at=2013-11-07%2012:00:00',()=>{throw Error('Must not fetch');}),/Invalid/);await assert.rejects(loadIbtracsArchivePreset('?ibtracs='+haiyan.id+'&at=2013-11-30%2012:00:00',read),/no usable/);
  const old=manifest.storms.find(s=>s.season===1958),oldRows=season(1958).storms.find(s=>s.id===old.id).records;assert.equal(m.archiveLink(old,oldRows[0],col),null);
});
test('track geometry keeps a crossing of 180 degrees local rather than drawing a line around the globe',async()=>{
  const {trackGeometry}=await mod('ibtracs-plots'),{columnMap}=await mod('ibtracs-model'),col=columnMap(['USA_LAT','USA_LON']),g=trackGeometry([['10','179'],['11','-179'],['12','-177']],col,'USA');assert.deepEqual(g.points.map(p=>p.lon),[179,181,183]);assert.ok(g.east-g.west<10);
});
test('complete snapshot covers every indexed storm and all 174 fields without dropping pre-satellite storms or spur records',()=>{
  assert.ok(manifest.storms.length>13000);assert.equal(manifest.columns.length,manifest.units.length);assert.ok(manifest.columns.length>=174);assert.equal(new Set(manifest.storms.map(s=>s.id)).size,manifest.storms.length);let count=0,total=0;const summaries=new Map(manifest.storms.map(s=>[s.id,s]));
  for(const year of manifest.years){const data=season(year);assert.equal(data.season,year);for(const s of data.storms){const summary=summaries.get(s.id);assert.ok(summary);assert.equal(summary.season,year);assert.equal(s.records.length,summary.records);for(const row of s.records){assert.equal(row.length,manifest.columns.length);assert.equal(row[0],s.id);}count++;total+=s.records.length;}}
  assert.equal(count,manifest.storms.length);assert.ok(total>700000);assert.ok(manifest.storms.some(s=>s.types.some(t=>/spur/i.test(t))));
});
