const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const mod=()=>import(pathToFileURL(path.join(__dirname,'../noaa-pressure-chart.js')).href);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
test('NOAA chart request uses the original plotting service and one exact UTC date, never a date average',async()=>{
  const {noaaPressureChartUrl}=await mod(),url=new URL(noaaPressureChartUrl('2006-11-29','1200')),q=url.searchParams;
  assert.equal(url.origin,'https://psl.noaa.gov');assert.equal(url.pathname,'/cgi-bin/mddb2/plot.pl');assert.equal(q.get('varID'),'142214');assert.equal(q.get('variable'),'prmsl');assert.equal(q.get('doplot'),'1');assert.equal(q.get('plotUnits'),'Pa');assert.equal(q.get('contourLevel'),'auto');
  for(const k of ['year','month','day','hr'])assert.equal(q.get(k+'1'),q.get(k+'2'));assert.equal(q.get('hr1'),'12 Z');assert.equal(new URL(noaaPressureChartUrl('2013-11-07','0600')).searchParams.get('hr1'),'06 Z');assert.throws(()=>noaaPressureChartUrl('2020-01-01','0000'),/1806/);
});
test('chart proxy caches and shares actual PNG bytes for repeated chart requests',async()=>{
  const {createNoaaPressureChartHandler}=await mod();let calls=0;const handler=createNoaaPressureChartHandler(async url=>{calls++;assert.ok(url.startsWith('https://psl.noaa.gov/cgi-bin/mddb2/plot.pl?'));return new Response(png,{headers:{'Content-Type':'image/png'}});});
  const request=()=>new Request('https://test.site/api/poci-roci-chart?date=2006-11-29&time=1200'),results=await Promise.all([handler.fetch(request()),handler.fetch(request())]);
  assert.equal(calls,1);for(const response of results){assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'image/png');assert.match(response.headers.get('Cache-Control'),/s-maxage=604800/);assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);}
});
test('chart errors never return an HTML error document as a PNG or send malformed dates upstream',async()=>{
  const {createNoaaPressureChartHandler}=await mod();let calls=0;const handler=createNoaaPressureChartHandler(async()=>{calls++;return new Response('<html>Error</html>');});
  const bad=await handler.fetch(new Request('https://test.site/api/poci-roci-chart?date=2006-02-30&time=1200'));assert.equal(bad.status,400);assert.equal(calls,0);
  const wrong=await handler.fetch(new Request('https://test.site/api/poci-roci-chart?date=2006-11-29&time=1200'));assert.equal(wrong.status,502);assert.match((await wrong.json()).error,/valid chart image/);
});
test('NOAA chart rate limiting supplies a cooldown instead of repeatedly regenerating images',async()=>{
  const {createNoaaPressureChartHandler}=await mod();let calls=0;const handler=createNoaaPressureChartHandler(async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'120'}});});
  const first=await handler.fetch(new Request('https://test.site/api/poci-roci-chart?date=2006-11-29&time=1200')),second=await handler.fetch(new Request('https://test.site/api/poci-roci-chart?date=2013-11-07&time=1200'));
  assert.equal(first.status,503);assert.equal(second.status,503);assert.ok(Number(second.headers.get('Retry-After'))>0);assert.equal(calls,1);
});
