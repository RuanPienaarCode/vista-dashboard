'use strict';
/* Weather is shown in the PLACE's time, from the forecast's own days — never
   from numbers frozen at fetch time, and never from the device's date. Guards
   the audit's stale-display, wrong-place-geo and per-device-cache findings. */
const assert = require('node:assert');
const W = require('../src/weather');

const week = (dates, extra) => Object.assign({
  current: { temperature_2m: 31, apparent_temperature: 33, weather_code: 0, is_day: 1, wind_speed_10m: 12 },
  utc_offset_seconds: 7200,
  daily: {
    time: dates, temperature_2m_max: [31, 22, 20, 19, 25, 26, 27], temperature_2m_min: [15, 12, 11, 10, 13, 14, 15],
    precipitation_probability_max: [80, 5, 0, 0, 10, 0, 0], precipitation_sum: [9, 0, 0, 0, 0, 0, 0], weather_code: [61, 1, 0, 0, 2, 0, 0],
  },
}, extra || {});
const D29 = ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'];
const D07 = ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'];
const at = (y, m, d, h, mi) => Date.UTC(y, m - 1, d, h, mi || 0);

/* ---- shape records the place's UTC offset, and freezes no "today" fields -- */
const fresh = W.shape(week(D07), 'c');
fresh.at = at(2026, 10, 7, 5); // pinned: shape() stamps the wall clock, and freshness is judged against the pinned 'now' below
assert.strictEqual(fresh.utcOffset, 7200, 'the API answers utc_offset_seconds with timezone=auto');
assert.strictEqual(W.shape({}, 'c').utcOffset, null, 'a bare response has no offset');
assert.ok(!('rain' in fresh) && !('tomorrow' in fresh), 'rain/tomorrow are derived at display time, not stored at fetch time');

