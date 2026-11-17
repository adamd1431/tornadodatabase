import fs from 'node:fs/promises';import zlib from 'node:zlib';import crypto from 'node:crypto';import {fileURLToPath}from 'node:url';
import {parseAdtHistory}from '../satellite-dvorak-model.js';import {columnMap,peakRecords,recordTime,numberValue}from '../ibtracs-model.js';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const cache='.cache/intensity-training',manifest=JSON.parse(await fs.readFile('ibtracs-data/index.json')),col=columnMap(manifest.columns),rows=(await fs.readFile(cache+'/examples-pacific.jsonl','utf8')).trim().split('\n').map(JSON.parse);
const snapshots=new Map();async function snapshot(year){if(!snapshots.has(year))snapshots.set(year,JSON.parse(zlib.gunzipSync(await fs.readFile(`ibtracs-data/${year}.json.gz`))));return snapshots.get(year);}
// Fresh year was fixed before any native-image outcomes were inspected.
for(const s of manifest.storms.filter(s=>s.season===2012&&s.atcf.some(a=>/^WP/.test(a)))){
  const atcf=s.atcf.find(a=>/^WP/.test(a)),raw=(await snapshot(2012)).storms.find(r=>r.id===s.id)?.records||[];if((peakRecords(raw,col,'USA').wind?.value||0)<65)continue;
  let text;try{text=await fs.readFile(cache+'/'+atcf+'.txt','utf8');}catch{const r=await fetch(`https://tropic.ssec.wisc.edu/real-time/adt/archive2012/${atcf.slice(2,4)}W-list.txt`,{signal:AbortSignal.timeout(15000)});if(!r.ok)continue;text=await r.text();await fs.writeFile(cache+'/'+atcf+'.txt',text);}
  for(const r of parseAdtHistory(text))if(r.scene==='EYE'&&[r.eye,r.cloud,r.latitude].every(Number.isFinite)&&r.eye>=-30&&r.cloud<=-50&&r.cloud>-100&&r.eye-r.cloud>=40)rows.push({storm:atcf,season:2012,split:'fresh',timestamp:r.timestamp,rawT:r.rawT});
}
const groups=new Map();for(const r of rows){if(r.split==='development')continue;const a=groups.get(r.storm)||[];a.push(r);groups.set(r.storm,a);}
const hash=s=>crypto.createHash('sha256').update('SI6-native-v1|'+s).digest('hex'),byYear=new Map();for(const [storm,a]of groups){const year=a[0].season,g=byYear.get(year)||[];g.push({storm,rows:a});byYear.set(year,g);}
const plan=[];
for(const [year,storms]of [...byYear].sort((a,b)=>a[0]-b[0])){
  storms.sort((a,b)=>hash(a.storm).localeCompare(hash(b.storm)));
  const selected=storms[0].rows[0].split==='train'?storms.slice(0,6):storms;
  for(const g of selected){
    const sorted=g.rows.sort((a,b)=>a.timestamp.localeCompare(b.timestamp)),split=sorted[0].split,count=['train','validation'].includes(split)?3:2,indices=count===3?[.2,.5,.8]:[.33,.67];
    for(const f of indices){const r=sorted[Math.round((sorted.length-1)*f)],time=new Date(Date.parse(r.timestamp));time.setUTCMinutes(0,0,0);const requestedAt=time.toISOString();if(!plan.some(p=>p.storm===g.storm&&p.requestedAt===requestedAt))plan.push({storm:g.storm,season:year,split,requestedAt});}
  }
}
const protocol={schema:1,seed:'SI6-native-v1',selection:'At most six training storms per year chosen by a fixed hash; image times at lifecycle fractions .2/.5/.8 for train/validation and .33/.67 for other splits. No owner or MOTIS values, no native outcomes used for selection.',splits:{train:[2013,2014,2015,2017,2018,2019,2020,2021],calibration:[2022],validation:[2023],reviewed:[2024,2025],fresh:[2012],excluded:[2016]},features:'Twelve image-morphology descriptors plus the existing twelve physical features.',candidates:'Storm-balanced ridge residuals, lambda 1/10/100, correction scale .5/1, optional calibration bias. Fit only training images, select using 2023 storm-balanced MAE + .35 strong-scene MAE. Require lower validation MAE and no worse RMSE than SI-5. 2012 evaluated only after choices are frozen.',plan};
protocol.digest=crypto.createHash('sha256').update(JSON.stringify(protocol)).digest('hex');await fs.writeFile(cache+'/native-vision-plan.json',JSON.stringify(protocol,null,2));console.log(JSON.stringify({digest:protocol.digest,requests:plan.length,bySplit:Object.fromEntries([...new Set(plan.map(r=>r.split))].map(s=>[s,plan.filter(r=>r.split===s).length]))}));
