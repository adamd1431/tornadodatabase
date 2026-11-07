import { cycloneSlug, cycloneUrl } from './cyclones.js';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const slugKey = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function cycloneUrlKey(location) {
  const query = new URLSearchParams(location.search || '').get('id');
  if (query) return query.trim();
  const match = String(location.pathname || '').match(/^\/tropical-cyclone\.html\/([^/]+)\/?$/i);
  if (!match) return '';
  try { return decodeURIComponent(match[1]).trim(); } catch { return ''; }
}

async function byId(client, id) {
  const { data, error } = await client.from('tropical_cyclones').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function resolveCycloneUrlKey(client, key, { readCatalog, includePending = false } = {}) {
  const clean = String(key || '').trim();
  if (uuid.test(clean)) return byId(client, clean);
  if (clean.length > 240 || !slugKey.test(clean)) return null;
  const year = clean.match(/-(\d{1,4})$/)?.[1];
  if (!year || Number(year) < 1) return null;
  if (readCatalog) {
    let rows;
    try { rows = await readCatalog(); } catch {}
    const matches = (Array.isArray(rows) ? rows : []).filter(row => row.status === 'approved' && cycloneSlug(row) === clean);
    if (matches.length === 1 && uuid.test(matches[0].id)) {
      const row = await byId(client, matches[0].id);
      if (row) return row;
    }
  }
  // Fresh metadata also covers newly approved/renamed cyclones and permitted
  // private submissions. The final record read still uses the database's RLS.
  const matches = [];
  for (let from = 0; ; from += 1000) {
    let query = client.from('tropical_cyclones').select('id,name,year,status').eq('year', Number(year)).order('id').range(from, from + 999);
    query = includePending ? query.neq('status', 'rejected') : query.eq('status', 'approved');
    const { data, error } = await query;
    if (error) throw error;
    for (const row of data || []) if (cycloneSlug(row) === clean) matches.push(row);
    if (!data || data.length < 1000) break;
  }
  // Never silently open a different storm when names/years are duplicated.
  return matches.length === 1 && uuid.test(matches[0].id) ? byId(client, matches[0].id) : null;
}

export function cycloneCanonicalUrl(row, currentHref) {
  const path = cycloneUrl(row);
  if (!path.startsWith('/tropical-cyclone.html/')) return null;
  const url = new URL(currentHref);
  url.pathname = path;
  url.searchParams.delete('id');
  return url.href === currentHref ? null : url.href;
}
