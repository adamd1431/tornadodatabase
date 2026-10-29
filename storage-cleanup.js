const BUCKETS = ['uploads','cyclone-uploads'];
const DAY = 24*60*60*1000;
export const storageFileKey = file => `${file.bucket || 'uploads'}/${file.path}`;

async function requireOwner(client) {
  const {data,error} = await client.auth.getUser();
  if(error) throw error;
  if(!data?.user) throw new Error('Sign in as Owner to scan storage.');
  const permission = await client.rpc('utwx_is_owner',{check_user_id:data.user.id});
  if(permission.error) throw permission.error;
  if(permission.data !== true) throw new Error('Only the Owner can manage storage.');
}

async function allRows(client,table) {
  const rows = [];
  for(let offset=0;;offset+=1000) {
    const {data,error} = await client.from(table).select('*').order('id').range(offset,offset+999);
    if(error) throw error;
    if(!Array.isArray(data)) throw new Error(`Could not check ${table}. No files can be removed.`);
    rows.push(...data);
    if(data.length<1000) return rows;
  }
}

async function bucketFiles(client,bucket,folder='') {
  const files = [];
  for(let offset=0;;offset+=1000) {
    const {data,error} = await client.storage.from(bucket).list(folder,{limit:1000,offset,sortBy:{column:'name',order:'asc'}});
    if(error) throw error;
    if(!Array.isArray(data)) throw new Error(`Could not list ${bucket}. No files can be removed.`);
    for(const item of data) {
      if(typeof item.name !== 'string' || !item.name) throw new Error(`Incomplete file listing for ${bucket}. Scan again.`);
      const path = [folder,item.name].filter(Boolean).join('/');
      if(!item.id && !['size','mimetype','eTag','cacheControl'].some(key=>item.metadata?.[key] != null)) files.push(...await bucketFiles(client,bucket,path));
      else {
        const size = Number(item.metadata?.size ?? item.metadata?.contentLength ?? 0);
        files.push({bucket,path,bytes:Number.isFinite(size) && size>0 ? size : 0,createdAt:item.created_at,item});
      }
    }
    if(data.length<1000) return files;
  }
}

function pathReference(value,origin) {
  try {
    const url = new URL(value);
    if(url.origin !== origin) return null;
    const match = url.pathname.match(/^\/storage\/v1\/(?:object|render\/image)\/(?:public|sign|authenticated)\/(uploads|cyclone-uploads)\/(.+)$/);
    if(match) return {bucket:match[1],path:decodeURIComponent(match[2])};
  } catch {}
  return null;
}

function collectReferences(value,origin,target) {
  if(typeof value === 'string') {
    const direct = pathReference(value,origin);
    if(direct) target.add(storageFileKey(direct));
    // Protect media linked inside summaries, Markdown, or HTML as well.
    for(const url of value.match(/https?:\/\/[^\s<>"']+/g) || []) {
      for(const candidate of [url,url.replace(/[)\],.;]+$/,'')]) {
        const reference = pathReference(candidate,origin);
        if(reference) target.add(storageFileKey(reference));
      }
    }
  } else if(Array.isArray(value)) value.forEach(item=>collectReferences(item,origin,target));
  else if(value && typeof value === 'object') Object.values(value).forEach(item=>collectReferences(item,origin,target));
}

function oldEnough(file,now) {
  const created = Date.parse(file.createdAt), updated = Date.parse(file.item?.updated_at || file.createdAt);
  return Number.isFinite(created) && Number.isFinite(updated) && Math.max(created,updated) < now-DAY;
}

