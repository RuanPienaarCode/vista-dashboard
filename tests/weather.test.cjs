'use strict';
const assert = require('node:assert');
const W = require('../src/weather');

assert.deepStrictEqual(W.describe(0, 1), { label: 'Clear', icon: 'sun' });
assert.deepStrictEqual(W.describe(0, 0), { label: 'Clear night', icon: 'moon' });
assert.strictEqual(W.describe(2, 0).icon, 'cloud-moon');
assert.strictEqual(W.describe(3, 1).label, 'Overcast');
assert.strictEqual(W.describe(45).icon, 'cloud-fog');
assert.strictEqual(W.describe(63).icon, 'cloud-rain');
assert.strictEqual(W.describe(82).label, 'Showers');
assert.strictEqual(W.describe(95).icon, 'cloud-lightning');
assert.strictEqual(W.describe(999).icon, 'cloud');
assert.ok(W.geocodeUrl('London').includes('name=London'));

const json = { current: { temperature_2m: 17.4, apparent_temperature: 19.2, weather_code: 3, is_day: 0, wind_speed_10m: 3.7 },
  daily: { time: ['2026-09-13', '2026-09-14'], temperature_2m_max: [25.9, 16.8], temperature_2m_min: [14.1, 13.5], precipitation_probability_max: [92, 100], weather_code: [82, 81] } };
const s = W.shape(json, 'c');
assert.strictEqual(s.temp, 17); assert.strictEqual(s.feels, 19); assert.strictEqual(s.label, 'Overcast'); assert.strictEqual(s.icon, 'cloud');
assert.strictEqual(s.hi, 26); assert.strictEqual(s.lo, 14); assert.strictEqual(s.wind, 4);
assert.strictEqual(s.days[0].rain, 92, 'rain lives on the day rows (forecastView picks the right one)');
assert.strictEqual(W.shape(json, 'f').temp, 63);
assert.strictEqual(W.shape({}, 'c').temp, null, 'a bare response does not throw');
assert.deepStrictEqual(W.shape({}, 'c').days, [], 'and has no days to show');

/* ---- the week ------------------------------------------------------------ */
assert.ok(W.forecastUrl(1, 2).includes('forecast_days=7'));
for (const f of ['sunrise', 'sunset', 'wind_speed_10m_max', 'wind_direction_10m_dominant', 'precipitation_sum']) {
  assert.ok(W.forecastUrl(1, 2).includes(f), 'asks for ' + f);
}
const week = { current: json.current, daily: {
  time: ['2026-09-16', '2026-09-17', '2026-09-18'],
  temperature_2m_max: [16.3, 16.8, 19.2], temperature_2m_min: [12.1, 12.0, 12.3],
  precipitation_probability_max: [100, 2, 0], precipitation_sum: [6.25, 0, null],
  weather_code: [81, 1, 1],
  sunrise: ['2026-09-16T06:52', '2026-09-17T06:51', '2026-09-18T06:49'],
  sunset: ['2026-09-16T18:38', '2026-09-17T18:39', '2026-09-18T18:40'],
  wind_speed_10m_max: [31.6, 12.2, 8], wind_direction_10m_dominant: [315, 170, 44],
} };
const wk = W.shape(week, 'c');
assert.strictEqual(wk.days.length, 3);
assert.deepStrictEqual(wk.days[0], { date: '2026-09-16', label: 'Showers', icon: 'cloud-rain', hi: 16, lo: 12, rain: 100, rainMm: 6.3, wind: 32, windDir: 'NW', sunrise: '06:52', sunset: '18:38' });
assert.strictEqual(wk.days[2].rainMm, null, 'an unknown rainfall stays unknown, not 0');
assert.strictEqual(wk.days[1].windDir, 'S');
assert.strictEqual(W.forecastView(wk, new Date(2026, 8, 16, 12).getTime()).tomorrow.label, 'Mostly clear', 'tomorrow is read off the week, so the two never disagree');
assert.strictEqual(W.shape(week, 'f').days[0].hi, 61, 'the week follows the unit setting too');

