const LEGACY_OUTBREAKS_KEY = 'utwx:outbreaks';

export function outbreakErrorMessage(error, fallback = 'Could not load outbreaks. Please try again.') {
  if (['42P01','42703','PGRST204','PGRST205'].includes(String(error?.code || ''))) {
    return 'Outbreaks are not set up yet. Run supabase-outbreaks.sql in the Supabase SQL Editor, then try again.';
  }
  return fallback;
}

export function isOutbreakDate(value) {
  const date = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000')) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export function normalizeOutbreakDates(dates) {
  const values = Array.isArray(dates) ? dates : String(dates || '').split(',');
  return [...new Set(values.map(date => String(date || '').trim()).filter(isOutbreakDate))].sort();
}

function validatedDates(dates) {
  const values = Array.isArray(dates) ? dates : String(dates || '').split(',');
  if (values.some(date => !isOutbreakDate(String(date || '').trim()))) throw new Error('Choose a valid calendar day.');
  const normalized = normalizeOutbreakDates(values);
  if (!normalized.length) throw new Error('Choose at least one day for the outbreak.');
  return normalized;
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
  const dates = validatedDates(row.dates);
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
  if (!data?.id) throw new Error('The server did not confirm this outbreak submission.');
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
  const { data: session, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!session?.user) throw new Error('Sign in as the owner to edit outbreaks.');
  const permission = await client.rpc('utwx_is_owner', { check_user_id: session.user.id });
  if (permission.error) throw permission.error;
  if (permission.data !== true) throw new Error('Only the owner can edit outbreaks.');
  const allowed = ['name', 'dates', 'cover_tornado_id', 'tornado_order'];
  if (!changes || !Object.keys(changes).length || Object.keys(changes).some(key => !allowed.includes(key))) {
    throw new Error('Choose outbreak information to update.');
  }
  const payload = { ...changes };
  if ('name' in payload) {
    payload.name = String(payload.name || '').trim();
    if (!payload.name) throw new Error('Enter an outbreak name.');
  }
  if ('dates' in payload) payload.dates = validatedDates(payload.dates);
  if ('tornado_order' in payload) payload.tornado_order = normalizeOutbreakOrder(payload.tornado_order);
  const { data, error } = await client.from('outbreaks')
    .update(payload).eq('id', id).select('*').single();
  if (error) throw error;
  if (!data?.id || String(data.id) !== String(id)) throw new Error('The server did not confirm this outbreak change. Your edits have not been cleared.');
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
