import { createUploadFingerprint, createImageContentHashFromFile, perceptualHashFromImage, imageHashesLookSame, isImageFileForDuplicateCheck } from './media-image-hash.js';
import { cycloneMediaCategoryLabel, escapeCycloneHtml as esc } from './cyclones.js';

const legacyHashes = new Map();
const scanFields = ['upload_fingerprint','image_hash','repeat_scan','repeat_reason'];
export const safeCycloneFilename = name => String(name || 'upload').replace(/[^\w.-]+/g,'-').replace(/-+/g,'-');

function storedFingerprint(row) {
  const stored = String(row.upload_fingerprint || '').trim().toLowerCase();
  if(stored) return stored;
  return String(row.storage_path || row.file_url || '').split('/').pop()
    .match(/^([a-f0-9]{12})-[a-f0-9]{8}-/i)?.[1]?.toLowerCase() || '';
}

function markRepeat(check, reason) {
  check.repeat_scan = true;
  check.repeatReasons = [...new Set([...check.repeatReasons,reason])];
  return reason;
}

export function findCycloneDuplicateWarnings(checks, existing) {
  const warnings = [], selected = [];
  for(const check of checks) {
    const previous = selected.find(other => (check.fingerprint && check.fingerprint === other.fingerprint)
      || (check.imageHash && imageHashesLookSame(check.imageHash,other.imageHash)));
    if(previous) warnings.push(markRepeat(check,`${check.file.name} matches another file selected in this upload (${previous.file.name}).`));
    selected.push(check);
    const match = existing.find(row => (check.fingerprint && check.fingerprint === storedFingerprint(row))
      || (check.imageHash && imageHashesLookSame(check.imageHash,row.image_hash))
      || (!isImageFileForDuplicateCheck(check.file) && safeCycloneFilename(check.file.name).toLowerCase() === safeCycloneFilename(row.filename).toLowerCase()));
    if(match) warnings.push(markRepeat(check,`${check.file.name} looks like existing ${cycloneMediaCategoryLabel(match.category)} media${match.status ? ', '+match.status : ''}.`));
  }
  return [...new Set(warnings)];
}

async function mapConcurrent(items, limit, worker) {
  const result = new Array(items.length); let next = 0;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
    while(next < items.length) { const index = next++; result[index] = await worker(items[index]); }
  }));
  return result;
}

export async function loadCycloneScanUploads(client, id) {
  const rows = [];
  for(let offset = 0; ; offset += 1000) {
    const {data,error} = await client.from('cyclone_uploads').select('*').eq('cyclone_id',id).order('id').range(offset,offset+999);
    if(error) throw error;
    if(!Array.isArray(data)) throw new Error('Could not check existing uploads. Please try again.');
    rows.push(...data);
    if(data.length < 1000) return rows;
  }
}

function imageUrlForHash(url) {
  try {
    const parsed = new URL(url);
    if(parsed.pathname.includes('/storage/v1/object/public/')) {
      parsed.pathname = parsed.pathname.replace('/storage/v1/object/public/','/storage/v1/render/image/public/');
      parsed.searchParams.set('width','96'); parsed.searchParams.set('quality','45'); parsed.searchParams.set('resize','cover');
    }
    return parsed.href;
  } catch { return url; }
}

async function legacyImageHash(row) {
  if(legacyHashes.has(row.file_url)) return legacyHashes.get(row.file_url);
  const pending = new Promise(resolve=>{
    const img = new Image();
    const finish = hash => { clearTimeout(timer); img.onload = img.onerror = null; resolve(hash); };
    const timer = setTimeout(()=>finish(''),4500);
    img.crossOrigin = 'anonymous';
    img.onload = () => { try { finish(perceptualHashFromImage(img)); } catch { finish(''); } };
    img.onerror = () => finish(''); img.src = imageUrlForHash(row.file_url);
  });
  legacyHashes.set(row.file_url,pending);
  const hash = await pending;
  if(!hash) legacyHashes.delete(row.file_url);
  return hash;
}

