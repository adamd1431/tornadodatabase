import { supabase } from './supabase.js';
import { cycloneUrl, cycloneWindKnots, cyclonePeakBadge, escapeCycloneHtml as esc } from './cyclones.js';
import { cycloneCropStyle } from './cyclone-cropper.js';
import { changeOfficialCycloneRank, loadOfficialCycloneRanks, loadOfficialCycloneCatalog, saveOfficialCycloneRanks, officialCycloneError } from './official-cyclone-top100.js';

const byId = id => document.getElementById(id);
const grid = byId('grid'), editor = byId('cycloneRankEditor'), form = byId('cycloneRankForm');
const search = byId('cycloneRankSearch'), choices = byId('cycloneRankChoices'), target = byId('cycloneTargetRank');
let catalog = [], snapshot = null, owner = false, busy = false, selectedId = null, loadSequence = 0;
let compact = false;
try { compact = localStorage.getItem('utwx:officialCycloneTop100Compact') === '1'; } catch {}

function notice(message = '', error = false) {
  const box = byId('rankingNotice');
  box.textContent = message;
  box.dataset.error = String(error);
  box.hidden = !message;
}

function visibleRanks() {
  const approved = new Set(catalog.map(row => row.id));
  return Object.fromEntries(Object.entries(snapshot?.ranks || {}).filter(([id]) => approved.has(id)));
}

function nextOpen(ranks = visibleRanks()) {
  const used = new Set(Object.values(ranks));
  for (let rank = 1; rank <= 100; rank++) if (!used.has(rank)) return rank;
  return null;
}

function candidates() {
  const terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return catalog.filter(row => terms.every(term => `${row.name} ${row.year}`.toLowerCase().includes(term))).slice(0, 25);
}

function closeChoices() {
  choices.hidden = true;
  search.setAttribute('aria-expanded', 'false');
}

