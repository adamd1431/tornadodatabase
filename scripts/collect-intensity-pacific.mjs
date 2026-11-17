import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {parseAdtHistory} from '../satellite-dvorak-model.js';
import {causalThermalHistory} from '../satellite-intensity-structure.js';
import {intensityFeatures,trainingBaseline} from '../satellite-intensity-model.js';
import {columnMap,numberValue,recordTime,peakRecords} from '../ibtracs-model.js';

process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const cache='.cache/intensity-training',manifest=JSON.parse(await fs.readFile('ibtracs-data/index.json')),col=columnMap(manifest.columns);
const splits={train:[2013,2014,2015,2017,2018,2019,2020,2021],calibration:[2022],validation:[2023],test:[2024],development:[2016],external:[2025]},dataset=[],availability=[];
for(const [split,years]of Object.entries(splits))for(const year of years){
  const snapshot=JSON.parse(zlib.gunzipSync(await fs.readFile(`ibtracs-data/${year}.json.gz`)));
  const candidates=manifest.storms.filter(s=>s.season===year&&s.atcf.some(a=>/^WP\d{6}$/.test(a))).map(s=>({...s,records:snapshot.storms.find(r=>r.id===s.id)?.records||[]})).filter(s=>(peakRecords(s.records,col,'USA').wind?.value||0)>=65);
  for(let i=0;i<candidates.length;i+=4)await Promise.all(candidates.slice(i,i+4).map(async storm=>{
    const atcf=storm.atcf.find(a=>/^WP/.test(a)),source=`https://tropic.ssec.wisc.edu/real-time/adt/archive${year}/${atcf.slice(2,4)}W-list.txt`,file=`${cache}/${atcf}.txt`;let text;
    try{text=await fs.readFile(file,'utf8');}catch{try{const r=await fetch(source,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('HTTP '+r.status);text=await r.text();if(text.length>3000000)throw Error('Archive exceeds size limit');await fs.writeFile(file,text);}catch(error){availability.push({storm:atcf,status:'unavailable',reason:error.message});return;}}
    const labels=storm.records.map(r=>({at:Date.parse(recordTime(r,col)),windKt:numberValue(r,col,'USA_WIND'),pressureMb:numberValue(r,col,'USA_PRES')})).filter(r=>Number.isFinite(r.at)).sort((a,b)=>a.at-b.at);
    function labelAt(time,key){const exact=labels.find(r=>r.at===time);if(exact)return exact[key];const hi=labels.findIndex(r=>r.at>time);if(hi<1)return null;const a=labels[hi-1],b=labels[hi];return b.at-a.at>21600000||a[key]===null||b[key]===null?null:a[key]+(b[key]-a[key])*(time-a.at)/(b.at-a.at);}
    const rows=parseAdtHistory(text),hours=new Set();let count=0;
    for(const r of rows){
      if(r.scene!=='EYE'||r.eye===null||r.cloud===null||r.latitude===null||r.eye< -30||r.cloud> -50||r.cloud<=-100||r.eye-r.cloud<40||hours.has(r.timestamp.slice(0,13)))continue;
      const time=Date.parse(r.timestamp),windKt=labelAt(time,'windKt'),pressure=labelAt(time,'pressureMb');if(windKt===null||windKt<35||windKt>220)continue;
      const features=intensityFeatures({...r,atcf,thermalHistory:causalThermalHistory(rows,r.timestamp)}),baseline=trainingBaseline({eyeC:r.eye,cloudC:r.cloud,latitude:r.latitude,atcf,rawT:r.rawT});
      if(!features)throw Error('Missing physical features');hours.add(r.timestamp.slice(0,13));dataset.push({storm:atcf,season:year,split,timestamp:r.timestamp,features,windKt,pressureMb:pressure>=800&&pressure<=1050?pressure:null,baselineWind:baseline.windKt,baselinePressure:baseline.pressureMb,pressurePrior:baseline.pressurePrior,source,adtVersion:r.version});count++;
    }
    availability.push({storm:atcf,status:count?'used':'no-eye-examples',frames:count});
  }));
  console.log(`${split} ${year}: ${dataset.length} total hourly frames`);
}
dataset.sort((a,b)=>a.storm.localeCompare(b.storm)||a.timestamp.localeCompare(b.timestamp));
const digest=crypto.createHash('sha256').update(JSON.stringify(dataset)).digest('hex');
await fs.writeFile(`${cache}/examples-pacific.jsonl`,dataset.map(r=>JSON.stringify(r)).join('\n')+'\n');
await fs.writeFile(`${cache}/pacific-availability.json`,JSON.stringify({splits,availability,digest},null,2));
console.log(JSON.stringify({digest,frames:dataset.length,storms:new Set(dataset.map(r=>r.storm)).size}));
