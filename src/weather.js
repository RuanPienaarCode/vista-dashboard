'use strict';
/* Weather from Open-Meteo (open-meteo.com — free, no key, no account).
   Two requests: geocode the place name once, then the forecast. Both go
   through Obsidian's requestUrl so they work on mobile. Nothing about the
   vault is sent — only the place name, then a latitude and longitude. */

const D = require('./dates');

const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';

/* WMO weather codes → words and a lucide icon. */
function describe(code, isDay) {
  const c = Number(code);
  const day = isDay !== 0 && isDay !== false;
  if (c === 0) return { label: day ? 'Clear' : 'Clear night', icon: day ? 'sun' : 'moon' };
  if (c === 1) return { label: 'Mostly clear', icon: day ? 'cloud-sun' : 'cloud-moon' };
  if (c === 2) return { label: 'Partly cloudy', icon: day ? 'cloud-sun' : 'cloud-moon' };
  if (c === 3) return { label: 'Overcast', icon: 'cloud' };
  if (c === 45 || c === 48) return { label: 'Fog', icon: 'cloud-fog' };
  if (c >= 51 && c <= 57) return { label: 'Drizzle', icon: 'cloud-drizzle' };
  if (c >= 61 && c <= 67) return { label: c >= 66 ? 'Freezing rain' : 'Rain', icon: 'cloud-rain' };
  if (c >= 71 && c <= 77) return { label: 'Snow', icon: 'cloud-snow' };
  if (c >= 80 && c <= 82) return { label: 'Showers', icon: 'cloud-rain' };
  if (c === 85 || c === 86) return { label: 'Snow showers', icon: 'cloud-snow' };
  if (c >= 95 && c <= 99) return { label: 'Thunderstorm', icon: 'cloud-lightning' };
  return { label: 'Weather', icon: 'cloud' };
}

function geocodeUrl(name) { return `${GEO}?name=${encodeURIComponent(name)}&count=1&language=en&format=json`; }
const DAILY = 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,weather_code,sunrise,sunset,wind_speed_10m_max,wind_direction_10m_dominant';
function forecastUrl(lat, lon) {
  return `${FORECAST}?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m&daily=${DAILY}&timezone=auto&forecast_days=7`;
}

/* A human page for the same spot — the Norwegian Meteorological Institute's
   yr.no takes plain coordinates, so no second lookup is needed. */
function moreInfoUrl(lat, lon) {
  const f = v => Number(v).toFixed(4);
  return `https://www.yr.no/en/forecast/daily-table/${f(lat)},${f(lon)}`;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function compass(deg) {
  if (deg === null || deg === undefined || !isFinite(deg)) return '';
  return COMPASS[Math.round((((Number(deg) % 360) + 360) % 360) / 45) % 8];
}

/* "2026-09-16T07:02" → "07:02". Taken off the string, never through a Date:
   the API already answered in the place's own time zone (timezone=auto), and
   a Date would quietly shift it into the viewer's. */
function hhmm(iso) {
  const m = /T(\d{2}:\d{2})/.exec(String(iso || ''));
  return m ? m[1] : '';
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/* "Today", "Tomorrow", then "Fri 18". Day-of-week from the date string itself. */
function dayName(iso, today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return '';
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const tm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today || ''));
  if (tm) {
    const n = Math.round((t - Date.UTC(+tm[1], +tm[2] - 1, +tm[3])) / 86400000);
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
  }
  return `${DAYS[new Date(t).getUTCDay()]} ${+m[3]}`;
}
function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return '';
  return `${DAYS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()]} ${+m[3]} ${MONTHS[+m[2] - 1]}`;
}

/* request: async url → json (Obsidian's requestUrl(...).json, or fetch). */
async function geocode(request, name) {
  const j = await request(geocodeUrl(name));
  const r = j && j.results && j.results[0];
  if (!r) return null;
  return { lat: r.latitude, lon: r.longitude, label: [r.name, r.admin1, r.country_code].filter(Boolean).join(', ').replace(/, ([A-Z]{2})$/, ' · $1') };
}

