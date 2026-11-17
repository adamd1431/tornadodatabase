// Re-run after caching each real peak scan in .cache/intensity-training/native/.
// Uses the published SI-1 model from git for an unchanged before comparison.
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {estimateIntensity,predictBoosted} from '../satellite-intensity-model.js';
import {parseAdtHistory} from '../satellite-dvorak-model.js';
import {causalThermalHistory} from '../satellite-intensity-structure.js';
import {ciToWind,pressureFromWind} from '../wind-pressure-model.js';
import {columnMap,recordTime,numberValue,sixHourMotion} from '../ibtracs-model.js';

process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const bundle=JSON.parse(fs.readFileSync('intensity-data/tree-model.json'));
const previous=JSON.parse(execFileSync('git',['show','9565fa4:intensity-data/tree-model.json'],{encoding:'utf8'}));
const manifest=JSON.parse(fs.readFileSync('ibtracs-data/index.json')),col=columnMap(manifest.columns),cases=[];
for(const atcf of ['EP202015','AL082025','AL132025']){
  const bytes=fs.readFileSync(`.cache/intensity-training/native/${atcf}-peak.json.gz`),scan=JSON.parse(zlib.gunzipSync(bytes));
  const storm=manifest.storms.find(s=>s.atcf.includes(atcf));
  const snapshot=JSON.parse(zlib.gunzipSync(fs.readFileSync(`ibtracs-data/${storm.season}.json.gz`)));
  const rows=snapshot.storms.find(s=>s.id===storm.id).records,index=rows.findIndex(r=>Date.parse(recordTime(r,col))===Date.parse(scan.requestedAt)),record=rows[index];
  if(!record)throw Error('A time-matched best-track record is required: '+atcf);
  const environment={pociMb:numberValue(record,col,'USA_POCI'),rociNmi:numberValue(record,col,'USA_ROCI'),motionKt:sixHourMotion(rows,col,index)};
  const thermalHistory=causalThermalHistory(parseAdtHistory(fs.readFileSync(`.cache/intensity-training/${atcf}.txt`,'utf8')),scan.grid.timestamp);
  const after=estimateIntensity(scan.grid,{...scan.center,atcf,autoCenter:true,environment,thermalHistory},bundle),x=after.features.slice(0,5);
  const eligible=x.every((v,i)=>v>=previous.domain[i][0]&&v<=previous.domain[i][1]);
  const windKt=eligible?predictBoosted(previous.wind,x):ciToWind(after.eye.rawT);
  const pressureMb=eligible?predictBoosted(previous.pressure,x):pressureFromWind(windKt,{method:'ckz-published',latitude:after.eye.latitude,environmentMb:environment.pociMb,radiusType:'roci',radiusNmi:environment.rociNmi,motionKnots:environment.motionKt}).pressureMb;
  const noHistory=estimateIntensity(scan.grid,{...scan.center,atcf,autoCenter:true,environment},bundle);
  cases.push({name:storm.name,season:storm.season,atcf,sid:storm.id,requestedAt:scan.requestedAt,acquiredAt:scan.grid.timestamp,satellite:scan.satellite,scanSha256:crypto.createHash('sha256').update(bytes).digest('hex'),source:scan.source,sourceUrl:scan.sourceUrl,reference:{windKt:numberValue(record,col,'USA_WIND'),pressureMb:numberValue(record,col,'USA_PRES'),timestamp:recordTime(record,col),agency:'IBTrACS USA / NHC best track',sourceUrl:'https://www.ncei.noaa.gov/products/international-best-track-archive'},environment,features:after.features,thermalHistory,before:{version:'SI-1',windKt,pressureMb,method:eligible?'Boosted trees':'Eye-scene baseline / CKZ fallback'},after:{version:after.version,windKt:after.windKt,pressureMb:after.pressureMb,method:after.windMethod},withoutHistory:{windKt:noHistory.windKt,pressureMb:noHistory.pressureMb},evaluationRole:'Training/development case; not an independent test'});
}
const report={version:'SI-2',previousCommit:'9565fa4',trainingDigest:bundle.trainingDigest,notes:['Same cached calibrated native pixels and auto-centering for both versions. No named-storm adjustment or reference intensity enters inference.','Reference pressure is at the requested wind-peak observation, not the lifetime pressure minimum. Acquisition times differ by seconds for two scans.','These three storms occur in training seasons and were reported during development. Independent general performance is reported separately for the withheld 2024 season.'],cases};
fs.writeFileSync('intensity-data/case-checks.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(cases.map(c=>({name:c.name,reference:c.reference,before:c.before,after:c.after,withoutHistory:c.withoutHistory})),null,2));
