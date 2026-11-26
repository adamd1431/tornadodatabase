const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const model = import('data:text/javascript;base64,' + Buffer.from(read('official-cyclone-top100.js')).toString('base64'));
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (n, wind, extra = {}) => ({ id: id(n), status: 'approved', name: 'Cyclone ' + n, year: 2000 + n, peak_winds_mph: 200, lowest_pressure_mb: 900, owner_estimated_winds_mph: wind, ...extra });

function clientFor(getRows) {
  const calls = [];
  return { calls, rpc() { throw new Error('Automatic rankings must not depend on manual-rank RPCs.'); }, from(table) {
    const call = { table, filters: [], orders: [] }; calls.push(call);
    const q = {
      select(columns) { call.columns = columns; return q; },
      eq(key, value) { call.filters.push(['eq', key, value]); return q; },
      gte(key, value) { call.filters.push(['gte', key, value]); return q; },
      lte(key, value) { call.filters.push(['lte', key, value]); return q; },
      order(key, options) { call.orders.push([key, options]); return q; },
      limit(value) { call.limit = value; return q; },
      range(from, to) { call.range = [from, to]; return q; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          let data = getRows().filter(row => call.filters.every(([op, key, value]) => op === 'eq' ? row[key] === value : row[key] != null && (op === 'gte' ? Number(row[key]) >= value : Number(row[key]) <= value)));
          data = [...data].sort((a,b) => { for (const [key, options] of call.orders) { const result = key === 'id' ? a.id.localeCompare(b.id) : Number(a[key]) - Number(b[key]); if (result) return options.ascending ? result : -result; } return 0; });
          return { data: call.range ? data.slice(call.range[0], call.range[1] + 1) : data.slice(0, call.limit) };
        }).then(resolve, reject);
      }
    }; return q;
  } };
}

test('rankings use only valid owner wind estimates on approved cyclones, never official wind or pressure', async () => {
  const { rankOfficialCyclones: rank } = await model;
  const rows = [row(1, 180, { peak_winds_mph: 250 }), row(2, '220', { peak_winds_mph: 100, owner_estimated_pressure_mb: 990 }), row(3, null, { peak_winds_mph: 300 }), row(4, undefined), row(5, ''), row(6, 400, { status: 'pending' }), row(7, 400, { status: 'rejected' }), row(8, 0), row(9, -1), row(10, 501), row(11, Infinity), row(12, 'bad'), row(13, true)];
  assert.deepEqual(rank(rows).map(r => r.id), [id(2), id(1), id(8)]);
  assert.equal(rows[0].id, id(1));
});

test('full stored precision decides the order before rounded knots are displayed', async () => {
  const { rankOfficialCyclones: rank } = await model;
  assert.deepEqual(rank([row(1, 200.03), row(2, 200.04)]).map(r => r.id), [id(2), id(1)]);
});

test('ties have a stable order unaffected by names, dates, pressure or input order', async () => {
  const { rankOfficialCyclones: rank } = await model;
  const rows = [row(2, 200, { name: 'A', owner_estimated_pressure_mb: 800 }), row(1, 200, { name: 'Z', year: 2026 })];
  assert.deepEqual(rank(rows).map(r => r.id), [id(1), id(2)]);
  assert.deepEqual(rank(rows.reverse()).map(r => r.id), [id(1), id(2)]);
});

test('every eligible cyclone remains ranked after global sorting, including ranks beyond 100', async () => {
  const { rankOfficialCyclones: rank } = await model;
  const rows = Array.from({ length: 105 }, (_, i) => row(i + 1, i + 1));
  rows.push(row(106, 500, { status: 'pending' }));
  const ranked = rank(rows);
  assert.equal(ranked.length, 105);
  assert.equal(ranked[0].id, id(105));
  assert.equal(ranked[104].id, id(1));
});

test('reading the list queries all approved owner estimates in descending order', async () => {
  const { loadOfficialCycloneTop100: load } = await model;
  const client = clientFor(() => [...Array.from({ length: 105 }, (_, i) => row(i + 1, i + 1)), row(106, null), row(107, 500, { status: 'pending' })]);
  const ranked = await load(client);
  assert.equal(ranked.length, 105);
  assert.equal(ranked[0].id, id(105));
  assert.equal(client.calls.length, 1);
  const call = client.calls[0];
  assert.equal(call.table, 'tropical_cyclones');
  assert.equal(call.limit, undefined);
  assert.deepEqual(call.range, [0, 499]);
  assert.deepEqual(call.orders, [['owner_estimated_winds_mph', { ascending: false }], ['id', { ascending: true }]]);
  assert.deepEqual(call.filters, [['eq', 'status', 'approved'], ['gte', 'owner_estimated_winds_mph', 0], ['lte', 'owner_estimated_winds_mph', 500]]);
  assert.ok(!call.columns.includes('*'));
});

