import savedPublicData from '../public-data/catalogs.json' with { type: 'json' };
import { siteDesignValue } from '../site-design-settings.js';

const ORIGIN = 'https://kxhqfwlfendphhwurhcg.supabase.co';
// Public anonymous key, also shipped in supabase.js. No visitor credentials are forwarded.
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4aHFmd2xmZW5kcGhod3VyaGNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4NDI4MjQsImV4cCI6MjA5MzQxODgyNH0.K4kwmU_i9qln-74xGX5Qj-VqwsJIlERvF3VAMXUcMa4';

function result(row, method, recovery = false) {
  return new Response(method === 'HEAD' ? null : JSON.stringify({
    style: siteDesignValue(row?.value), updatedAt: row?.updated_at || null,
    ...(recovery ? { recovery: true } : {})
  }), { headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Vercel-CDN-Cache-Control': 'public, max-age=30',
    'X-Content-Type-Options': 'nosniff'
  } });
}

export default {
  async fetch(request) {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed.', { status: 405, headers: { 'Cache-Control': 'no-store', Allow: 'GET, HEAD' } });
    if (new URL(request.url).search) return new Response('Not found.', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    try {
      const response = await fetch(ORIGIN + '/rest/v1/site_settings?select=value,updated_at&key=eq.site_design&limit=1', {
        headers: { apikey: ANON, Authorization: 'Bearer ' + ANON },
        redirect: 'error', signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) throw Error('Setting unavailable.');
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.length > 1) throw Error('Invalid setting.');
      return result(rows[0], request.method);
    } catch {
      const row = savedPublicData.resources?.['site-settings']?.rows?.find(row => row.key === 'site_design');
      return result(row, request.method, true);
    }
  }
};
