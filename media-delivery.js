// Public image bytes are cached unchanged; no resize or quality conversion.
const PROJECT_ORIGIN = 'https://kxhqfwlfendphhwurhcg.supabase.co';
const PREVIOUS_SITE_ORIGIN = 'https://tornadodatabase.vercel.app';
const PUBLIC_PREFIX = '/storage/v1/object/public/';
const IMAGE_PATH = /\.(?:jpe?g|png|webp|gif|avif|bmp|tiff?|ico)$/i;
const PUBLIC_IMAGE = /^(uploads|cyclone-uploads)\/(.+)$/;

function validImagePath(path) {
  if (!PUBLIC_IMAGE.test(path) || !IMAGE_PATH.test(path)) return false;
  try { return !decodeURIComponent(path).split(/[\/\\]/).some(part => part === '.' || part === '..'); }
  catch { return false; }
}

export function cachedPublicMediaUrl(value, base = globalThis.location?.href) {
  const raw = String(value || '');
  try {
    const site = base ? new URL(base) : null;
    const url = new URL(raw, base);
    if(site&&site.origin!==PREVIOUS_SITE_ORIGIN&&url.origin===PREVIOUS_SITE_ORIGIN&&!url.username&&!url.password){
      if(/^\/media-archive\/[a-f0-9]{64}\.(?:jpe?g|png|webp|gif|avif)$/i.test(url.pathname))return url.pathname+url.search+url.hash;
      const publicPath=url.pathname.startsWith(PUBLIC_PREFIX)?url.pathname.slice(PUBLIC_PREFIX.length):url.pathname.startsWith('/media/')?url.pathname.slice('/media/'.length):'';
      if(validImagePath(publicPath))return '/media/'+publicPath+url.search+url.hash;
    }
    // Simple local static servers have no Supabase image proxy.
    if (site && ['localhost','127.0.0.1','[::1]'].includes(site.hostname)) return raw;
    if (url.origin !== PROJECT_ORIGIN || url.username || url.password || !url.pathname.startsWith(PUBLIC_PREFIX)) return raw;
    const path = url.pathname.slice(PUBLIC_PREFIX.length);
    if (!validImagePath(path)) return raw;
    return '/media/' + path + url.search + url.hash;
  } catch { return raw; }
}

export function originalPublicMediaUrl(value, base = globalThis.location?.href) {
  try {
    if (!base) return null;
    const site = new URL(base), url = new URL(value, site);
    if (url.origin !== site.origin || url.username || url.password || !url.pathname.startsWith('/media/')) return null;
    const path = url.pathname.slice('/media/'.length);
    if (!validImagePath(path)) return null;
    return PROJECT_ORIGIN + PUBLIC_PREFIX + path + url.search + url.hash;
  } catch { return null; }
}

export function installMediaFallback(root) {
  const failedSources = new WeakMap();
  const onError = event => {
    const img = event.target;
    if (img?.tagName !== 'IMG') return;
    const source = img.getAttribute('src');
    const original = originalPublicMediaUrl(source, img.baseURI);
    if (!original || failedSources.get(img) === source) return;
    failedSources.set(img, source);
    img.removeAttribute('srcset');
    img.setAttribute('src', original);
  };
  root.addEventListener('error', onError, true);
  return () => root.removeEventListener('error', onError, true);
}

if (globalThis.document?.addEventListener) installMediaFallback(document);
