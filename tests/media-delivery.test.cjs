const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'media-delivery.js'), 'utf8');
const model = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const origin = 'https://kxhqfwlfendphhwurhcg.supabase.co';
const base = 'https://tornadodatabase.vercel.app/tornado.html?id=one';

test('public images use one unchanged-byte cache URL across pages and preview sizes', async () => {
  const { cachedPublicMediaUrl: cached, originalPublicMediaUrl: original } = await model;
  for (const bucket of ['uploads', 'cyclone-uploads']) {
    for (const name of ['photo.jpg', 'photo.PNG', 'animation.gif', 'animation.webp', 'photo.avif', 'photo%20one.png']) {
      const url = `${origin}/storage/v1/object/public/${bucket}/owner/${name}?v=2#view`;
      assert.equal(cached(url, base), `/media/${bucket}/owner/${name}?v=2#view`);
      assert.equal(original(cached(url, base), base), url);
    }
  }
});

test('private, signed, foreign and non-image sources are left alone', async () => {
  const { cachedPublicMediaUrl: cached, originalPublicMediaUrl: original } = await model;
  for (const url of [
    '', 'data:image/png;base64,AAAA', 'blob:https://site.test/image', '/favicon.png',
    'https://other.supabase.co/storage/v1/object/public/uploads/image.png',
    `${origin}/storage/v1/object/sign/uploads/image.png?token=secret`,
    `${origin}/storage/v1/object/authenticated/uploads/image.png`,
    `${origin}/storage/v1/object/public/avatars/photo.png`,
    `${origin}/storage/v1/object/public/uploads/movie.mp4`,
    `${origin}/storage/v1/object/public/uploads/map.pdf`,
    `${origin}/storage/v1/object/public/uploads/bad%2F..%2Fphoto.png`,
    `${origin}/storage/v1/object/public/uploads/bad%ZZ.png`,
    `${origin.replace('https://', 'https://someone@')}/storage/v1/object/public/uploads/photo.png`
  ]) assert.equal(cached(url, base), url);
  for (const url of ['/api/anything', '/media/private/photo.jpg', '/media/uploads/file.pdf', 'https://foreign.test/media/uploads/a.png', 'https://someone@tornadodatabase.vercel.app/media/uploads/a.png']) {
    assert.equal(original(url, base), null);
  }
  const publicUrl = `${origin}/storage/v1/object/public/uploads/photo.png`;
  assert.equal(cached(publicUrl, 'http://localhost:8000/index.html'), publicUrl);
});

test('failed cache images retry the original only once, without a srcset loop', async () => {
  const { installMediaFallback } = await model;
  let listener, removed;
  const root = { addEventListener(type, handler, capture) { assert.equal(type, 'error'); assert.equal(capture, true); listener = handler; }, removeEventListener(type, handler) { removed = handler; } };
  const stop = installMediaFallback(root), writes = [];
  const img = { tagName: 'IMG', baseURI: base, src: '/media/uploads/photo.jpg', getAttribute() { return this.src; }, removeAttribute(name) { assert.equal(name, 'srcset'); }, setAttribute(name, value) { assert.equal(name, 'src'); this.src = value; writes.push(value); } };
  listener({ target: img }); listener({ target: img });
  assert.deepEqual(writes, [`${origin}/storage/v1/object/public/uploads/photo.jpg`]);
  img.src = '/media/uploads/photo.jpg'; listener({ target: img });
  assert.equal(writes.length, 1);
  listener({ target: { tagName: 'VIDEO' } });
  stop(); assert.equal(removed, listener);
});

test('only the two public media buckets have fixed-origin cache routes', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json')));
  const media = config.routes.filter(route => route.src.startsWith('^/media/'));
  assert.equal(media.length, 2);
  for (const bucket of ['uploads', 'cyclone-uploads']) {
    const route = media.find(route => route.src === `^/media/${bucket}/(.+)$`);
    assert.equal(route.dest, `${origin}/storage/v1/object/public/${bucket}/$1`);
    const headers = Object.fromEntries(Object.entries(route.headers).map(([key, value]) => [key.toLowerCase(), value]));
    assert.equal(headers['x-vercel-enable-rewrite-caching'], '1');
    assert.equal(headers['vercel-cdn-cache-control'], 'public, max-age=86400');
    assert.equal(headers['vercel-cache-tag'], 'storm-media');
    assert.equal(headers['cache-control'], 'public, max-age=86400');
    for (const [type, key] of [['response.headers', 'set-cookie'], ['request.headers', 'authorization'], ['request.headers', 'cookie']]) {
      assert.ok(route.transforms.some(item => item.type === type && item.op === 'delete' && item.target.key === key));
    }
  }
  for (const name of ['tornado', 'outbreak']) {
    const route = config.routes.find(route => route.dest === `/${name}.html`);
    assert.ok(new RegExp(route.src).test(`/${name}.html/storm-name`));
    assert.ok(!new RegExp(route.src).test(`/${name}Xhtml/storm-name`));
  }
});