/* ---- the place's today ---------------------------------------------------- */
assert.strictEqual(W.placeToday({ utcOffset: 7200 }, at(2026, 10, 7, 21, 59)), '2026-10-07');
assert.strictEqual(W.placeToday({ utcOffset: 7200 }, at(2026, 10, 7, 22, 0)), '2026-10-08', 'SAST is already tomorrow at 22:00 UTC');
assert.strictEqual(W.placeToday({ utcOffset: -5 * 3600 }, at(2026, 10, 8, 4, 59)), '2026-10-07', 'a place west of UTC is still yesterday');
assert.strictEqual(W.placeToday({ utcOffset: 45 * 60 }, at(2026, 10, 7, 23, 15)), '2026-10-08', 'half/quarter-hour zones');
const localToday = (() => { const n = new Date(at(2026, 10, 7, 12)); return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0'); })();
assert.strictEqual(W.placeToday({}, at(2026, 10, 7, 12)), localToday, 'a forecast saved before offsets existed falls back to the device date');
assert.strictEqual(W.placeToday(null, at(2026, 10, 7, 12)), localToday);

/* ---- the display view ----------------------------------------------------- */
const v = W.forecastView(fresh, at(2026, 10, 7, 9));
assert.strictEqual(v.today, '2026-10-07');
assert.deepStrictEqual([v.hi, v.lo, v.rain], [31, 15, 80]);
assert.strictEqual(v.tomorrow.label, 'Mostly clear');
assert.deepStrictEqual([v.tomorrow.hi, v.tomorrow.lo, v.tomorrow.rain], [22, 12, 5]);
assert.strictEqual(v.stale, false);

/* the exact audit repro: a 29 Sep forecast, shown on 7 Oct */
const old = W.shape(week(D29), 'c'); old.at = at(2026, 9, 29, 5);
const ov = W.forecastView(old, at(2026, 10, 7, 9));
assert.strictEqual(ov.rain, null, '29 Sep’s 80% rain is not 7 Oct’s');
assert.strictEqual(ov.tomorrow, null, '30 Sep is not 8 Oct');
assert.deepStrictEqual([ov.hi, ov.lo], [null, null]);
assert.strictEqual(ov.stale, true);
/* the same forecast, still inside its own week, reads the matching rows */
const mid = W.forecastView(old, at(2026, 10, 1, 9));
assert.strictEqual(mid.today, '2026-10-01');
assert.deepStrictEqual([mid.hi, mid.rain], [20, 0]);
assert.strictEqual(mid.tomorrow.hi, 19);
assert.strictEqual(mid.stale, true, 'fetched on the 29th is stale on the 1st even though its rows still match');

/* a place AHEAD of the device: device still 7 Oct 22:30 UTC, the place (UTC+13) is 8 Oct 11:30 */
const ahead = W.shape(week(['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14'], { utc_offset_seconds: 13 * 3600 }), 'c');
ahead.at = at(2026, 10, 7, 22, 20);
const av = W.forecastView(ahead, at(2026, 10, 7, 22, 30));
assert.strictEqual(av.today, '2026-10-08');
assert.deepStrictEqual([av.hi, av.rain], [31, 80], 'the first row is the place’s today, not its tomorrow');
assert.strictEqual(av.stale, false);
/* a place BEHIND the device: UTC-7 at 03:00 UTC on the 8th is still 7 Oct 20:00 there */
const behind = W.shape(week(['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'], { utc_offset_seconds: -7 * 3600 }), 'c');
behind.at = at(2026, 10, 8, 2);
const bv = W.forecastView(behind, at(2026, 10, 8, 3));
assert.strictEqual(bv.today, '2026-10-07');
assert.strictEqual(bv.hi, 31);

/* ---- isStale: fetched on a day other than the place's today -------------- */
const f = W.shape(week(D07), 'c'); f.at = at(2026, 10, 7, 5);                // 07:00 in the place
assert.strictEqual(W.isStale(f, at(2026, 10, 7, 21, 59)), false, 'same place-day');
assert.strictEqual(W.isStale(f, at(2026, 10, 7, 22, 0)), true, 'the place’s midnight passed');
assert.strictEqual(W.isStale({ temp: 1 }, at(2026, 10, 7, 9)), true, 'no fetch time -> cannot claim fresh');
assert.strictEqual(W.isStale(null, at(2026, 10, 7, 9)), true);

/* ---- acceptGeo: a geocode answer belongs to the place it was asked about -- */
const geo = { lat: 51.5, lon: -0.12, label: 'London, GB' };
assert.deepStrictEqual(W.acceptGeo('London', ' London ', geo), { query: 'London', lat: 51.5, lon: -0.12, label: 'London, GB' }, 'same place -> accepted, stamped with the query it answered');
assert.strictEqual(W.acceptGeo('London', 'Durban', geo), null, 'the user moved on mid-lookup: the old coordinates are dropped');
assert.strictEqual(W.acceptGeo('London', 'Londo', geo), null);
assert.strictEqual(W.acceptGeo('London', 'London', null), null, 'no result -> no geo');
assert.strictEqual(W.acceptGeo('London', undefined, geo), null);
assert.strictEqual(geo.query, undefined, 'the input is not mutated');

/* ---- per-device cache ----------------------------------------------------- */
const mem = () => { const m = new Map(); return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, x) => { m.set(k, String(x)); } }; };
const key = W.cacheKey('My Vault', 'vista');
assert.notStrictEqual(key, W.cacheKey('Other Vault', 'vista'), 'keyed by vault');
assert.notStrictEqual(key, W.cacheKey('My Vault', 'other-plugin'), 'and by plugin id');
const st = mem();
assert.deepStrictEqual(W.readCache(st, key), { geo: null, last: null }, 'empty storage -> empty cache');
assert.strictEqual(W.writeCache(st, key, { geo: { query: 'London', lat: 1, lon: 2, label: 'x' }, last: { temp: 5, unit: '°C', query: 'London' } }), true);
assert.strictEqual(W.readCache(st, key).last.temp, 5);
assert.deepStrictEqual(W.readCache(mem(), key), { geo: null, last: null }, 'another device’s storage is empty');
st.m.set(key, '{not json'); assert.deepStrictEqual(W.readCache(st, key), { geo: null, last: null }, 'corrupt -> empty, no throw');
st.m.set(key, '[1,2]'); assert.deepStrictEqual(W.readCache(st, key), { geo: null, last: null }, 'wrong shape -> empty');
const boom = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
assert.deepStrictEqual(W.readCache(boom, key), { geo: null, last: null }, 'a throwing storage never breaks the dashboard');
assert.strictEqual(W.writeCache(boom, key, { geo: null, last: null }), false);
assert.deepStrictEqual(W.readCache(null, key), { geo: null, last: null }, 'no storage at all');
assert.strictEqual(W.writeCache(null, key, {}), false);

/* a cache entry only counts for the place and unit it was made for */
const entry = { geo: { query: 'London', lat: 1, lon: 2, label: 'x' }, last: { temp: 5, unit: '°C', query: 'London' } };
assert.strictEqual(W.cacheFor(entry, 'London', 'c').last.temp, 5);
assert.strictEqual(W.cacheFor(entry, ' London ', 'c').geo.lat, 1, 'trimmed');
assert.deepStrictEqual(W.cacheFor(entry, 'Durban', 'c'), { geo: null, last: null }, 'another place -> nothing');
assert.strictEqual(W.cacheFor(entry, 'London', 'f').last, null, 'another unit invalidates the forecast…');
assert.strictEqual(W.cacheFor(entry, 'London', 'f').geo.lat, 1, '…but the coordinates are unit-free and survive');
assert.deepStrictEqual(W.cacheFor(entry, '', 'c'), { geo: null, last: null }, 'no place set -> nothing');

console.log('weather-place-time OK');