function showChoices() {
  if (!owner || busy) return;
  const ranks = visibleRanks();
  choices.innerHTML = candidates().map(row => `<button type="button" class="result-item" data-cyclone-id="${esc(row.id)}">${esc(row.name)} · ${esc(row.year)}${ranks[row.id] ? ` · #${ranks[row.id]}` : ''}</button>`).join('')
    || '<div class="result-item">No matching tropical cyclones.</div>';
  choices.hidden = false;
  search.setAttribute('aria-expanded', 'true');
}

function thumbnail(row) {
  try {
    const url = new URL(row.cover_image || '', location.href);
    if (!row.cover_image || !['http:', 'https:'].includes(url.protocol) || /\.(mp4|webm|mov|m4v|ogg)(?:\?|$)/i.test(url.pathname)) throw new Error();
    if (url.pathname.includes('/storage/v1/object/public/') && /\.(png|jpe?g|webp)$/i.test(url.pathname)) {
      url.pathname = url.pathname.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
      url.searchParams.set('width', '320');
      url.searchParams.set('quality', '75');
    }
    return `<div class="thumb"><img src="${esc(url.href)}" style="${esc(cycloneCropStyle(row))}" loading="lazy" decoding="async" draggable="false" alt=""></div>`;
  } catch { return '<div class="thumb-placeholder" aria-hidden="true">🌀</div>'; }
}

function rowCard(row, rank) {
  const color = rank === 1 ? '#eab308' : rank === 2 ? '#cbd5e1' : rank === 3 ? '#f97316' : '#3b82f6';
  const badge = `<div class="rank" style="color:${color};border-color:${color}33;background:${color}1a">#${rank}</div>`;
  if (!row) return `<div class="slot${compact ? ' compact' : ''}" data-rank="${rank}">${badge}<span class="empty-slot-label">Open spot</span><button class="btn btn-sm" type="button" data-rank-action="assign" data-rank="${rank}" ${busy ? 'disabled' : ''}>Assign cyclone</button></div>`;
  const estimates = [
    ['owner_estimated_winds_mph', 'Wind', 'mph'], ['owner_estimated_pressure_mb', 'Pressure', 'mb']
  ].filter(([key]) => row[key] != null && String(row[key]).trim() !== '')
    .map(([key, label, unit]) => `<span class="slot-estimate">Owner ${label.toLowerCase()}: <strong>${esc(row[key])} ${unit}</strong></span>`).join('');
  return `<article class="slot${compact ? ' compact' : ''}" data-rank="${rank}" data-cyclone-id="${esc(row.id)}" draggable="${owner && !busy}">
    ${badge}<a class="cyclone-card-link" href="${esc(cycloneUrl(row))}" draggable="false">${thumbnail(row)}<div class="slot-body">
      <div class="slot-heading"><div class="slot-title-lines"><div class="slot-name">${esc(row.name)}</div><div class="slot-date">${esc(row.year)}</div></div>${cyclonePeakBadge(row.peak_winds_mph)}</div>
      <div class="cyclone-rank-data"><span>Official winds: ${esc(row.peak_winds_mph)} mph · ${esc(cycloneWindKnots(row.peak_winds_mph))} kt</span><span>Official pressure: ${esc(row.lowest_pressure_mb)} mb</span></div>
      ${estimates ? `<div class="cyclone-estimates">${estimates}</div>` : ''}
    </div></a>${owner ? `<div class="slot-actions">
      <button class="btn btn-sm" type="button" data-rank-action="up" aria-label="Move ${esc(row.name)} up" ${busy || rank === 1 ? 'disabled' : ''}>↑</button>
      <button class="btn btn-sm" type="button" data-rank-action="down" aria-label="Move ${esc(row.name)} down" ${busy || rank === 100 ? 'disabled' : ''}>↓</button>
      <button class="btn btn-sm" type="button" data-rank-action="remove" aria-label="Remove ${esc(row.name)} from ranking" ${busy ? 'disabled' : ''}>×</button>
    </div>` : ''}</article>`;
}

function render() {
  const ranks = visibleRanks(), byRank = new Map(catalog.filter(row => ranks[row.id]).map(row => [ranks[row.id], row]));
  byId('ownerBadge').hidden = !owner;
  editor.hidden = !owner || !snapshot;
  byId('refreshRankings').disabled = busy;
  editor.querySelectorAll('input,button').forEach(el => { el.disabled = busy; });
  byId('compactRanks').textContent = compact ? 'Full cards' : 'Compact table';
  const next = nextOpen(ranks);
  target.placeholder = next ? `Next #${next}` : 'Choose rank';
  byId('cycloneRankHint').textContent = next ? `Next open spot is #${next}.` : 'All 100 spots are filled. Inserting a new cyclone shifts lower ranks down and removes #100.';
  if (!snapshot) return;
  byId('rankedCount').textContent = `${byRank.size} / 100`;
  grid.innerHTML = owner
    ? Array.from({ length: 100 }, (_, i) => rowCard(byRank.get(i + 1), i + 1)).join('')
    : [...byRank.entries()].sort(([a], [b]) => a - b).map(([rank, row]) => rowCard(row, rank)).join('')
      || '<div class="empty-state"><div class="empty-icon">🌀</div><p>No tropical cyclones ranked yet.</p></div>';
}

async function loadOwner() {
  try {
    const { data } = await supabase.auth.getUser();
    if (!data?.user) return false;
    const result = await supabase.rpc('utwx_can_edit_official_cyclone_top100');
    return !result.error && result.data === true;
  } catch { return false; }
}

async function load() {
  if (busy) return;
  const sequence = ++loadSequence;
  busy = true;
  render();
  notice('Loading cyclone rankings…');
  try {
    const [rows, saved, canEdit] = await Promise.all([loadOfficialCycloneCatalog(supabase), loadOfficialCycloneRanks(supabase), loadOwner()]);
    if (sequence !== loadSequence) return;
    catalog = rows;
    snapshot = saved;
    owner = canEdit;
    notice();
  } catch (error) {
    if (sequence !== loadSequence) return;
    notice(officialCycloneError(error), true);
    if (!snapshot) grid.innerHTML = '<div class="empty-state"><p>The official cyclone ranking is unavailable. Please try refreshing.</p></div>';
  } finally {
    if (sequence === loadSequence) { busy = false; render(); }
  }
}

async function assign(cycloneId, rank) {
  if (!owner || busy || !snapshot || !catalog.some(row => row.id === cycloneId)) return;
  let next;
  try { next = changeOfficialCycloneRank(visibleRanks(), cycloneId, rank); }
  catch (error) { notice(error.message, true); return; }
  if (JSON.stringify(next) === JSON.stringify(visibleRanks())) return;
  busy = true;
  const sequence = loadSequence;
  closeChoices();
  render();
  notice('Saving rankings…');
  try {
    const saved = await saveOfficialCycloneRanks(supabase, next, snapshot.updated_at);
    if (sequence !== loadSequence) return;
    snapshot = saved;
    selectedId = null;
    search.value = '';
    target.value = '';
    notice('Rankings saved.');
  } catch (error) { if (sequence === loadSequence) notice(officialCycloneError(error), true); }
  finally { if (sequence === loadSequence) { busy = false; render(); } }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  if (!owner || busy) return;
  const row = catalog.find(item => item.id === selectedId) || (search.value.trim() ? candidates()[0] : null);
  if (!row) { notice('Search for a tropical cyclone first.', true); search.focus(); showChoices(); return; }
  const rank = target.value.trim() ? Number(target.value) : nextOpen();
  if (rank === null) { notice('All 100 spots are filled. Choose a rank to insert this cyclone.', true); target.focus(); return; }
  assign(row.id, rank);
});
search.addEventListener('input', () => { selectedId = null; showChoices(); });
search.addEventListener('focus', showChoices);
search.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeChoices();
  if (event.key === 'ArrowDown' && !choices.hidden) { event.preventDefault(); choices.querySelector('button')?.focus(); }
});
choices.addEventListener('click', event => {
  const button = event.target.closest('button[data-cyclone-id]');
  const row = catalog.find(item => item.id === button?.dataset.cycloneId);
  if (!row || busy) return;
  selectedId = row.id;
  search.value = `${row.name} ${row.year}`;
  closeChoices();
  target.focus();
});
document.addEventListener('click', event => { if (!form.contains(event.target)) closeChoices(); });
grid.addEventListener('click', event => {
  const button = event.target.closest('button[data-rank-action]');
  if (!button || busy || !owner) return;
  const slot = button.closest('.slot'), rank = Number(slot.dataset.rank), action = button.dataset.rankAction;
  if (action === 'assign') { target.value = String(rank); search.focus(); editor.scrollIntoView({ block: 'center' }); return; }
  assign(slot.dataset.cycloneId, action === 'remove' ? null : rank + (action === 'up' ? -1 : 1));
});
grid.addEventListener('dragstart', event => {
  const slot = event.target.closest('.slot[data-cyclone-id]');
  if (!owner || busy || !slot) { event.preventDefault(); return; }
  event.dataTransfer.setData('text/plain', slot.dataset.cycloneId);
  event.dataTransfer.effectAllowed = 'move';
  slot.classList.add('dragging');
});
grid.addEventListener('dragover', event => {
  if (!owner || busy) return;
  const slot = event.target.closest('.slot');
  if (slot) { event.preventDefault(); slot.classList.add('drop-target'); }
});
grid.addEventListener('dragleave', event => event.target.closest('.slot')?.classList.remove('drop-target'));
grid.addEventListener('dragend', () => grid.querySelectorAll('.dragging,.drop-target').forEach(el => el.classList.remove('dragging', 'drop-target')));
grid.addEventListener('drop', event => {
  event.preventDefault();
  const slot = event.target.closest('.slot');
  grid.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
  if (slot) assign(event.dataTransfer.getData('text/plain'), Number(slot.dataset.rank));
});
byId('refreshRankings').addEventListener('click', load);
byId('compactRanks').addEventListener('click', () => {
  compact = !compact;
  try { localStorage.setItem('utwx:officialCycloneTop100Compact', compact ? '1' : '0'); } catch {}
  render();
});
supabase.auth.onAuthStateChange(event => {
  if (!['SIGNED_OUT', 'SIGNED_IN', 'USER_UPDATED'].includes(event)) return;
  ++loadSequence;
  busy = false;
  owner = false;
  closeChoices();
  render();
  setTimeout(load, 0);
});
load();
