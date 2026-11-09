import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync,gzipSync} from 'node:zlib';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseForecastDeck,operationalInitials,selectForecastSources,legacySources,forecastFeatures,FORECAST_FAMILIES,xy,HOUR} from '../storm-forecast-core.js';
import {buildForecast,distanceKm,destination} from '../storm-forecast-model.js';
const directory=process.argv[process.argv.indexOf('--data')+1];if(!directory||directory===process.argv[0])throw Error('Pass --data directory.');
const root=path.resolve(directory),data=JSON.parse(await readFile(path.join(root,'verification-best-tracks.json'),'utf8'));
// Fixed before error analysis, including the 2024 global holdout. Never silently
// assign new storms or a changed SID to an already evaluated experiment.
const protocol=JSON.parse(await readFile(new URL('../forecast-study/protocol-v2.json',import.meta.url),'utf8'));
for(const storm of data.storms){const assignment=protocol.splitAssignments.find(s=>s.id===storm.id&&s.sid===storm.sid);if(!assignment)throw Error('Storm is outside the frozen study protocol: '+storm.id);Object.assign(storm,{split:assignment.split,eligibleFinal:assignment.eligibleFinal});}
const types=new Set(['TD','TS','HU','TY','ST','TC','SD','SS']),finalAgencies=new Set(['hurdat_atl','hurdat_epa','jtwc_wp','jtwc_sh','jtwc_io']),leads=[12,24,48,72,96,120];
const cases=[],audit={storms:[],excluded:{notFinal:0,noOperationalInitial:0,nonTropicalOrNoBestInitial:0,noFutureBestTrack:0,noLegacyGuidance:0,noExpandedGuidance:0,duplicateSidCycle:0}},seen=new Set();
function nativeOfficial(deck,initial,hours){const at=Date.parse(initial.validAt),g=['OFCL','JTWC','WRNG'].map(code=>deck.find(g=>g.code===code&&g.cycle===at)).find(Boolean),p=g?.points.find(p=>p.at===at+hours*HOUR);return p?[p.latitude,p.longitude,p.windKt,p.pressureMb]:null;}
function motionForecast(initial,hours){if(!initial.past)return null;const a=initial.past,b=initial,rad=Math.PI/180,d=(b.longitude-a.longitude)*rad,brg=Math.atan2(Math.sin(d)*Math.cos(b.latitude*rad),Math.cos(a.latitude*rad)*Math.sin(b.latitude*rad)-Math.sin(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.cos(d))/rad;const position=destination(initial,brg,hours*distanceKm(a,b)/a.hours);return [position.latitude,position.longitude,initial.windKt,initial.pressureMb];}
for(const entry of data.storms){
  if(!entry.eligibleFinal){audit.excluded.notFinal++;continue;}
  let text;try{text=gunzipSync(await readFile(path.join(root,'guidance',entry.id+'.csv.gz'))).toString();}catch{audit.storms.push({id:entry.id,error:'Missing guidance file'});continue;}
  const deck=parseForecastDeck(text,entry.id),analyses=operationalInitials(deck,entry.id),best=new Map(entry.points.filter(p=>finalAgencies.has(p.agency)).map(p=>[Date.parse(p.validAt),p]));let count=0,initials=0;
  if(!analyses.length)audit.excluded.noOperationalInitial++;
  for(const initial of analyses){
    const at=Date.parse(initial.validAt),truth0=best.get(at),key=entry.sid+':'+at;if(!truth0||!types.has(truth0.status)||(!types.has(initial.status)&&!['XX',''].includes(initial.status))){audit.excluded.nonTropicalOrNoBestInitial++;continue;}if(seen.has(key)){audit.excluded.duplicateSidCycle++;continue;}seen.add(key);initials++;
    const asOf=new Date(at+3*HOUR),sources=selectForecastSources(deck,initial,asOf),legacy=legacySources(deck,initial,asOf);
    if(!sources.length){audit.excluded.noExpandedGuidance++;continue;}if(!legacy.length){audit.excluded.noLegacyGuidance++;continue;}
    const oldGuidance=legacy.map(row=>{const g=row.sources.track;return {family:row.id,name:row.id,code:g.code,cycle:new Date(g.cycle).toISOString(),initial:{...g.initial,validAt:initial.validAt},points:g.points.filter(p=>p.lead>=0).map(p=>({...p,validAt:new Date(p.at).toISOString()}))};}),baseline=buildForecast(initial,oldGuidance,{asOf});
    for(const lead of leads){
      const truth=best.get(at+lead*HOUR);if(!truth||!types.has(truth.status)){audit.excluded.noFutureBestTrack++;continue;}const old=baseline.points.find(p=>p.hours===lead);if(!old){audit.excluded.noLegacyGuidance++;continue;}
      const features=forecastFeatures(sources,initial,lead).map(p=>[FORECAST_FAMILIES.findIndex(f=>f.id===p.id),p.track?.raw[0]??null,p.track?.raw[1]??null,p.track?.offset[0]??null,p.track?.offset[1]??null,p.wind?.raw??null,p.wind?.offset??null,p.pressure?.raw??null,p.pressure?.offset??null]);
      const target=xy(truth,initial);cases.push({id:entry.id,sid:entry.sid,name:entry.name,season:entry.season,basin:entry.basin,split:entry.split,at:initial.validAt,lead,
        initial:[initial.latitude,initial.longitude,initial.windKt,initial.pressureMb],trend:[initial.trendWind12,initial.trendPressure12],
        truth:[truth.latitude,truth.longitude,truth.windKt,truth.pressureMb],y:[target.east,target.north,truth.windKt,truth.pressureMb],x:features,
        v1:[old.latitude,old.longitude,old.windKt,old.pressureMb],official:nativeOfficial(deck,initial,lead),motion:motionForecast(initial,lead)});count++;
    }
  }
  audit.storms.push({id:entry.id,sid:entry.sid,name:entry.name,basin:entry.basin,season:entry.season,split:entry.split,initials,cases:count});
  if(audit.storms.length%20===0)console.log('EXTRACT',audit.storms.length,'storms',cases.length,'cases');
}
const raw=cases.map(c=>JSON.stringify(c)).join('\n')+'\n';await writeFile(path.join(root,'cases.jsonl.gz'),gzipSync(raw));
const summary={version:1,createdAt:new Date().toISOString(),families:FORECAST_FAMILIES.map(({id,name,roles})=>({id,name,roles})),caseFields:'x=[family index, raw east km, raw north km, initial east offset km, initial north offset km, raw wind kt, initial wind offset kt, raw pressure hPa, initial pressure offset hPa]; y=[east km,north km,wind kt,pressure hPa]',cases:cases.length,sha256:createHash('sha256').update(raw).digest('hex'),...audit};
await writeFile(path.join(root,'case-audit.json'),JSON.stringify(summary,null,2));console.log('DONE',cases.length,'cases;',new Set(cases.map(c=>c.sid)).size,'distinct storms;',JSON.stringify(audit.excluded));
