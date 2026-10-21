import { cyclonePeak, loadCyclones } from './cyclones.js';

// Lists created before list types were introduced contain tornado IDs.
export function rankedListType(list) {
  return list?.list_type === 'cyclones' ? 'cyclones' : 'tornadoes';
}

export function rankedListLabel(list, plural = true) {
  return rankedListType(list) === 'cyclones'
    ? (plural ? 'tropical cyclones' : 'tropical cyclone')
    : (plural ? 'tornadoes' : 'tornado');
}

export function rankedListSearchText(row, list) {
  return (rankedListType(list) === 'cyclones'
    ? `${row.name || ''} ${row.year || ''} ${row.peak_winds_mph || ''} ${row.lowest_pressure_mb || ''}`
    : `${row.name || ''} ${row.states || ''} ${row.date || ''}`).toLowerCase();
}

export function rankedGeneratorRecord(row, list) {
  if (rankedListType(list) !== 'cyclones') return row;
  return { ...row, _recordType: 'cyclones', date: String(row.year || ''), states: [], intensity: cyclonePeak(row.peak_winds_mph).label };
}

export async function loadRankedListCatalog(client, list) {
  if (rankedListType(list) === 'cyclones') return loadCyclones(client);
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from('tornadoes').select('*').eq('status', 'approved').order('id').range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}
