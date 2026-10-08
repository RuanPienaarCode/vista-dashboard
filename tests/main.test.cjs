'use strict';
/* Guards VistaPlugin.loadSettings(): DEFAULT_SETTINGS must never be shared
   live with a vault's settings (a shallow Object.assign leaves every vault
   mutating the same nested objects), and a data.json that is not a plain
   object (corrupt, an array, missing) must never leak stray keys onto
   settings. main.js requires ./view and ./settings-tab, which pull in DOM
   assumptions this harness has no reason to load — routed to a stub so this
   test stays decoupled from whatever those files look like mid-edit. */
const assert = require('node:assert');
require('./_stub.cjs');
const Module = require('node:module');
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === './view' || request === './settings-tab') return {};
  return origLoad.call(this, request, ...rest);
};
const VistaPlugin = require('../src/main');
Module._load = origLoad;
const { DEFAULT_SETTINGS } = require('../src/constants');

(async () => {
  const run = async data => {
    const p = new VistaPlugin();
    p.loadData = async () => data;
    await p.loadSettings();
    return p.settings;
  };

  /* ---- no shared reference: resizing one vault's widget must not touch
     every other vault's defaults ---- */
  const before = JSON.stringify(DEFAULT_SETTINGS.widgetSizes);
  const s = await run({ name: 'Old user' });
  assert.notStrictEqual(s.widgetSizes, DEFAULT_SETTINGS.widgetSizes, 'settings must own its own widgetSizes object, not the shared default');
  s.widgetSizes.stats = 'small';
  assert.strictEqual(JSON.stringify(DEFAULT_SETTINGS.widgetSizes), before, 'resizing one view must never mutate the shared defaults');

  const s2 = await run({ name: 'Another user' });
  assert.deepStrictEqual(s2.widgetSizes, {}, 'the next load starts from a clean default, unaffected by the first');

  /* ---- malformed data.json is ignored, never spread ---- */
  for (const d of [null, undefined, 'corrupt', [1, 2], 42]) {
    const r = await run(d);
    const stray = Object.keys(r).filter(k => !(k in DEFAULT_SETTINGS));
    assert.deepStrictEqual(stray, [], `data ${JSON.stringify(d)} must not leak stray keys onto settings, got ${JSON.stringify(stray)}`);
    assert.strictEqual(r.tiles, null, 'falls back to the built-in tile defaults');
    assert.deepStrictEqual(r.collapsed, []);
    assert.deepStrictEqual(r.widgetSizes, {});
  }

  /* ---- a plain object with malformed fields is still normalised ---- */
  const withBadFields = await run({ tiles: 'x', collapsed: 'a', widgetSizes: 'nope', widgetOrder: 1 });
  assert.deepStrictEqual(withBadFields.collapsed, [], 'a non-array collapsed is normalised, not trusted');
  assert.deepStrictEqual(withBadFields.widgetSizes, {});
  assert.deepStrictEqual(withBadFields.widgetOrder, []);

  /* ---- shapes that pass a typeof-object check but are not maps (r12) ----- */
  const arr = await run({ widgetSizes: [], tiles: [null, 3, 'x', [], { label: 'A', kind: 'note', target: 'A', group: 'Apps' }] });
  assert.ok(!Array.isArray(arr.widgetSizes) && Object.keys(arr.widgetSizes).length === 0, 'an array is not a size map');
  arr.widgetSizes.rhythm = 'wide';
  assert.strictEqual(JSON.parse(JSON.stringify(arr.widgetSizes)).rhythm, 'wide', 'so a size set on it survives a save');
  assert.deepStrictEqual(arr.tiles.map(t => t.label), ['A'], 'null/number/string/array tiles are dropped');
  const T = require('../src/tiles');
  assert.doesNotThrow(() => T.groupTiles(T.resolveTiles(arr)), 'and the page still renders');
  assert.deepStrictEqual((await run({ widgetSizes: null })).widgetSizes, {});
  assert.strictEqual((await run({ tiles: 'x' })).tiles, null, 'a non-array tiles falls back to the built-in set');
  assert.strictEqual((await run({ tiles: {} })).tiles, null);
  assert.deepStrictEqual((await run({ tiles: [] })).tiles, [], 'an empty list stays empty — the user removed them all');

  /* ---- a user's saved settings are never replaced by the defaults -------- */
  const mine = [{ label: 'Mine', icon: 'home', kind: 'note', target: 'Mine', group: 'Areas' }];
  const kept = await run({ tiles: mine, weatherLocation: 'Durban', budgetFolder: 'Money/B', journalFolder: 'J', gymFolder: 'Fit', journalTemplate: 'T/D' });
  assert.deepStrictEqual(kept.tiles, mine);
  assert.strictEqual(kept.weatherLocation, 'Durban'); assert.strictEqual(kept.budgetFolder, 'Money/B');
  assert.strictEqual(kept.journalFolder, 'J'); assert.strictEqual(kept.gymFolder, 'Fit'); assert.strictEqual(kept.journalTemplate, 'T/D');
  assert.strictEqual((await run({ weatherLocation: '' })).weatherLocation, '', 'a place the user cleared stays cleared');

  console.log('main OK');
})().catch(e => { console.error(e); process.exit(1); });
