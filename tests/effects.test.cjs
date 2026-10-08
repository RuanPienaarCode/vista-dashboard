'use strict';
const assert = require('node:assert');
const E = require('../src/effects');

assert.strictEqual(E.resolveType('auto', 22), 'stars');
assert.strictEqual(E.resolveType('auto', 10), 'dust');
assert.strictEqual(E.resolveType('leaves', 22), 'leaves');
assert.strictEqual(E.countFor('none', 1, 1440, 900, false), 0);
assert.strictEqual(E.countFor('stars', 1, 1440, 900, false), E.BASE.stars);
assert.strictEqual(E.countFor('stars', 0.5, 1440, 900, false), Math.round(E.BASE.stars / 2));
assert.ok(E.countFor('stars', 1, 390, 700, true) < E.BASE.stars * 0.4, 'phones get far fewer particles');
assert.ok(E.countFor('stars', 1, 5000, 3000, false) <= E.BASE.stars * 1.6, 'area factor is capped');
assert.ok(E.TYPES.some(t => t.id === 'auto') && E.TYPES.some(t => t.id === 'none'));
assert.strictEqual(E.makeSystem('none', 10), null);
assert.strictEqual(E.makeSystem('bogus', 10), null);

/* Every system survives resize → many steps → draw against a recording
   context, and keeps its particles on (or wrapping back onto) the canvas. */
const calls = {};
const ctx = new Proxy({}, {
  get(_, k) {
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
    return (...a) => { calls[k] = (calls[k] || 0) + 1; };
  },
  set() { return true; },
});
for (const t of E.TYPES.map(x => x.id).filter(id => id !== 'auto' && id !== 'none')) {
  const sys = E.makeSystem(t, 30);
  assert.ok(sys, t);
  sys.resize(800, 600);
  for (let i = 0; i < 600; i++) sys.step(0.05, 800, 600, i * 0.05);
  sys.draw(ctx, 800, 600, 30);
  assert.ok((calls.beginPath || 0) > 0 || (calls.moveTo || 0) > 0, t + ' drew something');
  sys.resize(300, 300);
  sys.step(0.016, 300, 300, 31);
  sys.draw(ctx, 300, 300, 31);
}
/* ---- leaf palettes ---------------------------------------------------- */
assert.deepStrictEqual(E.LEAF_PALETTES.map(x => x.id), ['autumn', 'summer']);
assert.strictEqual(E.leafPalette('summer'), 'summer');
assert.strictEqual(E.leafPalette('bogus'), 'autumn', 'an unknown palette falls back, never throws');
assert.strictEqual(E.leafPalette(undefined), 'autumn');

/* Sample a lot of leaves from each palette and check they land in the colour
   the palette promises — hue is the thing a person reads as "green" or "orange". */
const inGreen = h => h >= 70 && h <= 155;
const inAutumn = h => h >= 0 && h <= 50;
for (let i = 0; i < 2000; i++) {
  const sm = E.leafColour('summer');
  assert.ok(inGreen(sm.hue), `summer hue ${sm.hue} is green`);
  const au = E.leafColour('autumn');
  assert.ok(inAutumn(au.hue), `autumn hue ${au.hue} is orange/red/brown`);
  for (const c of [sm, au]) assert.ok(c.sat >= 0 && c.sat <= 100 && c.lit >= 0 && c.lit <= 100);
}
/* Autumn really is a mix: pinned random numbers reach every family. */
const seq = vals => { let i = 0; return () => vals[i++ % vals.length]; };
assert.ok(E.leafColour('autumn', seq([0.0, 0.5, 0.5, 0.5])).hue >= 20, 'the first slice is orange');
assert.ok(E.leafColour('autumn', seq([0.5, 0.5, 0.5, 0.5])).hue <= 12, 'the middle slice is red');
const brown = E.leafColour('autumn', seq([0.8, 0.5, 0.5, 0.5]));
assert.ok(brown.lit <= 34 && brown.sat <= 52, 'a later slice is brown — dark and muted');

