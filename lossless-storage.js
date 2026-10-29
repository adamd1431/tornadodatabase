import { IMMUTABLE_UPLOAD_CACHE_CONTROL } from './usage-efficiency.js';

const TABLE_FIELDS = {
  uploads:['file_url','original_file_url'],
  tornadoes:['cover_image','path_image'],
  cyclone_uploads:['file_url','storage_path'],
  tropical_cyclones:['cover_image']
};
const BUCKETS = ['uploads','cyclone-uploads'];
const key = (bucket,path)=>`${bucket}/${path}`;
const cleanETag = value=>String(value || '').replace(/^W\//,'').replace(/^"|"$/g,'');
const sha256 = async file=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(byte=>byte.toString(16).padStart(2,'0')).join('');

function reference(value,origin,bucket) {
  if(typeof value !== 'string' || !value) return '';
  try {
    const url = new URL(value);
    if(url.origin !== origin) return '';
    const match = url.pathname.match(/^\/storage\/v1\/(?:object|render\/image)\/(?:public|sign|authenticated)\/(uploads|cyclone-uploads)\/(.+)$/);
    return match ? key(match[1],decodeURIComponent(match[2])) : '';
  } catch {
    if(!bucket || /^[a-z]+:/i.test(value)) return '';
    const raw=value.replace(/^\/+/,''),prefixed=raw.match(/^(uploads|cyclone-uploads)\/(.+)$/);
    return prefixed ? key(prefixed[1],prefixed[2]) : key(bucket,raw);
  }
}

function embeddedReferences(value,origin,result=new Set()) {
  if(typeof value === 'string') {
    for(const url of value.match(/https?:\/\/[^\s<>"']+/g) || []) {
      for(const candidate of [url,url.replace(/[)\],.;]+$/,'')]) {
        const found=reference(candidate,origin); if(found) result.add(found);
      }
    }
  } else if(Array.isArray(value)) value.forEach(item=>embeddedReferences(item,origin,result));
  else if(value && typeof value === 'object') Object.values(value).forEach(item=>embeddedReferences(item,origin,result));
  return result;
}

async function owner(client) {
  const {data,error}=await client.auth.getUser();
  if(error) throw error;
  if(!data?.user) throw new Error('Sign in as Owner to compress stored images.');
  const permission=await client.rpc('utwx_is_owner',{check_user_id:data.user.id});
  if(permission.error) throw permission.error;
  if(permission.data !== true) throw new Error('Only the Owner can replace stored images.');
  return data.user;
}

async function rows(client,table) {
  const result=[];
  for(let offset=0;;offset+=1000) {
    const {data,error}=await client.from(table).select('*').order('id').range(offset,offset+999);
    if(error) throw error;
    if(!Array.isArray(data)) throw new Error(`Could not check ${table}. Original files are kept.`);
    result.push(...data); if(data.length<1000) return result;
  }
}
async function snapshot(client) {
  const names=Object.keys(TABLE_FIELDS), data=[];
  for(const name of names)data.push(await rows(client,name));
  return Object.fromEntries(names.map((name,index)=>[name,data[index]]));
}

async function object(client,bucket,path) {
  const slash=path.lastIndexOf('/'),folder=slash<0?'':path.slice(0,slash),name=path.slice(slash+1);
  const {data,error}=await client.storage.from(bucket).list(folder,{limit:1000,search:name});
  if(error) throw error;
  if(!Array.isArray(data)) throw new Error('Could not verify a stored file. Original files are kept.');
  return data.find(row=>row.name===name) || null;
}
const objectSize = row=>Number(row?.metadata?.size ?? row?.metadata?.contentLength);
const objectETag = row=>cleanETag(row?.metadata?.eTag ?? row?.metadata?.etag);
export const losslessSourceMatches = (entry,row)=>!!row && objectSize(row)===entry.originalBytes && objectETag(row)===cleanETag(entry.sourceETag);

export async function prepareLosslessBatch(plan,files,projectUrl) {
  const origin=new URL(projectUrl).origin;
  if(plan?.version!==1 || plan.lossless!==true || plan.projectUrl!==origin || !Array.isArray(plan.entries) || !plan.entries.length || plan.entries.length>5000) throw new Error('Choose a verified lossless batch for this database.');
  const selected=new Map();
  for(const file of files) {
    if(selected.has(file.name)) throw new Error(`Two selected files have the same name: ${file.name}`);
    selected.set(file.name,file);
  }
  const paths=new Set(),names=new Set(),entries=[];
  for(const entry of plan.entries) {
    const sourceKey=key(entry.bucket,entry.sourcePath),file=selected.get(entry.replacementFilename);
    if(!BUCKETS.includes(entry.bucket) || !entry.sourcePath || entry.sourcePath.split('/').some(part=>!part || part==='.' || part==='..')
      || reference(entry.sourceUrl,origin)!==sourceKey || paths.has(sourceKey) || names.has(entry.replacementFilename)
      || /[\\/]/.test(entry.replacementFilename || '') || !/^[a-f0-9]{64}$/.test(entry.originalSHA256 || '') || !/^[a-f0-9]{64}$/.test(entry.replacementSHA256 || '')
      || !cleanETag(entry.sourceETag) || !Number.isSafeInteger(entry.originalBytes) || !Number.isSafeInteger(entry.replacementBytes)
      || entry.originalBytes>50*1024*1024 || entry.replacementBytes<=0 || entry.replacementBytes>=entry.originalBytes
      || !['image/jpeg','image/png','image/webp','image/gif'].includes(entry.replacementMimeType)
      || entry.verification?.pixels!==true || !Number.isSafeInteger(entry.verification.frames) || entry.verification.frames<1
      || (entry.verification.frames>1 && (entry.verification.timing!==true || entry.verification.looping!==true))) throw new Error('This batch contains an invalid or unverified replacement.');
    if(!file || file.size!==entry.replacementBytes || await sha256(file)!==entry.replacementSHA256) throw new Error(`Missing or changed replacement: ${entry.replacementFilename}`);
    paths.add(sourceKey); names.add(entry.replacementFilename); entries.push({...entry,file});
  }
  return {entries,savedBytes:entries.reduce((total,entry)=>total+entry.originalBytes-entry.replacementBytes,0)};
}

function patchesFor(tables,entry,origin,newUrl,newPath) {
  const sourceKey=key(entry.bucket,entry.sourcePath),changes=[];
  for(const [table,records] of Object.entries(tables)) for(const row of records) {
    const before={},after={},other={...row};
    for(const field of TABLE_FIELDS[table]) {
      delete other[field];
      const rawBucket=field==='storage_path'?'cyclone-uploads':table==='tornadoes' || table==='uploads'?'uploads':'cyclone-uploads';
      if(reference(row[field],origin,rawBucket)!==sourceKey) continue;
      before[field]=row[field]; after[field]=field==='storage_path'?newPath:newUrl;
    }
    if(embeddedReferences(other,origin).has(sourceKey)) throw new Error('This image is linked inside text or other metadata. It was left unchanged.');
    if(!Object.keys(before).length) continue;
    if(table==='cyclone_uploads' && after.file_url) {
      after.mime_type=entry.replacementMimeType;
      const extension=entry.replacementFilename.split('.').pop();
      after.filename=String(row.filename || entry.originalFilename).replace(/\.[^.]+$/,'.'+extension);
    }
    if(table==='uploads') {
      if(after.file_url && Object.hasOwn(row,'display_file_size')) after.display_file_size=entry.replacementBytes;
      if(after.original_file_url && Object.hasOwn(row,'original_file_size')) after.original_file_size=entry.replacementBytes;
    }
    changes.push({table,id:row.id,before,after});
  }
  if(!changes.length) throw new Error('This source image is no longer referenced. It was left unchanged.');
  return changes;
}

async function updateReference(client,change) {
  let request=client.from(change.table).update(change.after).eq('id',change.id);
  for(const [field,value] of Object.entries(change.before)) request=request.eq(field,value);
  const {data,error}=await request.select('id').maybeSingle();
  if(error) throw error;
  if(data?.id!==change.id) throw new Error('An image reference changed during compression. Original files are kept.');
}

function allReferences(tables,origin) {
  const result=embeddedReferences(tables,origin);
  for(const [table,records] of Object.entries(tables)) for(const row of records) for(const field of TABLE_FIELDS[table]) {
    const bucket=field==='storage_path'?'cyclone-uploads':table==='tornadoes' || table==='uploads'?'uploads':'cyclone-uploads';
    const found=reference(row[field],origin,bucket); if(found) result.add(found);
  }
  return result;
}

export async function applyLosslessBatch(client,batch,{onProgress=()=>{},onReceipt=()=>{},previous=[]}={}) {
  const actor=await owner(client),{data}=client.storage.from('uploads').getPublicUrl('lossless-check');
  const origin=new URL(data.publicUrl).origin,receipts=[...previous],failures=[];
  // Revalidate selected bytes immediately before any write, even after a reload.
  await prepareLosslessBatch({version:1,lossless:true,projectUrl:origin,entries:batch.entries},batch.entries.map(entry=>entry.file),origin);
  let tables=await snapshot(client);
  const save=async receipt=>{const index=receipts.findIndex(row=>row.sourceUrl===receipt.sourceUrl);if(index<0)receipts.push(receipt);else receipts[index]=receipt;await onReceipt(receipts);};
  for(let offset=0;offset<batch.entries.length;offset+=10) {
    await owner(client);
    const staged=[];
    for(const [index,entry] of batch.entries.slice(offset,offset+10).entries()) {
      const oldReceipt=receipts.find(row=>row.sourceUrl===entry.sourceUrl);
      if(oldReceipt?.status==='finished') continue;
      onProgress({done:offset+index,total:batch.entries.length,label:entry.label});
      try {
        const original=await object(client,entry.bucket,entry.sourcePath);
        if(oldReceipt && (oldReceipt.replacementSHA256!==entry.replacementSHA256 || oldReceipt.originalSHA256!==entry.originalSHA256)) throw new Error('The recovery record belongs to a different replacement.');
        if(!original && oldReceipt?.status==='references-updated') {
          const referenced=allReferences(tables,origin),stored=await object(client,entry.bucket,oldReceipt.replacementPath);
          if(referenced.has(key(entry.bucket,entry.sourcePath)) || !referenced.has(key(entry.bucket,oldReceipt.replacementPath)) || objectSize(stored)!==entry.replacementBytes || objectETag(stored)!==oldReceipt.replacementETag) throw new Error('The recovery record could not be verified.');
          oldReceipt.status='finished';await save(oldReceipt);continue;
        }
        if(!losslessSourceMatches(entry,original)) throw new Error('The source file changed after verification.');
        if(oldReceipt && oldReceipt.originalObjectId!==original.id) throw new Error('The stored original was replaced outside this compression batch.');
        const extension=entry.replacementFilename.split('.').pop();
        const filename=String(entry.originalFilename || 'image').replace(/\.[^.]+$/,'').replace(/[^\w.-]+/g,'-').slice(-120)+'.'+extension;
        const cyclone=(tables.cyclone_uploads || []).find(row=>reference(row.file_url,origin)===key(entry.bucket,entry.sourcePath));
        const newPath=oldReceipt?.replacementPath || `${actor.id}/${cyclone?.cyclone_id || 'lossless'}/${crypto.randomUUID()}-${filename}`;
        const newUrl=client.storage.from(entry.bucket).getPublicUrl(newPath).data.publicUrl;
        const changes=oldReceipt?.changes || patchesFor(tables,entry,origin,newUrl,newPath);
        const {file,...metadata}=entry;
        const receipt=oldReceipt || {...metadata,replacementPath:newPath,replacementUrl:newUrl,originalObjectId:original.id,changes,status:'prepared'};
        await save(receipt); // A recovery receipt must exist before uploading.
        if(!oldReceipt || !await object(client,entry.bucket,newPath)) {
          const uploaded=await client.storage.from(entry.bucket).upload(newPath,file,{upsert:false,contentType:entry.replacementMimeType,cacheControl:IMMUTABLE_UPLOAD_CACHE_CONTROL});
          if(uploaded.error) throw uploaded.error;
          receipt.status='uploaded'; await save(receipt);
        }
        const stored=await object(client,entry.bucket,newPath);
        if(!stored || objectSize(stored)!==entry.replacementBytes || !objectETag(stored) || (receipt.replacementETag && receipt.replacementETag!==objectETag(stored))) throw new Error('The stored replacement could not be verified.');
        receipt.replacementETag=objectETag(stored);
        for(const change of changes) {
          const current=tables[change.table].find(row=>row.id===change.id);
          if(current && Object.keys(change.before).every(field=>current[field]===change.after[field])) continue;
          await updateReference(client,change);
          const row=tables[change.table].find(row=>row.id===change.id);Object.assign(row,change.after);
        }
        receipt.status='references-updated'; await save(receipt); staged.push(receipt);
      } catch(error) { failures.push(`${entry.label}: ${error.message || 'Could not replace this file.'}`); }
    }
    // Read current references again before removing any original object. This
    // also protects covers changed in another browser during the batch.
    tables=await snapshot(client);
    const referenced=allReferences(tables,origin),removable=[];
    for(const receipt of staged) {
      try {
        if(referenced.has(key(receipt.bucket,receipt.sourcePath)) || !referenced.has(key(receipt.bucket,receipt.replacementPath))) throw new Error('The original is still in use, or its replacement is no longer referenced.');
        const [original,replacement]=await Promise.all([object(client,receipt.bucket,receipt.sourcePath),object(client,receipt.bucket,receipt.replacementPath)]);
        if(original?.id!==receipt.originalObjectId || objectETag(original)!==cleanETag(receipt.sourceETag)
          || objectSize(replacement)!==receipt.replacementBytes || objectETag(replacement)!==receipt.replacementETag) throw new Error('A stored file changed during compression.');
        removable.push(receipt);
      } catch(error) { failures.push(`${receipt.label}: ${error.message} Original file kept.`); }
    }
    await owner(client);
    for(const bucket of BUCKETS) {
      const group=removable.filter(row=>row.bucket===bucket);if(!group.length)continue;
      const removed=await client.storage.from(bucket).remove(group.map(row=>row.sourcePath));
      if(removed.error) {failures.push(`${bucket}: ${removed.error.message}`);continue;}
      for(const receipt of group) {
        if(await object(client,bucket,receipt.sourcePath)) {failures.push(`${receipt.label}: the original file could not be removed.`);continue;}
        receipt.status='finished'; await save(receipt);
      }
    }
  }
  onProgress({done:batch.entries.length,total:batch.entries.length,label:''});
  const selected=new Set(batch.entries.map(entry=>entry.sourceUrl));
  return {receipts,failures,savedBytes:receipts.filter(row=>row.status==='finished' && selected.has(row.sourceUrl)).reduce((total,row)=>total+row.originalBytes-row.replacementBytes,0)};
}
