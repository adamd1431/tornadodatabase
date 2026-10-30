const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const apiPromise = import(pathToFileURL(path.join(__dirname, '../api/public-catalog.js')).href);
const clientPromise = import(pathToFileURL(path.join(__dirname, '../public-catalog.js')).href);
const base = 'https://tornadodatabase.vercel.app/index.html';

async function serve(resource, read, options = {}) {
  const original = global.fetch; global.fetch = read;
  try {
    return await (await apiPromise).default.fetch(new Request('https://site.test/api/public-catalog?resource=' + resource, options));
  } finally { global.fetch = original; }
}

test('public catalog caches only anonymous approved rows and never forwards visitor credentials', async () => {
  const seen = [];
  const response = await serve('tornadoes', async (url, init) => {
    seen.push({ url, init }); return new Response(JSON.stringify([{ id: 'one', status: 'approved' }]));
  }, { headers: { Authorization: 'Bearer owner-secret', Cookie: 'private-session' } });
  assert.equal(response.status, 200);
  const query = new URL(seen[0].url);
  assert.equal(query.origin, 'https://kxhqfwlfendphhwurhcg.supabase.co');
  assert.equal(query.searchParams.get('status'), 'eq.approved');
  assert.equal(seen[0].init.headers.Cookie, undefined);
  assert.notEqual(seen[0].init.headers.Authorization, 'Bearer owner-secret');
  const jwt = JSON.parse(Buffer.from(seen[0].init.headers.apikey.split('.')[1], 'base64url'));
  assert.equal(jwt.role, 'anon');
  assert.equal(response.headers.get('Vercel-CDN-Cache-Control'), 'public, max-age=300');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual((await response.json()).rows, [{ id: 'one', status: 'approved' }]);
});

test('counts paginate every approved upload and preserve video exclusions without exposing URLs', async () => {
  const calls = [];
  const response = await serve('upload-counts', async url => {
    calls.push(new URL(url).searchParams.get('offset'));
    const rows = calls.length === 1 ? Array.from({ length: 1000 }, () => ({ tornado_id: 'one', file_url: 'https://x/photo.png' })) : [
      { tornado_id: 'two', file_url: 'https://x/movie%2Emp4?x=1' },
      { tornado_id: 'two', file_url: 'https://x/movie.jpg', category: 'videos' },
      { tornado_id: 'two', file_url: 'data:video/mp4;base64,AA' },
      { tornado_id: 'two', file_url: 'https://x/animation.gif' },
      { tornado_id: null, file_url: 'https://x/photo.png' }
    ];
    return new Response(JSON.stringify(rows));
  });
  const body = await response.json();
  assert.deepEqual(calls, ['0', '1000']); assert.equal(body.total, 1001);
  assert.deepEqual(body.counts, [{ tornado_id: 'one', upload_count: 1000 }, { tornado_id: 'two', upload_count: 1 }]);
  assert.equal(JSON.stringify(body).includes('file_url'), false);
});

test('cyclone catalog keeps zero-upload cyclones with approved upload counts', async () => {
  const response = await serve('cyclones', async url => {
    const query = new URL(url).searchParams;
    assert.equal(query.get('cyclone_uploads.status'), 'eq.approved');
    assert.equal(query.get('select'), '*,cyclone_uploads(count)');
    return new Response(JSON.stringify([{ id: 'one', status: 'approved', cyclone_uploads: [{ count: 4 }] }, { id: 'two', status: 'approved', cyclone_uploads: [] }]));
  });
  assert.deepEqual((await response.json()).rows.map(row => row.upload_count), [4, 0]);
});

test('failed reads, unexpected private rows, unsupported resources and writes are not cached', async () => {
  for (const read of [async () => new Response('', { status: 503 }), async () => { throw Error('Offline'); }, async () => new Response('[{"id":"private","status":"pending"}]')]) {
    const response = await serve('tornadoes', read);
    assert.equal(response.status, 502); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  let calls = 0;
  for (const [resource, options] of [['profiles', {}], ['uploads', {}], ['tornadoes&select=*', {}], ['tornadoes', { method: 'POST' }]]) {
    const response = await serve(resource, async () => { calls++; }, options);
    assert.ok([404, 405].includes(response.status)); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal(calls, 0);
});

test('client validates public responses and falls back on deployment errors or local previews', async () => {
  const { loadPublicCatalog } = await clientPromise;
  const body = { resource: 'upload-counts', generatedAt: new Date().toISOString(), counts: [{ tornado_id: 'one', upload_count: 5 }], total: 5 };
  const read = async (_url, options) => { assert.equal(options.credentials, 'omit'); return new Response(JSON.stringify(body)); };
  assert.equal((await loadPublicCatalog('upload-counts', { base, read })).counts.get('one'), 5);
  body.total = 6; assert.equal(await loadPublicCatalog('upload-counts', { base, read }), null);
  assert.equal(await loadPublicCatalog('tornadoes', { base, read: async () => new Response('', { status: 404 }) }), null);
  assert.equal(await loadPublicCatalog('tornadoes', { base: 'http://localhost:8000/index.html', read: () => { throw Error('Must not fetch'); } }), null);
});
