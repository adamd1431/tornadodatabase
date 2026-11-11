import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {MOTIS_SOURCE,MOTIS_DATA_URL,MOTIS_CSV_URL,MOTIS_DATASET,normalizeMotisPoints,augmentMotisPoci} from '../motis-model.js';
const directory=fileURLToPath(new URL('../motis-data/',import.meta.url));
try{
  const response=await fetch(MOTIS_DATA_URL,{signal:AbortSignal.timeout(25000)});if(!response.ok)throw Error('The MOTIS map data could not be downloaded.');
  // Retain the exact versioned Zenodo CSV: its public download can return 403
  // to unattended builds. Verify the publisher's MD5 before using this copy.
  const csvBytes=gunzipSync(await readFile(path.join(directory,'source-260212.csv.gz')));if(createHash('md5').update(csvBytes).digest('hex')!=='d811ce73d49dbeb352ebff60731fd7e6')throw Error('The full MOTIS CSV does not match its published checksum.');
  const text=await response.text(),csv=csvBytes.toString('utf8');if(text.length>3000000||csv.length>3000000)throw Error('The MOTIS dataset is too large.');const raw=augmentMotisPoci(JSON.parse(text),csv),points=normalizeMotisPoints(raw);if(points.length<100)throw Error('The MOTIS dataset is incomplete.');
  await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'points.json.gz'),gzipSync(JSON.stringify(raw)));
  await writeFile(path.join(directory,'index.json'),JSON.stringify({source:MOTIS_SOURCE,dataUrl:MOTIS_DATA_URL,dataset:MOTIS_DATASET,csvUrl:MOTIS_CSV_URL,retrievedAt:new Date().toISOString(),count:points.length,pociCount:points.filter(p=>p.pociMb!==null).length,firstAt:points.map(p=>p.at).sort()[0],lastAt:points.map(p=>p.at).sort().at(-1),note:'Satellite-derived pressure and coordinates from the MOTIS map, matched to full-CSV POCI by storm, scan time, satellite, location and pressure. No forward speed or ROCI is provided.'},null,2)+'\n');
  console.log('Updated MOTIS snapshot: '+points.length+' satellite scans.');
}catch(error){
  if(process.argv.includes('--keep-on-error')){await readFile(path.join(directory,'index.json'));console.warn('MOTIS refresh unavailable; retained the existing snapshot.');}
  else{console.error(error.message);process.exitCode=1;}
}
