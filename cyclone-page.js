import { supabase } from './supabase.js';
import { mountImageImport } from './image-import-bridge.js';
import { IMMUTABLE_UPLOAD_CACHE_CONTROL } from './usage-efficiency.js';
import { deleteTropicalCyclone, cleanupCycloneFiles, ownerDeletionError } from './owner-deletion.js';
import { openCycloneCropper, cycloneCropStyle } from './cyclone-cropper.js';
import { prepareCycloneUpload, insertCycloneUpload, safeCycloneFilename } from './cyclone-duplicates.js';
import { CYCLONE_CATEGORIES, cycloneMediaCategory, cycloneMediaCategoryLabel, cycloneImageCategory, cycloneActor, cycloneFields, bindCycloneWindInputs, cycloneWindKnots, cycloneEyeStat, validateCyclone, cyclonePeak, cyclonePeakBadge, cycloneEstimateFields, cycloneEstimateStats, validateCycloneEstimates, cycloneError, escapeCycloneHtml as esc } from './cyclones.js';

const page = document.getElementById('cyclonePage');
const id = new URLSearchParams(location.search).get('id') || '';
let actor, cyclone, uploads = [], category = 'photos', busy = false, loadRun = 0;
let deletedCyclone = false, pendingCleanup = [];
const categoryName = cycloneMediaCategoryLabel;
const imageFile = row => /^image\//i.test(row.mime_type || '') || /\.(png|jpe?g|webp|gif|avif|bmp|tiff?)(?:\?|$)/i.test(row.file_url || '');
const status = message => { const el = document.getElementById('cyclonePageStatus'); if(el) el.textContent = message; };
const setBusy = value => { busy = value; page.querySelectorAll('button,input,select,textarea').forEach(control=>control.disabled = value); };

async function load() {
  if (busy || deletedCyclone) return;
  const run = ++loadRun;
  try {
    if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw new Error('not-found');
    actor = await cycloneActor(supabase);
    const { data, error } = await supabase.from('tropical_cyclones').select('*').eq('id',id).maybeSingle();
    if(error) throw error;
    if(!data) throw new Error('not-found');
    const media = await supabase.from('cyclone_uploads').select('*').eq('cyclone_id',id).neq('status','rejected').order('created_at',{ascending:false});
    if(media.error) throw media.error;
    if(run !== loadRun) return;
    cyclone = data; uploads = (media.data || []).map(row=>({...row,category:cycloneMediaCategory(row.category)}));
    render();
    await mountImageImport({kind:'cyclone',targetId:id,categories:CYCLONE_CATEGORIES,host:document.getElementById('cycloneMediaPanel'),client:supabase,
      upload:async(input,targetCategory,options)=>{category=targetCategory;renderMedia();return uploadFiles(input,options);}});
  } catch(error) {
    if(run !== loadRun) return;
    page.innerHTML = `<div class="cyclone-empty">${esc(error.message === 'not-found' ? 'This tropical cyclone is unavailable or is still awaiting approval.' : cycloneError(error,'Could not load this tropical cyclone. Please refresh and try again.'))}<p><a class="cyclone-detail-link" href="index.html?view=cyclones">Back to tropical cyclones</a></p></div>`;
  }
}

function renderDeletedCyclone() {
  page.innerHTML = `<section class="cyclone-card"><h1>Tropical cyclone deleted</h1><p>Its details, summaries, and media entries have been removed.</p>${pendingCleanup.length ? '<p>Some stored files could not be cleaned up. Retry to finish removing them.</p><p><button class="btn" type="button" data-retry-cleanup>Retry file cleanup</button></p>' : '<p>All stored files have been cleaned up.</p>'}<p class="cyclone-status" id="cyclonePageStatus" role="status" aria-live="polite"></p><p><a class="btn" href="index.html?view=cyclones">Back to tropical cyclones</a></p></section>`;
}