export function classifyStorageFiles({tables,files,origin,now=Date.now()}) {
  const mediaInfo = new Map();
  for(const [table,parentTable,parentKey] of [['uploads','tornadoes','tornado_id'],['cyclone_uploads','tropical_cyclones','cyclone_id']]) {
    const parents = new Map((tables[parentTable] || []).map(row=>[row.id,row]));
    for(const row of tables[table] || []) {
      const reference = pathReference(row.file_url,origin) || (table === 'cyclone_uploads' && row.storage_path ? {bucket:'cyclone-uploads',path:row.storage_path} : null);
      if(!reference) continue;
      const parent = parents.get(row[parentKey]);
      mediaInfo.set(storageFileKey(reference),{label:parent ? `${parent.name}${parent.year ? ` (${parent.year})` : ''}` : 'Uploaded media',filename:row.filename || row.file_name || reference.path.split('/').pop()});
    }
  }
  files = files.map(file=>({...file,...mediaInfo.get(storageFileKey(file))}));
  const referenced = new Set(), displayed = new Set();
  for(const [table,rows] of Object.entries(tables)) for(const row of rows) {
    collectReferences(row,origin,referenced);
    const {original_file_url,...other} = row;
    collectReferences(other,origin,displayed);
    // Older records can contain a raw storage path rather than a public URL.
    for(const field of ['file_url','original_file_url','cover_image','path_image']) {
      const value = row[field];
      if(typeof value !== 'string' || !value.trim() || /^(?:[a-z]+:|\/\/)/i.test(value)) continue;
      const raw = value.trim().replace(/^\/+/,''), prefixed = raw.match(/^(uploads|cyclone-uploads)\/(.+)$/);
      const bucket = prefixed?.[1] || (table.startsWith('cyclone') || table === 'tropical_cyclones' ? 'cyclone-uploads' : 'uploads');
      const path = prefixed?.[2] || raw;
      const paths = new Set([path]);
      try { paths.add(decodeURIComponent(path)); } catch {}
      for(const path of paths) {
        const key = storageFileKey({bucket,path}); referenced.add(key);
        if(field !== 'original_file_url') displayed.add(key);
      }
    }
    if(table === 'cyclone_uploads' && row.storage_path) {
      const key = storageFileKey({bucket:'cyclone-uploads',path:row.storage_path});
      referenced.add(key); displayed.add(key);
    }
  }
  const stored = new Map(files.map(file=>[storageFileKey(file),file])), originals = new Map();
  for(const row of tables.uploads || []) {
    const original = pathReference(row.original_file_url,origin), display = pathReference(row.file_url,origin);
    if(row.status !== 'approved' || !original || !display) continue;
    const key = storageFileKey(original);
    if(key === storageFileKey(display) || displayed.has(key) || !stored.has(key) || !stored.has(storageFileKey(display))) continue;
    if(!oldEnough(stored.get(key),now) || !oldEnough(stored.get(storageFileKey(display)),now)) continue;
    const file = originals.get(key) || {...stored.get(key),uploadIds:[]};
    file.uploadIds.push(row.id); originals.set(key,file);
  }
  // Recent objects may belong to uploads whose database insert is still running.
  // Unknown dates are kept too. A scan alone never deletes anything.
  const orphanFiles = files.filter(file=>!referenced.has(storageFileKey(file)) && oldEnough(file,now));
  const originalFiles = [...originals.values()];
  const sum = rows=>rows.reduce((total,file)=>total+file.bytes,0);
  const byFormat = new Map();
  for(const file of files) {
    const extension = (file.path.match(/\.([a-z0-9]+)$/i)?.[1] || 'other').toLowerCase().replace(/^jpeg$/,'jpg');
    const group = byFormat.get(extension) || {extension,count:0,bytes:0}; group.count++; group.bytes+=file.bytes; byFormat.set(extension,group);
  }
  return {scannedAt:new Date(now).toISOString(),storageFiles:files,originalFiles,orphanFiles,totalBytes:sum(files),originalBytes:sum(originalFiles),orphanBytes:sum(orphanFiles),buckets:BUCKETS.map(bucket=>({bucket,bytes:sum(files.filter(file=>file.bucket===bucket))})),formats:[...byFormat.values()].sort((a,b)=>b.bytes-a.bytes),largestFiles:[...files].sort((a,b)=>b.bytes-a.bytes).slice(0,10)};
}

export async function scanStorage(client) {
  await requireOwner(client);
  const names = ['uploads','tornadoes','cyclone_uploads','tropical_cyclones'];
  const [rows,files] = await Promise.all([
    Promise.all(names.map(name=>allRows(client,name))),
    Promise.all(BUCKETS.map(bucket=>bucketFiles(client,bucket)))
  ]);
  const {data} = client.storage.from('uploads').getPublicUrl('storage-check');
  const scan = classifyStorageFiles({tables:Object.fromEntries(names.map((name,index)=>[name,rows[index]])),files:files.flat(),origin:new URL(data.publicUrl).origin});
  scan.largestFiles = scan.largestFiles.map(file=>({...file,publicUrl:client.storage.from(file.bucket).getPublicUrl(file.path).data.publicUrl}));
  return scan;
}

export async function removeScannedStorageFiles(client,files,kind) {
  if(!['orphan','original'].includes(kind)) throw new Error('Choose a cleanup type.');
  // Recheck permissions and references immediately before a destructive request.
  const scan = await scanStorage(client);
  const allowed = new Set((kind === 'orphan' ? scan.orphanFiles : scan.originalFiles).map(storageFileKey));
  const selected = [...new Map(files.map(file=>[storageFileKey(file),file])).values()];
  if(selected.some(file=>!allowed.has(storageFileKey(file)))) throw new Error('Some files changed or are now in use. Scan again before removing them.');
  if(kind === 'original') for(const file of selected) {
    const current = scan.originalFiles.find(candidate=>storageFileKey(candidate)===storageFileKey(file));
    if(JSON.stringify([...current.uploadIds].sort()) !== JSON.stringify([...(file.uploadIds || [])].sort())) throw new Error('Original backup references changed. Scan again before removing them.');
  }
  const failures = [];
  for(const bucket of BUCKETS) {
    const paths = selected.filter(file=>file.bucket===bucket).map(file=>file.path);
    for(let index=0;index<paths.length;index+=25) {
      const {error} = await client.storage.from(bucket).remove(paths.slice(index,index+25));
      if(error) failures.push(`${bucket}: ${error.message || 'Could not remove stored files.'}`);
    }
  }
  return {failures};
}
