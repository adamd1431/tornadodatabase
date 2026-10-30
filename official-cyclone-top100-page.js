import { supabase } from './supabase.js';
import { cachedPublicMediaUrl } from './media-delivery.js';
import { cycloneUrl, cycloneWindKnots, cyclonePeakBadge, escapeCycloneHtml as esc } from './cyclones.js';
import { cycloneCropStyle } from './cyclone-cropper.js';
import { loadOfficialCycloneTop100, officialCycloneError, ownerWindEstimate } from './official-cyclone-top100.js';

const byId = id => document.getElementById(id);
const grid = byId('grid');
let rows = [], loaded = false, busy = false, lastRendered = '';

function notice(message = '', error = false) {
  const box = byId('rankingNotice');
  box.textContent = message;
  box.dataset.error = String(error);
  box.hidden = !message;
}

function thumbnail(row) {
  try {
    const url = new URL(row.cover_image || '', location.href);
    if (!row.cover_image || !['http:', 'https:'].includes(url.protocol) || /\.(mp4|webm|mov|m4v|ogg)(?:\?|$)/i.test(url.pathname)) throw new Error();
    return `<div class="thumb"><img src="${esc(cachedPublicMediaUrl(url.href))}" style="${esc(cycloneCropStyle(row))}" loading="lazy" decoding="async" draggable="false" alt=""></div>`;
  } catch { return '<div class="thumb-placeholder" aria-hidden="true">🌀</div>'; }
}

function rowCard(row, rank) {
  const color = rank === 1 ? '#eab308' : rank === 2 ? '#cbd5e1' : rank === 3 ? '#f97316' : '#3b82f6';
  const wind = ownerWindEstimate(row), pressure = row.owner_estimated_pressure_mb;
  return `<article class="slot" data-rank="${rank}" data-cyclone-id="${esc(row.id)}">
    <div class="rank" style="color:${color};border-color:${color}33;background:${color}1a">#${rank}</div>
    <a class="cyclone-card-link" href="${esc(cycloneUrl(row))}" draggable="false">${thumbnail(row)}<div class="slot-body">
      <div class="slot-heading"><div class="slot-title-lines"><div class="slot-name">${esc(row.name)}</div><div class="slot-date">${esc(row.year)}</div></div>${cyclonePeakBadge(row.peak_winds_mph)}</div>
      <div class="cyclone-estimates"><span class="slot-estimate ranking-wind">Owner wind: <strong>${esc(wind)} mph · ${esc(cycloneWindKnots(wind))} kt</strong></span>
        ${pressure != null && String(pressure).trim() !== '' ? `<span class="slot-estimate">Owner pressure: <strong>${esc(pressure)} mb</strong></span>` : ''}</div>
      <div class="cyclone-rank-data"><span>Official winds: ${esc(row.peak_winds_mph)} mph · ${esc(cycloneWindKnots(row.peak_winds_mph))} kt</span><span>Official pressure: ${esc(row.lowest_pressure_mb)} mb</span></div>
    </div></a></article>`;
}

function render() {
  byId('rankedCount').textContent = `${rows.length} / 100`;
  const content = rows.map((row, i) => rowCard(row, i + 1)).join('')
    || '<div class="empty-state"><div class="empty-icon">🌀</div><p>No owner wind estimates yet. Approved tropical cyclones appear here automatically once an owner wind estimate is added.</p></div>';
  if (content !== lastRendered) { grid.innerHTML = content; lastRendered = content; }
}

async function load(quiet = false) {
  if (busy || (quiet && document.visibilityState === 'hidden')) return;
  busy = true;
  byId('refreshRankings').disabled = true;
  if (!quiet) notice('Updating rankings…');
  try {
    rows = await loadOfficialCycloneTop100(supabase);
    loaded = true;
    render();
    notice();
  } catch (error) {
    notice(officialCycloneError(error), true);
    if (!loaded) grid.innerHTML = '<div class="empty-state"><p>The official cyclone ranking is unavailable. Please try refreshing.</p></div>';
  } finally {
    busy = false;
    byId('refreshRankings').disabled = false;
  }
}

byId('refreshRankings').addEventListener('click', () => load());
// Returning from an estimate edit refreshes the derived list, including browser
// back/forward cache restores. No extra realtime subscription is needed.
window.addEventListener('focus', () => load(true));
window.addEventListener('pageshow', event => { if (event.persisted) load(true); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(true); });
load();
