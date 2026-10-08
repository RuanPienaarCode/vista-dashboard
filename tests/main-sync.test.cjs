'use strict';
/* data.json syncs to every device. Guards the two-device clobber: the volatile
   weather cache no longer rides in data.json (so a background weather fetch
   never rewrites the whole settings file), and an edit made on another device
   is picked up by onExternalSettingsChange() instead of being reverted by the
   next save from a stale in-memory copy. */
const assert = require('node:assert');
const stub = require('./_stub.cjs');
const Module = require('node:module');
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === './view' || request === './settings-tab') return {};
  return origLoad.call(this, request, ...rest);
};
const disk = { data: null, writes: 0 };
stub.Plugin = class { async loadData() { return disk.data && JSON.parse(JSON.stringify(disk.data)); } async saveData(d) { disk.writes++; disk.data = JSON.parse(JSON.stringify(d)); } };
const VistaPlugin = require('../src/main');
Module._load = origLoad;

/* one localStorage per DEVICE; the two "devices" below get their own */
const mkStorage = () => { const m = new Map(); return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } }; };
let storage = mkStorage();
global.window = { get localStorage() { if (storage === 'denied') throw new Error('SecurityError'); return storage; } };

const device = (vaultName, store) => {
  const p = new VistaPlugin();
  p.manifest = { id: 'vista' };
  p.app = { vault: { getName: () => vaultName }, workspace: { getLeavesOfType: () => [] } };
  p.refreshed = 0;
  p.refreshViews = () => { p.refreshed++; };
  p._store = store;
  return p;
};
const on = (p, fn) => { storage = p._store; return fn(); };
const load = p => on(p, () => p.loadSettings());

