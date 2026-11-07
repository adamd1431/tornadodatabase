import { SITE_DESIGN_CACHE, validSiteDesign, shouldUseSiteDesign } from './site-design-settings.js';

const root = document.documentElement;
const preview = new URL(location.href).searchParams.get('design-preview');
const isPreview = validSiteDesign(preview);
let lastRefresh = 0;
let inFlight = false;

function apply(style) {
  root.dataset.siteDesign = style;
  syncCollectionHeading();
}

function syncCollectionHeading() {
  if (document.body?.dataset.sitePage !== 'index') return;
  const outbreak = document.body.dataset.indexMode === 'outbreaks';
  const cyclone = document.body.dataset.indexMode === 'cyclones';
  const revised = root.dataset.siteDesign === 'revised';
  const title = document.getElementById('databaseName');
  const caption = document.querySelector('#homeHero .hero-sub');
  if (title) title.textContent = cyclone ? 'Cyclone' : outbreak && revised ? 'Outbreak' : 'Tornado';
  if (caption && outbreak && revised) caption.textContent = 'Follow the outbreaks. Explore their tornadoes, tracks, and shared history.';
  else if (caption) caption.textContent = cyclone
    ? 'Explore tropical cyclones by year, peak winds, and lowest pressure.'
    : 'Explore and add media from tornadoes all across the world.';
}

async function refreshDesign() {
  if (isPreview || inFlight || Date.now() - lastRefresh < 30000) return;
  inFlight = true;
  lastRefresh = Date.now();
  try {
    const response = await fetch('/api/site-design', {
      credentials: 'omit', signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return;
    const setting = await response.json();
    let cached;
    try { cached = JSON.parse(localStorage.getItem(SITE_DESIGN_CACHE) || 'null'); } catch {}
    if (!shouldUseSiteDesign(setting, cached)) return;
    apply(setting.style);
    try { localStorage.setItem(SITE_DESIGN_CACHE, JSON.stringify(setting)); } catch {}
  } catch {
    // A blocked connection must never block browsing the archive.
  } finally { inFlight = false; }
}

function initDesign() {
  syncCollectionHeading();
  window.addEventListener('index-mode-change', () => queueMicrotask(syncCollectionHeading));
  const outbreakToggle = document.querySelector('.design-outbreak-toggle');
  outbreakToggle?.addEventListener('click', () => {
    const expanded = outbreakToggle.getAttribute('aria-expanded') !== 'true';
    outbreakToggle.setAttribute('aria-expanded', String(expanded));
    outbreakToggle.textContent = expanded ? 'Hide outbreak form' : 'Submit an outbreak';
    document.getElementById('outbreakCreator').dataset.expanded = String(expanded);
  });
  if (isPreview) {
    const banner = document.createElement('aside');
    banner.className = 'site-design-preview';
    banner.setAttribute('aria-label', 'Website design preview');
    const label = document.createElement('span');
    label.textContent = `Design preview · ${preview === 'original' ? 'Original' : 'Revised'}`;
    const link = document.createElement('a');
    const live = new URL(location.href);
    live.searchParams.delete('design-preview');
    link.href = live.href;
    link.textContent = 'Return to live design';
    banner.append(label, link);
    document.body.append(banner);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshDesign();
  });
  window.addEventListener('pageshow', refreshDesign);
  window.addEventListener('storage', event => {
    if (isPreview || event.key !== SITE_DESIGN_CACHE || !event.newValue) return;
    try { const value = JSON.parse(event.newValue); if (validSiteDesign(value?.style)) apply(value.style); } catch {}
  });
  refreshDesign();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initDesign, { once: true });
else initDesign();
