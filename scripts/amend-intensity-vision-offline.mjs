import fs from 'node:fs/promises';import crypto from 'node:crypto';
// Resource-only amendment, made before any native validation/test errors were
// computed. The provider stopped at its daily limit. Do not select on outcomes.
const cache='.cache/intensity-training',original=JSON.parse(await fs.readFile(cache+'/native-vision-plan.json'));
if(original.resourceAmendment)throw Error('The resource amendment is already frozen.');
await fs.writeFile(cache+'/native-vision-original-plan.json',JSON.stringify(original));
const plan=original.plan.filter(r=>r.season<=2020).map(r=>({...r,split:r.season===2012?'fresh':r.season===2020?'validation':'train'}));
for(const r of plan)await fs.access(cache+'/hourly/'+r.storm+'-'+r.requestedAt.replace(/[^0-9]/g,'').slice(0,12)+'.json.gz');
const protocol={...original,splits:{train:[2013,2014,2015,2017,2018,2019],calibration:[],validation:[2020],reviewed:[],fresh:[2012],excluded:[2016,2021,2022,2023,2024,2025]},
  resourceAmendment:{originalDigest:original.digest,originalRequests:original.plan.length,reason:'SSEC daily data/transaction quota stopped collection. All scheduled images through 2020 were already cached. No native prediction errors were inspected before fixing this reduced protocol. 2020 is held out from the new correction fit but was in the SI-5 backbone training; only the 2012 final comparison is excluded from both. No paid access or substitute imagery.'},
  candidates:'Storm-balanced ridge residuals, lambda 1/10/100, correction scale .5/1; no bias calibration. Fit native corrections on 2013–2015 and 2017–2019 only, select on 2020 storm-balanced MAE + .35 strong-scene MAE. Require lower validation frame/storm MAE and no worse RMSE. Freeze choices before assessing 2012.',plan};
delete protocol.digest;protocol.digest=crypto.createHash('sha256').update(JSON.stringify(protocol)).digest('hex');
await fs.writeFile(cache+'/native-vision-plan.json',JSON.stringify(protocol,null,2));await fs.writeFile('intensity-data/native-vision-protocol.json',JSON.stringify(protocol,null,2)+'\n');console.log(JSON.stringify({digest:protocol.digest,requests:plan.length,splits:protocol.splits}));
