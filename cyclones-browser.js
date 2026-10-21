import { openCycloneCropper } from './cyclone-cropper.js';
import { cyclonePeak, cyclonePeakBadge, cycloneWindKnots, cycloneEyeTemperature, cycloneEstimateStats, loadCyclones, openCycloneForm, cycloneUrl, escapeCycloneHtml as esc, cycloneError, compareCycloneYear, moveCyclone } from './cyclones.js';

export function mountCycloneBrowser(client, container, options = {}) {
  let rows = [], visible = [], loaded = false, loading = false, moving = false, request = 0;
  container.className = 'cyclone-browser';
  container.innerHTML = `<div class="search-wrap"><div class="search-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m16 16 5 5"/></svg></div><input class="searchBar" id="cycloneSearch" aria-label="Search tropical cyclones" placeholder="Search by name, year, peak winds, or pressure…"></div><div class="cyclone-filters"><select id="cycloneYearFilter" aria-label="Cyclone year"><option value="">All years</option></select><select id="cycloneSortFilter" aria-label="Sort tropical cyclones"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="strongest">Highest peak winds</option><option value="weakest">Lowest peak winds</option><option value="highest-pressure">Highest pressure</option><option value="pressure">Lowest pressure</option><option value="name">Name A–Z</option></select></div><p id="cycloneBrowserStatus" class="cyclone-status" role="status" aria-live="polite"></p><div class="results-meta"><span class="results-count" id="cycloneResultsCount"></span></div><div id="cycloneList"></div>`;
  const get = id => container.querySelector('#'+id), list = get('cycloneList'), year = get('cycloneYearFilter');
  let saved = {};
  try { saved = JSON.parse(sessionStorage.getItem('utwx:cycloneBrowseFilters') || '{}') || {}; } catch {}
  get('cycloneSearch').value = saved.search || '';
  if([...get('cycloneSortFilter').options].some(option=>option.value === saved.sort)) get('cycloneSortFilter').value = saved.sort;
  function saveFilters() {
    saved = {search:get('cycloneSearch').value, year:year.value, sort:get('cycloneSortFilter').value};
    try { sessionStorage.setItem('utwx:cycloneBrowseFilters',JSON.stringify(saved)); } catch {}
    render();
  }
  function orderControls(row, index, sort) {
    if (!options.isOwner?.() || !['newest','oldest'].includes(sort)) return '';
    const canMove = direction => visible[index + direction]?.year === row.year;
    if (!canMove(-1) && !canMove(1)) return '';
    return `<div class="cyclone-order-controls" role="group" aria-label="Change same-year order for ${esc(row.name)}"><span>Same-year order</span>${[-1,1].map(direction => `<button class="cyclone-order-btn" type="button" data-cyclone-order="${direction}" aria-label="Move ${esc(row.name)} ${direction === -1 ? 'up' : 'down'} within ${esc(row.year)}" title="Move ${direction === -1 ? 'up' : 'down'} within ${esc(row.year)}" ${moving || !canMove(direction) ? 'disabled' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="${direction === -1 ? 'M12 19V5m-7 7 7-7 7 7' : 'M12 5v14m7-7-7 7-7-7'}"/></svg></button>`).join('')}</div>`;
  }
  function render() {
    if(!loaded) return;
    const terms = get('cycloneSearch').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    visible = rows.filter(row => (!year.value || String(row.year) === year.value) && terms.every(term => `${row.name} ${row.year} ${row.peak_winds_mph} ${cycloneWindKnots(row.peak_winds_mph)} ${row.lowest_pressure_mb} ${cycloneEyeTemperature(row)}`.toLowerCase().includes(term)));
    const sort = get('cycloneSortFilter').value;
    visible.sort((a,b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'highest-pressure' ? b.lowest_pressure_mb-a.lowest_pressure_mb : sort === 'pressure' ? a.lowest_pressure_mb-b.lowest_pressure_mb : sort === 'strongest' ? b.peak_winds_mph-a.peak_winds_mph : sort === 'weakest' ? a.peak_winds_mph-b.peak_winds_mph : compareCycloneYear(a,b,sort));
    get('cycloneResultsCount').innerHTML = `Showing <strong>${visible.length}</strong> of ${rows.length} tropical cyclones`;
    list.innerHTML = visible.length ? visible.map((row,index) => { const peak = cyclonePeak(row.peak_winds_mph); return `<article class="tornado-card" data-cyclone-id="${esc(row.id)}" style="color:inherit;text-decoration:none"><a class="cyclone-card-link" href="${esc(cycloneUrl(row))}" aria-label="Open ${esc(row.name)} (${esc(row.year)})"></a><div class="card-accent" style="background:${peak.color}"></div><div class="card-body"><div class="card-top"><div class="card-name">${esc(row.name)}${row.status !== 'approved' ? '<span class="cyclone-submission-state">Pending</span>' : ''}</div>${cyclonePeakBadge(row.peak_winds_mph)}</div><div class="card-meta"><span class="meta-item">${esc(row.year)}</span><span class="meta-item">Official peak winds: ${esc(row.peak_winds_mph)} mph (${esc(cycloneWindKnots(row.peak_winds_mph))} kts)</span><span class="meta-item">Official lowest pressure: ${esc(row.lowest_pressure_mb)} mb</span>${cycloneEyeTemperature(row) !== '' ? `<span class="meta-item">Infrared eye temperature: ${esc(cycloneEyeTemperature(row))} °C</span>` : ''}</div>${cycloneEstimateStats(row)}${orderControls(row,index,sort)}${options.isAdmin?.() && row.cover_image ? `<button class="btn cyclone-mobile-adjust" type="button" data-adjust-cyclone="${esc(row.id)}">Adjust thumbnail</button>` : ''}</div><div class="card-image-wrap${options.isAdmin?.() && row.cover_image ? ' is-admin-adjustable' : ''}">${options.isAdmin?.() && row.cover_image ? `<button class="cyclone-thumbnail-adjust" type="button" data-adjust-cyclone="${esc(row.id)}" aria-label="Adjust ${esc(row.name)} thumbnail" title="Adjust thumbnail"></button>` : ''}${options.renderCover?.(row) || '<div class="card-image-placeholder">◉</div>'}</div><div class="card-arrow" aria-hidden="true">›</div></article>`; }).join('') : `<div class="empty-state"><div class="empty-icon">◉</div><p>${rows.length ? 'No tropical cyclones match your filters.' : 'No approved tropical cyclones yet.'}</p></div>`;
  }
  async function refresh(force = false) {
    if ((loaded && !force) || loading) return;
    loading = true; const run = ++request;
    list.innerHTML = '<div class="loading-state">Loading tropical cyclones…</div>';
    try {
      const admin = !!options.isAdmin?.();
      let countQuery = client.from('cyclone_uploads').select('id,tropical_cyclones!inner(status)', { count: 'exact', head: true }).eq('status', 'approved');
      countQuery = admin ? countQuery.neq('tropical_cyclones.status', 'rejected') : countQuery.eq('tropical_cyclones.status', 'approved');
      const [data, countResult] = await Promise.all([loadCyclones(client,admin), countQuery]);
      if(run !== request) return;
      rows = data; loaded = true;
      options.onCounts?.({ records: rows.length, uploads: countResult.error ? null : countResult.count });
      if (countResult.error) console.warn('Could not load cyclone upload count:', countResult.error);
      const selected = year.value || saved.year || '';
      year.innerHTML = '<option value="">All years</option>' + [...new Set(rows.map(row=>row.year))].sort((a,b)=>b-a).map(value=>`<option>${esc(value)}</option>`).join('');
      if([...year.options].some(option=>option.value === selected)) year.value = selected;
      render();
    } catch(error) { if(run !== request) return; options.onCounts?.({ records: null, uploads: null }); list.innerHTML = `<div class="empty-state"><p>${esc(cycloneError(error,'Could not load tropical cyclones. Please try again.'))}</p><button class="btn" type="button" data-retry>Try again</button></div>`; }
    finally { if(run === request) loading = false; }
  }
  get('cycloneSearch').addEventListener('input',saveFilters);
  year.addEventListener('change',saveFilters);
  get('cycloneSortFilter').addEventListener('change',saveFilters);
  container.addEventListener('click',async event=>{
    const order = event.target.closest('[data-cyclone-order]');
    if (order) {
      event.preventDefault(); event.stopPropagation();
      if (!options.isOwner?.() || moving || order.disabled || !['newest','oldest'].includes(get('cycloneSortFilter').value)) return;
      const id = order.closest('[data-cyclone-id]')?.dataset.cycloneId;
      const index = visible.findIndex(row => String(row.id) === id), direction = Number(order.dataset.cycloneOrder);
      const row = visible[index], neighbor = visible[index + direction];
      if (!row || !neighbor || row.year !== neighbor.year) return;
      const run = request;
      moving = true; get('cycloneBrowserStatus').textContent = 'Saving order…'; render();
      try {
        const updates = await moveCyclone(client,row.id,neighbor.id);
        if (run !== request) return;
        const positions = new Map(updates.map(item => [String(item.id),item.year_order]));
        rows = rows.map(item => positions.has(String(item.id)) ? {...item,year_order:positions.get(String(item.id))} : item);
        get('cycloneBrowserStatus').textContent = 'Order saved for everyone.';
      } catch (error) {
        if (run === request) get('cycloneBrowserStatus').textContent = cycloneError(error,error.message || 'Could not save order. Please try again.');
      } finally {
        moving = false;
        if (run === request) {
          render();
          const card = [...list.querySelectorAll('[data-cyclone-id]')].find(item => item.dataset.cycloneId === id);
          const focus = card?.querySelector(`[data-cyclone-order="${direction}"]:not(:disabled)`) || card?.querySelector('[data-cyclone-order]:not(:disabled)') || card?.querySelector('.cyclone-card-link');
          focus?.focus({preventScroll:true});
        }
      }
      return;
    }
    const adjust = event.target.closest('[data-adjust-cyclone]');
    if(adjust && options.isAdmin?.()) {
      event.preventDefault(); event.stopPropagation();
      const row = rows.find(item=>String(item.id)===adjust.dataset.adjustCyclone);
      if(!row) return;
      const saved = await openCycloneCropper(client,row,{source:adjust.closest('.card-image-wrap')});
      if(saved) {
        rows=rows.map(item=>item.id===saved.id ? saved : item);render();
        [...list.querySelectorAll(`[data-adjust-cyclone="${saved.id}"]`)].find(control=>control.getClientRects().length)?.focus({preventScroll:true});
        get('cycloneBrowserStatus').textContent='Thumbnail updated.';
      }
      return;
    }
    if(event.target.closest('[data-retry]')) refresh(true);
    const card = event.target.closest('[data-cyclone-id]');
    if(card) options.onNavigate?.(card.dataset.cycloneId);
  });
  return { refresh, render, invalidate() { loaded = false; loading = false; rows = []; request++; options.onCounts?.({ records: null, uploads: null }); }, openForm() {
    openCycloneForm(client,async result=>{
      get('cycloneBrowserStatus').textContent = result.status === 'approved' ? 'Tropical cyclone added.' : 'Submitted for review! It will appear here after admin approval.';
      await refresh(true);
    });
  }};
}
