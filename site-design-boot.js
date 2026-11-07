// Apply the last verified design before first paint. The public setting is
// refreshed by site-design.js; a preview never changes the stored live choice.
(() => {
  let style = 'revised';
  try {
    const saved = JSON.parse(localStorage.getItem('utwx:siteDesign') || 'null');
    if (['original', 'revised'].includes(saved?.style)) style = saved.style;
  } catch {}
  const preview = new URL(location.href).searchParams.get('design-preview');
  if (['original', 'revised'].includes(preview)) style = preview;
  document.documentElement.dataset.siteDesign = style;
})();
