import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(root,'public-data');
const fields={
  tornadoes:'id,date,name,states,status,day_order,intensity,created_at,path_image,cover_image,description,opinion_rank,thumbnail_fit,wind_estimate,cover_position,thumbnail_zoom,thumbnail_position',
  cyclones:'id,name,year,status,jtwc_designation,basin,cover_fit,cover_zoom,created_at,year_order,cover_image,description,thumbnail_fit,cover_position,peak_winds_mph,thumbnail_zoom,eye_temperature_c,lowest_pressure_mb,thumbnail_position,owner_estimated_winds_mph,owner_estimated_pressure_mb',
  outbreaks:'id,name,dates,status,created_at,updated_at,tornado_order,cover_tornado_id',
  uploads:'id,status,category,file_url,created_at,tornado_id,uploaded_by,display_file_size,filename,file_name,mime_type',
  cyclone_uploads:'id,status,category,file_url,filename,mime_type,created_at,cyclone_id,uploaded_by,storage_path'
};
const clean=(row,resource)=>Object.fromEntries(fields[resource].split(',').filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]));
function isVideo(row){
  if(['video','videos'].includes(String(row.category||'').toLowerCase())||/^data:video\//i.test(row.file_url||''))return true;
  try{return /\.(mp4|m4v|mov|webm|ogv|ogg|avi|mpeg|mpg|mkv|3gp|3g2|mts|m2ts|ts)$/i.test(decodeURIComponent(new URL(row.file_url,'https://site.invalid').pathname));}catch{return false;}
}
const idOK=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(id);

async function fetchSnapshot(){
  const source=await readFile(path.join(root,'supabase.js'),'utf8');
  const origin=source.match(/const supabaseUrl = "([^"]+)"/)[1],key=source.match(/const supabaseKey = "([^"]+)"/)[1];
  const result={version:1,generatedAt:new Date().toISOString()};
  for(const [resource,table] of Object.entries({tornadoes:'tornadoes',cyclones:'tropical_cyclones',outbreaks:'outbreaks',uploads:'uploads',cyclone_uploads:'cyclone_uploads',site_settings:'site_settings'})){
    const rows=[];
    for(let offset=0;;offset+=1000){
      const selection=resource==='uploads'?fields.uploads.split(',').filter(field=>!['filename','file_name','mime_type'].includes(field)).join(','):fields[resource];
      const query=new URLSearchParams({select:resource==='site_settings'?'key,value':selection,order:resource==='site_settings'?'key':'id',limit:'1000',offset:String(offset)});
      if(resource==='site_settings')query.set('key','in.(top100_public_visible,top100_wind_estimates)');else query.set('status','eq.approved');
      const response=await fetch(origin+'/rest/v1/'+table+'?'+query,{headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw Error('Public export unavailable ('+response.status+').');
      const page=await response.json();if(!Array.isArray(page)||page.length>1000)throw Error('Invalid public export.');
      rows.push(...page);if(page.length<1000)break;if(offset>=99000)throw Error('Export page limit reached.');
    }
    result[resource]=rows;
  }
  return result;
}

async function publish(snapshot){
  if(snapshot.version!==1||!Number.isFinite(Date.parse(snapshot.generatedAt)))throw Error('Invalid export metadata.');
  const data={};
  for(const resource of Object.keys(fields)){
    if(!Array.isArray(snapshot[resource])||snapshot[resource].some(row=>row.status!=='approved'||!idOK(row.id)))throw Error('Only approved public rows may be exported.');
    data[resource]=snapshot[resource].map(row=>clean(row,resource));
  }
  const tornadoIds=new Set(data.tornadoes.map(row=>row.id)),cycloneIds=new Set(data.cyclones.map(row=>row.id));
  data.uploads=data.uploads.filter(row=>tornadoIds.has(row.tornado_id));
  data.cyclone_uploads=data.cyclone_uploads.filter(row=>cycloneIds.has(row.cyclone_id));
  const counts=new Map();for(const row of data.uploads)if(!isVideo(row))counts.set(row.tornado_id,(counts.get(row.tornado_id)||0)+1);
  const cycloneCounts=new Map();for(const row of data.cyclone_uploads)cycloneCounts.set(row.cyclone_id,(cycloneCounts.get(row.cyclone_id)||0)+1);
  data.cyclones=data.cyclones.map(row=>({...row,upload_count:cycloneCounts.get(row.id)||0}));
  const resources=Object.fromEntries(['tornadoes','cyclones','outbreaks'].map(resource=>[resource,{rows:data[resource]}]));
  resources['upload-counts']={counts:[...counts].map(([tornado_id,upload_count])=>({tornado_id,upload_count})),total:[...counts.values()].reduce((sum,value)=>sum+value,0)};
  const settings=(snapshot.site_settings||[]).filter(row=>['top100_public_visible','top100_wind_estimates'].includes(row.key)).map(({key,value})=>({key,value}));
  resources['site-settings']={rows:settings};
  await mkdir(directory,{recursive:true});
  for(const [kind,parentRows,rows,parentField,resource] of [['tornado',data.tornadoes,data.uploads,'tornado_id','uploads'],['cyclone',data.cyclones,data.cyclone_uploads,'cyclone_id','cyclone_uploads']]){
    const folder=path.join(directory,'galleries',kind);await mkdir(folder,{recursive:true});const wanted=new Set();
    for(const parent of parentRows){
      const name=parent.id+'.json';wanted.add(name);
      await writeFile(path.join(folder,name),JSON.stringify({resource,parentId:parent.id,generatedAt:snapshot.generatedAt,rows:rows.filter(row=>row[parentField]===parent.id)}));
    }
    // Remove only obsolete, generated metadata files; image archives are untouched.
    for(const file of await readdir(folder))if(/^[a-zA-Z0-9_-]{1,80}\.json$/.test(file)&&!wanted.has(file))await unlink(path.join(folder,file));
  }
  await writeFile(path.join(directory,'catalogs.json'),JSON.stringify({version:1,generatedAt:snapshot.generatedAt,resources}));
  console.log(JSON.stringify({savedAt:snapshot.generatedAt,tornadoes:data.tornadoes.length,cyclones:data.cyclones.length,outbreaks:data.outbreaks.length,uploads:data.uploads.length,cycloneUploads:data.cyclone_uploads.length}));
}

const sourceIndex=process.argv.indexOf('--source');
let snapshot;
try{snapshot=sourceIndex>=0?JSON.parse(await readFile(process.argv[sourceIndex+1],'utf8')):await fetchSnapshot();}
catch(error){
  if(!process.argv.includes('--keep-on-error')||sourceIndex>=0)throw error;
  const saved=JSON.parse(await readFile(path.join(directory,'catalogs.json'),'utf8'));
  if(saved.version!==1||!saved.resources?.tornadoes)throw error;
  console.log('Backend unavailable; retained the verified public recovery copy from '+saved.generatedAt+'.');
}
if(snapshot)await publish(snapshot);