test('pagination includes cyclones beyond the default 1000-row backend limit without duplicates', async () => {
  const { loadOfficialCycloneRankings: load } = await model;
  const rows = Array.from({ length: 1205 }, (_, i) => row(i + 1, 100 + i % 200 / 10));
  const client = clientFor(() => rows.reverse());
  const ranked = await load(client);
  assert.equal(ranked.length, 1205);
  assert.equal(new Set(ranked.map(r => r.id)).size, 1205);
  assert.equal(ranked[0].owner_estimated_winds_mph, 119.9);
  assert.equal(ranked.at(-1).owner_estimated_winds_mph, 100);
  assert.deepEqual(client.calls.map(c => c.range), [[0, 499], [500, 999], [1000, 1499]]);
});

test('an exact full page finishes with an empty page and a later-page failure never returns a partial ranking', async () => {
  const { loadOfficialCycloneRankings: load } = await model;
  const rows = Array.from({ length: 500 }, (_, i) => row(i + 1, 150));
  const client = clientFor(() => rows);
  assert.equal((await load(client)).length, 500);
  assert.equal(client.calls.length, 2);
  let page = 0;
  const failed = { from(table) { if(page++ === 0)return clientFor(() => rows).from(table);const q = new Proxy({}, { get: (_, key) => key === 'then' ? resolve => resolve({ error: { message: 'Second page unavailable' } }) : () => q });return q; } };
  await assert.rejects(() => load(failed), error => error.message === 'Second page unavailable');
});

test('changing and clearing estimates changes membership and order without manual ranking writes', async () => {
  const { loadOfficialCycloneTop100: load } = await model;
  const rows = [row(1, 190), row(2, 180), row(3, null)];
  const client = clientFor(() => rows);
  assert.deepEqual((await load(client)).map(r => r.id), [id(1), id(2)]);
  rows[2].owner_estimated_winds_mph = 220;
  rows[0].owner_estimated_winds_mph = null;
  assert.deepEqual((await load(client)).map(r => r.id), [id(3), id(2)]);
});

test('load failures propagate and never require the retired manual-ranking setup', async () => {
  const { loadOfficialCycloneTop100: load, officialCycloneError } = await model;
  const denied = { code: '42501', message: 'denied' };
  const q = new Proxy({}, { get: (_, key) => key === 'then' ? resolve => resolve({ error: denied }) : () => q });
  await assert.rejects(() => load({ from: () => q }), error => error === denied);
  assert.match(officialCycloneError({ code: 'PGRST204', message: 'owner_estimated_winds_mph' }), /supabase-cyclone-estimates.sql/);
  assert.doesNotMatch(officialCycloneError({ code: 'PGRST205' }), /supabase-official-cyclone-top100/);
});

test('returning from an edit refreshes the rendered automatic ranking and clearing an estimate removes it', async () => {
  const m = await model, rows = [row(1, 190), row(2, 180)];
  const intensity = await import(require('node:url').pathToFileURL(path.join(__dirname,'../cyclones.js')).href);
  const elements = new Map(), events = new Map(), documentEvents = new Map();
  const element = () => ({ textContent: '', innerHTML: '', hidden: false, disabled: false, dataset: {}, addEventListener() {} });
  const context = vm.createContext({ ...m, ...intensity, console, URL, location: { href: 'https://site.test/official-cyclone-top100.html' }, supabase: clientFor(() => rows),
    document: { visibilityState: 'visible', getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, addEventListener(name, callback) { documentEvents.set(name, callback); } },
    window: { addEventListener(name, callback) { events.set(name, callback); } },
    esc: String, cycloneYear:r=>String(r.year), cycloneUrl: r => r.id, cycloneWindKnots: value => String(value), cyclonePeakBadge: () => '', cycloneCropStyle: () => '' });
  const body = read('official-cyclone-top100-page.js').replace(/^import .*;\r?\n/gm, '').replace(/\nload\(\);\s*$/, '\n');
  vm.runInContext(body, context);
  await vm.runInContext('load()', context);
  assert.ok(elements.get('grid').innerHTML.indexOf('Cyclone 1') < elements.get('grid').innerHTML.indexOf('Cyclone 2'));
  rows[1].owner_estimated_winds_mph = 220;
  await events.get('focus')();
  assert.ok(elements.get('grid').innerHTML.indexOf('Cyclone 2') < elements.get('grid').innerHTML.indexOf('Cyclone 1'));
  rows[0].owner_estimated_winds_mph = null;
  events.get('pageshow')({ persisted: true });
  await new Promise(setImmediate);
  assert.equal(elements.get('rankedCount').textContent, '1');
  assert.doesNotMatch(elements.get('grid').innerHTML, /Cyclone 1/);
  const calls = context.supabase.calls.length;
  context.document.visibilityState = 'hidden';
  await events.get('focus')();
  assert.equal(context.supabase.calls.length, calls);
  rows[1].owner_estimated_winds_mph = null;
  context.document.visibilityState = 'visible';
  documentEvents.get('visibilitychange')();
  await new Promise(setImmediate);
  assert.equal(elements.get('rankedCount').textContent, '0');
  assert.match(elements.get('grid').innerHTML, /No owner wind estimates yet/);
});
