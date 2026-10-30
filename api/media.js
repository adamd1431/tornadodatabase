import archivedMedia from '../media-archive-index.json' with { type: 'json' };

const ORIGIN = 'https://kxhqfwlfendphhwurhcg.supabase.co';
const PUBLIC_PREFIX = '/storage/v1/object/public/';
const IMAGE_PATH = /\.(?:jpe?g|png|webp|gif|avif|bmp|tiff?|ico)$/i;
const IMAGE_TYPE = /^image\/(?:jpeg|png|webp|gif|avif|bmp|tiff|x-icon|vnd\.microsoft\.icon)(?:;|$)/i;
const CACHE_LIMIT = 20 * 1024 * 1024;
const fail = (status, message) => new Response(message, { status, headers: { 'Cache-Control': 'no-store' } });

function publicImage(request) {
  const incoming = new URL(request.url);
  const route = incoming.pathname.match(/^\/(?:media|storage\/v1\/object\/public)\/(uploads|cyclone-uploads)\/(.+)$/);
  const bucket = route?.[1] || incoming.searchParams.get('bucket');
  if (!['uploads', 'cyclone-uploads'].includes(bucket)) return null;
  let path;
  try { path = decodeURIComponent(route ? route[2] : incoming.searchParams.get('path') || ''); }
  catch { return null; }
  if (!path || !IMAGE_PATH.test(path) || path.split(/[\/\\]/).some(part => !part || part === '.' || part === '..') || /[\u0000-\u001f\u007f]/.test(path)) return null;
  return ORIGIN + PUBLIC_PREFIX + bucket + '/' + path.split('/').map(encodeURIComponent).join('/');
}

// Public media only: never forward sessions, credentials or upstream cookies.
// Streaming preserves every original byte, including animation and metadata.
export default {
  async fetch(request) {
    if (!['GET', 'HEAD'].includes(request.method)) return fail(405, 'Method not allowed.');
    const source = publicImage(request);
    if (!source) return fail(404, 'Image not found.');
    const key = decodeURIComponent(new URL(source).pathname.slice(PUBLIC_PREFIX.length));
    const archived = archivedMedia[key];
    // Old page responses and bookmarks through /media keep working after a
    // move, without refetching an object that has left Supabase.
    if (typeof archived === 'string' && /^[a-f0-9]{64}\.(?:jpe?g|png|webp|gif|avif)$/i.test(archived)) {
      return new Response(null, { status: 308, headers: {
        Location: '/media-archive/' + archived,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*'
      } });
    }
    try {
      const upstream = await fetch(source, { method: request.method, redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (!upstream.ok || !IMAGE_TYPE.test(upstream.headers.get('content-type') || '')) {
        await upstream.body?.cancel();
        return fail(upstream.status === 404 ? 404 : 502, 'Image unavailable.');
      }
      // Larger files still load directly; they exceed the shared cache limit.
      if (Number(upstream.headers.get('content-length')) > CACHE_LIMIT) {
        await upstream.body?.cancel();
        return new Response(null, { status: 307, headers: { Location: source, 'Cache-Control': 'no-store' } });
      }
      const headers = new Headers({
        'Content-Type': upstream.headers.get('content-type'),
        'Cache-Control': 'public, max-age=86400',
        'Vercel-CDN-Cache-Control': 'public, max-age=86400',
        'Vercel-Cache-Tag': 'storm-media',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff'
      });
      for (const name of ['ETag', 'Last-Modified']) {
        if (upstream.headers.has(name)) headers.set(name, upstream.headers.get(name));
      }
      return new Response(request.method === 'HEAD' ? null : upstream.body, { status: 200, headers });
    } catch {
      return fail(502, 'Image unavailable.');
    }
  }
};
