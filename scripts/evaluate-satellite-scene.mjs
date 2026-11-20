// Structural coverage review only. Reuses cached scans, never intensity labels
// or storm-specific adjustments in inference, and does not fit new coefficients.
import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {estimateIntensity,estimateIntensityLegacy} from '../satellite-intensity-model.js';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
globalThis.fetch=async url=>{const p=String(url).replace(/^https?:\/\/[^/]+\//,'').replace(/^\//,'');if(!/^ibtracs-data\/\d{4}\.json.gz$/.test(p))throw Error('Only cached local track files can be read.');return new Response(await fs.readFile(p));};
const {stormRecords,reportedEnvironment}=await import('../satellite-intensity-data.js');
const input=JSON.parse(await fs.readFile('intensity-data/native-vision-training.json')),manifest=JSON.parse(await fs.readFile('ibtracs-data/index.json')),base=JSON.parse(await fs.readFile('intensity-data/tree-model.json')),wp=JSON.parse(await fs.readFile('intensity-data/pacific-tree-model.json')),bundle={...base,westernPacific:wp},tracks=new Map(),rows=[],failures=[];
for(const item of input.examples){
 try{
  const filename='.cache/intensity-training/hourly/'+item.storm+'-'+item.requestedAt.replace(/[^0-9]/g,'').slice(0,12)+'.json.gz',scan=JSON.parse(zlib.gunzipSync(await fs.readFile(filename)));
  for(const key of ['temperature','latitude','longitude'])if(!Array.isArray(scan.grid[key])&&!ArrayBuffer.isView(scan.grid[key]))scan.grid[key]=Object.values(scan.grid[key]);
  if(!tracks.has(item.storm))tracks.set(item.storm,await stormRecords(manifest.storms.find(s=>s.atcf.includes(item.storm)),manifest));
  const options={...scan.center,atcf:item.storm,autoCenter:true,thermalHistory:scan.thermalHistory,environment:reportedEnvironment(tracks.get(item.storm),scan.grid.timestamp)},before=estimateIntensityLegacy(scan.grid,options,bundle),now=estimateIntensity(scan.grid,options,bundle),scene=now.sceneQuality;
  rows.push({storm:item.storm,at:scan.grid.timestamp,accepted:scene.accepted,status:scene.status,ringShade:scene.ring?.ringShade??null,widthKm:scene.ring?.narrowestWidthKm??null,pixelsAcrossEye:scene.pixelsAcrossEye,reason:scene.accepted?null:scene.flags[0],windChange:scene.accepted&&Number.isFinite(now.windKt)&&Number.isFinite(before.windKt)?now.windKt-before.windKt:null,pressureChange:scene.accepted&&Number.isFinite(now.pressureMb)&&Number.isFinite(before.pressureMb)?now.pressureMb-before.pressureMb:null});
 }catch(error){failures.push({storm:item.storm,at:item.requestedAt,error:error.message});}
 if((rows.length+failures.length)%20===0)console.log(`${rows.length+failures.length}/${input.examples.length} cached scans reviewed`);
}
const accepted=rows.filter(r=>r.accepted),rejected=rows.filter(r=>!r.accepted),max=key=>Math.max(0,...accepted.map(r=>r[key]).filter(Number.isFinite).map(Math.abs));
const report={schema:1,version:'SI-8-scene-1',scope:'Retrospective structural coverage review of previously inspected cached native scans. This is not a fresh independent accuracy evaluation. Rejection/abstention is not counted as an accuracy improvement.',method:{ring:'Published EIR shade and minimum continuous thickness in 72 directions',symmetry:'Opposite-sector temperature differences from ADT 9.1 cloud sampling',pinhole:'Measured eye temperature retained; no inferred warming. Three pixels across the narrow axis is a conservative engineering flag, not an operational ADT rule or calibrated confidence.',history:'Strictly earlier thermal observations from six to 7.5 hours before; different sampling versions are context only.',trainedWeights:'Unchanged; frozen 8.2.1 fitted feature definition retained',overallCdoAreaBonus:false,stormSpecificOverrides:false},datasetDigest:input.digest,backboneDigests:{base:base.trainingDigest,westernPacific:wp.trainingDigest},sample:{requested:input.examples.length,reviewed:rows.length,storms:new Set(rows.map(r=>r.storm)).size,accepted:accepted.length,withheld:rejected.length,resolutionLimited:accepted.filter(r=>r.status==='resolution-limited').length,failures},maximumAcceptedTrainedPredictionChange:{windKt:max('windChange'),pressureMb:max('pressureChange')},rejectedScenes:rejected,reviewDigest:crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex'),references:['https://tropic.ssec.wisc.edu/real-time/amsu/herndon/AMSTC_Intensity/DVK_EIR_diagram_600dpi.pdf','https://tropic.ssec.wisc.edu/misc/adt/guides/ADTV9.1_Guide.pdf','https://www.ncei.noaa.gov/sites/default/files/2026-02/ADTHURSAT%20Technical%20Documentation%20-%202.3.26.pdf']};
await fs.writeFile('intensity-data/scene-quality-review.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({sample:report.sample,maximumAcceptedTrainedPredictionChange:report.maximumAcceptedTrainedPredictionChange,rejectedScenes:report.rejectedScenes},null,2));
