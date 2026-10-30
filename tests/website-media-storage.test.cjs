const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const model = import(pathToFileURL(path.join(__dirname, '../website-media-storage.js')).href);
const project = 'https://kxhqfwlfendphhwurhcg.supabase.co';
const site = 'https://tornadodatabase.vercel.app';
const bytes = Buffer.alloc(50000, 127), sha = crypto.createHash('sha256').update(bytes).digest('hex');
const sourceUrl = project + '/storage/v1/object/public/uploads/photo.jpg';
const entry = { bucket: 'uploads', sourcePath: 'photo.jpg', sourceUrl, originalFilename: 'photo.jpg', originalSHA256: sha, originalBytes: bytes.length, sourceETag: '"original"', replacementSHA256: sha, replacementBytes: bytes.length, replacementFilename: 'photo.jpg', replacementMimeType: 'image/jpeg', archiveUrl: site + '/media-archive/' + sha + '.jpg', label: 'Image' };
const plan = () => ({ version: 1, identicalBytes: true, projectUrl: project, siteUrl: site, entries: [structuredClone(entry)] });
const read = async () => new Response(bytes, { headers: { 'Content-Type': 'image/jpeg' } });

function fixture(options = {}) {
  const calls = [], objects = new Map([['photo.jpg', { id: 'object-1', metadata: { size: bytes.length, eTag: options.changed ? 'changed' : 'original' } }]]);
  const tables = { uploads: [{ id: 'upload', file_url: sourceUrl, display_file_size: bytes.length, status: 'approved', category: 'photos' }], tornadoes: [{ id: 'tornado', cover_image: sourceUrl, description: options.embedded ? sourceUrl : '' }], cyclone_uploads: [], tropical_cyclones: [] };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) },
    rpc: async () => ({ data: !options.nonowner }),
    from(table) {
      let after, filters = [], offset = 0, end = 999;
      const query = {
        select() { return query; }, order() { return query; }, range(a, b) { offset = a; end = b; return query; }, update(value) { after = value; return query; }, eq(field, value) { filters.push([field, value]); return query; },
        async maybeSingle() {
          calls.push({ op: 'update', table, after });
          if (options.denyUpdate) return { error: Error('Denied') };
          const row = tables[table].find(row => filters.every(([field, value]) => row[field] === value));
          if (!row) return { data: null };
          Object.assign(row, after);
          if (options.lateCover && table === 'tornadoes') tables.tornadoes.push({ id: 'late', cover_image: sourceUrl });
          return { data: { id: row.id } };
        },
        then(resolve, reject) { return Promise.resolve({ data: structuredClone(tables[table].slice(offset, end + 1)) }).then(resolve, reject); }
      };
      return query;
    },
    storage: { from(bucket) { return {
      async list(_folder, { search }) { return { data: [...objects].filter(([name]) => name === search).map(([name, object]) => ({ name, ...object })) }; },
      async remove(paths) { calls.push({ op: 'remove', bucket, paths }); if (!options.silentRemove) paths.forEach(path => objects.delete(path)); return {}; }
    }; } }
  };
  return { client, calls, tables, objects };
}

test('website migration verifies exact bytes, updates media and covers, then frees storage without changing records', async () => {
  const m = await model, f = fixture(), receipts = [];
  const batch = await m.prepareWebsiteMediaBatch(f.client, plan(), { read });
  assert.equal(batch.savedBytes, bytes.length); assert.equal(f.calls.length, 0);
  const result = await m.applyWebsiteMediaBatch(f.client, batch, { read, onReceipt: async value => receipts.push(structuredClone(value)) });
  assert.equal(result.savedBytes, bytes.length); assert.deepEqual(result.failures, []);
  assert.equal(f.tables.uploads[0].file_url, entry.archiveUrl); assert.equal(f.tables.tornadoes[0].cover_image, entry.archiveUrl);
  assert.equal(f.tables.uploads[0].category, 'photos'); assert.equal(f.tables.uploads[0].status, 'approved');
  assert.equal(f.tables.uploads[0].display_file_size, bytes.length); assert.equal(f.objects.size, 0);
  assert.deepEqual(f.calls.map(call => call.op), ['update', 'update', 'remove']);
  assert.ok(receipts.some(items => items[0]?.status === 'prepared')); assert.equal(receipts.at(-1)[0].status, 'finished');
});

