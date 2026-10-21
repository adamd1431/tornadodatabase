import { supabase } from './supabase.js';
import { CYCLONE_CATEGORIES, cycloneActor, cycloneFields, validateCyclone, cycloneError, escapeCycloneHtml as esc } from './cyclones.js';

const page = document.getElementById('cyclonePage');
const id = new URLSearchParams(location.search).get('id') || '';
let actor, cyclone, uploads = [], category = 'photos', busy = false, loadRun = 0;
const categoryName = value => CYCLONE_CATEGORIES.find(item=>item[0] === value)?.[1] || value;
const imageFile = row => /^image\//i.test(row.mime_type || '') || /\.(png|jpe?g|webp|gif|avif|bmp|tiff?)(?:\?|$)/i.test(row.file_url || '');
const status = message => { const el = document.getElementById('cyclonePageStatus'); if(el) el.textContent = message; };
const setBusy = value => { busy = value; page.querySelectorAll('button,input[type=file]').forEach(button=>button.disabled = value); };

async function load() {
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
    cyclone = data; uploads = media.data || [];
    render();
  } catch(error) {
    if(run !== loadRun) return;
    page.innerHTML = `<div class="cyclone-empty">${esc(error.message === 'not-found' ? 'This tropical cyclone is unavailable or is still awaiting approval.' : cycloneError(error,'Could not load this tropical cyclone. Please refresh and try again.'))}<p><a class="cyclone-detail-link" href="index.html?view=cyclones">Back to tropical cyclones</a></p></div>`;
  }
}

function render() {
  document.title = `${cyclone.name} (${cyclone.year}) - Tornado Database`;
  page.innerHTML = `<section class="cyclone-hero" id="cycloneHero"><div class="cyclone-eyebrow">Tropical cyclone${cyclone.status !== 'approved' ? ` · ${esc(cyclone.status)}` : ''}</div><h1>${esc(cyclone.name)}</h1><div class="cyclone-stats"><div class="cyclone-stat"><b>${esc(cyclone.year)}</b><span>Year</span></div><div class="cyclone-stat"><b>${esc(cyclone.peak_winds_mph)} mph</b><span>Peak winds</span></div><div class="cyclone-stat"><b>${esc(cyclone.lowest_pressure_mb)} mb</b><span>Lowest pressure</span></div></div>${actor.isAdmin ? '<div class="cyclone-owner-tools"><button class="btn" type="button" data-edit>Edit details</button></div>' : ''}${actor.isOwner ? '<div class="cyclone-owner-tools"><button class="btn btn-danger" type="button" data-delete-cyclone>Delete tropical cyclone</button></div>' : ''}</section><p class="cyclone-status" id="cyclonePageStatus" role="status" aria-live="polite"></p><section class="cyclone-card" id="cycloneEdit" hidden><h2>Edit tropical cyclone</h2><form id="cycloneEditForm"><fieldset class="cyclone-fields">${cycloneFields(cyclone,'edit-cyclone')}</fieldset><button class="btn btn-primary" type="submit">Save details</button></form></section><section class="cyclone-card"><h2>Summary</h2><div class="cyclone-summary">${esc(cyclone.description || 'No summary yet.')}</div><p><button class="btn" type="button" data-summary>${actor.isAdmin ? 'Edit summary' : 'Submit summary'}</button></p><form id="cycloneSummaryForm" hidden><div class="cyclone-field"><label for="cycloneSummaryText">Summary</label><textarea id="cycloneSummaryText" name="summary_text" maxlength="20000" required>${esc(cyclone.description || '')}</textarea></div><p><button class="btn btn-primary" type="submit">${actor.isAdmin ? 'Save summary' : 'Submit for approval'}</button></p></form></section><div class="cyclone-tabs" role="tablist" aria-label="Cyclone media">${CYCLONE_CATEGORIES.map(([value,label])=>`<button class="btn ${value === category ? 'active' : ''}" role="tab" aria-selected="${value === category}" aria-controls="cycloneMediaPanel" id="cyclone-tab-${value}" tabindex="${value === category ? '0' : '-1'}" data-category="${value}" type="button">${label}</button>`).join('')}</div><section class="cyclone-card" id="cycloneMediaPanel" role="tabpanel"><h2 id="cycloneMediaHeading"></h2><div class="cyclone-upload-tools"><label for="cycloneMediaFiles">Add files</label><input id="cycloneMediaFiles" type="file" multiple><span class="cyclone-status">${actor.user ? (actor.isAdmin ? 'Admin uploads are approved immediately.' : 'Your uploads will appear after approval.') : 'Log in to upload files.'}</span></div><div id="cycloneBulkRepair"></div><div class="cyclone-media-grid" id="cycloneMediaGrid"></div></section>`;
  if(cyclone.cover_image) {
    const hero = document.getElementById('cycloneHero');
    hero.classList.add('has-cover');
    hero.style.backgroundImage = `linear-gradient(100deg,rgba(8,14,26,.95),rgba(8,14,26,.6)),url(${JSON.stringify(cyclone.cover_image)})`;
    hero.style.backgroundPosition = cyclone.cover_position || '50% 50%';
  }
  renderMedia();
}

