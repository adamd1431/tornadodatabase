import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(root,'satellite-tracks');
const recent=process.argv.includes('--recent');
const source='https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.'+(recent?'last3years':'ALL')+'.list.v04r01.csv';
// NOAA CSV strings can contain quoted commas. Keep the parser independent of
// column order; the export intentionally contains positions, not intensities.
export function csvFields(line){return [...line.matchAll(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g)].map(m=>m[1].replace(/^"|"$/g,'').replaceAll('""','"').trim());}
export async function refreshTracks(){
  if(recent){try{const manifest=JSON.parse(await readFile(path.join(directory,'index.json'),'utf8'));if(Date.now()-Date.parse(manifest.generatedAt)<86400000){console.log('IBTrACS position snapshot is current.');return;}}catch{}}
  const response=await fetch(source,{signal:AbortSignal.timeout(180000)});
  if(!response.ok)throw Error('IBTrACS download failed ('+response.status+').');
  const storms=new Map();let columns,records=0;
  for await(const line of createInterface({input:Readable.fromWeb(response.body),crlfDelay:Infinity})){
    const values=csvFields(line);if(!columns){columns=Object.fromEntries(values.map((v,i)=>[v,i]));for(const key of ['SID','NAME','SEASON','BASIN','ISO_TIME','LAT','LON','USA_LAT','USA_LON','USA_ATCF_ID','TRACK_TYPE'])if(!(key in columns))throw Error('Missing IBTrACS column: '+key);continue;}
    const field=key=>values[columns[key]]||'',id=field('SID'),time=Date.parse(field('ISO_TIME').replace(' ','T')+'Z');
    if(!/^\d{7}[NS]\d{5}$/.test(id)||!Number.isFinite(time)||time<Date.UTC(1974,0,1)||!['main','PROVISIONAL','PROVISIONAL_spur'].includes(field('TRACK_TYPE'))||field('TRACK_TYPE').includes('spur'))continue;
    const valid=(lat,lon)=>lat!==''&&lon!==''&&Number.isFinite(+lat)&&Number.isFinite(+lon)&&Math.abs(+lat)<=90&&Math.abs(+lon)<=180;
    const usa=valid(field('USA_LAT'),field('USA_LON'));
    const lat=field(usa?'USA_LAT':'LAT'),lon=field(usa?'USA_LON':'LON');if(!valid(lat,lon))continue;
    let storm=storms.get(id);if(!storm){storm={id,name:field('NAME'),season:+field('SEASON'),basins:[],atcf:[],start:time/60000,points:[]};storms.set(id,storm);}
    if(!storm.basins.includes(field('BASIN')))storm.basins.push(field('BASIN'));
    const atcf=field('USA_ATCF_ID');if(atcf&&!storm.atcf.includes(atcf))storm.atcf.push(atcf);
    storm.points.push([time/60000-storm.start,+lat,+lon,usa?0:1]);records++;
  }
  if(storms.size<100||records<10000)throw Error('IBTrACS export unexpectedly small; keeping the previous files.');
  const years=new Map();
  for(const storm of storms.values()){
    storm.points.sort((a,b)=>a[0]-b[0]);
    const activeYears=new Set(storm.points.map(p=>new Date((storm.start+p[0])*60000).getUTCFullYear()));
    for(const year of activeYears){if(recent&&year<new Date().getUTCFullYear()-1)continue;if(!years.has(year))years.set(year,[]);years.get(year).push(storm);}
  }
  await mkdir(directory,{recursive:true});const generatedAt=new Date().toISOString();
  for(const [year,rows]of years)await writeFile(path.join(directory,year+'.json'),JSON.stringify({version:1,generatedAt,source,rows}));
  let previous={};try{previous=JSON.parse(await readFile(path.join(directory,'index.json'),'utf8'));}catch{}
  const manifest={version:1,generatedAt,source,lastModified:response.headers.get('last-modified'),years:[...new Set([...(recent?previous.years||[]:[]),...years.keys()])].sort((a,b)=>a-b),positionSources:['IBTrACS USA position','IBTrACS merged position'],pointFields:['minutes after start','latitude north','longitude east','position source index'],startUnit:'minutes since Unix epoch'};
  await writeFile(path.join(directory,'index.json'),JSON.stringify(manifest));
  console.log(`Exported ${years.size} years of IBTrACS positions (${storms.size} storms, ${records} positions read).`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))try{await refreshTracks();}catch(error){console.error(error.message);let snapshot=false;try{snapshot=JSON.parse(await readFile(path.join(directory,'index.json'),'utf8')).version===1;}catch{}if(!process.argv.includes('--keep-on-error')||!snapshot)process.exitCode=1;else console.log('Keeping the previous IBTrACS position snapshot.');}
