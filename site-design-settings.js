export const SITE_DESIGN_KEY = 'site_design';
export const SITE_DESIGN_CACHE = 'utwx:siteDesign';
export const SITE_DESIGNS = Object.freeze(['original', 'revised']);
export const DEFAULT_SITE_DESIGN = 'revised';

export function validSiteDesign(value) {
  return SITE_DESIGNS.includes(value);
}

export function siteDesignValue(value) {
  return validSiteDesign(value?.style) ? value.style : DEFAULT_SITE_DESIGN;
}

export function shouldUseSiteDesign(incoming, cached) {
  if (!validSiteDesign(incoming?.style)) return false;
  if (!validSiteDesign(cached?.style)) return true;
  if (incoming.recovery) return false;
  const knownTime = Date.parse(cached.updatedAt);
  const incomingTime = Date.parse(incoming.updatedAt);
  // A CDN response from before an Owner save must not undo that newer choice.
  return !Number.isFinite(knownTime) || (Number.isFinite(incomingTime) && incomingTime >= knownTime);
}

export async function loadSiteDesignSetting(client) {
  const { data, error } = await client.from('site_settings')
    .select('value,updated_at').eq('key', SITE_DESIGN_KEY).maybeSingle();
  if (error) throw error;
  return { style: siteDesignValue(data?.value), updatedAt: data?.updated_at || null };
}

export async function saveSiteDesignSetting(client, style, actorId) {
  if (!validSiteDesign(style)) throw Error('Choose Original or Revised.');
  if (!actorId) throw Error('Sign in as Owner to change the website design.');
  // Existing site_settings RLS permits only the owner to write this key.
  const { data, error } = await client.from('site_settings').upsert({
    key: SITE_DESIGN_KEY, value: { style },
    updated_at: new Date().toISOString(), updated_by: actorId
  }, { onConflict: 'key' }).select('value,updated_at').single();
  if (error) throw error;
  if (data?.value?.style !== style) throw Error('The design could not be verified. Please try again.');
  return { style, updatedAt: data.updated_at || null };
}