function choose(statusBox,title,copy,actions) {
  statusBox.innerHTML = `<div class="cyclone-scan-warning"><strong>${esc(title)}</strong><div>${copy}</div><div class="cyclone-actions"></div></div>`;
  const area = statusBox.querySelector('.cyclone-actions');
  return new Promise(resolve=>{
    for(const [value,label] of actions) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn'; button.textContent = label;
      button.addEventListener('click',()=>{
        area.querySelectorAll('button').forEach(control=>{control.disabled=true;}); resolve(value);
      },{once:true});
      area.append(button);
    }
    area.querySelector('button')?.focus();
  });
}

export async function prepareCycloneUpload(client, id, files, category, {isOwner,statusBox,scanDuplicates=false}) {
  if(isOwner && !scanDuplicates) {
    const decision = await choose(statusBox,'Would you like to check for duplicates?',`You selected ${files.length} file${files.length===1?'':'s'}.`,[
      ['scan','Yes, check duplicates'],['skip','No, skip check'],['cancel','Cancel']
    ]);
    if(decision === 'cancel') return null;
    if(decision === 'skip') return files.map(file=>({file,fingerprint:'',imageHash:'',repeat_scan:false,repeatReasons:[]}));
  }
  statusBox.textContent = 'Checking for duplicate media…';
  const checks = await mapConcurrent(files,3,async file=>{
    const [fingerprint,imageHash] = await Promise.all([createUploadFingerprint(file),createImageContentHashFromFile(file)]);
    return {file,fingerprint,imageHash,repeat_scan:false,repeatReasons:[]};
  });
  const existing = await loadCycloneScanUploads(client,id);
  const warnings = findCycloneDuplicateWarnings(checks,existing);
  // Existing uploads made before hash metadata was added still participate in
  // photo matching. Use the tornado scan's same 80-image limit and 6 workers.
  const legacy = existing.filter(row=>!row.image_hash && (/^image\//i.test(row.mime_type || '') || /\.(jpe?g|png|webp|avif|bmp)(?:\?|$)/i.test(row.file_url || '')))
    .sort((a,b)=>Number(b.category===category)-Number(a.category===category)).slice(0,80);
  const images = checks.filter(check=>check.imageHash && !check.repeat_scan);
  for(let offset=0; images.some(check=>!check.repeat_scan) && offset<legacy.length; offset+=6) {
    statusBox.textContent = `Checking photo matches (${Math.min(offset+6,legacy.length)}/${legacy.length})…`;
    const matches = await mapConcurrent(legacy.slice(offset,offset+6),6,async row=>({row,hash:await legacyImageHash(row)}));
    for(const {row,hash} of matches) for(const check of images) {
      if(!check.repeat_scan && hash && imageHashesLookSame(check.imageHash,hash)) warnings.push(markRepeat(check,`${check.file.name} looks like the same photo as an existing ${cycloneMediaCategoryLabel(row.category)} image${row.status ? ', '+row.status : ''}.`));
    }
  }
  if(!warnings.length) return checks;
  const unique = [...new Set(warnings)], clean = checks.filter(check=>!check.repeat_scan).length;
  const actions = [];
  if(clean && clean<checks.length) actions.push(['clean',`Upload all except duplicates (${clean})`]);
  actions.push(['all','Upload all anyways'],['cancel','Cancel']);
  const action = await choose(statusBox,'Possible duplicate media',`<ul>${unique.slice(0,6).map(warning=>`<li>${esc(warning)}</li>`).join('')}</ul>${unique.length>6 ? `<p>${unique.length-6} more possible duplicates found.</p>` : ''}`,actions);
  if(action === 'cancel') return null;
  return action === 'clean' ? checks.filter(check=>!check.repeat_scan) : checks;
}

export async function insertCycloneUpload(client, row) {
  let result = await client.from('cyclone_uploads').insert(row).select('*').single();
  // Keep uploads working before the optional metadata migration is installed.
  // A missing-column error occurs before INSERT; other failures are not retried.
  if(['42703','PGRST204'].includes(String(result.error?.code)) && scanFields.some(key=>`${result.error?.message} ${result.error?.details}`.includes(key))) {
    const fallback = {...row}; scanFields.forEach(key=>delete fallback[key]);
    result = await client.from('cyclone_uploads').insert(fallback).select('*').single();
  }
  if(result.error) throw result.error;
  if(!result.data?.id) throw new Error('The server did not confirm this upload.');
  return result.data;
}
