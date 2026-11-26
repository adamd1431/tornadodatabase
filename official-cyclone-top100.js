const CYCLONE_PAGE_SIZE = 500;

export function ownerWindEstimate(row) {
  const raw = row?.owner_estimated_winds_mph;
  if (!['number', 'string'].includes(typeof raw) || String(raw).trim() === '') return null;
  const wind = Number(raw);
  return Number.isFinite(wind) && wind >= 0 && wind <= 500 ? wind : null;
}

// Compare stored mph estimates before display rounding. UUID order keeps ties
// stable and matches the database's secondary sort.
export function rankOfficialCyclones(rows) {
  return rows.filter(row => row.status === 'approved' && ownerWindEstimate(row) !== null)
    .slice().sort((a, b) => ownerWindEstimate(b) - ownerWindEstimate(a)
      || String(a.id).localeCompare(String(b.id)));
}

export function officialCycloneError(error) {
  const detail = `${error?.message || ''} ${error?.details || ''}`;
  if (/owner_estimated_(winds_mph|pressure_mb)/.test(detail) && /42703|PGRST20[24]/.test(String(error?.code || ''))) {
    return 'Owner estimates are not set up yet. Run supabase-cyclone-estimates.sql in Supabase, then refresh.';
  }
  if (/42P01|PGRST20[025]|PGRST106/.test(String(error?.code || ''))) {
    return 'Tropical cyclones are not set up yet. Run supabase-tropical-cyclones.sql in Supabase, then refresh.';
  }
  return error?.message || 'Could not load the ranking. Please try refreshing.';
}

export async function loadOfficialCycloneRankings(client) {
  const columns = 'id,status,name,year,year_end,peak_winds_mph,lowest_pressure_mb,peak_winds_mph_text,peak_winds_kts_text,lowest_pressure_mb_text,owner_estimated_winds_mph,owner_estimated_pressure_mb,owner_estimated_winds_mph_text,owner_estimated_pressure_mb_text,cover_image,cover_position,thumbnail_fit,thumbnail_position,thumbnail_zoom';
  const rows = new Map();
  // Explicit pages also avoid the backend's default row limit. Keep the same
  // stable order on every page; publish a complete list only after all succeed.
  for (let from = 0; ; from += CYCLONE_PAGE_SIZE) {
    const { data, error } = await client.from('tropical_cyclones').select(columns)
      .eq('status', 'approved')
      .gte('owner_estimated_winds_mph', 0).lte('owner_estimated_winds_mph', 500)
      .order('owner_estimated_winds_mph', { ascending: false })
      .order('id', { ascending: true }).range(from, from + CYCLONE_PAGE_SIZE - 1);
    if (error) throw error;
    for (const row of data || []) rows.set(row.id, row);
    if (!data || data.length < CYCLONE_PAGE_SIZE) break;
  }
  return rankOfficialCyclones([...rows.values()]);
}

// Keep existing imports/bookmarks compatible with the former Top 100 page.
export const loadOfficialCycloneTop100 = loadOfficialCycloneRankings;
