export const CYCLONE_CATEGORIES = [
  ['photos','Cyclone pictures'], ['damage','Damage'], ['radar','Radar'],
  ['environment','Environment'], ['research','Research / Survey'],
  ['text_accounts','Text / Accounts'], ['misc','Misc']
];
export const cycloneUrl = row => `tropical-cyclone.html?id=${encodeURIComponent(row?.id || row?.cyclone_id || '')}`;
export const escapeCycloneHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function validateCyclone(input) {
  const name = String(input.name || '').trim();
  const year = Number(input.year), wind = Number(input.peak_winds_mph), pressure = Number(input.lowest_pressure_mb);
  if (!name || name.length > 160) throw new Error('Enter a cyclone name, up to 160 characters.');
  if (!/^\d{1,4}$/.test(String(input.year)) || !Number.isInteger(year) || year < 1 || year > 9999) throw new Error('Enter a valid year.');
  if (String(input.peak_winds_mph ?? '').trim() === '' || !Number.isFinite(wind) || wind < 0 || wind > 500) throw new Error('Enter peak winds between 0 and 500 mph.');
  if (String(input.lowest_pressure_mb ?? '').trim() === '' || !Number.isFinite(pressure) || pressure <= 0 || pressure > 2000) throw new Error('Enter a lowest pressure greater than 0 and up to 2,000 mb.');
  return { name, year, peak_winds_mph: wind, lowest_pressure_mb: pressure };
}
export function cycloneFields(row = {}, prefix = 'cyclone') {
  const esc = escapeCycloneHtml;
  return [
    ['name','Name','text','Hurricane Patricia','maxlength="160"'],
    ['year','Year','number','2015','min="1" max="9999" step="1"'],
    ['peak_winds_mph','Peak winds (mph)','number','215','min="0" max="500" step="any"'],
    ['lowest_pressure_mb','Lowest pressure (mb)','number','872','min="0.1" max="2000" step="any"']
  ].map(([key,label,type,placeholder,attrs]) => `<div class="cyclone-field"><label for="${esc(prefix)}-${key}">${label}</label><input class="form-input" id="${esc(prefix)}-${key}" name="${key}" type="${type}" placeholder="${placeholder}" value="${esc(row[key] ?? '')}" ${attrs} required></div>`).join('');
}
export async function cycloneActor(client) {
  const { data: { user }, error } = await client.auth.getUser();
  if (error) throw error;
  if (!user) return { user: null, isAdmin: false, isOwner: false, name: 'Anonymous' };
  const { data: profile } = await client.from('profiles').select('username,role,is_admin').eq('id',user.id).maybeSingle();
  const owner = String(user.email || '').toLowerCase() === 'lazerbuffalo1431@gmail.com' || profile?.role === 'owner';
  return { user, isOwner: owner, isAdmin: owner || !!profile?.is_admin || profile?.role === 'admin', name: profile?.username || 'Member' };
}
export function cycloneError(error, fallback = 'Could not save this change. Please try again.') {
  console.warn('Tropical cyclones:', error);
  if (/42P01|PGRST20[025]|PGRST106/.test(String(error?.code || '')) || /schema cache|does not exist|could not find.*(table|function)/i.test(error?.message || '')) return 'Tropical cyclones are not set up yet. Run supabase-tropical-cyclones.sql in Supabase, then refresh.';
  return fallback;
}
export async function loadCyclones(client, admin = false) {
  let query = client.from('tropical_cyclones').select('*').order('year',{ascending:false});
  query = admin ? query.neq('status','rejected') : query.eq('status','approved');
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
export async function submitCyclone(client, input, requestId = crypto.randomUUID()) {
  const row = validateCyclone(input);
  const { data, error } = await client.rpc('submit_tropical_cyclone', { p_id: requestId, p_name: row.name, p_year: row.year, p_peak_winds_mph: row.peak_winds_mph, p_lowest_pressure_mb: row.lowest_pressure_mb });
  if (error) throw error;
  if (!data?.id) throw new Error('The server did not confirm this submission.');
  return data;
}
export function openCycloneForm(client, onSaved = () => {}) {
  let dialog = document.getElementById('cycloneSubmitDialog');
  if (dialog) { dialog.showModal(); return; }
  dialog = document.createElement('dialog');
  dialog.id = 'cycloneSubmitDialog'; dialog.className = 'cyclone-dialog';
  dialog.setAttribute('aria-labelledby','cycloneFormTitle');
  dialog.innerHTML = `<form class="cyclone-modal"><h2 id="cycloneFormTitle">Add tropical cyclone</h2><fieldset class="cyclone-fields">${cycloneFields()}</fieldset><p class="cyclone-status" role="status" aria-live="polite"></p><div class="cyclone-actions"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn btn-primary" type="submit">Submit tropical cyclone</button></div></form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form'), status = dialog.querySelector('[role=status]');
  let requestId = crypto.randomUUID(), busy = false;
  dialog.querySelector('[data-cancel]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('cancel',event=>{ if(busy) event.preventDefault(); });
  dialog.addEventListener('click',event=>{ if(event.target === dialog && !busy) dialog.close(); });
  form.addEventListener('input',()=>{ requestId = crypto.randomUUID(); status.textContent = ''; });
  form.addEventListener('submit',async event=>{
    event.preventDefault(); if(busy) return;
    const input = Object.fromEntries(new FormData(form));
    try { validateCyclone(input); } catch(error) { status.textContent = error.message; return; }
    busy = true; form.querySelector('fieldset').disabled = true;
    const button = form.querySelector('[type=submit]'); button.disabled = true; button.textContent = 'Submitting…';
    dialog.querySelector('[data-cancel]').disabled = true;
    try {
      const result = await submitCyclone(client,input,requestId);
      form.reset(); requestId = crypto.randomUUID(); dialog.close();
      await onSaved(result);
    } catch(error) { status.textContent = cycloneError(error,'Could not submit this cyclone. Your details are still here; please try again.'); }
    finally { busy = false; form.querySelector('fieldset').disabled = false; button.disabled = false; button.textContent = 'Submit tropical cyclone'; dialog.querySelector('[data-cancel]').disabled = false; }
  });
  dialog.showModal();
}
