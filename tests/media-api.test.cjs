const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../api/media.js'), 'utf8');
const { pathToFileURL } = require('node:url');
const handler = import(pathToFileURL(path.join(__dirname, '../api/media.js')).href).then(module => module.default);
const origin = 'https://kxhqfwlfendphhwurhcg.supabase.co/storage/v1/object/public/';

async function withFetch(stub, work) {
  const original = global.fetch;
  global.fetch = stub;
  try { return await work(await handler); }
  finally { global.fetch = original; }
}

test('archived images redirect to their exact website copy without contacting Supabase', async () => {
  const index = JSON.parse(fs.readFileSync(path.join(__dirname, '../media-archive-index.json'), 'utf8'));
  const [source, archived] = Object.entries(index)[0]; let calls = 0;
  await withFetch(async () => { calls++; throw Error('Must not fetch'); }, async api => {
    const response = await api.fetch(new Request('https://site.test/media/' + source));
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('Location'), '/media-archive/' + archived);
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
  });
  assert.equal(calls, 0);
});

test('delivery streams exact bytes and caches only image headers, excluding upstream cookies', async () => {
  const bytes = Uint8Array.from([0, 255, 127, 10, 13, 1, 2, 3]);
  let fetched;
  await withFetch(async (url, options) => {
    fetched = { url, options };
    return new Response(bytes, { headers: { 'content-type': 'image/gif', 'cache-control': 'private, no-cache', 'set-cookie': 'upstream=secret', 'etag': '"same"', 'content-length': '8' } });
  }, async api => {
    const response = await api.fetch(new Request('https://site.test/media/uploads/owner/photo%20one.gif?quality=2', { headers: { Cookie: 'session=private', Authorization: 'Bearer private', Range: 'bytes=0-1' } }));
    assert.equal(fetched.url, origin + 'uploads/owner/photo%20one.gif');
    assert.equal(fetched.options.headers, undefined);
    assert.equal(fetched.options.redirect, 'error');
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
    assert.equal(response.headers.get('Content-Type'), 'image/gif');
    assert.equal(response.headers.get('ETag'), '"same"');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('Content-Length'), null, 'streamed content must not reuse an encoded upstream length');
    assert.equal(response.headers.get('Vercel-CDN-Cache-Control'), 'public, max-age=86400');
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=86400');
  });
});

test('rewritten requests and HEAD use the same fixed public origin', async () => {
  const seen = [];
  await withFetch(async (url, options) => { seen.push([url, options.method]); return new Response(null, { headers: { 'content-type': 'image/jpeg' } }); }, async api => {
    const response = await api.fetch(new Request('https://site.test/api/media?bucket=cyclone-uploads&path=owner%2Fphoto.jpg', { method: 'HEAD' }));
    assert.deepEqual(seen, [[origin + 'cyclone-uploads/owner/photo.jpg', 'HEAD']]);
    assert.equal(response.status, 200); assert.equal(await response.text(), '');
  });
});

test('invalid paths, private buckets, non-images and writes never reach the origin', async () => {
  await withFetch(() => { throw Error('Must not fetch'); }, async api => {
    for (const query of ['bucket=private&path=photo.jpg', 'bucket=uploads&path=..%2Fprivate%2Fphoto.jpg', 'bucket=uploads&path=folder%5C..%5Cphoto.jpg', 'bucket=uploads&path=file.pdf', 'bucket=uploads&path=%00photo.png', 'bucket=uploads&path=https%3A%2F%2Fother.test%2Fphoto.jpg', 'bucket=uploads&path=photo%25ZZ.jpg']) {
      const response = await api.fetch(new Request('https://site.test/api/media?' + query));
      assert.equal(response.status, 404, query); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    }
    const response = await api.fetch(new Request('https://site.test/media/uploads/photo.jpg', { method: 'POST' }));
    assert.equal(response.status, 405);
  });
});

test('origin errors and non-image responses cannot enter the public cache', async () => {
  for (const stub of [async () => new Response('Not found', { status: 404 }), async () => new Response('<html>Denied</html>', { headers: { 'content-type': 'text/html' } }), async () => { throw Error('Network'); }]) {
    await withFetch(stub, async api => {
      const response = await api.fetch(new Request('https://site.test/media/uploads/photo.jpg'));
      assert.ok([404, 502].includes(response.status)); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    });
  }
});

test('images above the cache limit keep their full bytes through a direct source redirect', async () => {
  let cancelled = false;
  await withFetch(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'image/gif', 'content-length': String(21 * 1024 * 1024) } }), async api => {
    const response = await api.fetch(new Request('https://site.test/media/uploads/large.gif'));
    assert.equal(response.status, 307); assert.equal(response.headers.get('Location'), origin + 'uploads/large.gif');
    assert.equal(response.headers.get('Cache-Control'), 'no-store'); assert.equal(cancelled, true);
  });
});
