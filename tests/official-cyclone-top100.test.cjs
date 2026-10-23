const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'official-cyclone-top100.js'), 'utf8');
const model = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('moving a ranked cyclone keeps the intervening order in both directions', async () => {
  const { changeOfficialCycloneRank: change } = await model;
  const original = { [id(1)]: 1, [id(2)]: 2, [id(3)]: 3, [id(4)]: 4 };
  const up = change(original, id(4), 2);
  assert.deepEqual(up, { [id(1)]: 1, [id(2)]: 3, [id(3)]: 4, [id(4)]: 2 });
  assert.deepEqual(change(up, id(4), 4), original);
  assert.equal(original[id(4)], 4);
});

test('insertion, open slots, removal, and the 100-entry boundary preserve unique ranks', async () => {
  const { changeOfficialCycloneRank: change } = await model;
  const full = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [id(i + 1), i + 1]));
  const inserted = change(full, id(101), 2);
  assert.equal(Object.keys(inserted).length, 100);
  assert.equal(inserted[id(101)], 2);
  assert.equal(inserted[id(2)], 3);
  assert.equal(inserted[id(99)], 100);
  assert.equal(inserted[id(100)], undefined);
  const removed = change(inserted, id(1), null);
  assert.equal(removed[id(1)], undefined);
  assert.equal(change(removed, id(50), 1)[id(50)], 1);
  assert.equal(new Set(Object.values(inserted)).size, 100);
});

test('invalid IDs, duplicate ranks, fractional ranks and oversized lists cannot be saved', async () => {
  const { validateOfficialCycloneRanks: validate, changeOfficialCycloneRank: change } = await model;
  for (const input of [null, [], { bad: 1 }, { [id(1)]: 0 }, { [id(1)]: 101 }, { [id(1)]: 1.5 }, { [id(1)]: '1' }, { [id(1)]: 1, [id(2)]: 1 }]) assert.throws(() => validate(input));
  assert.throws(() => validate(Object.fromEntries(Array.from({ length: 101 }, (_, i) => [id(i + 1), i + 1]))));
  for (const rank of [0, 101, 1.5, '2']) assert.throws(() => change({}, id(1), rank));
});

test('catalog loading pages approved cyclones without reading tornado records', async () => {
  const { loadOfficialCycloneCatalog: load } = await model;
  const calls = [];
  const client = { from(table) {
    const call = { table }; calls.push(call);
    const q = { select(columns) { call.columns = columns; return q; }, eq(key, value) { call.filter = [key, value]; return q; }, order() { return q; }, range(start, end) { call.range = [start, end]; return Promise.resolve({ data: Array.from({ length: start ? 1 : 1000 }, (_, i) => ({ id: id(start + i + 1) })) }); } }; return q;
  } };
  assert.equal((await load(client)).length, 1001);
  assert.deepEqual(calls.map(c => c.range), [[0, 999], [1000, 1999]]);
  assert.ok(calls.every(c => c.table === 'tropical_cyclones' && c.filter[1] === 'approved' && !c.columns.includes('*')));
});

test('loading ranks reports setup and permission errors without presenting an empty list', async () => {
  const { loadOfficialCycloneRanks: load, officialCycloneError } = await model;
  const client = result => ({ from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => result }) });
  await assert.rejects(() => load(client({ data: null })), /supabase-official-cyclone-top100.sql/);
  const denied = { code: '42501', message: 'denied' };
  await assert.rejects(() => load(client({ error: denied })), error => error === denied);
  assert.match(officialCycloneError({ code: 'PGRST205' }), /supabase-official-cyclone-top100.sql/);
  assert.match(officialCycloneError({ code: '40001' }), /another tab/);
});

test('saving uses a separate owner RPC and version; failed or mismatched confirmations are rejected', async () => {
  const { saveOfficialCycloneRanks: save } = await model;
  const ranks = { [id(1)]: 1 }, calls = [];
  const client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: { ranks, updated_at: 'next' } }; } };
  assert.deepEqual(await save(client, ranks, 'previous'), { ranks, updated_at: 'next' });
  assert.equal(calls[0].name, 'utwx_save_official_cyclone_top100');
  assert.deepEqual(calls[0].args, { p_ranks: ranks, p_expected_updated_at: 'previous' });
  await assert.rejects(() => save({ rpc: async () => ({ data: { ranks: {}, updated_at: 'next' } }) }, ranks, 'previous'), /not confirmed/);
  await assert.rejects(() => save({ rpc: async () => ({ error: { code: '40001' } }) }, ranks, 'previous'), error => error.code === '40001');
  await assert.rejects(() => save(client, ranks, null), /Refresh/);
});