/* Shape the forecast into what the header shows. */
function shape(json, unit) {
  const cur = json.current || {}, d = json.daily || {};
  const conv = v => (v === null || v === undefined) ? null : (unit === 'f' ? v * 9 / 5 + 32 : v);
  const round = v => (v === null ? null : Math.round(v));
  const w = describe(cur.weather_code, cur.is_day);
  const at = (arr, i) => (arr && arr[i] !== undefined ? arr[i] : null);
  const days = [];
  for (let i = 0; i < (d.time || []).length; i++) {
    const dw = describe(at(d.weather_code, i), 1);
    const mm = at(d.precipitation_sum, i);
    const wind = at(d.wind_speed_10m_max, i);
    days.push({
      date: d.time[i], label: dw.label, icon: dw.icon,
      hi: round(conv(at(d.temperature_2m_max, i))), lo: round(conv(at(d.temperature_2m_min, i))),
      rain: at(d.precipitation_probability_max, i),
      rainMm: mm === null ? null : Math.round(mm * 10) / 10,
      wind: wind === null ? null : Math.round(wind),
      windDir: compass(at(d.wind_direction_10m_dominant, i)),
      sunrise: hhmm(at(d.sunrise, i)), sunset: hhmm(at(d.sunset, i)),
    });
  }
  return {
    temp: round(conv(cur.temperature_2m)), feels: round(conv(cur.apparent_temperature)),
    code: cur.weather_code, isDay: cur.is_day, label: w.label, icon: w.icon,
    wind: cur.wind_speed_10m === undefined ? null : Math.round(cur.wind_speed_10m),
    hi: round(conv(d.temperature_2m_max ? d.temperature_2m_max[0] : null)), lo: round(conv(d.temperature_2m_min ? d.temperature_2m_min[0] : null)),
    /* No rain / tomorrow here on purpose: both used to be copied off slot 0 and
       slot 1 at fetch time, so a forecast shown days later printed an old
       day's rain as today's. forecastView() reads them off the matching row. */
    days,
    /* timezone=auto answers in the PLACE's clock; this is how far that clock
       is from UTC, so "today there" can be worked out without the device's. */
    utcOffset: Number.isFinite(json.utc_offset_seconds) ? json.utc_offset_seconds : null,
    unit: unit === 'f' ? '°F' : '°C', at: Date.now(),
  };
}

async function fetchWeather(request, lat, lon, unit) {
  const json = await request(forecastUrl(lat, lon));
  return shape(json, unit);
}

/* The header's H/L must be TODAY's, not whatever sat in slot 0 when this
   forecast was fetched. A fresh fetch's days[0] is today, but a persisted
   `weatherLast` shown days after its fetch is not — trusting the top-level
   hi/lo then quietly relabels an old day's range as today's. Matching the
   date is the fix; no match means no H/L, not a guess. */
function todayHiLo(w, today) {
  const days = w && Array.isArray(w.days) ? w.days : [];
  const d = days.find(x => x && x.date === today);
  return d ? { hi: d.hi, lo: d.lo } : { hi: null, lo: null };
}

/* ---- the place's own clock --------------------------------------------- */

const pad2 = n => (n < 10 ? '0' : '') + n;

/* The calendar date at a place `offsetSec` from UTC, at instant `ms`. Read off
   a UTC-shifted Date so the device's own zone never enters into it. */
