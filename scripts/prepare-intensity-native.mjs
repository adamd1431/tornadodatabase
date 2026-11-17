import fs from 'node:fs';import zlib from 'node:zlib';import crypto from 'node:crypto';import {fileURLToPath}from 'node:url';
import {columnMap,recordTime,numberValue}from '../ibtracs-model.js';
import {trainingBaseline}from '../satellite-intensity-model.js';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const audit=JSON.parse(fs.readFileSync('.cache/intensity-training/hourly-checks.json')),manifest=JSON.parse(fs.readFileSync('ibtracs-data/index.json')),col=columnMap(manifest.columns),examples=[];
for(const c of audit.cases){
 const season=+c.atcf.slice(-4),snapshot=JSON.parse(zlib.gunzipSync(fs.readFileSync(`ibtracs-data/${season}.json.gz`))),storm=snapshot.storms.find(s=>s.id===c.sid),rows=storm.records.map(r=>({at:Date.parse(recordTime(r,col)),windKt:numberValue(r,col,'USA_WIND'),pressureMb:numberValue(r,col,'USA_PRES')}));
 function label(at,key){const exact=rows.find(r=>r.at===at);if(exact)return exact[key];const hi=rows.findIndex(r=>r.at>at);if(hi<1)return null;const a=rows[hi-1],b=rows[hi];if(b.at-a.at>21600000||a[key]===null||b[key]===null)return null;return a[key]+(b[key]-a[key])*(at-a.at)/(b.at-a.at);}
 const seen=new Set();
 for(const r of c.results){if(r.error||seen.has(r.acquiredAt))continue;seen.add(r.acquiredAt);const at=Date.parse(r.acquiredAt),windKt=label(at,'windKt'),pressureMb=label(at,'pressureMb');if(windKt===null||windKt<35)continue;
 const x=r.features,prior=trainingBaseline({eyeC:x[0],cloudC:x[1],latitude:x[2],atcf:c.atcf,rawT:x[5]}),file=`.cache/intensity-training/hourly/${c.atcf}-${r.requestedAt.replace(/[^0-9]/g,'').slice(0,12)}.json.gz`;
 examples.push({storm:c.atcf,name:c.name,season,split:'train',timestamp:r.acquiredAt,features:x,windKt,pressureMb,baselineWind:prior.windKt,baselinePressure:prior.pressureMb,pressurePrior:prior.pressurePrior,source:'https://mcfetch.ssec.wisc.edu/',featureSource:'native-calibrated-pixels',scanSha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});
 }
}
fs.writeFileSync('intensity-data/native-training.json',JSON.stringify({schema:1,description:'Measured native IR predictors; labels are time-matched IBTrACS USA best track, not owner estimates.',examples},null,2)+'\n');console.log(examples.length+' native hourly training examples prepared.');
