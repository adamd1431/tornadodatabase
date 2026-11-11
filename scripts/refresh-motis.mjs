import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {MOTIS_SOURCE,MOTIS_DATA_URL,normalizeMotisPoints} from '../motis-model.js';
const directory=fileURLToPath(new URL('../motis-data/',import.meta.url));
try{
  const response=await fetch(MOTIS_DATA_URL,{signal:AbortSignal.timeout(25000)});if(!response.ok)throw Error('MOTIS returned HTTP '+response.status);
  const text=await response.text();if(text.length>3000000)throw Error('The MOTIS dataset is too large.');const raw=JSON.parse(text),points=normalizeMotisPoints(raw);if(points.length<100)throw Error('The MOTIS dataset is incomplete.');
  await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'points.json.gz'),gzipSync(JSON.stringify(raw)));
  await writeFile(path.join(directory,'index.json'),JSON.stringify({source:MOTIS_SOURCE,dataUrl:MOTIS_DATA_URL,retrievedAt:new Date().toISOString(),count:points.length,firstAt:points.map(p=>p.at).sort()[0],lastAt:points.map(p=>p.at).sort().at(-1),note:'Satellite-derived central-pressure estimates. These are separate from agency best-track values.'},null,2)+'\n');
  console.log('Updated MOTIS snapshot: '+points.length+' satellite scans.');
}catch(error){
  if(process.argv.includes('--keep-on-error')){await readFile(path.join(directory,'index.json'));console.warn('MOTIS refresh unavailable; retained the existing snapshot.');}
  else{console.error(error.message);process.exitCode=1;}
}
