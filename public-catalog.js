const RESOURCES = new Set(['tornadoes', 'cyclones', 'outbreaks', 'upload-counts']);

// Only public approved data uses this cache. Owner review, account data and all
// writes retain their authenticated Supabase requests.
export async function loadPublicCatalog(resource, { read = globalThis.fetch, base = globalThis.location?.href } = {}) {
  if (!RESOURCES.has(resource)) throw Error('Unknown public catalog.');
  if (!base || ['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname)) return null;
  try {
    const response = await read('/api/public-catalog?resource=' + resource, { credentials: 'omit' });
    if (!response.ok) return null;
    const body = await response.json();
    if (body?.resource !== resource || !Number.isFinite(Date.parse(body.generatedAt))) return null;
    if (resource === 'upload-counts') {
      if (!Array.isArray(body.counts)) return null;
      const counts = new Map(); let total = 0;
      for (const row of body.counts) {
        const count = Number(row.upload_count), id = String(row.tornado_id || '');
        if (!id || counts.has(id) || !Number.isSafeInteger(count) || count < 0) return null;
        counts.set(id, count); total += count;
      }
      return Number.isSafeInteger(total) && total === body.total ? { counts, total } : null;
    }
    return Array.isArray(body.rows) && body.rows.every(row => row?.id && row.status === 'approved') ? body.rows : null;
  } catch { return null; }
}
