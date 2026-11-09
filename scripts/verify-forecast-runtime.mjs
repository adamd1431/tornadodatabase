import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import assert from 'node:assert/strict';
import {FORECAST_FAMILIES,HOUR} from '../storm-forecast-core.js';
import {calibratePoint,buildCalibratedForecast} from '../storm-forecast-calibrated.js';
const directory=process.argv[process.argv.indexOf('--data')+1];if(!directory)throw Error('Pass --data directory.');
const rows=gunzipSync(await readFile(path.join(directory,'cases.jsonl.gz'))).toString().trim().split('\n').map(JSON.parse),expected=JSON.parse(gunzipSync(await readFile(path.join(directory,'runtime-predictions.json.gz'))));
assert.equal(rows.length,expected.length);let count=0;const checked=new Set();
for(const [i,row]of rows.entries()){
  if(!row.split.startsWith('test'))continue;
  const storm={id:row.id,validAt:row.at,latitude:row.initial[0],longitude:row.initial[1],windKt:row.initial[2],pressureMb:row.initial[3],trendWind12:row.trend[0],trendPressure12:row.trend[1]},features=row.x.map(x=>({id:FORECAST_FAMILIES[x[0]].id,track:x[1]===null?null:{raw:[x[1],x[2]],offset:[x[3],x[4]]},wind:x[5]===null?null:{raw:x[5],offset:x[6]},pressure:x[7]===null?null:{raw:x[7],offset:x[8]}}));
  const result=calibratePoint(Object.fromEntries(['latitude','longitude','windKt','pressureMb'].map((key,j)=>[key,row.v1[j]])),features,storm,row.lead);
  const compare=p=>{for(const [j,key]of ['latitude','longitude','windKt','pressureMb'].entries()){if(expected[i][j]===null)assert.equal(p[key],null);else assert.ok(Math.abs(p[key]-expected[i][j])<1e-7,`${row.id} ${row.at} +${row.lead} ${key}`);}};compare(result);count++;
  // Full archived deck -> native analysis -> runtime prediction, one
  // deterministic representative initialization from every held-out basin.
  if(!checked.has(row.basin)){
    const text=gunzipSync(await readFile(path.join(directory,'guidance',row.id+'.csv.gz'))).toString(),forecast=buildCalibratedForecast(storm,text,{asOf:new Date(Date.parse(storm.validAt)+3*HOUR)}),point=forecast.points.find(p=>p.hours===row.lead);
    assert.equal(forecast.calibrationApplied,true);assert.ok(point);compare(point);checked.add(row.basin);
  }
}
console.log(`Runtime parity verified on ${count} held-out forecast–lead pairs; full-deck inference checked in ${checked.size} basins. No fitting performed.`);
