const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const model = import(pathToFileURL(path.join(__dirname, '../cyclones.js')).href);
const routing = import(pathToFileURL(path.join(__dirname, '../cyclone-routing.js')).href);
const errol = { id: '56c27e50-6943-4902-a24c-057788097c2c', name: 'Cyclone Errol', year: 2025, status: 'approved' };

function database(pages = [], record = errol, failure = null) {
  const reads = [];
  return { reads, from(table) {
    assert.equal(table, 'tropical_cyclones');
    const request = { filters: [] }; reads.push(request);
    const q = {
      select(value) { request.select = value; return q; },
      eq(...args) { request.filters.push(['eq', ...args]); return q; },
      neq(...args) { request.filters.push(['neq', ...args]); return q; },
      order() { return q; },
      range(from, to) { request.range = [from, to]; return q; },
      maybeSingle: async () => ({ data: record, error: failure }),
      then(resolve) { resolve({ data: pages[(request.range?.[0] || 0) / 1000] || [], error: failure }); }
    };
    return q;
  } };
}

test('cyclone links include names and years, normalize punctuation, and preserve ID fallbacks', async () => {
  const { cycloneSlug, cycloneUrl } = await model;
  assert.equal(cycloneUrl(errol), '/tropical-cyclone.html/cyclone-errol-2025');
  assert.equal(cycloneSlug({ name: 'Typhóon O’Brien & Test / One', year: 2016 }), 'typhoon-obrien-and-test-one-2016');
  assert.notEqual(cycloneUrl({ ...errol, year: 2024 }), cycloneUrl(errol));
  assert.equal(cycloneUrl({ id: errol.id }), 'tropical-cyclone.html?id=' + errol.id);
  assert.equal(cycloneUrl({ ...errol, status: 'pending' }), 'tropical-cyclone.html?id=' + errol.id);
  assert.equal(cycloneUrl({ id: 'a&other=b' }), 'tropical-cyclone.html?id=a%26other%3Db');
  assert.equal(cycloneSlug({ ...errol, year: null }), '');
});

test('route parsing accepts named paths, ID queries and path IDs without double decoding', async () => {
  const { cycloneUrlKey } = await routing;
  assert.equal(cycloneUrlKey(new URL('https://site.test/tropical-cyclone.html/cyclone-errol-2025')), 'cyclone-errol-2025');
  assert.equal(cycloneUrlKey(new URL('https://site.test/tropical-cyclone.html/' + errol.id)), errol.id);
  assert.equal(cycloneUrlKey(new URL('https://site.test/tropical-cyclone.html?id=' + errol.id)), errol.id);
  assert.equal(cycloneUrlKey(new URL('https://site.test/tropical-cyclone.html/cyclone-errol-2025/')), 'cyclone-errol-2025');
  for (const path of ['/tropical-cyclone.html/%zz', '/tropical-cyclone.html/extra/path', '/other.html/errol-2025']) {
    assert.equal(cycloneUrlKey(new URL('https://site.test' + path)), '');
  }
});

test('canonical URLs preserve image transfers, preview settings and anchors', async () => {
  const { cycloneCanonicalUrl } = await routing;
  const next = cycloneCanonicalUrl(errol, 'https://site.test/tropical-cyclone.html?id=' + errol.id + '&imageImport=transfer&design-preview=original#recon');
  const url = new URL(next);
  assert.equal(url.pathname, '/tropical-cyclone.html/cyclone-errol-2025');
  assert.equal(url.searchParams.has('id'), false);
  assert.equal(url.searchParams.get('imageImport'), 'transfer');
  assert.equal(url.searchParams.get('design-preview'), 'original');
  assert.equal(url.hash, '#recon');
  assert.equal(cycloneCanonicalUrl(errol, next), null);
  assert.equal(cycloneCanonicalUrl({ ...errol, status: 'pending' }, next), null);
});

test('UUID routes keep their direct RLS read; cached name routes resolve to the real database ID', async () => {
  const { resolveCycloneUrlKey } = await routing;
  const direct = database();
  assert.equal((await resolveCycloneUrlKey(direct, errol.id)).id, errol.id);
  assert.equal(direct.reads.length, 1);
  const cached = database();
  assert.equal((await resolveCycloneUrlKey(cached, 'cyclone-errol-2025', { readCatalog: async () => [errol] })).id, errol.id);
  assert.deepEqual(cached.reads[0].filters, [['eq', 'id', errol.id]]);
  assert.equal(cached.reads.length, 1);
});