function render() {
  document.title = `${cyclone.name} (${cyclone.year}) - Tornado Database`;
  const peak = cyclonePeak(cyclone.peak_winds_mph);
  page.innerHTML = `<section class="cyclone-hero" id="cycloneHero" style="--cyclone-peak-color:${peak.color}">${cyclone.cover_image ? `<img class="cyclone-hero-image" src="${esc(cyclone.cover_image)}" alt="" style="${esc(cycloneCropStyle(cyclone,'cover'))}">` : ''}<div class="cyclone-hero-content"><div class="cyclone-heading-meta"><div class="cyclone-eyebrow">Tropical cyclone${cyclone.status !== 'approved' ? ` · ${esc(cyclone.status)}` : ''}</div>${cyclonePeakBadge(cyclone.peak_winds_mph)}</div><h1>${esc(cyclone.name)}</h1><div class="cyclone-stats"><div class="cyclone-stat"><b>${esc(cyclone.year)}</b><span>Year</span></div><div class="cyclone-stat cyclone-stat-peak"><b>${esc(cyclone.peak_winds_mph)} mph</b><span class="cyclone-wind-knots">${esc(cycloneWindKnots(cyclone.peak_winds_mph))} kts</span><span>Official peak winds</span></div><div class="cyclone-stat"><b>${esc(cyclone.lowest_pressure_mb)} mb</b><span>Official lowest pressure</span></div>${cycloneEyeStat(cyclone)}</div>${cycloneEstimateStats(cyclone)}${actor.isAdmin ? '<div class="cyclone-owner-tools"><button class="btn" type="button" data-edit>Edit details</button>'+(cyclone.cover_image ? '<button class="btn" type="button" data-adjust-cover>Adjust cover crop</button>' : '')+'</div>' : ''}${actor.isOwner ? '<div class="cyclone-owner-tools"><button class="btn" type="button" data-edit-estimates>Edit owner estimates</button><button class="btn btn-danger" type="button" data-delete-cyclone>Delete tropical cyclone</button></div>' : ''}</div></section><p class="cyclone-status" id="cyclonePageStatus" role="status" aria-live="polite"></p><section class="cyclone-card" id="cycloneEdit" hidden><h2>Edit tropical cyclone</h2><form id="cycloneEditForm"><fieldset class="cyclone-fields">${cycloneFields(cyclone,'edit-cyclone')}</fieldset><button class="btn btn-primary" type="submit">Save details</button></form></section>${actor.isOwner ? `<section class="cyclone-card" id="cycloneEstimateEdit" hidden><h2>Owner estimates</h2><p class="cyclone-estimate-help" id="cycloneEstimateHelp">Your independent estimates appear alongside the official figures. Leave a field blank to remove its estimate.</p><form id="cycloneEstimateForm"><fieldset class="cyclone-fields">${cycloneEstimateFields(cyclone)}</fieldset><button class="btn btn-primary" type="submit">Save owner estimates</button></form></section>` : ''}<section class="cyclone-card"><h2>Summary</h2><div class="cyclone-summary">${esc(cyclone.description || 'No summary yet.')}</div><p><button class="btn" type="button" data-summary>${actor.isAdmin ? 'Edit summary' : 'Submit summary'}</button></p><form id="cycloneSummaryForm" hidden><div class="cyclone-field"><label for="cycloneSummaryText">Summary</label><textarea id="cycloneSummaryText" name="summary_text" maxlength="20000" required>${esc(cyclone.description || '')}</textarea></div><p><button class="btn btn-primary" type="submit">${actor.isAdmin ? 'Save summary' : 'Submit for approval'}</button></p></form></section><div class="cyclone-tabs" role="tablist" aria-label="Cyclone media">${CYCLONE_CATEGORIES.map(([value,label])=>`<button class="btn ${value === category ? 'active' : ''}" role="tab" aria-selected="${value === category}" aria-controls="cycloneMediaPanel" id="cyclone-tab-${value}" tabindex="${value === category ? '0' : '-1'}" data-category="${value}" type="button">${label}</button>`).join('')}</div><section class="cyclone-card" id="cycloneMediaPanel" role="tabpanel"><h2 id="cycloneMediaHeading"></h2><div class="cyclone-upload-tools"><label for="cycloneMediaFiles">Add files</label><input id="cycloneMediaFiles" type="file" multiple><span class="cyclone-status">${actor.user ? (actor.isAdmin ? 'Admin uploads are approved immediately.' : 'Your uploads will appear after approval.') : 'Log in to upload files.'}</span></div><div class="cyclone-status" id="cycloneUploadStatus" role="status" aria-live="polite"></div><div id="cycloneBulkRepair"></div><div class="cyclone-media-grid" id="cycloneMediaGrid"></div></section>`;
  bindCycloneWindInputs(page);
  renderMedia();
}

