import savedPublicData from '../public-data/catalogs.json' with { type: 'json' };
const ORIGIN = 'https://kxhqfwlfendphhwurhcg.supabase.co';
// This is the same public anon key shipped to every visitor in supabase.js.
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4aHFmd2xmZW5kcGhod3VyaGNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4NDI4MjQsImV4cCI6MjA5MzQxODgyNH0.K4kwmU_i9qln-74xGX5Qj-VqwsJIlERvF3VAMXUcMa4';
const RESOURCES = {
  tornadoes: { table: 'tornadoes', select: '*', order: 'date.desc,id.asc' },
  cyclones: { table: 'tropical_cyclones', select: '*,cyclone_uploads(count)', order: 'year.desc,id.asc' },
  outbreaks: { table: 'outbreaks', select: '*', order: 'created_at.desc,id.asc' },
  'upload-counts': { table: 'uploads', select: 'tornado_id,file_url,category', order: 'id.asc' }
};
const noCache = (status, text) => new Response(text, { status, headers: { 'Cache-Control': 'no-store' } });
function result(resource, data, method, recovery=false) {
  const body={resource,generatedAt:recovery?savedPublicData.generatedAt:new Date().toISOString(),...data,...(recovery?{recovery:true}:{})};
  return new Response(method==='HEAD'?null:JSON.stringify(body),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=60','Vercel-CDN-Cache-Control':recovery?'public, max-age=120':'public, max-age=1200','X-Content-Type-Options':'nosniff'}});
}
function recovery(resource, method) {
  const saved=savedPublicData.resources?.[resource];
  return saved?result(resource,saved,method,true):noCache(503,'The database is temporarily unavailable.');
}
function validCounts(value){
  if(!Array.isArray(value?.counts)||!Number.isSafeInteger(value.total)||value.total<0)return false;
  const ids=new Set();let total=0;
  for(const row of value.counts){if(typeof row.tornado_id!=='string'||ids.has(row.tornado_id)||!Number.isSafeInteger(row.upload_count)||row.upload_count<0)return false;ids.add(row.tornado_id);total+=row.upload_count;}
  return total===value.total;
}
const videos = new Set(['mp4','m4v','mov','webm','ogv','ogg','avi','mpeg','mpg','mkv','3gp','3g2','mts','m2ts','ts']);
function isVideo(row) {
  if (['video', 'videos'].includes(String(row.category || '').toLowerCase()) || /^data:video\//i.test(row.file_url || '')) return true;
  try {
    const path = decodeURIComponent(new URL(row.file_url, 'https://site.invalid').pathname);
    return videos.has((path.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase());
  } catch { return false; }
}

export default {
  async fetch(request) {
    if (!['GET','HEAD'].includes(request.method)) return noCache(405, 'Method not allowed.');
    const url = new URL(request.url), resource = url.searchParams.get('resource');
    if (!Object.hasOwn(RESOURCES, resource) || [...url.searchParams.keys()].some(key => key !== 'resource') || url.searchParams.getAll('resource').length !== 1) return noCache(404, 'Catalog not found.');
    const config = RESOURCES[resource], rows = [];
    try {
      if(resource==='upload-counts'){
        const aggregate=await fetch(ORIGIN+'/rest/v1/rpc/approved_upload_counts',{headers:{apikey:ANON,Authorization:'Bearer '+ANON},redirect:'error',signal:AbortSignal.timeout(20000)});
        if(aggregate.status===402||aggregate.status>=500)return recovery(resource,request.method);
        if(aggregate.ok){const counts=await aggregate.json();return validCounts(counts)?result(resource,{counts:counts.counts,total:counts.total},request.method):noCache(502,'Invalid upload counts.');}
        // Older installations can still use the paginated count until the RPC is installed.
        if(aggregate.status!==404)return noCache(502,'Upload counts unavailable.');
      }
      for (let offset = 0; offset < 100000; offset += 1000) {
        const query = new URLSearchParams({ select: config.select, status: 'eq.approved', order: config.order, limit: '1000', offset: String(offset) });
        if (resource === 'cyclones') query.set('cyclone_uploads.status', 'eq.approved');
        const upstream = await fetch(ORIGIN + '/rest/v1/' + config.table + '?' + query, {
          headers: { apikey: ANON, Authorization: 'Bearer ' + ANON },
          redirect: 'error', signal: AbortSignal.timeout(20000)
        });
        if(upstream.status===402||upstream.status>=500)return recovery(resource,request.method);
        if (!upstream.ok) return noCache(502, 'Catalog unavailable.');
        const page = await upstream.json();
        if (!Array.isArray(page) || page.length > 1000 || (resource !== 'upload-counts' && page.some(row => row.status !== 'approved'))) return noCache(502, 'Catalog unavailable.');
        rows.push(...page);
        if (page.length < 1000) break;
        if (offset === 99000) return noCache(502, 'Catalog exceeds the page limit.');
      }
      const body = {};
      if (resource === 'upload-counts') {
        const counts = new Map();
        for (const row of rows) if (row.tornado_id && !isVideo(row)) {
          const id = String(row.tornado_id); counts.set(id, (counts.get(id) || 0) + 1);
        }
        body.counts = [...counts].map(([tornado_id, upload_count]) => ({ tornado_id, upload_count }));
        body.total = [...counts.values()].reduce((sum, count) => sum + count, 0);
      } else body.rows = resource === 'cyclones' ? rows.map(({ cyclone_uploads, ...row }) => ({ ...row, upload_count: Number(cyclone_uploads?.[0]?.count || 0) })) : rows;
      return result(resource,body,request.method);
    } catch { return recovery(resource,request.method); }
  }
};