test('nonowners, changed hosted bytes, and failed recovery storage cannot mutate references or delete files', async () => {
  const m = await model;
  const denied = fixture({ nonowner: true }); await assert.rejects(m.prepareWebsiteMediaBatch(denied.client, plan(), { read }), /Owner/); assert.equal(denied.calls.length, 0);
  const f = fixture(); await assert.rejects(m.prepareWebsiteMediaBatch(f.client, plan(), { read: async () => new Response('changed', { headers: { 'Content-Type': 'image/jpeg' } }) }), /differs/);
  const batch = await m.prepareWebsiteMediaBatch(f.client, plan(), { read });
  await assert.rejects(m.applyWebsiteMediaBatch(f.client, batch, { read }), /Recovery storage/);
  assert.equal(f.calls.length, 0); assert.equal(f.objects.size, 1);
});

test('source changes, rejected updates, embedded links and newly added cover references keep Supabase copies', async () => {
  const m = await model;
  for (const option of ['changed', 'denyUpdate', 'embedded', 'lateCover', 'silentRemove']) {
    const f = fixture({ [option]: true }), batch = await m.prepareWebsiteMediaBatch(f.client, plan(), { read });
    const result = await m.applyWebsiteMediaBatch(f.client, batch, { read, onReceipt: async () => {} });
    assert.equal(result.savedBytes, 0, option); assert.equal(f.objects.size, 1, option); assert.ok(result.failures.length, option);
    if (option !== 'silentRemove') assert.ok(!f.calls.some(call => call.op === 'remove'), option);
  }
});

test('action-time copy verification catches changes after preparation', async () => {
  const m = await model, f = fixture(), batch = await m.prepareWebsiteMediaBatch(f.client, plan(), { read });
  const result = await m.applyWebsiteMediaBatch(f.client, batch, { read: async () => new Response(null, { status: 404 }), onReceipt: async () => {} });
  assert.equal(result.savedBytes, 0); assert.equal(f.calls.length, 0); assert.equal(f.objects.size, 1);
});

test('interrupted removal can resume from verified references without repeating updates', async () => {
  const m = await model, f = fixture({ silentRemove: true }), batch = await m.prepareWebsiteMediaBatch(f.client, plan(), { read });
  const first = await m.applyWebsiteMediaBatch(f.client, batch, { read, onReceipt: async () => {} });
  f.objects.clear(); const before = f.calls.length;
  const second = await m.applyWebsiteMediaBatch(f.client, batch, { read, previous: first.receipts, onReceipt: async () => {} });
  assert.equal(second.savedBytes, bytes.length); assert.equal(f.calls.length, before);
});

test('archive plans are restricted to identical public images on the existing website', async () => {
  const m = await model;
  for (const change of [ { archiveUrl: 'https://foreign.test/media-archive/' + sha + '.jpg' }, { replacementSHA256: 'a'.repeat(64) }, { originalBytes: -1 }, { bucket: 'private' }, { sourceUrl: project + '/storage/v1/object/sign/uploads/photo.jpg' } ]) {
    const p = plan(); Object.assign(p.entries[0], change); const f = fixture();
    await assert.rejects(m.prepareWebsiteMediaBatch(f.client, p, { read })); assert.equal(f.calls.length, 0);
  }
  const p = plan(); p.entries.push(p.entries[0]); await assert.rejects(m.prepareWebsiteMediaBatch(fixture().client, p, { read }));
});
