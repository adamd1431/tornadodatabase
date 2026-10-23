export const OFFICIAL_CYCLONE_TABLE = 'official_cyclone_top100';
export const OFFICIAL_CYCLONE_SETUP = 'supabase-official-cyclone-top100.sql';
export const CYCLONE_RANK_LIMIT = 100;

export function validateOfficialCycloneRanks(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid official cyclone rankings. Refresh and try again.');
  const entries = Object.entries(value), used = new Set(), ids = new Set();
  if (entries.length > CYCLONE_RANK_LIMIT) throw new Error('The official list can contain at most 100 tropical cyclones.');
  for (const [id, rank] of entries) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      || ids.has(id.toLowerCase()) || !Number.isInteger(rank) || rank < 1 || rank > CYCLONE_RANK_LIMIT || used.has(rank)) {
      throw new Error('Each tropical cyclone must have a unique rank from 1 to 100.');
    }
    used.add(rank);
    ids.add(id.toLowerCase());
  }
  return { ...value };
}

// Move a ranked entry through occupied positions; inserting a new one shifts
// lower entries down, dropping #100 only when the list is already full there.
export function changeOfficialCycloneRank(current, cycloneId, targetRank) {
  const ranks = validateOfficialCycloneRanks(current);
  if (targetRank === null) { delete ranks[cycloneId]; return ranks; }
  if (!Number.isInteger(targetRank) || targetRank < 1 || targetRank > CYCLONE_RANK_LIMIT) throw new Error('Rank must be 1–100.');
  const previous = ranks[cycloneId];
  if (previous === targetRank) return ranks;
  const occupied = Object.values(ranks).includes(targetRank);
  delete ranks[cycloneId];
  if (occupied) {
    for (const [id, rank] of Object.entries(ranks)) {
      if (previous) {
        if (targetRank < previous && rank >= targetRank && rank < previous) ranks[id] = rank + 1;
        else if (targetRank > previous && rank > previous && rank <= targetRank) ranks[id] = rank - 1;
      } else if (rank >= targetRank) {
        if (rank === CYCLONE_RANK_LIMIT) delete ranks[id];
        else ranks[id] = rank + 1;
      }
    }
  }
  ranks[cycloneId] = targetRank;
  return validateOfficialCycloneRanks(ranks);
}

export function officialCycloneError(error) {
  if (/42P01|PGRST20[025]|PGRST106/.test(String(error?.code || ''))) {
    return `The official tropical cyclone ranking needs its database setup. Run ${OFFICIAL_CYCLONE_SETUP} in Supabase, then refresh.`;
  }
  if (error?.code === '40001') return 'This ranking changed in another tab. Refresh the rankings before editing again.';
  return error?.message || 'Could not save the ranking. Your current list is still here; please try again.';
}

export async function loadOfficialCycloneRanks(client) {
  const { data, error } = await client.from(OFFICIAL_CYCLONE_TABLE).select('ranks,updated_at').eq('id', true).maybeSingle();
  if (error) throw error;
  if (!data?.updated_at) throw new Error(`Run ${OFFICIAL_CYCLONE_SETUP} in Supabase, then refresh.`);
  return { ranks: validateOfficialCycloneRanks(data.ranks), updated_at: data.updated_at };
}

export async function loadOfficialCycloneCatalog(client) {
  const rows = [];
  const columns = 'id,name,year,peak_winds_mph,lowest_pressure_mb,owner_estimated_winds_mph,owner_estimated_pressure_mb,cover_image,cover_position,thumbnail_fit,thumbnail_position,thumbnail_zoom';
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from('tropical_cyclones').select(columns)
      .eq('status', 'approved').order('name').order('id').range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

export async function saveOfficialCycloneRanks(client, ranks, version) {
  const expected = validateOfficialCycloneRanks(ranks);
  if (!version) throw new Error('Refresh the rankings before editing.');
  const { data, error } = await client.rpc('utwx_save_official_cyclone_top100', {
    p_ranks: expected, p_expected_updated_at: version
  });
  if (error) throw error;
  const confirmed = validateOfficialCycloneRanks(data?.ranks);
  if (!data?.updated_at || Object.keys(confirmed).length !== Object.keys(expected).length
    || Object.entries(expected).some(([id, rank]) => confirmed[id] !== rank)) {
    throw new Error('The saved ranking was not confirmed. Refresh before editing again.');
  }
  return { ranks: confirmed, updated_at: data.updated_at };
}
