export const CYCLONE_CATEGORIES = [
  ['photos','Pictures'], ['satellite','Satellite imagery'], ['track','Track'], ['recon','Recon'], ['research','Research'], ['damage','Damage'],
  ['radar','Radar'], ['models','Models'], ['misc','Misc']
];
// Keep uploads from retired tabs visible before and after the SQL migration.
export const cycloneMediaCategory = value => CYCLONE_CATEGORIES.some(([key])=>key === value) ? value : 'misc';
export const cycloneMediaCategoryLabel = value => CYCLONE_CATEGORIES.find(([key])=>key === cycloneMediaCategory(value))[1];
export const cycloneImageCategory = value => ['photos','satellite','damage','radar'].includes(value);
export const cycloneUrl = row => `tropical-cyclone.html?id=${encodeURIComponent(row?.id || row?.cyclone_id || '')}`;
export const escapeCycloneHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MPH_PER_KNOT = 1852 / 1609.344;
const roundWindToFive = value => Math.round(value / 5) * 5;
const MAX_WIND_KNOTS = roundWindToFive(500 / MPH_PER_KNOT);
export function cycloneWindKnots(mph) {
  if(mph == null || String(mph).trim() === '' || !Number.isFinite(Number(mph))) return '';
  return String(roundWindToFive(Number(mph) / MPH_PER_KNOT));
}
export function cycloneWindMph(knots) {
  if(knots == null || String(knots).trim() === '' || !Number.isFinite(Number(knots))) return '';
  return String(roundWindToFive(Number(knots) * MPH_PER_KNOT));
}
export function cycloneEyeTemperature(row) {
  const value = row?.eye_temperature_c;
  return value == null || String(value).trim() === '' || !Number.isFinite(Number(value)) ? '' : String(Number(value));
}
export function cycloneEyeStat(row) {
  const value = cycloneEyeTemperature(row);
  return value === '' ? '' : `<div class="cyclone-stat" data-eye-temperature><b>${escapeCycloneHtml(value)} °C</b><span>Infrared eye temperature</span></div>`;
}
// Wikipedia's Saffir–Simpson palette, independent of the tornado EF colors.
// https://en.wikipedia.org/wiki/Module:Storm_categories/categories
const CYCLONE_PEAK_COLORS = ['#4DFFFF','#FFFFD9','#FFD98C','#FF9E59','#FF738A','#A188FC'];
export function cyclonePeak(winds) {
  const wind = Number(winds);
  if (winds == null || String(winds).trim() === '' || !Number.isFinite(wind) || wind < 0) return {category:null,label:'Unrated',color:'#CCCCCC'};
  // Saffir–Simpson thresholds: https://www.nhc.noaa.gov/aboutsshws.php
  const category = wind >= 157 ? 5 : wind >= 130 ? 4 : wind >= 111 ? 3 : wind >= 96 ? 2 : wind >= 74 ? 1 : 0;
  return {category,label:category ? `Category ${category}` : wind >= 39 ? 'Tropical storm' : 'Tropical depression',color:wind < 39 ? '#6EC1EA' : CYCLONE_PEAK_COLORS[category]};
}
export function cyclonePeakBadge(winds) {
  const peak = cyclonePeak(winds);
  return `<span class="cyclone-category" style="--cyclone-peak-color:${peak.color}" aria-label="Official peak: ${peak.label}">${peak.label}</span>`;
}
export function validateCycloneEstimates(input) {
  const result = {};
  for (const [key,label,minimum,maximum] of [
    ['owner_estimated_winds_mph','Estimated peak winds',0,500],
    ['owner_estimated_pressure_mb','Estimated lowest pressure',0,2000]
  ]) {
    const raw = input[key];
    if (raw == null || String(raw).trim() === '') { result[key] = null; continue; }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < minimum || value > maximum || (key === 'owner_estimated_pressure_mb' && value === 0)) throw new Error(`${label} must be ${minimum === 0 && key.endsWith('pressure_mb') ? 'greater than 0 and up to' : 'between 0 and'} ${maximum.toLocaleString('en-US')}${key.endsWith('winds_mph') ? ' mph' : ' mb'}.`);
    result[key] = value;
  }
  return result;
}
export function cycloneEstimateFields(row = {}) {
  return [
    ['owner_estimated_winds_mph','Estimated peak winds (mph)','0','500'],
    ['owner_estimated_pressure_mb','Estimated lowest pressure (mb)','0.1','2000']
  ].map(([key,label,min,max]) => `<div class="cyclone-field"><label for="cyclone-${key}">${label}</label><input id="cyclone-${key}" name="${key}" type="number" min="${min}" max="${max}" step="any" value="${escapeCycloneHtml(row[key] ?? '')}" placeholder="Leave blank if unset" aria-describedby="cycloneEstimateHelp"></div>`).join('');
}
export function cycloneEstimateStats(row = {}) {
  const values = [
    ['owner_estimated_winds_mph','Peak winds','mph'],
    ['owner_estimated_pressure_mb','Lowest pressure','mb']
  ].filter(([key]) => row[key] != null && String(row[key]).trim() !== '');
  if (!values.length) return '';
  return `<div class="cyclone-owner-estimates"><div class="cyclone-eyebrow">Owner estimates</div><div class="cyclone-stats">${values.map(([key,label,unit]) => `<div class="cyclone-stat" data-estimate="${key}"><b>${escapeCycloneHtml(row[key])} ${unit}</b><span>${label}</span></div>`).join('')}</div></div>`;
}
export function validateCyclone(input) {
  const name = String(input.name || '').trim();
  const year = Number(input.year), pressure = Number(input.lowest_pressure_mb);
  const hasMph = String(input.peak_winds_mph ?? '').trim() !== '', hasKnots = String(input.peak_winds_kts ?? '').trim() !== '';
  const knots = Number(input.peak_winds_kts);
  const useKnots = hasKnots && (input.wind_input_unit === 'kts' || !hasMph);
  const wind = useKnots ? Number(cycloneWindMph(knots)) : Number(input.peak_winds_mph);
  if (!name || name.length > 160) throw new Error('Enter a cyclone name, up to 160 characters.');
  if (!/^\d{1,4}$/.test(String(input.year)) || !Number.isInteger(year) || year < 1 || year > 9999) throw new Error('Enter a valid year.');
  if(hasKnots && (!Number.isFinite(knots) || knots < 0 || knots > MAX_WIND_KNOTS)) throw new Error(`Enter peak winds between 0 and ${MAX_WIND_KNOTS} kts.`);
  if ((!hasMph && !hasKnots) || !Number.isFinite(wind) || wind < 0 || wind > 500) throw new Error('Enter peak winds in mph or knots, up to 500 mph.');
  if(hasMph && hasKnots && !['mph','kts'].includes(input.wind_input_unit)
    && Math.abs(Number(input.peak_winds_mph) - Number(cycloneWindMph(knots))) > .1
    && Math.abs(knots - Number(cycloneWindKnots(input.peak_winds_mph))) > .1) throw new Error('Wind speeds in mph and knots must describe the same speed.');
  if (String(input.lowest_pressure_mb ?? '').trim() === '' || !Number.isFinite(pressure) || pressure <= 0 || pressure > 2000) throw new Error('Enter a lowest pressure greater than 0 and up to 2,000 mb.');
  const eyeRaw = input.eye_temperature_c;
  const eye = eyeRaw == null || String(eyeRaw).trim() === '' ? null : Number(eyeRaw);
  if(eye !== null && (!Number.isFinite(eye) || eye < -150 || eye > 100)) throw new Error('Enter an eye temperature between −150 and 100 °C, or leave it blank.');
  return { name, year, peak_winds_mph: wind, lowest_pressure_mb: pressure, eye_temperature_c: eye };
}
export function cycloneFields(row = {}, prefix = 'cyclone') {
  const esc = escapeCycloneHtml;
  const values = {...row,peak_winds_kts:cycloneWindKnots(row.peak_winds_mph)};
  return `<input type="hidden" name="wind_input_unit" value="mph">` + [
    ['name','Name','text','Hurricane Patricia','maxlength="160" required'],
    ['year','Year','number','2015','min="1" max="9999" step="1" required'],
    ['peak_winds_mph','Peak winds (mph)','number','215','min="0" max="500" step="any" required'],
    ['peak_winds_kts','Peak winds (kts)','number','185',`min="0" max="${MAX_WIND_KNOTS}" step="any"`],
    ['lowest_pressure_mb','Lowest pressure (mb)','number','872','min="0.1" max="2000" step="any" required'],
    ['eye_temperature_c','Eye temperature (°C, optional)','number','Leave blank if unknown','min="-150" max="100" step="any"']
  ].map(([key,label,type,placeholder,attrs]) => `<div class="cyclone-field"><label for="${esc(prefix)}-${key}">${label}</label><input class="form-input" id="${esc(prefix)}-${key}" name="${key}" type="${type}" placeholder="${placeholder}" value="${esc(values[key] ?? '')}" ${attrs}></div>`).join('') + '<p class="cyclone-field full cyclone-estimate-help">Enter winds in mph or knots; the other updates automatically, rounded to the nearest 5. Eye temperature is from infrared imagery and can be left blank.</p>';
}
const linkedWindRoots = new WeakSet();
export function bindCycloneWindInputs(root) {
  if(linkedWindRoots.has(root)) return;
  linkedWindRoots.add(root);
  root.addEventListener('input',event=>{
    const field = event.target;
    if(!['peak_winds_mph','peak_winds_kts'].includes(field.name)) return;
    const form = field.closest('form'); if(!form) return;
    const unit = field.name === 'peak_winds_kts' ? 'kts' : 'mph';
    const other = form.elements.namedItem(unit === 'kts' ? 'peak_winds_mph' : 'peak_winds_kts');
    const source = form.elements.namedItem('wind_input_unit');
    if(source) source.value = unit;
    if(!other) return;
    const value = Number(field.value);
    other.value = field.value.trim() === '' || field.validity?.badInput || !Number.isFinite(value) || value < 0 ? '' : (unit === 'kts' ? cycloneWindMph(value) : cycloneWindKnots(value));
  });
}
export async function cycloneActor(client) {
  const { data, error } = await client.auth.getUser();
  // A missing session is normal for visitors viewing approved public cyclones.
  if (error && error.name !== 'AuthSessionMissingError') throw error;
  const user = error ? null : data?.user;
  if (!user) return { user: null, isAdmin: false, isOwner: false, name: 'Anonymous' };
  const { data: profile } = await client.from('profiles').select('username,role,is_admin').eq('id',user.id).maybeSingle();
  const owner = String(user.email || '').toLowerCase() === 'lazerbuffalo1431@gmail.com' || profile?.role === 'owner';
  return { user, isOwner: owner, isAdmin: owner || !!profile?.is_admin || profile?.role === 'admin', name: profile?.username || 'Member' };
}
export function cycloneError(error, fallback = 'Could not save this change. Please try again.') {
  console.warn('Tropical cyclones:', error);
  if (/utwx_move_cyclone|year_order/.test(`${error?.message || ''} ${error?.details || ''}`) && /42703|42883|PGRST20[24]/.test(String(error?.code || ''))) return 'Run supabase-cyclone-order.sql in Supabase to enable owner ordering, then try again.';
  if(/eye_temperature_c/.test(`${error?.message || ''} ${error?.details || ''}`) && /42703|PGRST20[24]/.test(String(error?.code || ''))) return 'Run supabase-cyclone-eye-temperature.sql in Supabase to enable eye temperature, then try again. Your entries are still here.';
  if (error?.code === '23514' && /cyclone_uploads_category_check/.test(error?.message || '')) return 'Run supabase-cyclone-research.sql in Supabase to enable the current media categories, including Research, then try again.';
  if (/owner_estimated_(winds_mph|pressure_mb)/.test(`${error?.message || ''} ${error?.details || ''}`) && /42703|PGRST204/.test(String(error?.code || ''))) return 'Owner estimates are not set up yet. Run supabase-cyclone-estimates.sql in Supabase, then refresh.';
  if (/42P01|PGRST20[025]|PGRST106/.test(String(error?.code || '')) || /schema cache|does not exist|could not find.*(table|function)/i.test(error?.message || '')) return 'Tropical cyclones are not set up yet. Run supabase-tropical-cyclones.sql in Supabase, then refresh.';
  return fallback;
}
export function compareCycloneYear(a, b, sort = 'newest') {
  return (sort === 'oldest' ? a.year - b.year : b.year - a.year)
    || Number(a.year_order || 0) - Number(b.year_order || 0)
    || String(a.id).localeCompare(String(b.id));
}
export async function moveCyclone(client, id, neighborId) {
  const { data, error } = await client.rpc('utwx_move_cyclone', { p_cyclone_id: id, p_neighbor_id: neighborId });
  if (error) throw error;
  if (!Array.isArray(data) || ![id,neighborId].every(key => data.some(row => String(row.id) === String(key)))) throw new Error('The order change was not confirmed. Refresh and try again.');
  return data;
}
export async function loadCyclones(client, admin = false) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let query = client.from('tropical_cyclones').select('*').order('year',{ascending:false}).order('id').range(from, from + 999);
    query = admin ? query.neq('status','rejected') : query.eq('status','approved');
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}
export async function submitCyclone(client, input, requestId = crypto.randomUUID()) {
  const row = validateCyclone(input);
  const args = { p_id: requestId, p_name: row.name, p_year: row.year, p_peak_winds_mph: row.peak_winds_mph, p_lowest_pressure_mb: row.lowest_pressure_mb };
  if(row.eye_temperature_c !== null) args.p_eye_temperature_c = row.eye_temperature_c;
  const { data, error } = await client.rpc('submit_tropical_cyclone', args);
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
  bindCycloneWindInputs(form);
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
