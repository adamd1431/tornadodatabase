// Upload paths are unique and never overwritten. Cache the same bytes longer.
export const IMMUTABLE_UPLOAD_CACHE_CONTROL = '31536000';

// Share identical reads only while they are in flight. No persisted responses,
// stale permission results, image conversions, or changes to write requests.
export function createCoalescedFetch(fetchImpl, projectUrl) {
  const origin = new URL(projectUrl).origin;
  const pending = new Map();
  let revision = 0;
  return async function efficientFetch(input, init = {}) {
    init ||= {};
    const request = typeof Request !== 'undefined' && input instanceof Request ? input : null;
    let url;
    try { url = new URL(request ? request.url : String(input)); }
    catch { return fetchImpl(input, init); }
    const method = String(init.method || request?.method || 'GET').toUpperCase();
    const database = url.origin === origin && url.pathname.startsWith('/rest/v1/');
    if (database && !['GET','HEAD'].includes(method)) {
      revision++;
      pending.clear();
    }
    // Keep independent cancellation semantics for requests with an AbortSignal.
    if (!database || !['GET','HEAD'].includes(method) || init.signal || request || init.body != null) return fetchImpl(input, init);
    const headers = [...new Headers(init.headers).entries()].sort(([a],[b])=>a.localeCompare(b));
    const key = JSON.stringify([revision,method,url.href,headers,init.credentials || '',init.cache || '',init.mode || '',init.redirect || '',init.referrer || '',init.referrerPolicy || '',init.integrity || '']);
    let promise = pending.get(key);
    if (!promise) {
      promise = Promise.resolve().then(()=>fetchImpl(input, init));
      pending.set(key,promise);
    }
    try { return (await promise).clone(); }
    finally { if(pending.get(key) === promise) pending.delete(key); }
  };
}

const COUNTS_UNAVAILABLE_KEY = 'utwx:aggregateUploadCountsUnavailable';
let missingAggregate = false;
try {
  if (performance.getEntriesByType('navigation')[0]?.type === 'reload') sessionStorage.removeItem(COUNTS_UNAVAILABLE_KEY);
  missingAggregate = Number(sessionStorage.getItem(COUNTS_UNAVAILABLE_KEY)) > Date.now();
} catch {}

export async function loadAggregateUploadCounts(client, fallback) {
  if(missingAggregate) return fallback();
  try {
    const {data,error} = await client.rpc('approved_upload_counts',{}, {get:true});
    if(error) {
      if(['PGRST202','42883'].includes(error.code)) {
        missingAggregate = true;
        try { sessionStorage.setItem(COUNTS_UNAVAILABLE_KEY,String(Date.now()+600000)); } catch {}
      }
      return fallback();
    }
    if(!Array.isArray(data?.counts)) return fallback();
    const counts = new Map(); let total = 0;
    for(const row of data.counts) {
      const id = String(row.tornado_id ?? ''), count = Number(row.upload_count);
      if(!id || !Number.isSafeInteger(count) || count < 0 || counts.has(id)) return fallback();
      counts.set(id,count);total += count;
    }
    if(!Number.isSafeInteger(total) || total !== Number(data.total)) return fallback();
    return {counts,total};
  } catch { return fallback(); }
}
