const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{gunzipSync}=require('node:zlib'),{pathToFileURL}=require('node:url');
const mod=n=>import(pathToFileURL(path.join(__dirname,'../'+n+'.js')).href),at='2006-11-29T12:00:00Z';
const subset=gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/noaa-prmsl-20061129T1200Z.nc.gz')));
test('NOAA original plotting-page subset decodes one complete pressure grid at its exact UTC time',async()=>{
  const {parseNoaaPressureSubset}=await mod('noaa-pressure-subset'),grid=parseNoaaPressureSubset(subset,at);
  assert.equal(grid.at,at);assert.equal(grid.lat[0],-90);assert.equal(grid.lat.at(-1),90);assert.equal(grid.lon[359],359);assert.equal(grid.values.length,181);assert.equal(grid.values[0].length,360);assert.equal(grid.values[103][127],968.099375);
  assert.throws(()=>parseNoaaPressureSubset(subset,'2006-11-29T09:00:00Z'),/valid time/);assert.throws(()=>parseNoaaPressureSubset(Buffer.from('<html>Rate limit</html>'),at),/valid NetCDF/);assert.throws(()=>parseNoaaPressureSubset(subset.subarray(0,100),at));
});
test('official subset matches the independent ASCII benchmark and retains Durian’s verified closed isobar',async()=>{
  const {parseNoaaPressureSubset}=await mod('noaa-pressure-subset'),m=await mod('poci-roci-model'),grid=parseNoaaPressureSubset(subset,at),text=gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/noaa-prmsl-20061129T1200Z.ascii.gz'))).toString('utf8'),reference=m.parsePressureAscii(text,at);
  let difference=0;for(let y=0;y<181;y++)for(let x=0;x<360;x++)difference=Math.max(difference,Math.abs(grid.values[y][x]-reference.values[y][x]));assert.ok(difference<.00003);
  const result=m.extractPociRoci(grid,{lat:13.3,lon:126.2});assert.equal(result.status,'estimated');assert.equal(result.termination,'open');assert.equal(result.pociMb,1008);assert.equal(result.rociNmi,292);
});
test('numeric subset uses the supported NOAA plotting form download rather than the rate-limited THREDDS service',async()=>{
  const {noaaPressureSubsetUrl}=await mod('noaa-pressure-chart'),url=new URL(noaaPressureSubsetUrl('2013-11-07','0600')),p=url.searchParams;
  assert.equal(url.origin,'https://psl.noaa.gov');assert.equal(url.pathname,'/cgi-bin/mddb2/plot.pl');assert.equal(p.get('doplot'),'0');assert.equal(p.get('varID'),'142214');assert.equal(p.get('variable'),'prmsl');assert.equal(p.get('hr1'),'06 Z');assert.equal(p.get('hr2'),'06 Z');assert.equal(p.get('year1'),'2013');assert.equal(p.get('day1'),'7');assert.equal(p.get('plotUnits'),'Pa');assert.equal(p.has('contourLevel'),false);assert.equal(p.has('projection'),false);
});
