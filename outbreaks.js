const LEGACY_OUTBREAKS_KEY = 'utwx:outbreaks';

export function normalizeOutbreakDates(dates) {
  const values = Array.isArray(dates) ? dates : String(dates || '').split(',');
  return [...new Set(values.map(date => String(date || '').trim()).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
}

export function normalizeOutbreakOrder(order) {
  const values = Array.isArray(order) ? order : String(order || '').split(',');
  return [...new Set(values.map(id => String(id || '').trim()).filter(Boolean))];
}

export function normalizeOutbreak(row) {
  return {
    ...row,
    id: String(row.id),
    name: String(row.name || row.title || '').trim(),
    dates: normalizeOutbreakDates(row.dates || row.outbreak_dates),
    cover_tornado_id: String(row.cover_tornado_id || row.thumbnail_tornado_id || row.coverTornadoId || '').trim(),
    tornado_order: normalizeOutbreakOrder(row.tornado_order || row.tornadoOrder || row.member_order),
    status: row.status || 'pending',
    source: 'remote'
  };
}

function outbreakSubmission(row, user, isAdmin) {
  if (!user?.id) throw new Error('Log in to submit an outbreak for approval.');
  const dates = normalizeOutbreakDates(row.dates);
  if (!dates.length) throw new Error('Choose at least one day for the outbreak.');
  return {
    name: String(row.name || '').trim(),
    dates,
    cover_tornado_id: row.cover_tornado_id || null,
    tornado_order: normalizeOutbreakOrder(row.tornado_order),
    created_by: user.id,
    status: isAdmin ? 'approved' : 'pending'
  };
}

export async function submitSharedOutbreak(client, row, user, isAdmin) {
  const { data, error } = await client.from('outbreaks')
    .insert(outbreakSubmission(row, user, isAdmin)).select('*').single();
  if (error) throw error;
  return normalizeOutbreak(data);
}

export async function loadSharedOutbreaks(client, isAdmin = false) {
  let query = client.from('outbreaks').select('*');
  query = isAdmin ? query.neq('status', 'rejected') : query.eq('status', 'approved');
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(normalizeOutbreak);
}

export async function updateSharedOutbreak(client, id, changes) {
  const { data, error } = await client.from('outbreaks')
    .update(changes).eq('id', id).select('*').single();
  if (error) throw error;
  return normalizeOutbreak(data);
}

// Preserve outbreaks created by the old browser-only fallback and submit them
// through the same approval rules as new outbreaks. Never publish local rows.
export async function migrateLocalOutbreaks(client, user, isAdmin = false) {
  if (!user?.id) return 0;
  let rows;
  try { rows = JSON.parse(localStorage.getItem(LEGACY_OUTBREAKS_KEY) || '[]'); }
  catch { return 0; }
  if (!Array.isArray(rows)) return 0;
  let migrated = 0;
  for (const row of [...rows]) {
    if (row.created_by && row.created_by !== user.id) continue;
    if (!normalizeOutbreakDates(row.dates || row.outbreak_dates).length) continue;
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(row.id || ''))) {
      row.id = crypto.randomUUID();
      localStorage.setItem(LEGACY_OUTBREAKS_KEY, JSON.stringify(rows));
    }
    const submission = outbreakSubmission({
      ...row,
      dates: row.dates || row.outbreak_dates,
      tornado_order: row.tornado_order || row.tornadoOrder || row.member_order
    }, user, isAdmin);
    const { error } = await client.from('outbreaks').upsert({
      ...submission, id: row.id
    }, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
    rows = rows.filter(candidate => candidate !== row);
    localStorage.setItem(LEGACY_OUTBREAKS_KEY, JSON.stringify(rows));
    migrated++;
  }
  return migrated;
}
