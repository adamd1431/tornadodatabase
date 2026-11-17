import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync,gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {warmCorePressure,SOUNDING_FEATURES,MOTIS_PAPER} from '../satellite-intensity-motis.js';

const bytes=await readFile('motis-data/source-260212.csv.gz'),text=gunzipSync(bytes).toString('utf8').replace(/^\uFEFF/,'');
const fields=line=>[...line.matchAll(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g)].map(m=>m[1].replace(/^"|"$/g,'').replaceAll('""','"').trim());
const lines=text.trim().split(/\r?\n/),header=fields(lines.shift()),names=['B24 dT','B36 dT','Upper dif','Mid dif','B27 dT','Eye size','B31-B32','B33 dT tr.','Aqua Bias','Terra Bias'];
const points=[],audit=[];
for(const line of lines){
  const row=Object.fromEntries(fields(line).map((v,i)=>[header[i],v]));
  const date=row.Date.padStart(4,'0'),clock=row.Time.padStart(4,'0');
  const measurement={timestamp:`${row.Year}-${date.slice(0,2)}-${date.slice(2)}T${clock.slice(0,2)}:${clock.slice(2)}:00.000Z`,latitude:+row.Lat,longitude:((+row.Lon+540)%360)-180,satellite:row.Satellite,eyeClarity:row['Eye clarity'],pociMb:+row.POCI,cdoC:+row['T CDO'],predictors:names.map(k=>row[k]===''?null:Number(row[k]))};
  if(!Number.isFinite(Date.parse(measurement.timestamp))||measurement.predictors.some(v=>v===null))throw Error('Invalid measurement row.');
  const result=warmCorePressure(measurement);points.push(measurement);
  // Labels are confined to this audit; none is serialized in the input bundle.
  audit.push({year:+row.Year,good:measurement.eyeClarity==='Good',error:row['dP Obs']===''?null:result.pressureMb-(+row.POCI-Number(row['dP Obs'])),reconstructionDifference:result.pressureMb-Number(row['P MOTIS'])});
}
function metrics(rows){const a=rows.filter(r=>Number.isFinite(r.error));return {count:a.length,mae:a.reduce((s,r)=>s+Math.abs(r.error),0)/a.length,rmse:Math.sqrt(a.reduce((s,r)=>s+r.error**2,0)/a.length),bias:a.reduce((s,r)=>s+r.error,0)/a.length};}
const data={schema:1,featureNames:SOUNDING_FEATURES,source:'https://zenodo.org/records/22224266',paper:MOTIS_PAPER,sourceDigest:createHash('sha256').update(bytes).digest('hex'),points};
const report={version:'SI-4',method:'Published MOTIS Table 2, no local fitting',source:data.source,paper:MOTIS_PAPER,sourceDigest:data.sourceDigest,measurements:points.length,goodEye:points.filter(p=>p.eyeClarity==='Good').length,matchLimits:{minutes:15,kilometres:50,eyeClarity:'Good'},reconstruction:{count:audit.length,maeMb:audit.reduce((s,r)=>s+Math.abs(r.reconstructionDifference),0)/audit.length,maxDifferenceMb:Math.max(...audit.map(r=>Math.abs(r.reconstructionDifference))),note:'Numerical reproduction against stored MOTIS outputs, not an independent accuracy test. Printed coefficients and rounded source deficits differ slightly.'},pressureChecks:{allObserved:metrics(audit),goodObserved:metrics(audit.filter(r=>r.good)),paperVerificationYearsGood:metrics(audit.filter(r=>r.good&&r.year>=2019)),note:'Published dataset observation labels include time adjustments and some radar-derived estimates. 2019–2025 is the paper-defined verification period; not an independent locally withheld dataset. No independent CKZ wind validation is claimed.'}};
await writeFile('intensity-data/motis-predictors.json.gz',gzipSync(JSON.stringify(data),{level:9}));
await writeFile('intensity-data/motis-checks.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
