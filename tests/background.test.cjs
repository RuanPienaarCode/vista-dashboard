'use strict';
const assert = require('node:assert');
const B = require('../src/background');

const paths = ['Home.md', 'Dashboard/Backgrounds/b.jpg', 'Dashboard/Backgrounds/a.PNG', 'Dashboard/Backgrounds/sub/c.webp', 'Dashboard/Backgrounds/notes.md', 'Other/d.jpg', 'Dashboard/Backgroundsx/e.jpg'];
assert.deepStrictEqual(B.listPhotos(paths, 'Dashboard/Backgrounds'), ['Dashboard/Backgrounds/a.PNG', 'Dashboard/Backgrounds/b.jpg', 'Dashboard/Backgrounds/sub/c.webp']);
assert.deepStrictEqual(B.listPhotos(paths, '/Dashboard/Backgrounds/'), B.listPhotos(paths, 'Dashboard/Backgrounds'), 'slashes are forgiven');
assert.strictEqual(B.listPhotos(paths, '').length, 5, 'blank folder = every image');
assert.deepStrictEqual(B.listPhotos(paths, 'Nope'), []);

const photos = B.listPhotos(paths, 'Dashboard/Backgrounds');
assert.strictEqual(B.pickPhoto([], 'daily', '', '2026-09-12'), null);
assert.strictEqual(B.pickPhoto(photos, 'daily', '', '2026-09-12'), B.pickPhoto(photos, 'daily', '', '2026-09-12'), 'same day, same photo');
assert.ok(photos.includes(B.pickPhoto(photos, 'daily', '', '2026-09-13')));
assert.strictEqual(B.pickPhoto(photos, 'fixed', 'Dashboard/Backgrounds/b.jpg', 'x'), 'Dashboard/Backgrounds/b.jpg');
assert.ok(photos.includes(B.pickPhoto(photos, 'fixed', 'Gone/away.jpg', 'x')), 'a missing fixed photo falls back to the seed pick');

assert.strictEqual(B.nextPhoto(photos, photos[2]), photos[0], 'wraps');
assert.strictEqual(B.nextPhoto(photos, 'not-in-list'), photos[0]);
assert.strictEqual(B.nextPhoto([], 'x'), null);

assert.strictEqual(B.photoTitle('Dashboard/Backgrounds/jonatan-pie-night_road.jpg'), 'jonatan pie night road');
assert.ok(B.GRADIENTS.length >= 4);
assert.strictEqual(B.gradientPreset('nope'), B.GRADIENTS[0], 'unknown id → first preset');
assert.strictEqual(B.gradientCss('nope'), B.gradientCss(B.GRADIENTS[0].id));
assert.ok(B.gradientCss('ocean').includes('gradient'));

/* ---- every preset must actually paint: no bare colour at the top level of
   the image list, or the browser drops the whole background-image rule and
   only Ocean (which has never needed a base colour) would ever show. ---- */
function topLevelTerms(css) {
  const out = []; let depth = 0, start = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) { out.push(css.slice(start, i).trim()); start = i + 1; }
  }
  out.push(css.slice(start).trim());
  return out;
}
for (const g of B.GRADIENTS) {
  const layers = B.gradientLayers(g.id);
  assert.strictEqual(layers.image, g.image);
  for (const term of topLevelTerms(layers.image)) {
    assert.ok(/\)\s*$/.test(term), `${g.id}: top-level term "${term}" is not a completed gradient function (a bare colour there would invalidate the whole background-image rule)`);
  }
  if (g.color) assert.ok(/^#|^rgb|^hsl/.test(g.color), `${g.id}: color must be a real colour value`);
}
/* the historical bug: gradientCss() used to hand that same bare colour to
   background-image directly — assert the split values never do. */
for (const g of B.GRADIENTS) {
  assert.ok(!/,\s*#[0-9a-f]{3,8}\s*$/i.test(B.gradientLayers(g.id).image), `${g.id}: image must not end in a bare colour`);
}
console.log('background OK');