/* times come straight off the string — no timezone shift */
assert.strictEqual(W.hhmm('2026-09-16T06:52'), '06:52');
assert.strictEqual(W.hhmm(''), '');
assert.strictEqual(W.compass(0), 'N');
assert.strictEqual(W.compass(359), 'N');
assert.strictEqual(W.compass(-90), 'W');
assert.strictEqual(W.compass(null), '');
assert.strictEqual(W.dayName('2026-09-16', '2026-09-16'), 'Today');
assert.strictEqual(W.dayName('2026-09-17', '2026-09-16'), 'Tomorrow');
assert.strictEqual(W.dayName('2026-09-18', '2026-09-16'), 'Fri 18');
assert.strictEqual(W.dayName('2026-10-01', '2026-09-30'), 'Tomorrow', 'across a month end');
assert.strictEqual(W.longDate('2026-09-16'), 'Wed 16 Sep');
assert.strictEqual(W.moreInfoUrl(51.50741, -0.12781), 'https://www.yr.no/en/forecast/daily-table/51.5074,-0.1278');

/* ---- the header's H/L must be today's, never a stale days[0] ------------- */
assert.deepStrictEqual(W.todayHiLo(wk, '2026-09-17'), { hi: 17, lo: 12 }, 'matches the row for the 17th, not days[0] (the 16th)');
assert.deepStrictEqual(W.todayHiLo(wk, '2026-09-30'), { hi: null, lo: null }, 'no matching day → no H/L, not a guess');
assert.deepStrictEqual(W.todayHiLo(null, '2026-09-16'), { hi: null, lo: null });
assert.deepStrictEqual(W.todayHiLo({ days: [] }, '2026-09-16'), { hi: null, lo: null });

/* the exact audit repro: a forecast fetched two days ago, read today */
const stale = W.shape({
  current: { temperature_2m: 14, weather_code: 1, is_day: 1 },
  daily: { time: ['2026-09-25', '2026-09-26', '2026-09-27'], temperature_2m_max: [31, 22, 18], temperature_2m_min: [15, 11, 9], weather_code: [0, 3, 61] },
}, 'c');
assert.deepStrictEqual(stale.days.map(d => d.date), ['2026-09-25', '2026-09-26', '2026-09-27']);
assert.deepStrictEqual(W.todayHiLo(stale, '2026-09-27'), { hi: 18, lo: 9 }, 'today (the 27th) reads its own row, not the 25th’s H 31/L 15 that days[0] would give');

/* ---- the forecast footer names the date when the fetch was not today ---- */
assert.strictEqual(W.updatedLabel(0, '2026-09-16', true), '', 'no timestamp, no line');
const fetchedToday = new Date(2026, 8, 16, 7, 2).getTime();
assert.strictEqual(W.updatedLabel(fetchedToday, '2026-09-16', true), 'updated 07:02');
const fetchedStale = new Date(2026, 8, 25, 7, 2).getTime();
assert.strictEqual(W.updatedLabel(fetchedStale, '2026-09-27', true), 'updated Fri 25 Sep, 07:02');
assert.strictEqual(W.updatedLabel(fetchedToday, '2026-09-16', false), 'updated 7:02 am');

(async () => {
  const calls = [];
  const req = async url => { calls.push(url); return url.includes('geocoding') ? { results: [{ name: 'London', admin1: 'England', country_code: 'GB', latitude: 51.5, longitude: -0.12 }] } : json; };
  const g = await W.geocode(req, 'London');
  assert.deepStrictEqual(g, { lat: 51.5, lon: -0.12, label: 'London, England · GB' });
  assert.strictEqual(await W.geocode(async () => ({ results: [] }), 'Nowhere'), null);
  const f = await W.fetchWeather(req, g.lat, g.lon, 'c');
  assert.strictEqual(f.temp, 17);
  assert.ok(calls[1].includes('latitude=51.5'));
  console.log('weather OK');
})().catch(e => { console.error(e); process.exit(1); });
