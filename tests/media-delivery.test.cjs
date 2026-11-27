const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'media-delivery.js'), 'utf8');
const model = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const origin = 'https://kxhqfwlfendphhwurhcg.supabase.co';
const base = 'https://tornadodatabase.vercel.app/tornado.html?id=one';

test('a free-hosting move serves existing website archive and media links from the new host',async()=>{
  const {cachedPublicMediaUrl:cached}=await model,next='https://tornadodatabase.pages.dev/index.html',name='a'.repeat(64)+'.webp';
  assert.equal(cached('https://tornadodatabase.vercel.app/media-archive/'+name,next),'/media-archive/'+name);
  assert.equal(cached('https://tornadodatabase.vercel.app/storage/v1/object/public/cyclone-uploads/owner/photo.png',next),'/media/cyclone-uploads/owner/photo.png');
  for(const value of ['https://foreign.test/media-archive/'+name,'https://tornadodatabase.vercel.app/private/photo.png','https://user@tornadodatabase.vercel.app/media-archive/'+name])assert.equal(cached(value,next),value);
});

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

test('only the two public media buckets use the image delivery function', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json')));
  const media = config.rewrites.filter(route => route.source.startsWith('/media/'));
  assert.equal(media.length, 2);
  for (const bucket of ['uploads', 'cyclone-uploads']) {
    const route = media.find(route => route.source === `/media/${bucket}/:path*`);
    assert.equal(route.destination, `/api/media?bucket=${bucket}&path=:path*`);
  }
  assert.ok(config.rewrites.some(route => route.source === '/tornado.html/:slug'));
  assert.ok(config.rewrites.some(route => route.source === '/outbreak.html/:slug'));
});

test('ranked generator thumbnails and export images can use the module-scoped media helper', async () => {
  const { cachedPublicMediaUrl } = await model;
  const html = fs.readFileSync(path.join(root, 'generator.html'), 'utf8');
  const bootstrap = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
    .replace(/^import .*?;\r?\n/gm, '');
  const functions = html.slice(html.indexOf('function escapeHtml('), html.indexOf('function prettyCategory('))
    + html.slice(html.indexOf('function loadTop100Image('), html.indexOf('function mediaNaturalWidth('));
  const nextBase = 'https://tornadodatabase.pages.dev/generator?mode=list&list=one';
  for (const mode of ['mode=list&list=one', 'top100=1']) {
    const context = vm.createContext({
      URLSearchParams,
      location: { search: '?' + mode },
      mediaHelper: value => cachedPublicMediaUrl(value, nextBase),
      dbClient: {},
      rankedSlideStory: {},
      Image: class {
        set src(value) { this.loadedUrl = value; queueMicrotask(() => this.onload()); }
      }
    });
    vm.runInContext('window = globalThis; const top100ImageCache = new Map();', context);
    // Keep imported names in their own scope, as they are in a browser module.
    vm.runInContext(`(function(cachedPublicMediaUrl, supabase, rankedSlideStory) { ${bootstrap}\n})(mediaHelper, dbClient, rankedSlideStory);`, context);
    vm.runInContext(functions, context);
    for (const url of [
      `${origin}/storage/v1/object/public/uploads/photo.png`,
      'https://tornadodatabase.vercel.app/media-archive/' + 'a'.repeat(64) + '.webp'
    ]) {
      context.imageUrl = url;
      const expected = cachedPublicMediaUrl(url, nextBase);
      assert.ok(vm.runInContext('renderMediaThumb(imageUrl, "Example")', context).includes(`src="${expected}"`));
      const image = await vm.runInContext('loadTop100Image(imageUrl)', context);
      assert.equal(image.loadedUrl, expected);
      assert.equal(image.crossOrigin, 'anonymous');
      assert.equal(await vm.runInContext('loadTop100Image(imageUrl)', context), image);
    }
    assert.equal(await vm.runInContext('loadTop100Image("")', context), null);
    assert.equal(await vm.runInContext('loadTop100Image("https://site.test/video.mp4")', context), null);
  }
});
