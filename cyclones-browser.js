import { cyclonePeak, cyclonePeakBadge, cycloneEstimateStats, loadCyclones, openCycloneForm, cycloneUrl, escapeCycloneHtml as esc, cycloneError } from './cyclones.js';

export function mountCycloneBrowser(client, container, options = {}) {
  let rows = [], loaded = false, loading = false, request = 0;
  container.className = 'cyclone-browser';
  container.innerHTML = `<div class="search-wrap"><div class="search-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m16 16 5 5"/></svg></div><input class="searchBar" id="cycloneSearch" aria-label="Search tropical cyclones" placeholder="Search by name, year, peak winds, or pressure…"></div><div class="cyclone-filters"><select id="cycloneYearFilter" aria-label="Cyclone year"><option value="">All years</option></select><select id="cycloneSortFilter" aria-label="Sort tropical cyclones"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="strongest">Highest peak winds</option><option value="weakest">Lowest peak winds</option><option value="pressure">Lowest pressure</option><option value="name">Name A–Z</option></select></div><p id="cycloneBrowserStatus" class="cyclone-status" role="status" aria-live="polite"></p><div class="results-meta"><span class="results-count" id="cycloneResultsCount"></span></div><div id="cycloneList"></div>`;
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
  function render() {
    if(!loaded) return;
    const terms = get('cycloneSearch').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const visible = rows.filter(row => (!year.value || String(row.year) === year.value) && terms.every(term => `${row.name} ${row.year} ${row.peak_winds_mph} ${row.lowest_pressure_mb}`.toLowerCase().includes(term)));
    const sort = get('cycloneSortFilter').value;
    visible.sort((a,b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'pressure' ? a.lowest_pressure_mb-b.lowest_pressure_mb : sort === 'strongest' ? b.peak_winds_mph-a.peak_winds_mph : sort === 'weakest' ? a.peak_winds_mph-b.peak_winds_mph : sort === 'oldest' ? a.year-b.year : b.year-a.year);
    get('cycloneResultsCount').innerHTML = `Showing <strong>${visible.length}</strong> of ${rows.length} tropical cyclones`;
    list.innerHTML = visible.length ? visible.map(row => { const peak = cyclonePeak(row.peak_winds_mph); return `<a class="tornado-card" href="${esc(cycloneUrl(row))}" data-cyclone-id="${esc(row.id)}" style="color:inherit;text-decoration:none"><div class="card-accent" style="background:${peak.color}"></div><div class="card-body"><div class="card-top"><div class="card-name">${esc(row.name)}${row.status !== 'approved' ? '<span class="cyclone-submission-state">Pending</span>' : ''}</div>${cyclonePeakBadge(row.peak_winds_mph)}</div><div class="card-meta"><span class="meta-item">${esc(row.year)}</span><span class="meta-item">Official peak winds: ${esc(row.peak_winds_mph)} mph</span><span class="meta-item">Official lowest pressure: ${esc(row.lowest_pressure_mb)} mb</span></div>${cycloneEstimateStats(row)}</div><div class="card-image-wrap">${options.renderCover?.(row) || '<div class="card-image-placeholder">◉</div>'}</div><div class="card-arrow">›</div></a>`; }).join('') : `<div class="empty-state"><div class="empty-icon">◉</div><p>${rows.length ? 'No tropical cyclones match your filters.' : 'No approved tropical cyclones yet.'}</p></div>`;
  }
  async function refresh(force = false) {
    if ((loaded && !force) || loading) return;
    loading = true; const run = ++request;
    list.innerHTML = '<div class="loading-state">Loading tropical cyclones…</div>';
    try {
      const data = await loadCyclones(client,!!options.isAdmin?.());
      if(run !== request) return;
      rows = data; loaded = true;
      const selected = year.value || saved.year || '';
      year.innerHTML = '<option value="">All years</option>' + [...new Set(rows.map(row=>row.year))].sort((a,b)=>b-a).map(value=>`<option>${esc(value)}</option>`).join('');
      if([...year.options].some(option=>option.value === selected)) year.value = selected;
      render();
    } catch(error) { list.innerHTML = `<div class="empty-state"><p>${esc(cycloneError(error,'Could not load tropical cyclones. Please try again.'))}</p><button class="btn" type="button" data-retry>Try again</button></div>`; }
    finally { if(run === request) loading = false; }
  }
  get('cycloneSearch').addEventListener('input',saveFilters);
  year.addEventListener('change',saveFilters);
  get('cycloneSortFilter').addEventListener('change',saveFilters);
  container.addEventListener('click',event=>{
    if(event.target.closest('[data-retry]')) refresh(true);
    const card = event.target.closest('[data-cyclone-id]');
    if(card) options.onNavigate?.(card.dataset.cycloneId);
  });
  return { refresh, render, invalidate() { loaded = false; loading = false; rows = []; request++; }, openForm() {
    openCycloneForm(client,async result=>{
      get('cycloneBrowserStatus').textContent = result.status === 'approved' ? 'Tropical cyclone added.' : 'Submitted for review! It will appear here after admin approval.';
      await refresh(true);
    });
  }};
}