(async () => {
  assert.strictEqual(typeof VistaPlugin.prototype.onExternalSettingsChange, 'function', 'syncing devices need the hook');

  /* ---- r14: Mac's weather refresh must not revert the phone's edit -------- */
  const mac = device('Home', mkStorage()), phone = device('Home', mkStorage());
  await load(mac); await load(phone);
  mac.settings.weatherLocation = 'London'; await on(mac, () => mac.saveSettings());
  await load(phone); phone.settings.weatherLocation = 'London';
  phone.settings.tiles = [{ label: 'Prayer list', icon: 'church', kind: 'note', target: 'Prayer', group: 'Apps' }];
  phone.settings.widgetOrder = ['rhythm', 'tasks'];
  await on(phone, () => phone.saveSettings());                        // edit on the phone; data.json syncs
  const writesBefore = disk.writes;
  on(mac, () => mac.saveWeatherCache({ geo: { query: 'London', lat: 1, lon: 2, label: 'London, GB' }, last: { temp: 21, unit: '°C' } }));   // the Mac's 30-min refresh
  assert.strictEqual(disk.writes, writesBefore, 'a weather fetch writes nothing to data.json');
  assert.deepStrictEqual(disk.data.tiles.map(t => t.label), ['Prayer list'], 'the phone’s tiles survive');
  assert.deepStrictEqual(disk.data.widgetOrder, ['rhythm', 'tasks']);
  assert.ok(!('weatherLast' in disk.data) && !('weatherGeo' in disk.data), 'the cache is not in data.json at all');

  /* ---- ...and the Mac then picks the phone's edit up ---------------------- */
  const macSettingsRef = mac.settings;
  await on(mac, () => mac.onExternalSettingsChange());
  assert.deepStrictEqual(mac.settings.tiles.map(t => t.label), ['Prayer list'], 'reloaded from disk');
  assert.deepStrictEqual(mac.settings.widgetOrder, ['rhythm', 'tasks']);
  assert.strictEqual(mac.settings, macSettingsRef, 'updated IN PLACE: a settings tab or view holding the object sees it');
  assert.strictEqual(mac.refreshed, 1, 'open dashboards re-render');
  /* a later save from the Mac now carries the phone’s edit instead of reverting it */
  mac.settings.name = 'R'; await on(mac, () => mac.saveSettings());
  assert.deepStrictEqual(disk.data.tiles.map(t => t.label), ['Prayer list']);
  assert.strictEqual(disk.data.name, 'R');
  /* a setting deleted elsewhere does not linger */
  disk.data = { name: 'Only' };
  await on(mac, () => mac.onExternalSettingsChange());
  assert.strictEqual(mac.settings.name, 'Only'); assert.strictEqual(mac.settings.tiles, null, 'removed key falls back to the default');

  /* ---- the per-device cache ---------------------------------------------- */
  const d1 = device('Home', mkStorage()), d2 = device('Home', mkStorage());
  disk.data = { weatherLocation: 'London', weatherUnit: 'c' };
  await load(d1); await load(d2);
  const geo = { query: 'London', lat: 51.5, lon: -0.12, label: 'London, GB' };
  assert.ok(on(d1, () => d1.saveWeatherCache({ geo, last: { temp: 17, unit: '°C' } })));
  assert.strictEqual(on(d1, () => d1.loadWeatherCache()).last.temp, 17);
  assert.strictEqual(on(d1, () => d1.loadWeatherCache()).last.query, 'London', 'stamped with the place it was fetched for');
  assert.strictEqual(on(d2, () => d2.loadWeatherCache()).last, null, 'another device does not see it');
  const other = device('Work', d1._store); await load(other); other.settings.weatherLocation = 'London';
  assert.strictEqual(on(other, () => other.loadWeatherCache()).last, null, 'another vault on the same device does not see it');
  d1.settings.weatherLocation = 'Durban';
  assert.deepStrictEqual(on(d1, () => d1.loadWeatherCache()), { geo: null, last: null }, 'a cache for another place is ignored once the Place changes');
  d1.settings.weatherLocation = 'London'; d1.settings.weatherUnit = 'f';
  assert.strictEqual(on(d1, () => d1.loadWeatherCache()).last, null, 'and for another unit');
  d1.settings.weatherUnit = 'c';
  on(d1, () => d1.clearWeatherCache());
  assert.deepStrictEqual(on(d1, () => d1.loadWeatherCache()), { geo: null, last: null });

  /* storage that throws (private mode, blocked): weather still works for the session */
  const nostore = device('Home', 'denied'); await load(nostore); nostore.settings.weatherLocation = 'London';
  assert.doesNotThrow(() => on(nostore, () => nostore.saveWeatherCache({ geo, last: { temp: 3, unit: '°C' } })));
  assert.strictEqual(on(nostore, () => nostore.loadWeatherCache()).last.temp, 3, 'falls back to memory');

  /* ---- one-time migration out of data.json -------------------------------- */
  disk.data = { weatherLocation: 'London', weatherUnit: 'c', name: 'Keep', weatherGeo: geo, weatherLast: { temp: 9, unit: '°C', query: 'London' } };
  const old = device('Home', mkStorage());
  await load(old);
  assert.ok(!('weatherGeo' in old.settings) && !('weatherLast' in old.settings), 'no longer part of settings');
  assert.strictEqual(on(old, () => old.loadWeatherCache()).geo.lat, 51.5, 'moved into this device’s storage');
  assert.strictEqual(on(old, () => old.loadWeatherCache()).last.temp, 9);
  assert.ok(!('weatherGeo' in disk.data) && !('weatherLast' in disk.data), 'and scrubbed from data.json');
  assert.strictEqual(disk.data.name, 'Keep', 'nothing else was lost');
  /* a forecast saved by the old version has no place stamp: it takes its geo's */
  disk.data = { weatherLocation: 'London', weatherUnit: 'c', weatherGeo: geo, weatherLast: { temp: 11, unit: '°C' } };
  const old2 = device('Home', mkStorage()); await load(old2);
  assert.strictEqual(on(old2, () => old2.loadWeatherCache()).last.temp, 11, 'an unstamped legacy forecast is kept for its own place');
  /* migration is once: an existing local entry is not overwritten by a stale synced one */
  disk.data = { weatherLocation: 'London', weatherUnit: 'c', weatherLast: { temp: -50, unit: '°C', query: 'London' } };
  await load(old);
  assert.strictEqual(on(old, () => old.loadWeatherCache()).last.temp, 9, 'the device’s own newer cache wins');
  /* the settings tab may still assign these keys; they never reach disk */
  old.settings.weatherGeo = null; old.settings.weatherLast = null; await on(old, () => old.saveSettings());
  assert.ok(!('weatherGeo' in disk.data) && !('weatherLast' in disk.data));
  assert.ok(!('weatherGeo' in require('../src/constants').DEFAULT_SETTINGS), 'and defaults no longer declare them');

  console.log('main-sync OK');
})().catch(e => { console.error(e); process.exit(1); });
