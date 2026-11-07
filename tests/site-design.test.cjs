const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const settings = import(pathToFileURL(path.join(root, 'site-design-settings.js')).href);
const api = import(pathToFileURL(path.join(root, 'api/site-design.js')).href);

function boot(saved, query = '') {
  const dataset = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'site-design-boot.js'), 'utf8'), {
    URL, location: { href: 'https://site.test/index.html' + query },
    localStorage: { getItem: () => saved }, document: { documentElement: { dataset } }
  });
  return dataset.siteDesign;
}

test('boot preserves the saved Original style, defaults to Revised, and isolates previews', () => {
  assert.equal(boot(null), 'revised');
  assert.equal(boot('{"style":"original"}'), 'original');
  assert.equal(boot('{"style":"original"}', '?design-preview=revised'), 'revised');
  assert.equal(boot('{"style":"revised"}', '?design-preview=original'), 'original');
  for (const value of ['broken', '{"style":"other"}', 'null']) assert.equal(boot(value), 'revised');
  assert.equal(boot('{"style":"original"}', '?design-preview=other'), 'original');
});

test('owner setting validates the choice, verifies the saved result, and propagates write failures', async () => {
  const m = await settings;
  let writes = 0;
  const client = { from(table) {
    assert.equal(table, 'site_settings');
    return { upsert(row, options) {
      writes++;
      assert.equal(row.key, 'site_design'); assert.equal(row.updated_by, 'owner');
      assert.equal(options.onConflict, 'key');
      return { select: () => ({ single: async () => ({ data: { value: row.value, updated_at: row.updated_at } }) }) };
    } };
  } };
  for (const style of ['original', 'revised']) assert.equal((await m.saveSiteDesignSetting(client, style, 'owner')).style, style);
  assert.equal(writes, 2);
  await assert.rejects(m.saveSiteDesignSetting(client, 'invented', 'owner'));
  await assert.rejects(m.saveSiteDesignSetting(client, 'revised', null));
  assert.equal(writes, 2);
  const denied = { from: () => ({ upsert: () => ({ select: () => ({ single: async () => ({ error: Error('RLS denied') }) }) }) }) };
  await assert.rejects(m.saveSiteDesignSetting(denied, 'original', 'visitor'), /RLS denied/);
});

test('owner reads the global setting; unavailable data never masquerades as a successful read', async () => {
  const m = await settings;
  const client = result => ({ from: () => ({ select: () => ({ eq: (key, value) => {
    assert.equal(key, 'key'); assert.equal(value, 'site_design');
    return { maybeSingle: async () => result };
  } }) }) });
  assert.equal((await m.loadSiteDesignSetting(client({ data: { value: { style: 'original' } } }))).style, 'original');
  assert.equal((await m.loadSiteDesignSetting(client({ data: null }))).style, 'revised');
  await assert.rejects(m.loadSiteDesignSetting(client({ error: Error('Unavailable') })), /Unavailable/);
});

test('a stale public cache or outage cannot undo a newer Owner save', async () => {
  const { shouldUseSiteDesign: accept } = await settings;
  const saved = { style: 'original', updatedAt: '2026-11-06T03:00:00Z' };
  assert.equal(accept({ style: 'revised', updatedAt: '2026-11-06T02:59:00Z' }, saved), false);
  assert.equal(accept({ style: 'revised', updatedAt: null }, saved), false);
  assert.equal(accept({ style: 'revised', updatedAt: '2026-11-06T04:00:00Z', recovery: true }, saved), false);
  assert.equal(accept({ style: 'revised', updatedAt: '2026-11-06T04:00:00Z' }, saved), true);
  assert.equal(accept({ style: 'original', updatedAt: saved.updatedAt }, saved), true);
  assert.equal(accept({ style: 'revised', updatedAt: null }, null), true);
  assert.equal(accept({ style: 'invalid' }, saved), false);
});

async function serve(read, method = 'GET', suffix = '') {
  const old = global.fetch; global.fetch = read;
  try { return await (await api).default.fetch(new Request('https://site.test/api/site-design' + suffix, { method, headers: { Authorization: 'Bearer private-owner-session', Cookie: 'private-session' } })); }
  finally { global.fetch = old; }
}

test('public design endpoint reads only its setting and shares a short anonymous CDN response', async () => {
  const response = await serve(async (url, options) => {
    const query = new URL(url);
    assert.equal(query.pathname, '/rest/v1/site_settings');
    assert.equal(query.searchParams.get('key'), 'eq.site_design');
    assert.equal(query.searchParams.get('select'), 'value,updated_at');
    assert.equal(options.headers.Cookie, undefined);
    assert.notEqual(options.headers.Authorization, 'Bearer private-owner-session');
    const token = JSON.parse(Buffer.from(options.headers.apikey.split('.')[1], 'base64url'));
    assert.equal(token.role, 'anon');
    return new Response('[{"value":{"style":"original"},"updated_at":"2026-11-06T01:00:00Z","private":"excluded"}]');
  });
  assert.equal(response.headers.get('Vercel-CDN-Cache-Control'), 'public, max-age=30');
  assert.deepEqual(await response.json(), { style: 'original', updatedAt: '2026-11-06T01:00:00Z' });
});

test('design API handles missing settings and outages; rejects writes and extra query parameters', async () => {
  assert.equal((await (await serve(async () => new Response('[]'))).json()).style, 'revised');
  for (const read of [async () => new Response('', { status: 402 }), async () => { throw Error('Offline'); }]) {
    const body = await (await serve(read)).json(); assert.equal(body.recovery, true); assert.ok(['original', 'revised'].includes(body.style));
  }
  const unexpected = () => { throw Error('No upstream request expected'); };
  assert.equal((await serve(unexpected, 'POST')).status, 405);
  assert.equal((await serve(unexpected, 'GET', '?style=original')).status, 404);
  assert.equal(await (await serve(async () => new Response('[]'), 'HEAD')).text(), '');
});