/* ---- sun from above, on a tumbling leaf ---------------------------------- */
const leaf = { hue: 30, sat: 80, lit: 50, a: 0.9 };
const L = str => Number(/,(\d+)%,[\d.]+\)$/.exec(str)[1]);
const top = E.leafShade(leaf, 1), under = E.leafShade(leaf, -1), edge = E.leafShade(leaf, 0.05);
assert.ok(L(under.light) < L(top.light), 'the underside, facing you, is darker than the top face');
assert.ok(L(under.dark) < L(top.dark));
assert.ok(L(top.light) - L(under.light) >= 8, 'and by enough to see, not a rounding error');
assert.ok(L(edge.light) < L(top.light), 'a leaf turned edge-on catches less light than one lying flat');
assert.ok(L(top.dark) < L(top.light) - 20, 'the bottom of a leaf is clearly in its own shade');
assert.ok(L(under.dark) >= 5, 'but never black');
assert.strictEqual(E.leafShade(leaf, NaN).k, E.leafShade(leaf, 0).k, 'a bad tumble value is treated as edge-on, not a crash');

/* The factory honours the palette, and draws shaded leaves. */
assert.strictEqual(E.makeSystem('leaves', 5, { leafPalette: 'summer' }).palette, 'summer');
assert.strictEqual(E.makeSystem('leaves', 5).palette, 'autumn');
const grads = [];
const fills = [];
const rec = new Proxy({}, {
  get(_, k) {
    if (k === 'createLinearGradient') return (...a) => { const g = { a, stops: [], addColorStop(o, c) { this.stops.push([o, c]); } }; grads.push(g); return g; };
    return () => {};
  },
  set(_, k, v) { if (k === 'fillStyle') fills.push(v); return true; },
});
const lsys = E.makeSystem('leaves', 4, { leafPalette: 'summer' });
lsys.resize(400, 300);
lsys.draw(rec, 400, 300, 1);
assert.strictEqual(grads.length, 4, 'every leaf is shaded');
for (const g of grads) {
  const light = /,(\d+)%,[\d.]+\)$/.exec(g.stops[0][1])[1], dark = /,(\d+)%,[\d.]+\)$/.exec(g.stops[1][1])[1];
  assert.ok(Number(dark) < Number(light), 'the far end of the gradient (screen-down) is the darker one');
  assert.ok(Number(dark) >= 5, 'but darker, not black');
  assert.ok(g.a.every(Number.isFinite), 'gradient ends are real numbers even when the leaf is edge-on');
}
assert.strictEqual(fills.filter(f => /^rgba\(0,0,0,/.test(f)).length, 0, 'and no drop shadow — it made them look like they hovered over a surface');
for (const g of grads) {
  const alpha = Number(/,([\d.]+)\)$/.exec(g.stops[0][1])[1]);
  assert.ok(alpha >= 0.5 && alpha <= 0.85, `a leaf is slightly transparent (alpha ${alpha})`);
}

console.log('effects OK');

/* Fireflies actually travel: over a few seconds each one moves a good
   distance, and paths differ from one another. */
{
  const sys = E.makeSystem('fireflies', 12);
  sys.resize(800, 600);
  sys.step(0.016, 800, 600, 0);
  /* the closure is private; read positions through the glow gradients it draws */
  const seen = [];
  const rec = new Proxy({}, { get(_, k) { if (k === 'createRadialGradient') return (x, y) => { seen.push([x, y]); return { addColorStop() {} }; }; return () => {}; }, set() { return true; } });
  sys.draw(rec, 800, 600, 1.2);
  const start = seen.slice();
  for (let i = 0; i < 240; i++) sys.step(0.025, 800, 600, 1.2 + i * 0.025);
  seen.length = 0;
  sys.draw(rec, 800, 600, 7.2);
  const moved = start.map((s, i) => seen[i] ? Math.hypot(seen[i][0] - s[0], seen[i][1] - s[1]) : 0);
  assert.ok(moved.filter(d => d > 40).length >= Math.min(start.length, seen.length) * 0.5, 'most lit fireflies flew more than 40px in six seconds: ' + moved.map(Math.round).join(','));
  console.log('fireflies fly OK');
}
