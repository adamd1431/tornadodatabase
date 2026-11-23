import assert from 'node:assert/strict';

// Exercise Pages' real redirect/proxy handling, rather than only checking that
// following redirects eventually returns an HTML document with HTTP 200.
const base = new URL(process.argv[2] || 'https://tornadodatabase.pages.dev/');
const token = '2c1f040e-ff2a-4bf5-b9f6-fecf17c6b96c';
for (const [page, marker] of [
  ['tropical-cyclone.html', 'id="cyclonePage"'],
  ['tropical-cyclone', 'id="cyclonePage"'],
  ['tornado.html', 'id="tornado_pics"'],
  ['outbreak.html', 'id="outbreakTitle"']
]) {
  const url = new URL(`${page}/route-check-2025?imageImport=${token}`, base);
  const response = await fetch(url, {redirect: 'manual'});
  assert.equal(response.status, 200, `${url.pathname} must serve its shell without dropping the named route`);
  assert.equal(response.headers.get('location'), null, `${url.pathname} must not redirect to an unidentified storm`);
  assert.ok((await response.text()).includes(marker), `${url.pathname} must serve the correct page`);
  console.log(`OK ${url.pathname}: named route and image-import query preserved`);
}

const query = new URL(`tropical-cyclone.html?id=${token}&imageImport=${token}`, base);
const response = await fetch(query);
const landed = new URL(response.url);
assert.equal(response.status, 200);
assert.equal(landed.searchParams.get('id'), token, 'legacy query links must retain their storm ID');
assert.equal(landed.searchParams.get('imageImport'), token, 'legacy query links must retain their staged image');
assert.ok((await response.text()).includes('id="cyclonePage"'));
console.log('OK cyclone query link: storm ID and image-import query preserved');
