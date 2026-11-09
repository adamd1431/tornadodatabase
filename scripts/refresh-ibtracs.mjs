import {mkdir,readFile,writeFile,rename,rm,appendFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {Readable} from 'node:stream';
import {gzipSync,gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {csvFields} from './refresh-satellite-tracks.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','ibtracs-data');
export const IBTRACS_ROOT='https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/';
export function summarizeStorm(storm,columns){
  const col=Object.fromEntries(columns.map((k,i)=>[k,i])),get=(r,k)=>r[col[k]]||'',first=storm.records[0],last=storm.records.at(-1);
  return {id:storm.id,name:get(first,'NAME')||'UNNAMED',season:+get(first,'SEASON'),basins:[...new Set(storm.records.map(r=>get(r,'BASIN')).filter(Boolean))],subbasins:[...new Set(storm.records.map(r=>get(r,'SUBBASIN')).filter(Boolean))],atcf:[...new Set(storm.records.flatMap(r=>get(r,'USA_ATCF_ID').split(':')).filter(Boolean))],start:get(first,'ISO_TIME'),end:get(last,'ISO_TIME'),records:storm.records.length,types:[...new Set(storm.records.map(r=>get(r,'TRACK_TYPE')))]};
}
export async function refreshIbtracs({recent=false,read=fetch}={}){
  let previous;try{previous=JSON.parse(await readFile(path.join(root,'index.json'),'utf8'));}catch{}
  if(recent&&!previous?.storms?.length)throw Error('A complete IBTrACS snapshot is required before recent updates.');
  if(recent&&Date.now()-Date.parse(previous.generatedAt)<86400000){console.log('Full IBTrACS snapshot is current.');return;}
  const source=IBTRACS_ROOT+`ibtracs.${recent?'last3years':'ALL'}.list.v04r01.csv`,response=await read(source,{signal:AbortSignal.timeout(600000)});
  if(!response.ok)throw Error('IBTrACS source returned '+response.status);
  const temp=path.join(root,'.refresh-'+Date.now());await mkdir(temp,{recursive:true});
  let columns,units,current,count=0,records=0;const index=[],years=new Set(),buffers=new Map();let buffered=0;
  const flush=async()=>{for(const [year,chunk]of buffers)await appendFile(path.join(temp,year+'.jsonl'),chunk,'utf8');buffers.clear();buffered=0;};
  const finish=async()=>{if(!current)return;const summary=summarizeStorm(current,columns);if(summary.season<1800||summary.season>new Date().getUTCFullYear()+1)throw Error('Invalid IBTrACS season.');index.push(summary);years.add(summary.season);const chunk=JSON.stringify(current)+'\n';buffers.set(summary.season,(buffers.get(summary.season)||'')+chunk);buffered+=chunk.length;if(buffered>4*1048576)await flush();if(++count%1000===0)console.log('IBTrACS:',count,'storms,',records,'records parsed');};
  try{
    for await(const line of createInterface({input:Readable.fromWeb(response.body),crlfDelay:Infinity})){
      const row=csvFields(line);if(!columns){columns=row;for(const key of ['SID','SEASON','NAME','ISO_TIME','USA_WIND','USA_POCI','USA_ROCI'])if(!columns.includes(key))throw Error('Missing source column '+key);continue;}
      if(!units){units=row;continue;}
      if(row.length!==columns.length)throw Error('Unexpected CSV field count.');const id=row[columns.indexOf('SID')];if(!/^\d{7}[NS]\d{5}$/.test(id))throw Error('Invalid source storm identifier.');
      if(current?.id!==id){await finish();current={id,records:[]};}current.records.push(row);records++;
    }
    await finish();await flush();if(count<(recent?100:10000)||records<(recent?1000:500000))throw Error('IBTrACS export is unexpectedly small; previous files retained.');
    if(recent&&JSON.stringify(previous.columns)!==JSON.stringify(columns))throw Error('IBTrACS schema changed; run a full refresh.');
    const ids=new Set(index.map(s=>s.id));if(ids.size!==index.length)throw Error('Duplicate or noncontiguous IBTrACS storm.');
    if(recent){const old=new Map(previous.storms.map(s=>[s.id,s]));for(const s of index){const prior=old.get(s.id);if(prior&&(s.start>prior.start||s.end<prior.end))throw Error('A recent subset would truncate an existing track; run a full refresh.');}}
    const previousByYear=new Map();if(recent)for(const s of previous.storms)if(years.has(s.season)&&!ids.has(s.id)){if(!previousByYear.has(s.season))previousByYear.set(s.season,[]);previousByYear.get(s.season).push(s.id);}
    let bytes=0;
    for(const year of [...years].sort((a,b)=>a-b)){
      const rows=(await readFile(path.join(temp,year+'.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
      if(previousByYear.has(year)){const old=JSON.parse(gunzipSync(await readFile(path.join(root,year+'.json.gz'))));const keep=new Set(previousByYear.get(year));rows.push(...old.storms.filter(s=>keep.has(s.id)));}
      rows.sort((a,b)=>a.id.localeCompare(b.id));const data=gzipSync(JSON.stringify({version:1,season:year,storms:rows}),{level:9});bytes+=data.length;await writeFile(path.join(temp,year+'.json.gz'),data);
    }
    const storms=(recent?previous.storms.filter(s=>!ids.has(s.id)):[]).concat(index).sort((a,b)=>a.season-b.season||a.id.localeCompare(b.id));
    const manifest={version:1,dataset:'IBTrACS v04r01',generatedAt:new Date().toISOString(),source:IBTRACS_ROOT+'ibtracs.ALL.list.v04r01.csv',lastModified:response.headers.get('last-modified'),columns,units,storms,years:[...new Set(storms.map(s=>s.season))].sort((a,b)=>a-b)};
    for(const year of years)await rename(path.join(temp,year+'.json.gz'),path.join(root,year+'.json.gz'));
    await writeFile(path.join(temp,'index.json'),JSON.stringify(manifest));await rename(path.join(temp,'index.json'),path.join(root,'index.json'));
    console.log(`IBTrACS ready: ${storms.length} storms; ${columns.length} fields; ${records} records read; ${(bytes/1048576).toFixed(1)} MiB compressed.`);
  }finally{const resolved=path.resolve(temp);if(!resolved.startsWith(path.resolve(root)+path.sep)||!path.basename(resolved).startsWith('.refresh-'))throw Error('Invalid temporary archive path.');await rm(resolved,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))try{await refreshIbtracs({recent:process.argv.includes('--recent')});}catch(error){console.error(error.message);let saved=false;try{saved=JSON.parse(await readFile(path.join(root,'index.json'),'utf8')).version===1;}catch{}if(!saved||!process.argv.includes('--keep-on-error'))process.exitCode=1;else console.log('Keeping previous full IBTrACS snapshot.');}