function renderMedia() {
  document.getElementById('cycloneMediaHeading').textContent = categoryName(category);
  const panel = document.getElementById('cycloneMediaPanel');
  panel.setAttribute('aria-labelledby','cyclone-tab-'+category);
  document.getElementById('cycloneMediaFiles').accept = ['photos','damage','radar','environment'].includes(category) ? 'image/*' : 'image/*,.pdf,.txt,.doc,.docx,.csv,.json,.kml,.kmz';
  const visible = uploads.filter(row=>row.category === category && (row.status === 'approved' || actor.isAdmin || row.user_id === actor.user?.id));
  document.getElementById('cycloneMediaGrid').innerHTML = visible.length ? visible.map(row=>`<article class="cyclone-media" data-media-id="${esc(row.id)}">${imageFile(row) ? `<a href="${esc(row.file_url)}" data-image="${esc(row.id)}"><img src="${esc(row.file_url)}" alt="${esc(row.filename)}" loading="lazy" decoding="async"></a>` : `<a class="media-file" href="${esc(row.file_url)}" target="_blank" rel="noopener">${esc(row.filename)}</a>`}<div class="cyclone-media-info"><p>${esc(row.uploaded_by)}${row.status === 'pending' ? ' · Waiting for approval' : ''}</p><div class="cyclone-actions">${actor.isAdmin && row.status === 'pending' ? `<button class="btn" type="button" data-review="approved" data-id="${esc(row.id)}">Approve</button><button class="btn btn-danger" type="button" data-review="rejected" data-id="${esc(row.id)}">Reject</button>` : ''}${actor.isAdmin && imageFile(row) && row.status === 'approved' ? `<button class="btn" type="button" data-cover="${esc(row.id)}">Set cover</button>` : ''}${actor.isAdmin || (row.status === 'pending' && row.user_id === actor.user?.id) ? `<button class="btn btn-danger" type="button" data-delete-media="${esc(row.id)}">${actor.isAdmin ? 'Delete' : 'Cancel upload'}</button>` : ''}</div>${actor.isAdmin ? `<p><label>Category <select data-move="${esc(row.id)}">${CYCLONE_CATEGORIES.map(([key,label])=>`<option value="${key}" ${row.category === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label></p>` : ''}</div></article>`).join('') : '<div class="cyclone-empty">No approved media in this category yet.</div>';
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

async function uploadFiles(input) {
  const files = [...input.files], targetCategory = category;
  if(!files.length || busy) return;
  if(!await requireUser()) { input.value = ''; return; }
  setBusy(true); let saved = 0, failed = [];
  try {
    for(const [index,file] of files.entries()) {
      let path = '';
      try {
        const extension = file.name.split('.').pop().toLowerCase();
        const allowed = /^(jpe?g|png|webp|gif|avif|bmp|heic|heif|tiff?|pdf|txt|docx?|csv|json|kml|kmz)$/i.test(extension);
        if(!allowed || file.size > 50*1024*1024) throw new Error('Use an image or supported research file up to 50 MB.');
        if(['photos','damage','radar','environment'].includes(targetCategory) && !/^image\//.test(file.type)) throw new Error('Choose an image for this category.');
        status(`Uploading ${index+1} of ${files.length}: ${file.name}`);
        path = `${actor.user.id}/${id}/${crypto.randomUUID()}.${extension}`;
        const stored = await supabase.storage.from('cyclone-uploads').upload(path,file,{contentType:file.type || 'application/octet-stream',upsert:false});
        if(stored.error) throw stored.error;
        const { data: publicFile } = supabase.storage.from('cyclone-uploads').getPublicUrl(path);
        const result = await supabase.from('cyclone_uploads').insert({ id:crypto.randomUUID(),cyclone_id:id,user_id:actor.user.id,uploaded_by:actor.name,file_url:publicFile.publicUrl,storage_path:path,filename:file.name,mime_type:file.type || 'application/octet-stream',category:targetCategory,status:actor.isAdmin ? 'approved' : 'pending' }).select('*').single();
        if(result.error) { await supabase.storage.from('cyclone-uploads').remove([path]); throw result.error; }
        uploads.unshift(result.data); saved++;
      } catch(error) { failed.push(`${file.name}: ${cycloneError(error,error.message || 'Upload failed.')}`); }
    }
    renderMedia(); status(`${saved} file${saved === 1 ? '' : 's'} ${actor.isAdmin ? 'added' : 'submitted for approval'}.${failed.length ? '\n'+failed.join('\n') : ''}`);
  } finally { input.value = ''; setBusy(false); }
}

async function removeMedia(rows) {
  if(rows.some(row=>row.file_url === cyclone.cover_image)) {
    const result = await supabase.from('tropical_cyclones').update({cover_image:null}).eq('id',id);
    if(result.error) throw result.error;
    cyclone.cover_image = null;
    const hero = document.getElementById('cycloneHero'); hero.style.backgroundImage = ''; hero.classList.remove('has-cover');
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
  const tab = event.target.closest('[data-category]');
  if(tab && !busy) {
    category = tab.dataset.category;
    page.querySelectorAll('[data-category]').forEach(button=>{ const active=button===tab; button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active ? 0 : -1; });
    renderMedia(); return;
  }
  if(event.target.closest('[data-edit]')) { document.getElementById('cycloneEdit').hidden = !document.getElementById('cycloneEdit').hidden; return; }
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
  if(button.hasAttribute('data-delete-media') && !confirm('Delete this media upload?')) return;
  if(button.hasAttribute('data-delete-cyclone') && !confirm(`Delete ${cyclone.name} and all its media? This cannot be undone.`)) return;
  setBusy(true);
  try {
    if(button.dataset.review && actor.isAdmin) {
      const result = await supabase.from('cyclone_uploads').update({status:button.dataset.review}).eq('id',row.id).eq('status','pending').select('*').single();
      if(result.error) throw result.error;
      uploads = uploads.map(item=>item.id === row.id ? result.data : item).filter(item=>item.status !== 'rejected');
    } else if(button.dataset.cover && actor.isAdmin) {
      const result = await supabase.from('tropical_cyclones').update({cover_image:row.file_url,cover_position:'50% 50%'}).eq('id',id);
      if(result.error) throw result.error;
      cyclone.cover_image=row.file_url;cyclone.cover_position='50% 50%';render();status('Cover updated.');
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
      const result=await supabase.from('tropical_cyclones').delete().eq('id',id);if(result.error)throw result.error;
      if(uploads.length) await supabase.storage.from('cyclone-uploads').remove(uploads.map(item=>item.storage_path));
      location.href='index.html?view=cyclones';return;
    }
    renderMedia();
  } catch(error) { status(cycloneError(error)); }
  finally { setBusy(false); }
});

page.addEventListener('submit',async event=>{
  event.preventDefault();if(busy || !await requireUser())return;
  const form=event.target;
  let edits;
  try { if(form.id === 'cycloneEditForm') edits=validateCyclone(Object.fromEntries(new FormData(form))); }
  catch(error){status(error.message);return;}
  setBusy(true);
  try {
    if(form.id === 'cycloneEditForm' && actor.isAdmin) {
      const result=await supabase.from('tropical_cyclones').update(edits).eq('id',id).select('*').single();if(result.error)throw result.error;
      cyclone=result.data;render();status('Details updated.');
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