function dayAt(ms, offsetSec) {
  const d = new Date(ms + offsetSec * 1000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/* Today in the forecast's place. A forecast saved before offsets were kept
   has none, and falls back to the device's date (the old behaviour). The
   offset is the one in force at fetch time; across a clock change it can be
   an hour out, which only matters in the hour either side of midnight. */
function placeToday(w, nowMs) {
  const off = w && Number.isFinite(w.utcOffset) ? w.utcOffset : null;
  return off === null ? D.todayISO(new Date(nowMs)) : dayAt(nowMs, off);
}

/* True when the fetch was not on the place's today — the current conditions
   (temp, label) then describe some earlier moment and should not be shown as
   "now". No fetch time at all counts as stale: freshness is never assumed. */
function isStale(w, nowMs) {
  if (!w || !w.at) return true;
  const off = Number.isFinite(w.utcOffset) ? w.utcOffset : null;
  const fetchedDay = off === null ? D.todayISO(new Date(w.at)) : dayAt(w.at, off);
  return fetchedDay !== placeToday(w, nowMs);
}

/* Everything the header derives from the week, for "now": today's H/L and
   rain, tomorrow's summary, and whether the whole forecast is stale. A row
   that is not there gives null, never a neighbouring day's number. */
function forecastView(w, nowMs) {
  const today = placeToday(w, nowMs);
  const days = w && Array.isArray(w.days) ? w.days : [];
  const row = iso => days.find(x => x && x.date === iso) || null;
  const t = row(today), n = row(D.addDays(today, 1));
  return {
    today,
    hi: t ? t.hi : null, lo: t ? t.lo : null, rain: t ? t.rain : null,
    tomorrow: n ? { hi: n.hi, lo: n.lo, rain: n.rain, label: n.label, icon: n.icon } : null,
    stale: isStale(w, nowMs),
  };
}

/* ---- a geocode answer belongs to the place it was asked about ------------ */

/* The Place field can change while the geocode request is in flight. The answer
   is for `queryAtStart`; if the field now says something else those coordinates
   must not be stored under the new name. Returns the geo stamped with the query
   it answered, or null to drop it. */
function acceptGeo(queryAtStart, currentQuery, geo) {
  if (!geo) return null;
  const a = String(queryAtStart || '').trim(), b = String(currentQuery === undefined || currentQuery === null ? '' : currentQuery).trim();
  if (!a || a !== b) return null;
  return Object.assign({}, geo, { query: a });
}

/* ---- the per-device cache ------------------------------------------------ */

/* The last forecast and the geocoded coordinates are properties of THIS device
   (its clock, its last fetch), not of the vault. In data.json they synced to
   every device, and writing them rewrote the whole settings file — reverting
   edits made elsewhere. They live in localStorage instead, keyed so two vaults
   on one device never share them. `storage` is passed in so this stays pure. */
function cacheKey(vaultName, pluginId) { return `${pluginId || 'vista'}:weather:${vaultName || ''}`; }

const EMPTY = () => ({ geo: null, last: null });
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

function readCache(storage, key) {
  try {
    const raw = storage && storage.getItem(key);
    if (!raw) return EMPTY();
    const o = JSON.parse(raw);
    if (!isObj(o)) return EMPTY();
    return { geo: isObj(o.geo) ? o.geo : null, last: isObj(o.last) ? o.last : null };
  } catch (e) { return EMPTY(); }
}

function writeCache(storage, key, cache) {
  try {
    if (!storage) return false;
    storage.setItem(key, JSON.stringify({ geo: cache && cache.geo || null, last: cache && cache.last || null }));
    return true;
  } catch (e) { return false; }
}

/* A cached entry counts only for the place and unit it was made for. */
function cacheFor(cache, query, unit) {
  const q = String(query || '').trim();
  const c = cache || EMPTY();
  if (!q) return EMPTY();
  const geo = isObj(c.geo) && c.geo.query === q ? c.geo : null;
  const wantUnit = unit === 'f' ? '°F' : '°C';
  const last = isObj(c.last) && c.last.query === q && c.last.unit === wantUnit ? c.last : null;
  return { geo, last };
}

/* "updated 07:02" when the fetch was today; "updated Wed 16 Sep, 07:02"
   when it was not — so a stale forecast never reads as if it just landed. */
function updatedLabel(atMs, today, clock24) {
  if (!atMs) return '';
  const d = new Date(atMs);
  const day = D.todayISO(d);
  const time = D.fmtTime(d, clock24 !== false);
  return day === today ? `updated ${time}` : `updated ${longDate(day)}, ${time}`;
}

module.exports = { placeToday, isStale, forecastView, acceptGeo, cacheKey, readCache, writeCache, cacheFor, describe, geocode, fetchWeather, shape, geocodeUrl, forecastUrl, moreInfoUrl, compass, hhmm, dayName, longDate, todayHiLo, updatedLabel };
