export const CYCLONE_RANK_LIMIT = 100;

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
      || String(a.id).localeCompare(String(b.id)))
    .slice(0, CYCLONE_RANK_LIMIT);
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

export async function loadOfficialCycloneTop100(client) {
  const columns = 'id,status,name,year,peak_winds_mph,lowest_pressure_mb,owner_estimated_winds_mph,owner_estimated_pressure_mb,cover_image,cover_position,thumbnail_fit,thumbnail_position,thumbnail_zoom';
  const { data, error } = await client.from('tropical_cyclones').select(columns)
    .eq('status', 'approved')
    .gte('owner_estimated_winds_mph', 0).lte('owner_estimated_winds_mph', 500)
    .order('owner_estimated_winds_mph', { ascending: false })
    .order('id', { ascending: true }).limit(CYCLONE_RANK_LIMIT);
  if (error) throw error;
  return rankOfficialCyclones(data || []);
}