function renderMedia() {
  document.getElementById('cycloneMediaHeading').textContent = categoryName(category);
  const panel = document.getElementById('cycloneMediaPanel');
  panel.setAttribute('aria-labelledby','cyclone-tab-'+category);
  document.getElementById('cycloneMediaFiles').accept = cycloneImageCategory(category) ? 'image/*' : 'image/*,.pdf,.txt,.doc,.docx,.csv,.json,.kml,.kmz';
  const visible = uploads.filter(row=>row.category === category && (row.status === 'approved' || actor.isAdmin || row.user_id === actor.user?.id));
  document.getElementById('cycloneMediaGrid').innerHTML = visible.length ? visible.map(row=>`<article class="cyclone-media" data-media-id="${esc(row.id)}">${imageFile(row) ? `<a href="${esc(row.file_url)}" data-image="${esc(row.id)}"><img src="${esc(row.file_url)}" alt="${esc(row.filename)}" loading="lazy" decoding="async"></a>` : `<a class="media-file" href="${esc(row.file_url)}" target="_blank" rel="noopener">${esc(row.filename)}</a>`}<div class="cyclone-media-info"><p>${esc(row.uploaded_by)}${actor.isAdmin && row.repeat_scan ? ' · Scanned repeat' : ''}${row.status === 'pending' ? ' · Waiting for approval' : ''}</p><div class="cyclone-actions">${actor.isAdmin && row.status === 'pending' ? `<button class="btn" type="button" data-review="approved" data-id="${esc(row.id)}">Approve</button><button class="btn btn-danger" type="button" data-review="rejected" data-id="${esc(row.id)}">Reject</button>` : ''}${actor.isAdmin && imageFile(row) && row.status === 'approved' ? `<button class="btn" type="button" data-cover="${esc(row.id)}">Set cover</button>` : ''}${actor.isAdmin || (row.status === 'pending' && row.user_id === actor.user?.id) ? `<button class="btn btn-danger" type="button" data-delete-media="${esc(row.id)}">${actor.isAdmin ? 'Delete' : 'Cancel upload'}</button>` : ''}</div>${actor.isAdmin ? `<p><label>Category <select data-move="${esc(row.id)}">${CYCLONE_CATEGORIES.map(([key,label])=>`<option value="${key}" ${row.category === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label></p>` : ''}</div></article>`).join('') : '<div class="cyclone-empty">No approved media in this category yet.</div>';
  const approved = visible.filter(row=>row.status === 'approved');
  const groups = [...new Set(approved.map(row=>row.uploaded_by))].map(name=>({name,count:approved.filter(row=>row.uploaded_by === name).length})).sort((a,b)=>b.count-a.count);
  document.getElementById('cycloneBulkRepair').innerHTML = actor.isOwner && groups.length ? `<div class="cyclone-bulk"><b>Owner batch repair</b><div class="cyclone-actions"><select id="cycloneBulkSource" aria-label="Uploader batch">${groups.map(group=>`<option value="${esc(group.name)}">${esc(group.name)} · ${group.count} files</option>`).join('')}</select><select id="cycloneBulkDestination" aria-label="Batch destination">${CYCLONE_CATEGORIES.filter(([key])=>key !== category).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}<option value="delete">Delete selection</option></select><button class="btn btn-primary" type="button" data-bulk>Apply</button></div></div>` : '';
}

async function requireUser() {
  actor = await cycloneActor(supabase);
  if(actor.user) return true;
  status('Log in to submit media or a summary.');
  return false;
}

async function uploadFiles(input,{scanDuplicates=false}={}) {
  const files = [...input.files], targetCategory = category;
  const uploadStatus = document.getElementById('cycloneUploadStatus') || document.getElementById('cyclonePageStatus');
  const status = message => { if(uploadStatus) uploadStatus.textContent = message; };
  if(!files.length || busy) return;
  if(!await requireUser()) { input.value = ''; return; }
  setBusy(true); let saved = 0, failed = [], skipped = 0;
  try {
    const valid = files.filter(file=>{
      const extension = file.name.split('.').pop().toLowerCase();
      if(!/^(jpe?g|png|webp|gif|avif|bmp|heic|heif|tiff?|pdf|txt|docx?|csv|json|kml|kmz)$/i.test(extension) || file.size>50*1024*1024) {failed.push(`${file.name}: Use an image or supported research file up to 50 MB.`);return false;}
      if(cycloneImageCategory(targetCategory) && !/^image\//.test(file.type)) {failed.push(`${file.name}: Choose an image for this category.`);return false;}
      return true;
    });
    if(!valid.length) {status(failed.join('\n'));return;}
    const checks = await prepareCycloneUpload(supabase,id,valid,targetCategory,{isOwner:actor.isOwner,statusBox:uploadStatus,scanDuplicates});
    if(!checks) {status('Upload canceled. No files were uploaded.');return;}
    skipped = valid.length-checks.length;
    for(const [index,check] of checks.entries()) {
      const file = check.file;
      let path = '';
      try {
        status(`Uploading ${index+1} of ${checks.length}: ${file.name}`);
        path = `${actor.user.id}/${id}/${check.fingerprint ? check.fingerprint+'-' : ''}${crypto.randomUUID()}-${check.repeat_scan ? 'repeat-' : ''}${safeCycloneFilename(file.name)}`;
        const stored = await supabase.storage.from('cyclone-uploads').upload(path,file,{contentType:file.type || 'application/octet-stream',cacheControl:IMMUTABLE_UPLOAD_CACHE_CONTROL,upsert:false});
        if(stored.error) throw stored.error;
        const { data: publicFile } = supabase.storage.from('cyclone-uploads').getPublicUrl(path);
        let result;
        try {
          result = await insertCycloneUpload(supabase,{ id:crypto.randomUUID(),cyclone_id:id,user_id:actor.user.id,uploaded_by:actor.name,file_url:publicFile.publicUrl,storage_path:path,filename:file.name,mime_type:file.type || 'application/octet-stream',category:targetCategory,status:actor.isAdmin ? 'approved' : 'pending',upload_fingerprint:check.fingerprint,image_hash:check.imageHash,repeat_scan:check.repeat_scan,repeat_reason:check.repeatReasons.join('; ').slice(0,900) });
        } catch(error) {await supabase.storage.from('cyclone-uploads').remove([path]);throw error;}
        uploads.unshift(result); saved++;
      } catch(error) { failed.push(`${file.name}: ${cycloneError(error,error.message || 'Upload failed.')}`); }
    }
    renderMedia(); status(`${saved} file${saved === 1 ? '' : 's'} ${actor.isAdmin ? 'added' : 'submitted for approval'}.${skipped ? ` Skipped ${skipped} duplicate${skipped===1?'':'s'}.` : ''}${failed.length ? '\n'+failed.join('\n') : ''}`);
  } catch(error) {status(cycloneError(error,error.message || 'Could not finish the duplicate scan. Please try again.'));}
  finally { input.value = ''; setBusy(false); }
  return {saved};
}

async function removeMedia(rows) {
  if(rows.some(row=>row.file_url === cyclone.cover_image)) {
    const result = await supabase.from('tropical_cyclones').update({cover_image:null}).eq('id',id);
    if(result.error) throw result.error;
    cyclone.cover_image = null;
    render();
  }
  const result = await supabase.from('cyclone_uploads').delete().in('id',rows.map(row=>row.id)).select('id');
  if(result.error) throw result.error;
  if(result.data?.length !== rows.length) throw new Error('Some uploads were already reviewed or removed. Refresh to see their current status.');
  uploads = uploads.filter(row=>!rows.some(deleted=>deleted.id === row.id));
  const cleaned = await supabase.storage.from('cyclone-uploads').remove(rows.map(row=>row.storage_path));
  if(cleaned.error) status('Media removed. Some stored files could not be cleaned up.');
}

page.addEventListener('change',async event=>{
  if(event.target.id === 'cycloneMediaFiles') return uploadFiles(event.target);
  const move = event.target.closest('[data-move]');
  if(!move || busy || !actor.isAdmin) return;
  setBusy(true);
  try {
    const result = await supabase.from('cyclone_uploads').update({category:move.value}).eq('id',move.dataset.move);
    if(result.error) throw result.error;
    uploads = uploads.map(row=>row.id === move.dataset.move ? {...row,category:move.value} : row);
    renderMedia();
  } catch(error) { status(cycloneError(error)); renderMedia(); }
  finally { setBusy(false); }
});

page.addEventListener('keydown',event=>{
  const tab = event.target.closest('[data-category]');
  if(!tab || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  event.preventDefault();
  const keys = CYCLONE_CATEGORIES.map(item=>item[0]), current = keys.indexOf(tab.dataset.category);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? keys.length-1 : (current+(event.key === 'ArrowRight' ? 1 : -1)+keys.length)%keys.length;
  const button = page.querySelector(`[data-category="${keys[next]}"]`); button.click(); button.focus();
});

page.addEventListener('click',async event=>{
  if(busy) return;
  if(event.target.closest('[data-adjust-cover]') && actor.isAdmin) {
    const saved = await openCycloneCropper(supabase,cyclone,{mode:'cover',source:document.getElementById('cycloneHero')});
    if(saved){cyclone=saved;render();status('Cover crop updated.');}
    return;
  }
  if(event.target.closest('[data-retry-cleanup]') && deletedCyclone) {
    setBusy(true);
    try {
      pendingCleanup = await cleanupCycloneFiles(supabase, pendingCleanup);
      renderDeletedCyclone();
      if(pendingCleanup.length) status('File cleanup could not finish. Check your connection and owner account, then try again.');
    } finally { setBusy(false); }
    return;
  }
  const tab = event.target.closest('[data-category]');
  if(tab && !busy) {
    category = tab.dataset.category;
    page.querySelectorAll('[data-category]').forEach(button=>{ const active=button===tab; button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active ? 0 : -1; });
    renderMedia(); return;
  }
  if(event.target.closest('[data-edit]')) { document.getElementById('cycloneEdit').hidden = !document.getElementById('cycloneEdit').hidden; return; }
  if(event.target.closest('[data-edit-estimates]') && actor.isOwner) {
    const editor = document.getElementById('cycloneEstimateEdit');
    editor.hidden = !editor.hidden;
    if(!editor.hidden) editor.querySelector('input').focus({preventScroll:true});
    return;
  }
  if(event.target.closest('[data-summary]')) {
    if(!await requireUser()) return;
    document.getElementById('cycloneSummaryForm').hidden = !document.getElementById('cycloneSummaryForm').hidden; return;
  }
  const image = event.target.closest('[data-image]');
  if(image) {
    event.preventDefault(); const row = uploads.find(item=>item.id === image.dataset.image);
    const box = document.getElementById('cycloneLightbox'); box.querySelector('img').src=row.file_url;box.querySelector('img').alt=row.filename;box.querySelector('p').textContent=`${row.filename} · ${row.uploaded_by}`;box.showModal();return;
  }
  const button = event.target.closest('[data-review],[data-cover],[data-delete-media],[data-bulk],[data-delete-cyclone]');
  if(!button || busy) return;
  const row = uploads.find(item=>item.id === (button.dataset.id || button.dataset.cover || button.dataset.deleteMedia));
  if(button.dataset.cover && actor.isAdmin) {
    const saved = await openCycloneCropper(supabase,cyclone,{mode:'cover',source:document.getElementById('cycloneHero'),url:row.file_url});
    if(saved){cyclone=saved;render();status('Cover updated.');}
    return;
  }
  if(button.hasAttribute('data-delete-media') && !confirm('Delete this media upload?')) return;
  if(button.hasAttribute('data-delete-cyclone')) {
    if(!actor.isOwner || !confirm(`Delete ${cyclone.name} (${cyclone.year}), its summaries, and all its media? This cannot be undone.`)) return;
    ++loadRun;
    status('Deleting tropical cyclone…');
  }
  setBusy(true);
  try {
    if(button.dataset.review && actor.isAdmin) {
      const result = await supabase.from('cyclone_uploads').update({status:button.dataset.review}).eq('id',row.id).eq('status','pending').select('*').single();
      if(result.error) throw result.error;
      uploads = uploads.map(item=>item.id === row.id ? {...result.data,category:cycloneMediaCategory(result.data.category)} : item).filter(item=>item.status !== 'rejected');
    } else if(button.dataset.deleteMedia && (actor.isAdmin || (row?.user_id === actor.user?.id && row.status === 'pending'))) await removeMedia([row]);
    else if(button.hasAttribute('data-bulk') && actor.isOwner) {
      const source = document.getElementById('cycloneBulkSource').value, destination = document.getElementById('cycloneBulkDestination').value;
      const batch = uploads.filter(item=>item.category === category && item.status === 'approved' && item.uploaded_by === source);
      if(destination === 'delete') { if(!confirm(`Delete all ${batch.length} files in this uploader batch?`)) return; await removeMedia(batch); }
      else {
        const result=await supabase.from('cyclone_uploads').update({category:destination}).in('id',batch.map(item=>item.id));if(result.error)throw result.error;
        uploads=uploads.map(item=>batch.some(entry=>entry.id === item.id) ? {...item,category:destination} : item);
      }
    } else if(button.hasAttribute('data-delete-cyclone') && actor.isOwner) {
      pendingCleanup = await deleteTropicalCyclone(supabase, id);
      deletedCyclone = true;
      if(pendingCleanup.length) renderDeletedCyclone();
      else location.href='index.html?view=cyclones';
      return;
    }
    renderMedia();
  } catch(error) { status(cycloneError(error, button.hasAttribute('data-delete-cyclone') ? ownerDeletionError(error) : undefined)); }
  finally { setBusy(false); }
});

page.addEventListener('submit',async event=>{
  event.preventDefault();if(busy || !await requireUser())return;
  const form=event.target;
  let edits;
  try {
    if(form.id === 'cycloneEditForm') edits=validateCyclone(Object.fromEntries(new FormData(form)));
    if(form.id === 'cycloneEstimateForm') {
      if(!actor.isOwner) { status('Only the owner can edit cyclone estimates.'); return; }
      edits=validateCycloneEstimates(Object.fromEntries(new FormData(form)));
    }
  }
  catch(error){status(error.message);return;}
  setBusy(true);
  try {
    if(form.id === 'cycloneEditForm' && actor.isAdmin) {
      const result=await supabase.from('tropical_cyclones').update(edits).eq('id',id).select('*').single();if(result.error)throw result.error;
      cyclone=result.data;render();status('Details updated.');
    } else if(form.id === 'cycloneEstimateForm' && actor.isOwner) {
      const result=await supabase.from('tropical_cyclones').update(edits).eq('id',id).select('*').single();if(result.error)throw result.error;
      cyclone=result.data;render();status('Owner estimates updated.');
    } else if(form.id === 'cycloneSummaryForm') {
      const text=form.querySelector('textarea').value.trim();if(!text){status('Enter a summary.');return;}
      const result=await supabase.from('cyclone_summaries').insert({cyclone_id:id,user_id:actor.user.id,submitted_by:actor.name,summary_text:text,status:actor.isAdmin ? 'approved' : 'pending'});if(result.error)throw result.error;
      if(actor.isAdmin){cyclone.description=text;render();}else form.hidden=true;
      status(actor.isAdmin ? 'Summary updated.' : 'Summary submitted for approval.');
    }
  } catch(error){status(cycloneError(error));}
  finally{setBusy(false);}
});

const lightbox=document.getElementById('cycloneLightbox');
lightbox.addEventListener('click',event=>{if(event.target===lightbox)lightbox.close();});
lightbox.addEventListener('close',()=>lightbox.querySelector('img').removeAttribute('src'));
supabase.auth.onAuthStateChange(()=>{ if(cyclone) load(); });
load();