test('fresh metadata handles new names and pagination, keeps public filters, and rejects ambiguity', async () => {
  const { resolveCycloneUrlKey } = await routing;
  const page = Array.from({ length: 1000 }, (_, i) => ({ id: String(i), name: 'Other ' + i, year: 2025, status: 'approved' }));
  const client = database([page, [errol]]);
  const row = await resolveCycloneUrlKey(client, 'cyclone-errol-2025', { readCatalog: async () => [] });
  assert.equal(row.id, errol.id);
  assert.deepEqual(client.reads.slice(0, 2).map(r => r.range), [[0, 999], [1000, 1999]]);
  assert.ok(client.reads[0].filters.some(f => f[1] === 'year' && f[2] === 2025));
  assert.ok(client.reads[0].filters.some(f => f[1] === 'status' && f[2] === 'approved'));
  const duplicate = database([[errol, { ...errol, id: '12345678-1234-1234-1234-123456789abc' }]]);
  assert.equal(await resolveCycloneUrlKey(duplicate, 'cyclone-errol-2025'), null);
  assert.equal(duplicate.reads.length, 1);
});

test('invalid routes never query the database and backend errors remain visible', async () => {
  const { resolveCycloneUrlKey } = await routing;
  const client = database();
  for (const key of ['', '../errol-2025', '<script>-2025', 'missing-year', 'errol-0', 'x'.repeat(241)]) {
    assert.equal(await resolveCycloneUrlKey(client, key), null);
  }
  assert.equal(client.reads.length, 0);
  await assert.rejects(resolveCycloneUrlKey(database([], null, Error('Unavailable')), errol.id), /Unavailable/);
  const allowed = database([[{ ...errol, status: 'pending' }]], { ...errol, status: 'pending' });
  assert.equal((await resolveCycloneUrlKey(allowed, 'cyclone-errol-2025', { includePending: true })).id, errol.id);
  assert.ok(allowed.reads[0].filters.some(f => f[0] === 'neq' && f[2] === 'rejected'));
});

test('the page loader keeps named routes, gallery reads, and browser image transfers on the same real ID', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const { cycloneUrlKey, resolveCycloneUrlKey } = await routing;
  const source = fs.readFileSync(path.join(__dirname, '../cyclone-page.js'), 'utf8');
  const load = source.slice(source.indexOf('async function load()'), source.indexOf('function renderDeletedCyclone()'));
  for (const address of ['https://site.test/tropical-cyclone.html/cyclone-errol-2025', 'https://site.test/tropical-cyclone.html?id=' + errol.id]) {
    const calls = [], mounts = [];
    const client = { from(table) {
      const q = {
        select() { return q; }, eq(field, value) { calls.push({ table, field, value }); return q; },
        neq() { return q; }, order() { return q; },
        maybeSingle: async () => ({ data: errol, error: null }),
        then(resolve) { resolve({ data: [{ id: 'photo', category: 'satellite', cyclone_id: errol.id }], error: null }); }
      };
      return q;
    } };
    const state = { location: new URL(address), supabase: client, cycloneUrlKey, resolveCycloneUrlKey,
      cycloneActor: async () => ({ user: null, isAdmin: false }), loadPublicCatalog: async () => [errol],
      cycloneMediaCategory: value => value, render() {}, mountImageImport: async options => mounts.push(options),
      document: { getElementById: () => ({}) }, CYCLONE_CATEGORIES: [], page: { innerHTML: '' },
      esc: String, cycloneError: error => error.message };
    const context = vm.createContext(state);
    vm.runInContext('let id=cycloneUrlKey(location), busy=false, deletedCyclone=false, loadRun=0, actor, cyclone, uploads, category="photos";\n' + load, context);
    await vm.runInContext('load()', context);
    assert.equal(vm.runInContext('id', context), errol.id);
    assert.equal(calls.find(call => call.table === 'cyclone_uploads').value, errol.id);
    assert.equal(mounts[0].targetId, errol.id);
    assert.equal(state.page.innerHTML, '');
  }
});
