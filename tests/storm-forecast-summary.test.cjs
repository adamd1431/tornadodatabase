const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const modulePromise=import(pathToFileURL(path.join(__dirname,'../storm-forecast-summary.js')).href);
const p=(hours,windKt,pressureMb)=>({hours,windKt,pressureMb,validAt:new Date(Date.UTC(2026,10,9,hours)).toISOString()});

test('forecast extrema exclude initialization and keep wind and pressure times independent',async()=>{
  const {forecastExtremes}=await modulePromise,result=forecastExtremes([p(0,150,900),p(6,110,950),p(12,120,960),p(24,100,940)]);
  assert.equal(result.peak.hours,12);assert.equal(result.peak.windKt,120);assert.equal(result.minimum.hours,24);assert.equal(result.minimum.pressureMb,940);assert.equal(result.throughHours,24);
});
test('each member peak is calculated over its own future coverage, rather than the peak of the mean',async()=>{
  const {summarizeGuidance}=await modulePromise,result=summarizeGuidance({points:[p(0,80,990),p(6,100,970),p(12,100,970)],members:[
    {code:'A',points:[p(0,80,990),p(6,150,950),p(12,50,990)]},
    {code:'B',points:[p(0,80,990),p(6,50,990),p(12,150,940)]},
    {code:'WIND',points:[p(6,90,null)]}
  ]});
  assert.equal(result.blend.peak.windKt,100);assert.deepEqual(result.peakRange,{min:90,max:150,count:3});assert.deepEqual(result.minimumRange,{min:940,max:950,count:2});assert.equal(result.members[2].windThroughHours,6);assert.equal(result.members[2].pressureThroughHours,null);
});
test('missing, nonfinite and initialization-only guidance never turns into a zero or an invented future value',async()=>{
  const {forecastExtremes,summarizeGuidance}=await modulePromise;
  const result=forecastExtremes([p(0,100,950),p(6,null,null),p(12,NaN,Infinity)]);
  assert.equal(result.peak,null);assert.equal(result.minimum,null);assert.equal(result.windThroughHours,null);
  assert.deepEqual(summarizeGuidance({points:[],members:[]}).peakRange,null);
});
test('ties select the earliest valid future time even when the input is unsorted',async()=>{
  const {forecastExtremes}=await modulePromise,result=forecastExtremes([p(24,100,970),p(12,100,970),p(6,90,980)]);
  assert.equal(result.peak.hours,12);assert.equal(result.minimum.hours,12);assert.equal(result.throughHours,24);
});
test('an advisory at +3h on an older model time base is still a fix, not a future pressure forecast',async()=>{
  const {forecastExtremes,summarizeGuidance}=await modulePromise,points=[p(3,80,990),p(15,70,null)];
  const result=forecastExtremes(points,p(3).validAt);assert.equal(result.peak.hours,15);assert.equal(result.minimum,null);
  const summary=summarizeGuidance({advisoryAt:p(3).validAt,initializedAt:p(0).validAt,points,members:[{points}]});assert.equal(summary.blend.minimum,null);assert.equal(summary.minimumRange,null);
});
test('environment bars use declared physical scales, bound their length and leave missing values absent',async()=>{
  const {environmentLevel}=await modulePromise;
  assert.equal(environmentLevel('shear',15),75);assert.equal(environmentLevel('shear',80),0);assert.equal(environmentLevel('shear',0),100);
  assert.equal(environmentLevel('sst',29),75);assert.equal(environmentLevel('sst',19),0);assert.equal(environmentLevel('sst',35),100);
  assert.equal(environmentLevel('humidity',60),60);assert.equal(environmentLevel('shear',null),null);assert.equal(environmentLevel('sst',NaN),null);assert.equal(environmentLevel('ventilation',.01),null);
});
test('compass directions wrap bearings and fix ages use the actual UTC timestamp',async()=>{
  const {compass,fixAge}=await modulePromise;
  assert.equal(compass(360),'N');assert.equal(compass(-22.5),'NNW');assert.equal(compass(90),'E');assert.equal(compass(null),null);
  assert.equal(fixAge('2026-11-09T00:00Z',Date.parse('2026-11-09T01:48Z')),'1.8 h ago');assert.equal(fixAge('bad'),'Time unavailable');assert.equal(fixAge('2026-11-09T06:00Z',Date.parse('2026-11-09T00:00Z')),'Future-dated fix');
});
