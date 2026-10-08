'use strict';
/* The dashboard: builds the layered shell (photo, particles, veil, glass
   page), renders each panel from state, and owns search, stats and the
   background lifecycle for one view. Rendering uses the standard DOM API only
   so the preview harness runs the same code. */

const obsidian = require('obsidian');
const { Notice, Platform, Menu } = obsidian;
const { el, icon, button, clear } = require('./dom');
const D = require('./dates');
const S = require('./search');
const { computeStats, fmtNum, fmtBytes } = require('./stats');
const B = require('./background');
const E = require('./effects');
const T = require('./tiles');
const A = require('./actions');
const { TileModal, ListModal, ReminderModal } = require('./modals');
const RH = require('./rhythm');
const CAL = require('./calendar');
const BG = require('./budget');
const TK = require('./tasks');
const NU = require('./nudge');
const GY = require('./gym');
const W = require('./weather');

const RESULT_LIMIT = 8;
const CONTENT_LIMIT = 4;
const STATS_FRESH_MS = 60 * 1000;
/* How many reminders the card shows before it starts counting the rest. */
const NUDGE_LIMIT = 5;

/* What tapping a calendar day should do, decided once and asked everywhere
   (the cell's hint text and the tap handler both need the same answer).
   A day that already has a journal note always opens it, any day. A day
   without one is only ever created going forward — today or later — never
   backdated by a tap on a past square, which would otherwise conjure a
   journal entry for a day that never got one. */
function dayTapAction(iso, today, exists) {
  if (exists) return 'open';
  return iso >= today ? 'create' : 'none';
}

/* Reordering the visible cards must not push every hidden widget to the
   end: a drag only ever sees (and can only reorder) the cards on screen, so
   `visible` here is that new arrangement, and `fullOrder` is the saved order
   including whatever is hidden. Walking fullOrder and substituting the next
   visible key at each visible slot keeps every hidden key in the relative
   position it already held, while the visible ones take their new places. */
function mergeWidgetOrder(fullOrder, visible) {
  const visibleSet = new Set(visible);
  const queue = visible.slice();
  const merged = (fullOrder || []).map(k => (visibleSet.has(k) ? queue.shift() : k));
  return merged.concat(queue);
}

/* What the Budget card's headline says, decided once from currentBudget()'s
   value (src/budget.js) so the three states are testable without a DOM
   (tests/budget-card.test.cjs):
     locked   — the Budget plugin's privacy splash is up and has not been
                opened this session. A label and NO figure: not the amount,
                not the period, not a tooltip.
     noBudget — the period has no budget yet. The Budget plugin's own hero
                reads "New period — nothing budgeted yet" over what has been
                spent; this card read "Over budget R X" for the same state,
                since a budget of 0 minus the spend is negative. So the number
                is what was spent, and there is no meter — a meter of spend
                against nothing is a full bar with no meaning (the hero's own
                reasoning), and it cannot draw an overflow mark either.
     figure   — left to spend, or over budget when negative, as before.
   An older Budget plugin sends neither flag, which reads as `figure` —
   exactly what this card did before the two existed. Vista's own reader
   (src/budget.js's computeBudget) sends noBudget too, by the Budget
   plugin's own test, and never `locked` — it has no lock to honour. */
function budgetHeadline(b) {
  /* Defence in depth: renderBudget prints `b.error` before it ever asks, but
     an error value must never reach the figure branch below (it carries no
     `available`, so it would read as "Over budget"). */
  if (b.error) return { state: 'error' };
  if (b.locked === true) return { state: 'locked', label: 'Budget locked' };
  if (b.noBudget === true) return { state: 'noBudget', amount: b.spent, label: 'Nothing budgeted yet', over: false, meter: false };
  const over = b.available < 0;
  return { state: 'figure', amount: Math.abs(b.available), label: over ? 'Over budget' : 'Left to spend', over, meter: true };
}

/* The Budget card's 60-second cache, as a dashboard stops. A figure from the
   Budget plugin is only as current as the onChange subscription that hears
   its lock close (see start()), and that subscription ends with this
   dashboard — so its figure is dropped, or a dashboard opened inside the
   minute would show again a figure cached before the splash closed. A cached
   lock goes too, or a gate opened meanwhile would still read as locked.
   Vista's own count has no lock to honour and keeps its cache as before. */
function budgetCacheAfterStop(cache) {
  return cache && cache.value && cache.value.source === 'budget-app' ? null : cache;
}

/* Does the Budget card belong on the page? Vista's own reader needs a folder
   with a Settings.md; the Budget plugin's api needs only the plugin. So a
   budget-app user with the folder setting left blank still gets the card —
   including its locked / switched-off / can't-share states, which print no
   figure — and only an install of neither gets nothing. */
function showBudgetCard(app, s) {
  if (s.showBudget === false) return false;
  return BG.budgetAvailable(app, s.budgetFolder) || BG.budgetAppStatus(app).kind !== 'absent';
}

/* The note for a task the Tasks lane refused to tick, in one place so the
   wording is testable. `r` is toggleTask()'s { ok:false, reason, message }. */
function taskRefusedNotice(r) {
  if (r && r.reason === 'line-changed') return 'Vista: that task line has changed — open the note.';
  return 'Vista: ' + ((r && r.message) || 'could not update that task.');
}

/* The note for a Rhythm tick that did not happen. `res` is tick()'s
   { ok:false, reason:'unreadable', key } or { ok:false, reason:'name' }. */
function rhythmRefusedNotice(res) {
  if (res && res.reason === 'unreadable') return `Vista: the "${res.key}" line in today's Rhythm log is in a form Vista can't read, so it left the note alone. Tick it in Rhythm.`;
  return 'Vista: could not write that tick to the Rhythm log.';
}

/* Rhythm ticks the card has drawn but the vault has not yet confirmed. One
   entry per practice name (a single slot lost the first of two quick ticks):
   name -> { on, settled }. `settled` flips once the write has landed; only a
   settled entry may be dropped when a re-read comes back, or a refresh that
   raced an in-flight write would un-tick the row it was still writing. */
function overlayPending(focus, pending) {
  return (focus || []).map(r => {
    const p = pending && pending.get(r.name);
    return p ? Object.assign({}, r, { done: p.on }) : r;
  });
}
function settledPending(pending) {
  return [...pending].filter(([, e]) => e.settled);
}
function dropSettled(pending, snapshot) {
  for (const [name, entry] of snapshot) if (pending.get(name) === entry) pending.delete(name);
}

function mountDashboard(view) {
  const plugin = view.plugin;
  const app = plugin.app;
  const root = view.contentEl;
  root.classList.add('vs-app');
  const settings = () => plugin.settings;
  const isMobile = !!(Platform && Platform.isMobile);
  const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const sessionSeed = 'open-' + Math.random().toString(36).slice(2);

  const state = {
    query: '', results: [], content: [], sel: -1,
    editing: false, stats: null, statsBusy: false,
    photos: [], photo: null, entries: [],
    rhythm: null, rhythmPending: new Map(),
    calOpen: false, calMonth: null,
    budget: null, budgetBusy: false, budgetQueued: false,
    tasks: null, gym: null, nudge: null, nudgeBusy: false, weather: null, weatherKey: null, weatherBusy: false, weatherQueued: false, wxOpen: false, hidden: new Set(),
  };
  let bgLayers = [], bgFront = -1, canvas, veil, page, greetEl, subEl, vaultEl, clockEl;
  let searchWrap, searchInput, resultsEl, tilesEl, colsEl, footEl, photoLabel, calEl, weatherEl, wxEl, captureEl;
  let fx = null, searchTimer = null, contentTimer = null, statsTimer = null, rhythmTimer = null, budgetTimer = null, nudgeTimer = null, unsubscribeBudgetApi = null, stopped = false;
  /* Which Budget plugin instance we are subscribed to, and a counter that goes
     up whenever that instance changes: a read that started against the old
     one must not land on the card (see gatherBudget). */
  let subscribedApi = null, budgetEpoch = 0;
  /* Newest rhythmToday() wins; and whether the first load has been started. */
  let rhythmSeq = 0, rhythmKicked = false, staleWeatherKick = null;
  /* The in-progress card/tile drag's own teardown, so ctl.stop() can cancel
     it if the view closes mid-gesture instead of leaving document-level
     listeners and timers behind. Only one drag runs at a time. */
  let activeDragCancel = null;
  /* The local calendar day the cards were last drawn for, so the 15s tick
     (and a resume from background) can tell a page left open overnight. */
  let lastRenderDay = D.todayISO();

  /* ---- shell ------------------------------------------------------------ */

  function buildShell() {
    clear(root);
    bgLayers = [el(root, 'div', 'vs-bg'), el(root, 'div', 'vs-bg')];
    canvas = el(root, 'canvas', 'vs-fx');
    veil = el(root, 'div', 'vs-veil');
    const scroll = el(root, 'div', 'vs-scroll');
    page = el(scroll, 'div', 'vs-page' + (reduced ? '' : ' is-enter'));

    const head = el(page, 'header', 'vs-head');
    const left = el(head, 'div', 'vs-head-text');
    greetEl = el(left, 'h1', 'vs-greet');
    vaultEl = el(left, 'div', 'vs-vault');
    /* The date sits with the clock, not with the greeting: they answer the
       same question, and the calendar opens from the one you look at for the
       time. The vault's name stays on the left, where the identity is. */
    const right = el(head, 'div', 'vs-head-right');
    const time = el(right, 'div', 'vs-head-time');
    clockEl = el(time, 'div', 'vs-clock');
    subEl = button(time, 'vs-sub', null, () => toggleCalendar());
    subEl.title = 'Calendar';
    subEl.setAttribute('aria-haspopup', 'dialog');
    calEl = el(time, 'div', 'vs-cal is-hidden');
    calEl.setAttribute('role', 'dialog');
    calEl.setAttribute('aria-label', 'Calendar');
    /* Tapping the weather opens the week; refreshing lives inside it. */
    weatherEl = button(right, 'vs-weather is-hidden', null, () => toggleWeather());
    weatherEl.title = 'The week ahead';
    weatherEl.setAttribute('aria-haspopup', 'dialog');
    wxEl = el(right, 'div', 'vs-wx is-hidden');
    wxEl.setAttribute('role', 'dialog');
    wxEl.setAttribute('aria-label', 'Weather this week');
    root.addEventListener('mousedown', e => { if (state.calOpen && !calEl.contains(e.target) && !subEl.contains(e.target)) toggleCalendar(false); });
    root.addEventListener('keydown', e => { if (e.key === 'Escape' && state.calOpen) { toggleCalendar(false); subEl.focus(); } });
    root.addEventListener('mousedown', e => { if (state.wxOpen && !wxEl.contains(e.target) && !weatherEl.contains(e.target)) toggleWeather(false); });
    root.addEventListener('keydown', e => { if (e.key === 'Escape' && state.wxOpen) { toggleWeather(false); weatherEl.focus(); } });

    searchWrap = el(page, 'div', 'vs-search-wrap');
    const box = el(searchWrap, 'div', 'vs-search');
    icon(box, 'search', 'vs-search-icon');
    searchInput = el(box, 'input', 'vs-search-input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search your vault';
    searchInput.setAttribute('spellcheck', 'false');
    searchInput.setAttribute('autocomplete', 'off');
    searchInput.setAttribute('aria-label', 'Search the vault');
    const clearBtn = button(box, 'vs-search-clear', null, () => { setQuery(''); searchInput.focus(); }, 'x');
    clearBtn.setAttribute('aria-label', 'Clear');
    resultsEl = el(searchWrap, 'div', 'vs-results');
    resultsEl.classList.add('is-hidden');
    searchInput.addEventListener('input', () => setQuery(searchInput.value));
    searchInput.addEventListener('keydown', onSearchKey);
    searchInput.addEventListener('focus', () => { if (state.query) showResults(true); });
    root.addEventListener('mousedown', e => { if (!searchWrap.contains(e.target)) showResults(false); });

    captureEl = el(page, 'div', 'vs-capture is-hidden');
    icon(captureEl, 'pen-line', 'vs-capture-icon');
    const capInput = el(captureEl, 'input', 'vs-capture-input');
    capInput.type = 'text';
    capInput.placeholder = 'Jot something into today\'s journal…';
    capInput.setAttribute('aria-label', 'Capture a line into today\'s journal');
    capInput.setAttribute('autocomplete', 'off');
    const capBtn = button(captureEl, 'vs-capture-send', null, () => capture(capInput), 'send');
    capBtn.setAttribute('aria-label', 'Save to journal');
    capInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); capture(capInput); } });
    tilesEl = el(page, 'section', 'vs-section');
    colsEl = el(page, 'div', 'vs-cols');
    footEl = el(page, 'footer', 'vs-foot');
    if (!reduced) setTimeout(() => page && page.classList.remove('is-enter'), 1200);
  }

  /* ---- header ----------------------------------------------------------- */

  function renderHeader() {
    const now = new Date();
    const name = (settings().name || '').trim();
    greetEl.textContent = D.greeting(now.getHours()) + (name ? ', ' + name : '');
    let vaultName = '';
    try { vaultName = app.vault.getName ? app.vault.getName() : ''; } catch (e) { vaultName = ''; }
    subEl.textContent = D.fmtDate(now);
    vaultEl.textContent = vaultName;
    vaultEl.classList.toggle('is-hidden', !vaultName);
    clockEl.textContent = D.fmtTime(now, settings().clock24 !== false);
  }

  /* ---- capture ---------------------------------------------------------- */

  async function capture(input) {
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    try {
      const f = await A.captureToJournal(app, settings(), text);
      input.value = '';
      new Notice(`Captured into ${f.basename}.`);
    } catch (e) {
      console.error('vista capture', e);
      new Notice('Vista: could not write to today\'s journal.');
    } finally { input.disabled = false; input.focus(); }
  }

  /* ---- weather ---------------------------------------------------------- */

  const WEATHER_FRESH_MS = 30 * 60 * 1000;

  function requestJson(url) {
    if (typeof obsidian.requestUrl === 'function') return obsidian.requestUrl({ url }).then(r => r.json);
    return fetch(url).then(r => r.json());
  }

  /* The forecast to draw: this view's own, if it is for the place and unit
     that are set now, else whatever this device cached for them. The cache
     lives per device (plugin.loadWeatherCache) and is already filtered to the
     current place and unit; a forecast held in memory from before the place
     changed is not. */
  function currentWeather() {
    const s = settings();
    if (state.weather && state.weatherKey === `${s.weatherLocation}|${s.weatherUnit}`) return state.weather;
    return plugin.loadWeatherCache().last;
  }

  function renderWeather() {
    if (!weatherEl) return;
    const s = settings();
    const w = currentWeather();
    clear(weatherEl);
    if (s.showWeather === false || !w) { weatherEl.classList.add('is-hidden'); return; }
    weatherEl.classList.remove('is-hidden');
    weatherEl.classList.toggle('is-busy', state.weatherBusy);
    if (w.error) { icon(weatherEl, 'cloud'); el(weatherEl, 'span', 'vs-weather-main', w.error); return; }
    /* Everything "now" is derived in the forecast's own place and clock:
       today's H/L and rain come off today's row (never a neighbouring day's),
       and a forecast fetched on an earlier day there is not current at all. */
    const view = W.forecastView(w, Date.now());
    const place = plugin.loadWeatherCache().geo;
    const bits = [];
    if (view.hi !== null && view.lo !== null) bits.push(`H ${view.hi}° L ${view.lo}°`);
    if (!view.stale && view.rain !== null && view.rain >= 20) bits.push(`${view.rain}% rain`);
    if (place && place.label) bits.push(place.label.split(',')[0]);
    if (view.stale) {
      icon(weatherEl, 'cloud');
      const body = el(weatherEl, 'span', 'vs-weather-body');
      el(body, 'span', 'vs-weather-main', 'Weather out of date');
      el(body, 'span', 'vs-weather-sub', bits.join(' · '));
      weatherEl.title = 'This forecast is from an earlier day · click for the week';
      /* Ask for a fresh one — once per stale forecast, so a refresh that
         fails (offline) is not retried in a tight loop from here. */
      if (!state.weatherBusy && staleWeatherKick !== w.at) {
        staleWeatherKick = w.at;
        setTimeout(() => { if (!stopped) loadWeather(true); }, 0);
      }
      return;
    }
    icon(weatherEl, w.icon);
    const body = el(weatherEl, 'span', 'vs-weather-body');
    el(body, 'span', 'vs-weather-main', `${w.temp}° ${w.label}`);
    el(body, 'span', 'vs-weather-sub', bits.join(' · '));
    weatherEl.title = (w.feels !== null ? `Feels like ${w.feels}°` : '') + (w.wind !== null ? ` · wind ${w.wind} km/h` : '') + (view.tomorrow ? ` · tomorrow ${String(view.tomorrow.label).toLowerCase()}, H ${view.tomorrow.hi}° L ${view.tomorrow.lo}°` : '') + ' · click for the week';
  }

  /* Settings saves weatherLocation on every keystroke and refreshes every
     view, so a load can already be in flight for "C" when "Ca" lands. The
     in-flight request only ever reads the location it started with — it
     must, `s` below is one snapshot — so a location typed while busy would
     otherwise be dropped for good: nothing was left to ask for it again.
     Queuing here means the settled value always gets its own request once
     the in-flight one clears, instead of Vista quietly settling on whatever
     the user had typed by the time the FIRST keystroke's request landed. */
  async function loadWeather(force) {
    const s = settings();
    if (s.showWeather === false || !(s.weatherLocation || '').trim()) { state.weather = null; renderWeather(); return; }
    const cache = plugin._weatherCache;
    const key = `${s.weatherLocation}|${s.weatherUnit}`;
    if (!force && cache && cache.key === key && Date.now() - cache.at < WEATHER_FRESH_MS) { state.weather = cache.data; state.weatherKey = key; renderWeather(); return; }
    if (state.weatherBusy) { state.weatherQueued = true; return; }
    state.weatherBusy = true;
    const startedKey = key;
    /* What the place field said when this request began: the answers below
       are only kept if it still says so. */
    const q = s.weatherLocation.trim();
    const unit = s.weatherUnit || 'c';
    const unchanged = () => `${settings().weatherLocation}|${settings().weatherUnit}` === startedKey;
    renderWeather();
    try {
      let geo = plugin.loadWeatherCache().geo;
      if (!geo || geo.query !== q) {
        const g = await W.geocode(requestJson, q);
        if (!g) throw new Error('place not found');
        /* Typed over while we waited: these coordinates are for a place that
           is no longer the one set. The finally below sees the key changed
           and asks again for the new one. */
        const accepted = W.acceptGeo(q, settings().weatherLocation, g);
        if (!accepted) return;
        geo = accepted;
        plugin.saveWeatherCache({ geo });
      }
      const data = await W.fetchWeather(requestJson, geo.lat, geo.lon, unit);
      if (!unchanged()) return;
      state.weather = data;
      state.weatherKey = startedKey;
      plugin._weatherCache = { key, at: Date.now(), data };
      /* Per device, outside data.json: no settings write on a fetch. */
      plugin.saveWeatherCache({ geo, last: data });
    } catch (e) {
      console.error('vista weather', e);
      if (unchanged() && !currentWeather()) {
        state.weather = { error: /not found/.test(String(e && e.message)) ? 'Place not found' : 'Weather unavailable' };
        state.weatherKey = startedKey;
      }
    } finally {
      state.weatherBusy = false;
      if (!stopped) { renderWeather(); if (state.wxOpen) renderForecast(); }
      const settledKey = `${settings().weatherLocation}|${settings().weatherUnit}`;
      const rerun = state.weatherQueued || settledKey !== startedKey;
      state.weatherQueued = false;
      if (!stopped && rerun) loadWeather(true);
    }
  }

  /* ---- the week, under the weather --------------------------------------- */

  function toggleWeather(on) {
    state.wxOpen = on === undefined ? !state.wxOpen : !!on;
    if (state.wxOpen && state.calOpen) toggleCalendar(false);
    weatherEl.setAttribute('aria-expanded', state.wxOpen ? 'true' : 'false');
    wxEl.classList.toggle('is-hidden', !state.wxOpen);
    if (!state.wxOpen) return;
    renderForecast();
    /* A forecast saved by an older version has no week in it: fetch one. */
    const w = currentWeather();
    if (!w || !Array.isArray(w.days) || !w.days.length) loadWeather(true);
  }

  /* clear()+rebuild drops focus to <body> if it was on the thing being
     rebuilt — and once it is on body, Escape's keydown handler (bound to
     `root`, an element body merely contains) never sees the key at all,
     since a keydown only bubbles UP from its target. Tagging the controls
     that can hold focus with a stable token and refocusing the equivalent
     one after the rebuild keeps Escape reachable across a re-render. */
  function captureFocusToken(container) {
    const a = document.activeElement;
    if (!a || !container.contains(a) || !a.dataset) return null;
    return a.dataset.nav ? 'nav:' + a.dataset.nav : a.dataset.iso ? 'iso:' + a.dataset.iso : null;
  }
  function restoreFocusToken(container, token) {
    if (!token) return;
    const sep = token.indexOf(':');
    const attr = token.slice(0, sep) === 'nav' ? 'data-nav' : 'data-iso';
    const node = container.querySelector(`[${attr}="${token.slice(sep + 1)}"]`);
    if (node && node.focus) node.focus();
  }

  function renderForecast() {
    if (!wxEl) return;
    const focusToken = captureFocusToken(wxEl);
    clear(wxEl);
    const s = settings();
    const w = currentWeather();
    const geo = plugin.loadWeatherCache().geo;
    const u = '°';

    const head = el(wxEl, 'div', 'vs-wx-head');
    const place = el(head, 'div', 'vs-wx-place', geo && geo.label ? geo.label : (s.weatherLocation || 'Weather'));
    place.title = geo && geo.label ? geo.label : '';
    el(head, 'span', 'vs-spacer');
    const again = button(head, 'vs-iconbtn vs-iconbtn-sm' + (state.weatherBusy ? ' is-busy' : ''), null, () => loadWeather(true), 'refresh-cw');
    again.title = 'Refresh';
    again.setAttribute('aria-label', 'Refresh the forecast');
    again.dataset.nav = 'refresh';

    if (!w || w.error) { el(wxEl, 'div', 'vs-empty', w && w.error ? w.error : (state.weatherBusy ? 'Reading the forecast…' : 'No forecast yet.')); restoreFocusToken(wxEl, focusToken); return; }

    /* now — a forecast fetched on an earlier day (in the place's own clock)
       says nothing about now, so only the week below is drawn from it */
    const view = W.forecastView(w, Date.now());
    const now = el(wxEl, 'div', 'vs-wx-now');
    icon(now, view.stale ? 'cloud' : w.icon, 'vs-wx-now-icon');
    el(now, 'div', 'vs-wx-now-temp', view.stale ? '–' : `${w.temp}${u}`);
    const nowText = el(now, 'div', 'vs-wx-now-text');
    el(nowText, 'div', 'vs-wx-now-label', view.stale ? 'Out of date' : w.label);
    const nowBits = [];
    if (!view.stale && w.feels !== null && w.feels !== undefined) nowBits.push(`Feels like ${w.feels}${u}`);
    if (!view.stale && w.wind !== null && w.wind !== undefined) nowBits.push(`Wind ${w.wind} km/h`);
    el(nowText, 'div', 'vs-wx-now-sub', nowBits.join(' · '));

    /* the week */
    const days = Array.isArray(w.days) ? w.days : [];
    if (!days.length) { el(wxEl, 'div', 'vs-empty', state.weatherBusy ? 'Reading the week…' : 'Refresh to load the week.'); }
    /* the place's today, not the device's: a forecast for another time zone
       starts its week on that zone's date */
    const today = view.today;
    const his = days.map(d => d.hi).filter(v => v !== null), los = days.map(d => d.lo).filter(v => v !== null);
    const min = Math.min(...los), max = Math.max(...his), span = Math.max(1, max - min);
    const list = el(wxEl, 'div', 'vs-wx-days');
    for (const d of days) {
      const row = el(list, 'div', 'vs-wx-day' + (d.date === today ? ' is-today' : ''));
      const top = el(row, 'div', 'vs-wx-top');
      const name = el(top, 'div', 'vs-wx-name', W.dayName(d.date, today));
      name.title = W.longDate(d.date);
      const ic = el(top, 'span', 'vs-wx-icon');
      icon(ic, d.icon);
      ic.title = d.label;
      el(top, 'span', 'vs-wx-label', d.label);
      el(top, 'span', 'vs-wx-lo', d.lo === null ? '–' : `${d.lo}${u}`);
      /* the day's range on the week's scale, so a warm day looks warm */
      const bar = el(top, 'span', 'vs-wx-bar');
      if (d.lo !== null && d.hi !== null && isFinite(span)) {
        const fill = el(bar, 'span', 'vs-wx-bar-fill');
        fill.style.left = (((d.lo - min) / span) * 100).toFixed(1) + '%';
        fill.style.width = Math.max(4, ((d.hi - d.lo) / span) * 100).toFixed(1) + '%';
      }
      el(top, 'span', 'vs-wx-hi', d.hi === null ? '–' : `${d.hi}${u}`);

      const sub = el(row, 'div', 'vs-wx-sub');
      const bit = (ico, text, title) => { if (!text) return; const b = el(sub, 'span', 'vs-wx-bit'); icon(b, ico); el(b, 'span', null, text); if (title) b.title = title; };
      bit('droplets', d.rain === null ? '' : `${d.rain}%` + (d.rainMm ? ` · ${d.rainMm} mm` : ''), 'Chance of rain · expected rainfall');
      bit('wind', d.wind === null ? '' : `${d.wind} km/h${d.windDir ? ' ' + d.windDir : ''}`, 'Strongest wind · direction it comes from');
      bit('sunrise', d.sunrise, 'Sunrise');
      bit('sunset', d.sunset, 'Sunset');
    }

    const foot = el(wxEl, 'div', 'vs-wx-foot');
    const updLabel = w.at ? W.updatedLabel(w.at, D.todayISO(), s.clock24 !== false) : '';
    el(foot, 'span', 'vs-wx-src', 'Open-Meteo' + (updLabel ? ` · ${updLabel}` : ''));
    el(foot, 'span', 'vs-spacer');
    if (geo && isFinite(geo.lat) && isFinite(geo.lon)) {
      const more = button(foot, 'vs-wx-more', 'More on yr.no', () => window.open(W.moreInfoUrl(geo.lat, geo.lon)), 'external-link');
      more.title = 'The full forecast for this spot, from the Norwegian Meteorological Institute';
      more.dataset.nav = 'more';
    }
    restoreFocusToken(wxEl, focusToken);
  }

  /* ---- calendar --------------------------------------------------------- */

  function toggleCalendar(on) {
    state.calOpen = on === undefined ? !state.calOpen : !!on;
    if (state.calOpen && !state.calMonth) state.calMonth = D.todayISO();
    if (!state.calOpen) state.calMonth = null;
    subEl.setAttribute('aria-expanded', state.calOpen ? 'true' : 'false');
    calEl.classList.toggle('is-hidden', !state.calOpen);
    if (state.calOpen) renderCalendar();
  }

  /* Days that have a journal note, and days with a Rhythm event. */
  function calendarMarks(monthKey) {
    const journal = new Set(), events = new Map();
    /* The same day-set capture, the Today tile and the streak use: one rule
       (src/actions.js journalDays) for which note is a day's journal. */
    for (const iso of A.journalDays(app.vault.getFiles(), settings().journalFolder).keys()) {
      if (iso.startsWith(monthKey)) journal.add(iso);
    }
    const rs = RH.rhythmSettings(app);
    const evFolder = app.vault.getFolderByPath(rs.folder + '/Events');
    if (evFolder && evFolder.children) {
      for (const f of evFolder.children) {
        if (f.extension !== 'md') continue;
        let fm = null;
        try { fm = (app.metadataCache.getFileCache(f) || {}).frontmatter; } catch (e) { fm = null; }
        const date = fm && String(fm.date || '');
        if (date && date.startsWith(monthKey)) { if (!events.has(date)) events.set(date, []); events.get(date).push(f.basename); }
      }
    }
    return { journal, events };
  }

  function renderCalendar() {
    const focusToken = captureFocusToken(calEl);
    clear(calEl);
    const month = state.calMonth || D.todayISO();
    const today = D.todayISO();
    const weekStart = RH.rhythmSettings(app).weekStart;
    const head = el(calEl, 'div', 'vs-cal-head');
    const prev = button(head, 'vs-iconbtn vs-iconbtn-sm', null, () => { state.calMonth = CAL.shiftMonth(month, -1); renderCalendar(); }, 'chevron-left');
    prev.title = 'Previous month';
    prev.dataset.nav = 'prev';
    const title = button(head, 'vs-cal-title', CAL.monthLabel(month), () => { state.calMonth = D.todayISO(); renderCalendar(); });
    title.title = 'Back to this month';
    title.dataset.nav = 'title';
    const next = button(head, 'vs-iconbtn vs-iconbtn-sm', null, () => { state.calMonth = CAL.shiftMonth(month, 1); renderCalendar(); }, 'chevron-right');
    next.title = 'Next month';
    next.dataset.nav = 'next';
    const grid = el(calEl, 'div', 'vs-cal-grid');
    for (const d of CAL.weekdayRow(weekStart)) el(grid, 'div', 'vs-cal-dow', d);
    const marks = calendarMarks(CAL.monthKey(month));
    for (const row of CAL.monthGrid(month, weekStart, today)) {
      for (const d of row) {
        const has = marks.journal.has(d.iso);
        const action = dayTapAction(d.iso, today, has);
        const cls = ['vs-cal-day', d.inMonth ? '' : 'is-out', d.isToday ? 'is-today' : '', has ? 'has-note' : '', marks.events.has(d.iso) ? 'has-event' : ''].filter(Boolean).join(' ');
        const b = button(grid, cls, String(d.day), () => openDay(d.iso, has));
        b.dataset.iso = d.iso;
        const ev = marks.events.get(d.iso);
        const hint = has ? ' · journal' : action === 'none' ? ' · no journal note for this day' : '';
        b.title = d.iso + (ev ? ' · ' + ev.join(', ') : '') + hint;
        b.setAttribute('aria-label', b.title);
        const dots = el(b, 'span', 'vs-cal-dots');
        if (has) el(dots, 'i', 'vs-dot vs-dot-note');
        if (ev) el(dots, 'i', 'vs-dot vs-dot-event');
      }
    }
    const foot = el(calEl, 'div', 'vs-cal-foot');
    const k1 = el(foot, 'span', 'vs-cal-key'); el(k1, 'i', 'vs-dot vs-dot-note'); k1.appendChild(document.createTextNode('journal'));
    const k2 = el(foot, 'span', 'vs-cal-key'); el(k2, 'i', 'vs-dot vs-dot-event'); k2.appendChild(document.createTextNode('event'));
    el(foot, 'span', 'vs-spacer');
    el(foot, 'span', 'vs-cal-hint', 'Tap a day to open its journal note');
    restoreFocusToken(calEl, focusToken);
  }

  /* A note that exists always opens, any day. A day with none only ever
     creates one going forward (today or later) — a tap on a bare past
     square does nothing but say why, rather than conjuring a journal entry
     for a day that never had one. */
  async function openDay(iso, exists) {
    const action = dayTapAction(iso, D.todayISO(), exists);
    if (action === 'none') { new Notice(`Vista: no journal note for ${iso}.`); return; }
    toggleCalendar(false);
    try { await A.openDailyFor(app, settings(), iso); }
    catch (e) { console.error('vista day', e); new Notice('Vista: could not open that day.'); }
  }

  /* ---- search ----------------------------------------------------------- */

  function buildIndex() {
    const files = app.vault.getFiles();
    state.entries = files.map(f => {
      let aliases = [];
      if (f.extension === 'md') {
        try { const c = app.metadataCache.getFileCache(f); aliases = S.aliasesOf(c && c.frontmatter); } catch (e) { aliases = []; }
      }
      const slash = f.path.lastIndexOf('/');
      return { file: f, basename: f.basename, path: f.path, extension: f.extension, folder: slash > 0 ? f.path.slice(0, slash) : '', mtime: f.stat ? f.stat.mtime : 0, aliases };
    });
  }

  function matcherFactory() {
    return typeof obsidian.prepareFuzzySearch === 'function' ? q => obsidian.prepareFuzzySearch(q) : null;
  }

  function setQuery(q) {
    state.query = q;
    if (searchInput.value !== q) searchInput.value = q;
    searchWrap.classList.toggle('has-query', !!q.trim());
    if (searchTimer) clearTimeout(searchTimer);
    if (contentTimer) clearTimeout(contentTimer);
    if (!q.trim()) { state.results = []; state.content = []; state.sel = -1; renderResults(); showResults(false); return; }
    searchTimer = setTimeout(() => {
      if (!state.entries.length) buildIndex();
      state.results = S.rank(state.entries, q, matcherFactory(), RESULT_LIMIT);
      state.sel = state.results.length ? 0 : -1;
      renderResults();
      showResults(true);
    }, 50);
    contentTimer = setTimeout(() => searchContent(q), 260);
  }

  function omnisearchApi() {
    try { const p = app.plugins && app.plugins.plugins && app.plugins.plugins.omnisearch; return p && p.api && typeof p.api.search === 'function' ? p.api : null; } catch (e) { return null; }
  }

  async function searchContent(q) {
    const api = omnisearchApi();
    if (!api || q.trim().length < 2) { state.content = []; renderResults(); return; }
    try {
      const res = await api.search(q);
      if (stopped || state.query !== q) return;
      const seen = new Set(state.results.map(r => r.entry.path));
      state.content = (res || []).filter(r => r && r.path && !seen.has(r.path)).slice(0, CONTENT_LIMIT).map(r => ({
        path: r.path, basename: r.basename || r.path.slice(r.path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
        excerpt: String(r.excerpt || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
      }));
      renderResults();
    } catch (e) { state.content = []; }
  }

  function allRows() {
    const rows = state.results.map(r => ({ kind: 'file', path: r.entry.path, file: r.entry.file, r }));
    for (const c of state.content) rows.push({ kind: 'content', path: c.path, c });
    rows.push({ kind: 'everything' });
    return rows;
  }

  function showResults(on) { resultsEl.classList.toggle('is-hidden', !on || !state.query.trim()); }

  function renderResults() {
    clear(resultsEl);
    if (!state.query.trim()) return;
    const rows = allRows();
    let i = 0;
    if (state.results.length) el(resultsEl, 'div', 'vs-results-label', 'Notes and files');
    else el(resultsEl, 'div', 'vs-results-label', 'No file names match');
    for (const r of state.results) {
      const idx = i++;
      const row = button(resultsEl, 'vs-result' + (state.sel === idx ? ' is-sel' : ''), null, e => openRow(rows[idx], e));
      icon(row, S.fileIcon(r.entry.extension));
      const body = el(row, 'div', 'vs-result-body');
      const name = el(body, 'div', 'vs-result-name');
      if (r.field === 'name' && typeof obsidian.renderMatches === 'function') {
        try { obsidian.renderMatches(name, r.entry.basename, r.matches); } catch (e) { name.textContent = r.entry.basename; }
      } else {
        name.textContent = r.entry.basename;
        if (r.field === 'alias') el(name, 'span', 'vs-result-alias', ' · alias');
      }
      const meta = el(row, 'div', 'vs-result-path', r.entry.folder || '/');
      if (r.entry.extension !== 'md') el(meta, 'span', 'vs-result-ext', r.entry.extension);
      row.addEventListener('mousemove', () => select(idx, false));
    }
    if (state.content.length) {
      el(resultsEl, 'div', 'vs-results-label', 'In the text');
      for (const c of state.content) {
        const idx = i++;
        const row = button(resultsEl, 'vs-result vs-result-content' + (state.sel === idx ? ' is-sel' : ''), null, e => openRow(rows[idx], e));
        icon(row, 'file-text');
        const body = el(row, 'div', 'vs-result-body');
        el(body, 'div', 'vs-result-name', c.basename);
        if (c.excerpt) el(body, 'div', 'vs-result-excerpt', c.excerpt.length > 140 ? c.excerpt.slice(0, 140) + '…' : c.excerpt);
        row.addEventListener('mousemove', () => select(idx, false));
      }
    }
    const idx = i++;
    const all = button(resultsEl, 'vs-result vs-result-all' + (state.sel === idx ? ' is-sel' : ''), null, e => openRow(rows[idx], e));
    icon(all, 'search');
    el(all, 'div', 'vs-result-body').appendChild(document.createTextNode(`Search everything for “${state.query.trim()}”`));
    el(all, 'kbd', 'vs-kbd', '⇧↩');
    all.addEventListener('mousemove', () => select(idx, false));
  }

  function select(i, scrollTo) {
    const n = allRows().length;
    if (!n) return;
    state.sel = ((i % n) + n) % n;
    const nodes = resultsEl.querySelectorAll('.vs-result');
    nodes.forEach((node, k) => node.classList.toggle('is-sel', k === state.sel));
    if (scrollTo && nodes[state.sel] && nodes[state.sel].scrollIntoView) nodes[state.sel].scrollIntoView({ block: 'nearest' });
  }

  async function openRow(row, e) {
    if (!row) return;
    const q = state.query.trim();
    if (row.kind === 'everything') { A.openGlobalSearch(app, q); return; }
    const mode = e && (e.metaKey || e.ctrlKey) ? 'tab' : undefined;
    const file = row.file || app.vault.getFileByPath(row.path);
    if (!file) { new Notice('Vista: that file has moved.'); return; }
    showResults(false);
    await A.openFile(app, settings(), file, mode);
  }

  function onSearchKey(e) {
    const rows = allRows();
    if (e.key === 'ArrowDown') { e.preventDefault(); select(state.sel + 1, true); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); select(state.sel - 1, true); return; }
    if (e.key === 'Escape') { e.preventDefault(); if (state.query) setQuery(''); else searchInput.blur(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!state.query.trim()) return;
      if (e.shiftKey) { A.openGlobalSearch(app, state.query.trim()); return; }
      const row = rows[state.sel >= 0 ? state.sel : 0];
      openRow(row, e);
    }
  }

  /* ---- editing: hide and restore widgets ---------------------------------- */

  /* Everything on the page that can be hidden, keyed by its settings flag. */
  const WIDGETS = [
    { flag: 'showCapture', name: 'Quick capture' },
    { flag: 'showBudget', name: 'Budget' },
    { flag: 'showRhythm', name: 'Today from Rhythm' },
    { flag: 'showTasks', name: 'Tasks' },
    { flag: 'showNudge', name: 'Reminders' },
    { flag: 'showGym', name: 'Gym' },
    { flag: 'showRecent', name: 'Recent' },
    { flag: 'showStats', name: 'Vault stats' },
  ];

  async function setFlag(flag, on) {
    settings()[flag] = on;
    try { await plugin.saveSettings(); } catch (e) { console.error('vista hide', e); }
    plugin.refreshViews();
  }

  async function setGroupHidden(group, hidden) {
    const set = new Set(settings().hiddenGroups || []);
    if (hidden) set.add(group); else set.delete(group);
    settings().hiddenGroups = [...set];
    try { await plugin.saveSettings(); } catch (e) { console.error('vista hide group', e); }
    plugin.refreshViews();
  }

  const SIZES = ['small', 'normal', 'wide'];
  const SIZE_LABEL = { small: 'S', normal: 'M', wide: 'W' };
  const SIZE_TITLE = { small: 'Small — a quarter of the row', normal: 'Medium — half the row', wide: 'Wide — the full row' };
  const DEFAULT_SIZES = { budget: 'normal', rhythm: 'normal', tasks: 'normal', nudge: 'normal', gym: 'small', recent: 'small', stats: 'wide' };

  function widgetSize(key) {
    const s = (settings().widgetSizes || {})[key];
    return SIZES.includes(s) ? s : DEFAULT_SIZES[key] || 'normal';
  }

  async function setWidgetSize(key, size) {
    if (!settings().widgetSizes) settings().widgetSizes = {};
    settings().widgetSizes[key] = size;
    try { await plugin.saveSettings(); } catch (e) { console.error('vista size', e); }
    plugin.refreshViews();
  }

  const WIDGET_KEYS = ['budget', 'rhythm', 'tasks', 'nudge', 'gym', 'recent', 'stats'];
  const WIDGET_NAME = { budget: 'Budget', rhythm: 'Today from Rhythm', tasks: 'Tasks', nudge: 'Reminders', gym: 'Gym', recent: 'Recent', stats: 'Vault stats' };
  const WIDGET_FLAG = { budget: 'showBudget', rhythm: 'showRhythm', tasks: 'showTasks', nudge: 'showNudge', gym: 'showGym', recent: 'showRecent', stats: 'showStats' };

  function widgetOrder() {
    const saved = (settings().widgetOrder || []).filter(k => WIDGET_KEYS.includes(k));
    return [...saved, ...WIDGET_KEYS.filter(k => !saved.includes(k))];
  }

  async function saveOrder(order) {
    settings().widgetOrder = order.filter(k => WIDGET_KEYS.includes(k));
    try { await plugin.saveSettings(); } catch (e) { console.error('vista order', e); }
    plugin.refreshViews();
  }

  async function moveWidget(key, delta) {
    const order = widgetOrder();
    const i = order.indexOf(key);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    order.splice(i, 1); order.splice(j, 0, key);
    await saveOrder(order);
  }

  /* One ⋯ button per card in edit mode: size, move, hide — behind a menu. */
  function editControls(head, key) {
    const grip = button(head, 'vs-iconbtn vs-iconbtn-sm vs-grip vs-hide', null, null, 'grip-vertical');
    grip.title = 'Drag to move ' + WIDGET_NAME[key];
    grip.setAttribute('aria-label', 'Drag to move ' + WIDGET_NAME[key]);
    grip.addEventListener('pointerdown', e => startDrag(e, grip, key));
    grip.addEventListener('click', e => e.preventDefault());
    const menuBtn = button(head, 'vs-iconbtn vs-iconbtn-sm vs-hide', null, e => widgetMenu(e, key), 'ellipsis');
    menuBtn.title = 'Edit ' + WIDGET_NAME[key];
    menuBtn.setAttribute('aria-label', 'Edit ' + WIDGET_NAME[key]);
    menuBtn.setAttribute('aria-haspopup', 'menu');
  }

  function widgetMenu(e, key) {
    if (typeof Menu !== 'function') { setFlag(WIDGET_FLAG[key], false); return; }
    const menu = new Menu();
    const cur = widgetSize(key);
    const order = widgetOrder(), at = order.indexOf(key);
    for (const sz of SIZES) menu.addItem(i => { i.setTitle(SIZE_TITLE[sz]).setIcon(sz === 'small' ? 'minimize-2' : sz === 'wide' ? 'maximize-2' : 'square').onClick(() => setWidgetSize(key, sz)); if (i.setChecked && sz === cur) i.setChecked(true); });
    if (menu.addSeparator) menu.addSeparator();
    menu.addItem(i => { i.setTitle('Move earlier').setIcon('arrow-up').onClick(() => moveWidget(key, -1)); if (i.setDisabled && at <= 0) i.setDisabled(true); });
    menu.addItem(i => { i.setTitle('Move later').setIcon('arrow-down').onClick(() => moveWidget(key, 1)); if (i.setDisabled && at >= order.length - 1) i.setDisabled(true); });
    if (menu.addSeparator) menu.addSeparator();
    menu.addItem(i => i.setTitle('Hide ' + WIDGET_NAME[key]).setIcon('eye-off').onClick(() => setFlag(WIDGET_FLAG[key], false)));
    if (menu.showAtMouseEvent) menu.showAtMouseEvent(e); else if (menu.showAtPosition) menu.showAtPosition({ x: e.clientX, y: e.clientY });
  }

  /* Pointer drag on the grip: the card follows the pointer and swaps places
     with whichever card it is over; the new order is saved on release.
     The listeners live on the document, not the grip: re-inserting the card
     releases any pointer capture the grip holds, and the lifted card carries
     pointer-events:none — bound to the grip, the drag would silently die at
     the first swap and never reach the save on pointerup. */
  function startDrag(e, handle, key) {
    if (!state.editing || (e.button !== undefined && e.button !== 0)) return;
    const card = handle.closest('.vs-card');
    if (!card) return;
    e.preventDefault();
    const id = e.pointerId;
    let sx = e.clientX, sy = e.clientY, moved = false;
    card.classList.add('is-dragging');
    /* the lifted card must not shadow the card underneath from elementFromPoint */
    card.style.pointerEvents = 'none';
    /* If the view closes mid-drag, ctl.stop() calls this instead of letting
       the gesture finish on a document that has been cleared out from under
       it — otherwise these listeners (and the reversed one below) outlive
       the view and the closure keeps colsEl/state alive for nothing. */
    const cleanup = () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
      card.style.transform = '';
      card.style.pointerEvents = '';
      card.classList.remove('is-dragging');
      activeDragCancel = null;
    };
    const onMove = ev => {
      if (ev.pointerId !== id) return;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      card.style.transform = `translate(${dx}px, ${dy}px)`;
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const target = under && under.closest ? under.closest('.vs-cols > .vs-card') : null;
      if (!target || target === card || target.classList.contains('is-dragging')) return;
      const cards = [...colsEl.children];
      const after = cards.indexOf(target) > cards.indexOf(card);
      target.parentNode.insertBefore(card, after ? target.nextSibling : target);
      /* the card now sits in a new slot: re-anchor so it stays under the pointer */
      sx = ev.clientX; sy = ev.clientY;
      card.style.transform = '';
    };
    const onUp = async ev => {
      if (ev && ev.pointerId !== undefined && ev.pointerId !== id) return;
      cleanup();
      if (!moved) return;
      const order = [...colsEl.children].map(c => c.dataset.key).filter(Boolean);
      await saveOrder(mergeWidgetOrder(widgetOrder(), order));
    };
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
    activeDragCancel = cleanup;
  }

  function sizedCard(key, cls) {
    const card = el(colsEl, 'section', 'vs-card ' + cls + ' is-' + widgetSize(key));
    card.dataset.key = key;
    return card;
  }

  /* The eye-off button every hideable thing carries; CSS shows it only in edit mode. */
  function hideButton(parent, name, onHide) {
    const b = button(parent, 'vs-iconbtn vs-iconbtn-sm vs-hide', null, onHide, 'eye-off');
    b.title = 'Hide ' + name;
    b.setAttribute('aria-label', 'Hide ' + name);
    return b;
  }

  function setEditing(on) {
    state.editing = !!on;
    root.classList.toggle('is-editing', state.editing);
    renderTiles();
    renderCols();
    renderCaptureChrome();
  }

  function renderCaptureChrome() {
    const old = captureEl.querySelector('.vs-hide');
    if (old) old.remove();
    if (state.editing) hideButton(captureEl, 'quick capture', () => setFlag('showCapture', false));
  }

  /* In edit mode: chips for everything hidden, click to restore. */
  function renderHiddenStrip(parent) {
    if (!state.editing) return;
    const s = settings();
    const items = [];
    for (const w of WIDGETS) if (s[w.flag] === false) items.push({ name: w.name, restore: () => setFlag(w.flag, true) });
    for (const g of s.hiddenGroups || []) items.push({ name: g + ' tiles', restore: () => setGroupHidden(g, false) });
    const strip = el(parent, 'div', 'vs-hidden-strip');
    el(strip, 'span', 'vs-hidden-label', items.length ? 'Hidden' : 'Nothing hidden. Use the eye buttons to hide a widget or a row of tiles.');
    for (const it of items) {
      const chip = button(strip, 'vs-chip', it.name, it.restore, 'eye');
      chip.title = 'Show ' + it.name;
    }
  }

  /* ---- tiles ------------------------------------------------------------ */

  function renderTiles() {
    clear(tilesEl);
    const head = el(tilesEl, 'div', 'vs-section-head');
    el(head, 'span', 'vs-label', 'Quick access');
    el(head, 'span', 'vs-spacer');
    const add = button(head, 'vs-iconbtn', null, () => new TileModal(app, null, t => saveTiles([...T.resolveTiles(settings()), t])).open(), 'plus');
    add.title = 'Add a tile';
    const edit = button(head, 'vs-iconbtn' + (state.editing ? ' is-on' : ''), state.editing ? 'Done' : null, () => setEditing(!state.editing), state.editing ? 'check' : 'pencil');
    edit.title = state.editing ? 'Done editing' : 'Edit the page: rearrange tiles, hide widgets';
    renderHiddenStrip(tilesEl);

    const tiles = T.resolveTiles(settings());
    const hiddenGroups = new Set(settings().hiddenGroups || []);
    const groups = T.groupTiles(tiles).filter(g => state.editing || !hiddenGroups.has(g.group));
    if (!groups.length) { el(tilesEl, 'div', 'vs-empty', 'No tiles yet — add one with the plus.'); return; }
    const collapsed = settings().collapsed || [];
    for (const g of groups) {
      const isHidden = hiddenGroups.has(g.group);
      const wrap = el(tilesEl, 'div', 'vs-group' + (collapsed.includes(g.group) ? ' is-collapsed' : '') + (isHidden ? ' is-off' : ''));
      wrap.dataset.group = g.group;
      const glRow = el(wrap, 'div', 'vs-group-row');
      const gl = button(glRow, 'vs-group-label', g.group + (isHidden ? ' · hidden' : ''), () => toggleGroup(g.group), 'chevron-down');
      gl.setAttribute('aria-expanded', collapsed.includes(g.group) ? 'false' : 'true');
      if (state.editing) {
        const hb = button(glRow, 'vs-iconbtn vs-iconbtn-sm vs-hide', null, () => setGroupHidden(g.group, !isHidden), isHidden ? 'eye' : 'eye-off');
        hb.title = (isHidden ? 'Show ' : 'Hide ') + g.group + ' tiles';
      }
      const grid = el(wrap, 'div', 'vs-grid');
      for (const t of g.tiles) renderTile(grid, t, tiles.indexOf(t));
    }
  }

  function renderTile(grid, t, index) {
    const b = button(grid, 'vs-tile is-' + t.kind, null, e => {
      if (b._dragged) { b._dragged = false; return; }
      if (state.editing) { new TileModal(app, t, nt => { const all = T.resolveTiles(settings()).slice(); all[index] = nt; saveTiles(all); }).open(); return; }
      A.runTile(app, settings(), t, e.metaKey || e.ctrlKey ? 'tab' : undefined);
    });
    b.setAttribute('aria-label', t.label);
    b.dataset.index = String(index);
    if (state.editing) b.addEventListener('pointerdown', e => startTileDrag(e, b));
    const ic = el(b, 'span', 'vs-tile-icon');
    icon(ic, t.icon);
    el(b, 'span', 'vs-tile-label', t.label);
    if (state.editing) {
      const x = el(b, 'span', 'vs-tile-x');
      icon(x, 'x');
      x.setAttribute('role', 'button');
      x.setAttribute('aria-label', 'Remove ' + t.label);
      x.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); const all = T.resolveTiles(settings()).slice(); all.splice(index, 1); saveTiles(all); });
    }
    b.addEventListener('contextmenu', e => { e.preventDefault(); tileMenu(e, t, index); });
  }

  /* Drag a tile within its group or into another. Mouse: drag after 4px.
     Touch: hold 200ms first, so a quick swipe still scrolls the page.
     Listeners live on the document: the tile carries pointer-events:none while
     lifted, and re-inserting it releases any pointer capture — bound to the
     tile, the drag would die at the first swap and never reach the save. */
  function startTileDrag(e, tile) {
    if (!state.editing || (e.button !== undefined && e.button !== 0)) return;
    const touch = e.pointerType === 'touch';
    const id = e.pointerId;
    let armed = !touch, moved = false, sx = e.clientX, sy = e.clientY;
    const armTimer = touch ? setTimeout(() => { armed = true; tile.classList.add('is-dragging'); }, 200) : null;
    /* The tile's touch-action is pan-y, so an un-armed swipe scrolls the page as
       usual; once the hold arms the drag we take the gesture over by cancelling
       the browser's pan. touch-action is fixed for the life of a gesture, so
       preventing touchmove is the only way to reclaim it — and it only works
       while the pan has not started, which the 200ms still hold guarantees. */
    const onTouchMove = ev => { if (armed && ev.cancelable) ev.preventDefault(); };
    /* Same reason startDrag tracks activeDragCancel: if the view closes
       mid-drag, ctl.stop() must be able to cancel this — the hold timer and
       the document listeners otherwise outlive the view entirely. */
    const done = () => {
      if (armTimer) clearTimeout(armTimer);
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
      document.removeEventListener('touchmove', onTouchMove, true);
      tile.style.transform = '';
      tile.style.pointerEvents = '';
      tile.classList.remove('is-dragging');
      activeDragCancel = null;
    };
    const onMove = ev => {
      if (ev.pointerId !== id) return;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      /* moved before the hold armed: that was a swipe, not a drag — let it go,
         and swallow the tap that would otherwise open the tile editor */
      if (!armed) { if (Math.hypot(dx, dy) > 8) { tile._dragged = true; setTimeout(() => { tile._dragged = false; }, 400); done(); } return; }
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved) { moved = true; tile._dragged = true; tile.classList.add('is-dragging'); tile.style.pointerEvents = 'none'; }
      tile.style.transform = `translate(${dx}px, ${dy}px)`;
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const target = under && under.closest ? under.closest('.vs-grid > .vs-tile') : null;
      if (target && target !== tile) {
        const all = [...tilesEl.querySelectorAll('.vs-grid > .vs-tile')];
        const after = all.indexOf(target) > all.indexOf(tile);
        target.parentNode.insertBefore(tile, after ? target.nextSibling : target);
        sx = ev.clientX; sy = ev.clientY; tile.style.transform = '';
        return;
      }
      /* an empty stretch of another group's grid: append there */
      const grid = under && under.closest ? under.closest('.vs-grid') : null;
      if (grid && grid !== tile.parentNode) { grid.appendChild(tile); sx = ev.clientX; sy = ev.clientY; tile.style.transform = ''; }
    };
    const onUp = async ev => {
      if (ev && ev.pointerId !== undefined && ev.pointerId !== id) return;
      const wasMoved = moved;
      done();
      if (!wasMoved) return;
      const tiles = T.resolveTiles(settings());
      const next = [];
      for (const wrap of tilesEl.querySelectorAll('.vs-group')) {
        const group = wrap.dataset.group;
        for (const node of wrap.querySelectorAll('.vs-grid > .vs-tile')) {
          const t = tiles[Number(node.dataset.index)];
          if (t) next.push(Object.assign({}, t, { group }));
        }
      }
      if (next.length === tiles.length) await saveTiles(next);
      else plugin.refreshViews();
      setTimeout(() => { tile._dragged = false; }, 0);
    };
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
    if (touch) document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
    activeDragCancel = done;
  }

  function tileMenu(e, t, index) {
    if (typeof Menu !== 'function') return;
    const menu = new Menu();
    const all = () => T.resolveTiles(settings()).slice();
    menu.addItem(i => i.setTitle('Open in new tab').setIcon('external-link').onClick(() => A.runTile(app, settings(), t, 'tab')));
    menu.addItem(i => i.setTitle('Edit').setIcon('pencil').onClick(() => new TileModal(app, t, nt => { const a = all(); a[index] = nt; saveTiles(a); }).open()));
    menu.addItem(i => i.setTitle('Move earlier').setIcon('arrow-up').onClick(() => { const a = all(); if (index > 0) { [a[index - 1], a[index]] = [a[index], a[index - 1]]; saveTiles(a); } }));
    menu.addItem(i => i.setTitle('Move later').setIcon('arrow-down').onClick(() => { const a = all(); if (index < a.length - 1) { [a[index + 1], a[index]] = [a[index], a[index + 1]]; saveTiles(a); } }));
    menu.addItem(i => i.setTitle('Remove').setIcon('trash-2').onClick(() => { const a = all(); a.splice(index, 1); saveTiles(a); }));
    if (menu.showAtMouseEvent) menu.showAtMouseEvent(e); else if (menu.showAtPosition) menu.showAtPosition({ x: e.clientX, y: e.clientY });
  }

  async function saveTiles(tiles) {
    settings().tiles = tiles.map(T.normalizeTile);
    try { await plugin.saveSettings(); } catch (e) { console.error('vista tiles', e); new Notice('Vista: could not save the tiles.'); }
    plugin.refreshViews();
  }

  async function toggleGroup(g) {
    const c = new Set(settings().collapsed || []);
    if (c.has(g)) c.delete(g); else c.add(g);
    settings().collapsed = [...c];
    try { await plugin.saveSettings(); } catch (e) { console.error('vista collapse', e); }
    renderTiles();
  }

  /* ---- tasks due today and overdue --------------------------------------- */

  function renderTasks(card) {
    card = card || colsEl.querySelector('.vs-tasks');
    if (!card) return;
    clear(card);
    const t = state.tasks;
    const head = el(card, 'div', 'vs-card-head');
    el(head, 'span', 'vs-label', 'Tasks');
    if (t) el(head, 'span', 'vs-label vs-label-faint', `${t.overdue.length} overdue · ${t.due.length} today`);
    el(head, 'span', 'vs-spacer');
    editControls(head, 'tasks');
    const open = button(head, 'vs-iconbtn vs-iconbtn-sm', null, () => { if (!A.resolveNote(app, 'Task Dashboard')) new Notice('Vista: no "Task Dashboard" note to open.'); else A.openNote(app, settings(), 'Task Dashboard'); }, 'external-link');
    open.title = 'Open Task Dashboard';
    const list = el(card, 'div', 'vs-list');
    if (!t) { el(list, 'div', 'vs-empty', 'Reading tasks…'); return; }
    const today = D.todayISO();
    const rows = [...t.overdue, ...t.due].filter(x => !state.hidden.has(x.path + ':' + x.raw));
    if (!rows.length) { el(list, 'div', 'vs-empty', 'Nothing due today. Nothing overdue.'); return; }
    for (const item of rows.slice(0, 6)) {
      const row = el(list, 'div', 'vs-rrow vs-task' + (item.due < today ? ' is-late' : ''));
      const tickBtn = button(row, 'vs-rtick', null, () => tickTask(item), null);
      tickBtn.setAttribute('aria-label', 'Mark done: ' + item.text);
      const body = button(row, 'vs-row-body vs-task-body', null, e => openTask(item, e));
      el(body, 'div', 'vs-row-name', item.text);
      const note = item.path.slice(item.path.lastIndexOf('/') + 1).replace(/\.md$/, '');
      const late = TK.daysOverdue(item.due, today);
      el(body, 'div', 'vs-row-sub', note + ' · ' + (late > 0 ? `${late} day${late === 1 ? '' : 's'} overdue` : 'due today'));
    }
    if (rows.length > 6) el(card, 'div', 'vs-card-foot', `+${rows.length - 6} more in Task Dashboard`);
  }

  async function openTask(item, e) {
    const file = app.vault.getFileByPath(item.path);
    if (!file) return;
    const leaf = app.workspace.getLeaf(e && (e.metaKey || e.ctrlKey) ? 'tab' : A.openMode(settings()));
    await leaf.openFile(file, { eState: { line: item.line } });
  }

  async function tickTask(item) {
    state.hidden.add(item.path + ':' + item.raw);
    renderTasks();
    try {
      /* A result object, not a boolean: a refused tick (a 🔁 task with no
         Tasks API, a changed line, a gone note) says why, and must put the row
         back rather than report "Done." */
      const r = await TK.toggleTask(app, item);
      if (!r.ok) { state.hidden.delete(item.path + ':' + item.raw); renderTasks(); new Notice(taskRefusedNotice(r)); return; }
      new Notice(TK.tasksApi(app) ? 'Done (through Tasks).' : 'Done.');
    } catch (e) { console.error('vista task', e); state.hidden.delete(item.path + ':' + item.raw); renderTasks(); new Notice('Vista: could not update that task.'); }
  }

  /* ---- reminders, from Nudge --------------------------------------------- */

  /* Everything due, topped up with what is next. Reading and ticking both go
     through Nudge's store (src/nudge.js) — Vista never edits that note. */
  function renderNudge(card) {
    card = card || colsEl.querySelector('.vs-nudge');
    if (!card) return;
    clear(card);
    const n = state.nudge;
    const head = el(card, 'div', 'vs-card-head');
    el(head, 'span', 'vs-label', 'Reminders');
    const c = n && n.counts;
    el(head, 'span', 'vs-label vs-label-faint', c && c.due ? `${c.overdue} overdue · ${c.today} today` : 'from Nudge');
    el(head, 'span', 'vs-spacer');
    editControls(head, 'nudge');
    const add = button(head, 'vs-iconbtn vs-iconbtn-sm', null, () => A.runCommand(app, 'nudge-reminders:add'), 'plus');
    add.title = 'Add a reminder';
    const open = button(head, 'vs-iconbtn vs-iconbtn-sm', null, () => A.runCommand(app, 'nudge-reminders:open'), 'external-link');
    open.title = 'Open Nudge';
    const list = el(card, 'div', 'vs-list');
    if (!n) { el(list, 'div', 'vs-empty', 'Reading reminders…'); return; }
    if (n.error) { el(list, 'div', 'vs-empty', n.error); return; }
    const today = D.todayISO();
    const rows = n.rows.filter(r => !state.hidden.has('nudge:' + NU.keyOf(r)));
    if (!rows.length) {
      el(list, 'div', 'vs-empty', n.counts.open ? 'Nothing due. Nothing coming.' : 'No reminders yet.');
    }
    /* Shaped like the Rhythm card — round tick, name, a when-pill on the
       right — but the tick and the row do different things here: the tick
       completes, the rest opens the reminder. */
    for (const item of rows) {
      const late = NU.bucketOf(item, today) === 'overdue';
      const row = el(list, 'div', 'vs-rrow vs-nrow' + (late ? ' is-late' : '') + (NU.isUrgent(item) ? ' is-urgent' : ''));
      const tick = button(row, 'vs-rtick', null, () => tickNudge(item), null);
      tick.title = 'Mark done';
      tick.setAttribute('aria-label', 'Mark done: ' + item.title);
      const body = button(row, 'vs-row-body vs-nrow-body', null, () => openReminder(item));
      body.title = 'Open this reminder';
      el(body, 'div', 'vs-row-name', item.title);
      const sub = NU.subLabel(item);
      if (sub) el(body, 'div', 'vs-row-sub', sub);
      el(row, 'span', 'vs-rwhen' + (late ? ' is-late' : ''), NU.shortWhen(item, today));
    }
    const foot = el(card, 'div', 'vs-card-foot');
    const bits = [];
    if (n.more) bits.push(`+${n.more} more in Nudge`);
    else if (n.counts.someday) bits.push(`${n.counts.someday} with no date`);
    foot.textContent = bits.join(' · ');
  }

  /* Tapping a reminder opens what the line actually says, and the few things
     worth doing about it from here. Every write still goes through Nudge. */
  function openReminder(item) {
    new ReminderModal(app, item, {
      today: D.todayISO(),
      note: state.nudge && state.nudge.path,
      canSnooze: NU.canSnooze(app),
      onDone: () => tickNudge(item),
      onSnooze: days => snoozeNudge(item, days),
      onOpenNote: () => openNudge(item),
      onOpenNudge: () => A.runCommand(app, 'nudge-reminders:open'),
    }).open();
  }

  async function snoozeNudge(item, days) {
    try {
      const res = await NU.snoozeReminder(app, item, days, D.todayISO());
      /* A refusal says why ('changed' is not "could not find"), and the card
         re-reads so a row that moved under us shows where it is now. */
      if (!res.ok) { new Notice(NU.snoozeRefusedNotice(res)); scheduleNudge(400); return; }
      new Notice(days === 1 ? 'Snoozed to tomorrow.' : `Snoozed ${days} days.`);
    } catch (e) {
      console.error('vista nudge snooze', e);
      new Notice('Vista: could not snooze that reminder.');
      return;
    }
    scheduleNudge(400);
  }

  async function openNudge(item, e) {
    const file = state.nudge && state.nudge.path ? app.vault.getFileByPath(state.nudge.path) : null;
    if (!file) { A.runCommand(app, 'nudge-reminders:open'); return; }
    const leaf = app.workspace.getLeaf(e && (e.metaKey || e.ctrlKey) ? 'tab' : A.openMode(settings()));
    await leaf.openFile(file, { eState: { line: item.line } });
  }

  /* The row goes as soon as it is tapped; it comes back if the write fails —
     and the note it comes back with says WHY, rather than always guessing
     the line went missing (a repeat Nudge can't roll forward is left open
     on purpose, not lost). */
  async function tickNudge(item) {
    const key = 'nudge:' + NU.keyOf(item);
    state.hidden.add(key);
    renderNudge();
    try {
      const res = await NU.tickReminder(app, item, D.todayISO());
      if (!res.ok) { state.hidden.delete(key); renderNudge(); new Notice(NU.tickRefusedNotice(res)); scheduleNudge(400); return; }
      new Notice('Done (through Nudge).');
    } catch (e) {
      console.error('vista nudge tick', e);
      state.hidden.delete(key); renderNudge();
      new Notice('Vista: could not tick that reminder.');
      return;
    }
    scheduleNudge(400);
  }

  async function gatherNudge(force) {
    if (state.nudgeBusy) return;
    if (!force && state.nudge) return;
    state.nudgeBusy = true;
    try {
      state.nudge = await NU.loadReminders(app, D.todayISO(), NUDGE_LIMIT);
    } catch (e) {
      console.error('vista nudge', e);
      state.nudge = { error: 'Could not read the reminders note. See the console.', rows: [], counts: null, more: 0 };
    } finally {
      state.nudgeBusy = false;
      if (!stopped) renderNudge();
    }
  }

  function scheduleNudge(ms) {
    if (nudgeTimer) clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => {
      nudgeTimer = null;
      if (stopped || settings().showNudge === false) return;
      state.hidden = new Set([...state.hidden].filter(k => k.slice(0, 6) !== 'nudge:'));
      gatherNudge(true);
    }, ms || 800);
  }

  /* ---- next gym session --------------------------------------------------- */

  function renderGym(card) {
    card = card || colsEl.querySelector('.vs-gym');
    if (!card) return;
    clear(card);
    const g = state.gym;
    const head = el(card, 'div', 'vs-card-head');
    el(head, 'span', 'vs-label', 'Gym');
    el(head, 'span', 'vs-label vs-label-faint', 'next session');
    el(head, 'span', 'vs-spacer');
    editControls(head, 'gym');
    const log = button(head, 'vs-iconbtn vs-iconbtn-sm', null, () => A.runCommand(app, 'gym-app:log-workout'), 'dumbbell');
    log.title = 'Log a workout';
    const open = button(head, 'vs-iconbtn vs-iconbtn-sm', null, () => A.runCommand(app, 'gym-app:open-gym'), 'external-link');
    open.title = 'Open Gym';
    if (!g) { el(card, 'div', 'vs-empty', 'Reading plans…'); return; }
    if (!g.available) { el(card, 'div', 'vs-empty', 'No plans yet.'); return; }
    if (g.next) {
      const when = el(card, 'div', 'vs-gym-when' + (g.next.when === 'Today' ? ' is-today' : ''), g.next.when);
      when.title = g.next.date;
      for (const sn of g.next.sessions) {
        const row = el(card, 'div', 'vs-gym-session');
        el(row, 'div', 'vs-gym-day', sn.day);
        el(row, 'div', 'vs-row-sub', sn.plan + (sn.items ? ` · ${sn.items} exercise${sn.items === 1 ? '' : 's'}` : ''));
      }
    } else el(card, 'div', 'vs-empty', 'Nothing scheduled this week.');
    const foot = el(card, 'div', 'vs-card-foot');
    const bits = [];
    if (g.doneToday.length) bits.push(`Done today: ${g.doneToday.join(', ')}`);
    if (g.last) bits.push(`Last: ${g.last.day || g.last.plan}${g.last.daysAgo === 0 ? ' today' : g.last.daysAgo === 1 ? ' yesterday' : ` ${g.last.daysAgo}d ago`}`);
    foot.textContent = bits.join(' · ');
  }

  /* ---- budget, from the Budget plugin's files --------------------------- */

  function renderBudget(card) {
    card = card || colsEl.querySelector('.vs-budget');
    if (!card) return;
    clear(card);
    const b = state.budget;
    const head = el(card, 'div', 'vs-card-head');
    el(head, 'span', 'vs-label', 'Budget');
    el(head, 'span', 'vs-label vs-label-faint', b && b.periodLabel ? b.periodLabel : 'this period');
    el(head, 'span', 'vs-spacer');
    editControls(head, 'budget');
    const open = button(head, 'vs-iconbtn vs-iconbtn-sm', null, () => A.runCommand(app, 'budget-app:open-budget'), 'external-link');
    open.title = 'Open Budget';
    if (!b) {
      el(card, 'div', 'vs-budget-num', '…');
      el(card, 'div', 'vs-card-foot', state.budgetBusy ? 'Reading the budget…' : '');
      return;
    }
    if (b.error) { el(card, 'div', 'vs-empty', b.error); return; }
    const h = budgetHeadline(b);
    /* Locked: say so and stop — budgetHeadline's header says why nothing
       else may be drawn. The way in is the Budget plugin's own gate. */
    if (h.state === 'locked') {
      el(card, 'div', 'vs-empty', h.label);
      el(card, 'div', 'vs-card-foot', 'Open Budget and tap Enter budget to show it here.');
      return;
    }
    const num = el(card, 'div', 'vs-budget-num' + (h.over ? ' is-over' : ''), BG.money(h.amount, b.currency));
    num.title = h.state === 'noBudget'
      ? `${BG.money(b.spent, b.currency)} spent — nothing is budgeted for this period yet`
      : `${BG.money(b.spent, b.currency)} spent of ${BG.money(b.budgeted, b.currency)} budgeted`;
    el(card, 'div', 'vs-budget-lbl', h.label);
    if (h.meter) {
      const meter = el(card, 'div', 'vs-meter' + (h.over ? ' is-over' : ''));
      const max = Math.max(b.spent, b.budgeted, 1);
      const fill = el(meter, 'div', 'vs-meter-fill');
      fill.style.width = Math.min(100, (b.spent / max) * 100).toFixed(1) + '%';
      if (b.budgeted > 0 && b.spent > b.budgeted) { const mark = el(meter, 'div', 'vs-meter-mark'); mark.style.left = ((b.budgeted / max) * 100).toFixed(1) + '%'; }
    }
    const sub = el(card, 'div', 'vs-budget-sub');
    /* With no budget the big number already IS the spend; the line under it
       names it, in the hero's own word for that figure. */
    sub.textContent = (h.state === 'noBudget' ? 'Total spent' : `${BG.money(b.spent, b.currency)} spent of ${BG.money(b.budgeted, b.currency)}`)
      + (b.daysLeft > 0 ? ` · ${b.daysLeft} day${b.daysLeft === 1 ? '' : 's'} left` : '');
    if (b.overCats.length) {
      const list = el(card, 'div', 'vs-budget-over');
      for (const c of b.overCats.slice(0, 3)) {
        const row = el(list, 'div', 'vs-budget-over-row');
        el(row, 'span', 'vs-budget-over-name', c.category);
        el(row, 'span', 'vs-budget-over-amt', BG.money(c.over, b.currency) + ' over');
      }
      if (b.overCats.length > 3) el(list, 'div', 'vs-budget-over-more', `+${b.overCats.length - 3} more over`);
    }
    const foot = el(card, 'div', 'vs-card-foot');
    /* The Budget plugin's own figure carries its hero's caveats as sentences;
       Vista's fallback count names what it left out. */
    const fromApp = b.source === 'budget-app';
    const notes = fromApp ? (b.notes || []).slice() : [];
    if (!fromApp && b.uncategorised) notes.push(`${b.uncategorised} uncategorised`);
    if (!fromApp && b.foreign) notes.push(`${b.foreign} foreign-currency rows left out`);
    foot.textContent = (fromApp ? `From Budget, as of ${b.asOfLabel}` : `Vista's own count from the Budget files, as of ${b.asOfLabel}`) + (notes.length ? ' · ' + notes.join(' · ') : '');
  }

  /* The Budget plugin builds a NEW api object each time it is reloaded,
     switched off and on, or updated; a subscription made to the old one never
     hears the new one, and a figure read through the old one is not the new
     one's. Called on every gather and on the slow tick: when the instance has
     changed, drop the old subscription, take the new one, and forget the
     figure (the card shows "…" until it is re-read). Returns whether it
     changed, so the caller knows to read again. */
  function syncBudgetApi() {
    const { changed, api } = BG.budgetApiChanged(app, subscribedApi);
    if (!changed) return false;
    if (typeof unsubscribeBudgetApi === 'function') { try { unsubscribeBudgetApi(); } catch (e) { /* old instance gone */ } }
    unsubscribeBudgetApi = null; subscribedApi = api;
    budgetEpoch++;
    plugin._budgetCache = null;
    state.budget = null;   // '…' until re-read: the old instance's figure must not stay on screen
    if (api && typeof api.onChange === 'function') {
      try { unsubscribeBudgetApi = api.onChange(() => { if (!stopped && settings().showBudget !== false) gatherBudget(true); }); }
      catch (e) { console.error('vista budget: onChange', e); }
    }
    return true;
  }

  async function gatherBudget(force) {
    if (stopped) return;
    const changed = syncBudgetApi();
    if (changed) force = true;
    /* A notification (or a changed instance) that lands while a read is in
       flight is not dropped: it is queued and the read goes round again. */
    if (state.budgetBusy) { if (force) state.budgetQueued = true; return; }
    const cached = plugin._budgetCache;
    if (!force && BG.budgetCacheUsable(cached, app, Date.now(), STATS_FRESH_MS)) { state.budget = cached.value; renderBudget(); return; }
    state.budgetBusy = true;
    const api = BG.budgetAppStatus(app).api, epoch = budgetEpoch;
    renderBudget();
    let again = false;
    try {
      let value = await BG.currentBudget(app, settings().budgetFolder);
      /* The instance changed while we were reading: this value came from the
         old one. Discard it and read again. */
      if (epoch !== budgetEpoch) { again = true; return; }
      /* The Budget plugin is running but has no budget set up (its api answered
         null), and Vista has no folder of its own to fall back on: say so,
         rather than let the empty reader print a "nothing budgeted" card. */
      if (api && value && value.source === 'vista' && !BG.budgetAvailable(app, settings().budgetFolder)) {
        value = { source: 'budget-app', unavailable: 'unset', error: 'Budget has no budget set up yet. Open Budget to start one.' };
      }
      state.budget = value;
      plugin._budgetCache = { value, at: Date.now(), api };
    } catch (e) {
      console.error('vista budget', e);
      if (epoch !== budgetEpoch) again = true;
      else state.budget = { error: 'Could not read the budget files. See the console.' };
    } finally {
      state.budgetBusy = false;
      if (state.budgetQueued) { state.budgetQueued = false; again = true; }
      if (!stopped) { renderBudget(); if (again) gatherBudget(true); }
    }
  }

  function scheduleBudget() {
    if (budgetTimer) clearTimeout(budgetTimer);
    budgetTimer = setTimeout(() => { budgetTimer = null; if (!stopped && settings().showBudget !== false) gatherBudget(true); }, 3000);
  }

  /* ---- today, from Rhythm ----------------------------------------------- */

  /* Reading Rhythm is asynchronous (it reads each note's text, as Rhythm does),
     so two reads can overlap: only the newest may land, or an older one
     finishing last would put an earlier state back on the card. */
  async function rhythmToday() {
    const seq = ++rhythmSeq;
    let t;
    try { t = await RH.todayFromRhythm(app, D.todayISO()); }
    catch (e) { console.error('vista rhythm', e); t = { available: false, focus: [] }; }
    if (seq !== rhythmSeq || stopped) return state.rhythm;
    state.rhythm = t;
    return t;
  }

  /* Re-read, then redraw: the whole column set if the card has just appeared
     or vanished (a first practice written, the folder removed), else just the
     card. Entries for ticks whose write had already landed when the read began
     are dropped afterwards — the read now includes them. */
  async function refreshRhythm() {
    const before = !!(state.rhythm && state.rhythm.available);
    const settled = settledPending(state.rhythmPending);
    await rhythmToday();
    if (stopped) return;
    dropSettled(state.rhythmPending, settled);
    const after = !!(state.rhythm && state.rhythm.available);
    if (before !== after && settings().showRhythm !== false) renderCols(); else renderRhythm();
  }

  function renderRhythm(card) {
    card = card || colsEl.querySelector('.vs-rhythm');
    if (!card) return;
    const t = state.rhythm;
    if (!t) return;
    clear(card);
    const head = el(card, 'div', 'vs-card-head');
    el(head, 'span', 'vs-label', 'Today');
    el(head, 'span', 'vs-label vs-label-faint', 'from Rhythm');
    el(head, 'span', 'vs-spacer');
    editControls(head, 'rhythm');
    const open = button(head, 'vs-iconbtn vs-iconbtn-sm', null, () => A.runCommand(app, 'rhythm:open'), 'external-link');
    open.title = 'Open Rhythm';
    const list = el(card, 'div', 'vs-list');
    const rows = overlayPending(t.focus, state.rhythmPending);
    if (!rows.length) {
      /* Rhythm's own words for an empty day (page-today.js), so the two
         surfaces never say different things about the same state. */
      const h = RH.emptyLabel(t);
      if (h) {
        el(list, 'div', 'vs-empty', h.line);
        el(list, 'div', 'vs-empty vs-empty-sub', h.rest);
      }
    }
    for (const r of rows) {
      const row = button(list, 'vs-rrow' + (r.done ? ' is-done' : ''), null, () => tickRhythm(r.name, !r.done));
      row.setAttribute('aria-pressed', r.done ? 'true' : 'false');
      const tickEl = el(row, 'span', 'vs-rtick');
      if (r.done) icon(tickEl, 'check');
      const body = el(row, 'div', 'vs-row-body');
      el(body, 'div', 'vs-row-name', r.name);
      el(body, 'div', 'vs-row-sub', [r.area, r.reason].filter(Boolean).join(' · '));
      if (r.whenLabel) el(row, 'span', 'vs-rwhen', r.whenLabel);
    }
    const foot = el(card, 'div', 'vs-card-foot');
    const bits = [];
    /* With nothing in the list the hero line above already says what is left. */
    if (t.later && rows.length) bits.push(`${t.later} more when there's space`);
    if (t.done) bits.push(`${t.done} done today`);
    /* Rhythm's own label, so its streakMode (off / weeks / days) is honoured. */
    if (t.streakLabel) bits.push(t.streakLabel);
    foot.textContent = bits.join(' · ');
  }

  async function tickRhythm(name, on) {
    const entry = { on, settled: false };
    state.rhythmPending.set(name, entry);
    renderRhythm();
    const undo = () => { if (state.rhythmPending.get(name) === entry) state.rhythmPending.delete(name); renderRhythm(); };
    try {
      const res = await RH.tick(app, D.todayISO(), name, on);
      if (!res.ok) {
        new Notice(rhythmRefusedNotice(res));
        undo();
        return;
      }
    } catch (e) {
      console.error('vista tick', e);
      new Notice('Vista: could not write that tick to the Rhythm log.');
      undo();
      return;
    }
    entry.settled = true;
    /* The metadata cache catches up a moment after the write. */
    if (rhythmTimer) clearTimeout(rhythmTimer);
    rhythmTimer = setTimeout(() => { rhythmTimer = null; if (!stopped) refreshRhythm(); }, 900);
  }

  function scheduleRhythm() {
    if (rhythmTimer) return;
    rhythmTimer = setTimeout(() => { rhythmTimer = null; if (!stopped) refreshRhythm(); }, 700);
  }

  /* Is this path inside the Rhythm folder? Rhythm writes its own log (and the
     user edits practices by hand); either must refresh the card. */
  function inRhythmFolder(path) {
    const folder = (state.rhythm && state.rhythm.folder) || RH.rhythmSettings(app).folder;
    return !!path && path.startsWith(folder + '/');
  }

  /* ---- recent + stats --------------------------------------------------- */

  function recentFiles() {
    const n = Math.max(1, settings().recentCount || 6);
    const out = [];
    const seen = new Set();
    let last = [];
    try { last = app.workspace.getLastOpenFiles ? app.workspace.getLastOpenFiles() : []; } catch (e) { last = []; }
    for (const p of last) {
      const f = app.vault.getFileByPath(p);
      if (f && !seen.has(p)) { seen.add(p); out.push(f); }
      if (out.length >= n) return out;
    }
    const byMtime = app.vault.getFiles().filter(f => f.extension === 'md' && !seen.has(f.path)).sort((a, b) => (b.stat.mtime || 0) - (a.stat.mtime || 0));
    for (const f of byMtime) { out.push(f); if (out.length >= n) break; }
    return out;
  }

  function renderCols() {
    clear(colsEl);
    const s = settings();
    /* Rhythm is read asynchronously, so the card is decided from what has been
       read. The first read is started here if nothing has started it (start()
       normally has, and waits briefly for it, so the card is there on first
       paint); when it lands the columns are drawn again. */
    if (state.rhythm === null && !rhythmKicked && s.showRhythm !== false) {
      rhythmKicked = true;
      rhythmToday().then(() => { if (!stopped) renderCols(); });
    }
    const showRhythm = s.showRhythm !== false && !!(state.rhythm && state.rhythm.available);
    const showBudget = showBudgetCard(app, s);
    const showTasks = s.showTasks !== false;
    const showGym = s.showGym !== false && !!app.vault.getFolderByPath((s.gymFolder || 'Gym').replace(/^\/+|\/+$/g, '') + '/Plans');
    const showNudge = s.showNudge !== false && NU.nudgeAvailable(app);
    const show = { budget: showBudget, rhythm: showRhythm, tasks: showTasks, nudge: showNudge, gym: showGym, recent: s.showRecent !== false, stats: s.showStats !== false };
    const render = { budget: () => { renderBudget(sizedCard('budget', 'vs-budget')); gatherBudget(false); }, rhythm: () => renderRhythm(sizedCard('rhythm', 'vs-rhythm')), tasks: () => renderTasks(sizedCard('tasks', 'vs-tasks')), nudge: () => { renderNudge(sizedCard('nudge', 'vs-nudge')); gatherNudge(false); }, gym: () => renderGym(sizedCard('gym', 'vs-gym')), recent: () => renderRecent(sizedCard('recent', 'vs-recent')), stats: () => renderStats(sizedCard('stats', 'vs-stats')) };
    for (const key of widgetOrder()) if (show[key]) render[key]();
    colsEl.classList.toggle('is-hidden', !colsEl.firstChild);
  }

  function renderRecent(card) {
    card = card || colsEl.querySelector('.vs-recent');
    if (!card) return;
    clear(card);
    const head = el(card, 'div', 'vs-card-head');
    el(head, 'span', 'vs-label', 'Recent');
    el(head, 'span', 'vs-spacer');
    editControls(head, 'recent');
    const list = el(card, 'div', 'vs-list');
    const files = recentFiles();
    if (!files.length) { el(list, 'div', 'vs-empty', 'Nothing opened yet.'); return; }
    const now = Date.now();
    for (const f of files) {
      const row = button(list, 'vs-row', null, e => A.openFile(app, settings(), f, e.metaKey || e.ctrlKey ? 'tab' : undefined));
      icon(row, S.fileIcon(f.extension));
      const body = el(row, 'div', 'vs-row-body');
      el(body, 'div', 'vs-row-name', f.basename);
      const slash = f.path.lastIndexOf('/');
      el(body, 'div', 'vs-row-sub', slash > 0 ? f.path.slice(0, slash) : '/');
      el(row, 'div', 'vs-row-time', D.relTime(f.stat ? f.stat.mtime : now, now));
    }
  }

  function renderStats(card) {
    card = card || colsEl.querySelector('.vs-stats');
    if (!card) return;
    clear(card);
    const head = el(card, 'div', 'vs-card-head');
    el(head, 'span', 'vs-label', 'Vault');
    el(head, 'span', 'vs-spacer');
    editControls(head, 'stats');
    const refresh = button(head, 'vs-iconbtn vs-iconbtn-sm' + (state.statsBusy ? ' is-busy' : ''), null, () => gatherStats(true), 'refresh-cw');
    refresh.title = 'Recount';
    const st = state.stats;
    const grid = el(card, 'div', 'vs-stat-grid');
    const cell = (value, label, onClick, title) => {
      const c = onClick ? button(grid, 'vs-stat is-link', null, onClick) : el(grid, 'div', 'vs-stat');
      el(c, 'div', 'vs-stat-value', st ? value : '…');
      el(c, 'div', 'vs-stat-label', label);
      if (title) c.title = title;
      return c;
    };
    cell(st && fmtNum(st.notes), 'Notes');
    cell(st && fmtNum(st.words), 'Words');
    cell(st && fmtNum(st.tasksOpen), 'Open tasks', null, st ? `${st.tasksDone} done` : '');
    cell(st && fmtNum(st.links), 'Links');
    cell(st && fmtNum(st.tags), 'Tags', null, st && st.topTags.length ? st.topTags.join('  ') : '');
    cell(st && fmtNum(st.orphans.length), 'Orphans', st ? () => new ListModal(app, 'Notes with no links in or out', st.orphans, p => A.openNote(app, settings(), p)).open() : null, 'Notes nothing links to, that link to nothing');
    cell(st && fmtNum(st.journalStreak), st && st.journalStreak === 1 ? 'Day of journal' : 'Journal streak', null, 'Days in a row with a journal note');
    cell(st && fmtNum(st.modifiedToday), 'Edited today', null, st ? `${st.createdToday} created today · ${st.createdWeek} this week` : '');
    const foot = el(card, 'div', 'vs-card-foot');
    if (st) {
      foot.textContent = `${fmtNum(st.attachments)} attachments · ${fmtNum(st.folders)} folders · ${fmtBytes(st.size)}`;
      if (st.unresolved.length) {
        const u = button(foot, 'vs-inline-link', `${st.unresolved.length} unresolved link${st.unresolved.length === 1 ? '' : 's'}`, () => new ListModal(app, 'Links that point nowhere yet', st.unresolved, null).open());
        foot.insertBefore(document.createTextNode(' · '), u);
      }
    } else foot.textContent = state.statsBusy ? 'Counting…' : '';
  }

  const tick = () => new Promise(r => setTimeout(r, 0));

  async function gatherStats(force) {
    if (state.statsBusy) return;
    const cached = plugin._statsCache;
    if (!force && cached && Date.now() - cached.at < STATS_FRESH_MS) {
      state.stats = cached.stats; renderStats();
      if (plugin._sideCache) { state.tasks = plugin._sideCache.tasks; state.gym = plugin._sideCache.gym; renderTasks(); renderGym(); }
      return;
    }
    state.statsBusy = true;
    renderStats();
    try {
      const files = app.vault.getFiles();
      const cache = plugin._textCache || (plugin._textCache = new Map());
      const texts = new Map();
      const md = files.filter(f => f.extension === 'md');
      for (let i = 0; i < md.length; i++) {
        const f = md[i];
        const mtime = f.stat ? f.stat.mtime : 0;
        const c = cache.get(f.path);
        if (c && c.mtime === mtime) texts.set(f.path, c.text);
        else { const text = await app.vault.cachedRead(f); cache.set(f.path, { mtime, text }); texts.set(f.path, text); }
        if (i % 40 === 39) await tick();
        if (stopped) return;
      }
      for (const k of [...cache.keys()]) if (!texts.has(k)) cache.delete(k);
      const tagCounts = {};
      for (const f of md) {
        let fc = null;
        try { fc = app.metadataCache.getFileCache(f); } catch (e) { fc = null; }
        if (!fc) continue;
        let tags = [];
        try { tags = typeof obsidian.getAllTags === 'function' ? (obsidian.getAllTags(fc) || []) : []; } catch (e) { tags = []; }
        for (const t of tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
      }
      const stats = computeStats({
        files: files.map(f => ({ path: f.path, extension: f.extension, ctime: f.stat ? f.stat.ctime : 0, mtime: f.stat ? f.stat.mtime : 0, size: f.stat ? f.stat.size : 0 })),
        resolvedLinks: app.metadataCache.resolvedLinks || {},
        unresolvedLinks: app.metadataCache.unresolvedLinks || {},
        tagCounts, texts, now: Date.now(), journalFolder: settings().journalFolder,
      });
      state.stats = stats;
      plugin._statsCache = { stats, at: Date.now() };
      /* A reminder is one task line, and the Reminders card is already
         showing it — two cards saying the same thing is worse than either. */
      const owned = settings().showNudge !== false && NU.nudgeAvailable(app) ? new Set([NU.nudgePath(app)]) : null;
      state.tasks = TK.scanTasks(texts, D.todayISO(), settings().tasksGlobalFilter, owned);
      state.hidden = new Set();
      state.gym = GY.gymFromTexts(texts, settings().gymFolder, D.todayISO());
      plugin._sideCache = { tasks: state.tasks, gym: state.gym, at: Date.now() };
      if (!stopped) { renderTasks(); renderGym(); }
    } catch (e) {
      console.error('vista stats', e);
    } finally {
      state.statsBusy = false;
      if (!stopped) renderStats();
    }
  }

  function scheduleStats() {
    if (statsTimer) clearTimeout(statsTimer);
    statsTimer = setTimeout(() => { statsTimer = null; if (!stopped) gatherStats(true); }, 4000);
  }

  /* ---- background + effects --------------------------------------------- */

  function refreshPhotos() {
    state.photos = B.listPhotos(app.vault.getFiles().map(f => f.path), settings().photoFolder);
  }

  function choosePhoto() {
    const s = settings();
    const seed = s.photoMode === 'open' ? sessionSeed : D.todayISO();
    return B.pickPhoto(state.photos, s.photoMode, s.photo, seed);
  }

  function applyBackground(photoPath) {
    const s = settings();
    root.classList.toggle('is-plain', s.background === 'none');
    const dim = Math.max(0, Math.min(0.85, Number(s.dim) || 0));
    veil.style.setProperty('--vs-dim-top', String(Math.max(0, dim)));
    veil.style.setProperty('--vs-dim-bot', String(Math.min(0.92, dim * 1.35 + 0.08)));
    const blur = Math.max(0, Math.min(30, Number(s.blur) || 0));
    if (s.background === 'none') { setLayer(null, null); state.photo = null; setPhotoLabel(''); return; }
    if (s.background === 'gradient') { setLayer(null, B.gradientLayers(s.gradient)); state.photo = null; setPhotoLabel(''); return; }
    refreshPhotos();
    const path = photoPath || choosePhoto();
    if (!path) {
      setLayer(null, B.gradientLayers(s.gradient));
      state.photo = null;
      setPhotoLabel(`No photos in “${s.photoFolder}” — showing a gradient`);
      return;
    }
    state.photo = path;
    const file = app.vault.getFileByPath(path);
    let url = '';
    try { url = file ? app.vault.getResourcePath(file) : ''; } catch (e) { url = ''; }
    if (!url) { setLayer(null, B.gradientLayers(s.gradient)); return; }
    setPhotoLabel(B.photoTitle(path));
    const img = new Image();
    img.onload = () => { if (!stopped && state.photo === path) setLayer(url, null, blur); };
    img.onerror = () => { if (!stopped) setLayer(null, B.gradientLayers(s.gradient)); };
    img.src = url;
  }

  /* gradient is { image, color } from B.gradientLayers(), or null. The two
     go on separate style properties — a gradient preset's radials are
     transparent at the edges and need backgroundColor showing through
     there; joining them into one background-image string put a bare colour
     at the top level of that comma list, which CSS treats as invalid and
     drops the WHOLE property (5 of 6 presets only ever painted Ocean, the
     one preset with no transparent gaps to fill). */
  function setLayer(url, gradient, blur) {
    const next = (bgFront + 1) % 2;
    const layer = bgLayers[next];
    layer.style.backgroundImage = url ? `url("${url}")` : (gradient ? gradient.image : '');
    layer.style.backgroundColor = url || !gradient ? '' : (gradient.color || '');
    layer.style.filter = blur ? `blur(${blur}px)` : '';
    layer.style.webkitFilter = layer.style.filter;
    bgLayers.forEach((l, i) => l.classList.toggle('is-front', i === next));
    bgFront = next;
  }

  function setPhotoLabel(text) { if (photoLabel) photoLabel.textContent = text; }

  function effectOpts() {
    const s = settings();
    return { type: s.effect || 'auto', intensity: Math.max(0, Math.min(1.5, Number(s.intensity) || 0)), reduced, mobile: isMobile, hour: new Date().getHours(), leafPalette: s.leafPalette };
  }

  function applyEffect() {
    const o = effectOpts();
    if (fx) { fx.setLeafPalette(o.leafPalette); fx.setIntensity(o.intensity); fx.setType(o.type, o.hour); }
    else fx = E.startEffect(canvas, o);
  }

  function renderFoot() {
    clear(footEl);
    photoLabel = el(footEl, 'span', 'vs-foot-text', state.photo ? B.photoTitle(state.photo) : '');
    el(footEl, 'span', 'vs-spacer');
    const s = settings();
    if (s.background === 'photos') {
      const b = button(footEl, 'vs-iconbtn', null, () => ctl.nextPhoto(), 'shuffle');
      b.title = 'Next photo';
    }
    const fxBtn = button(footEl, 'vs-iconbtn', null, e => effectMenu(e), 'sparkles');
    fxBtn.title = 'Background effect';
    const cog = button(footEl, 'vs-iconbtn', null, () => openSettings(), 'settings');
    cog.title = 'Vista settings';
  }

  function effectMenu(e) {
    if (typeof Menu !== 'function') { ctl.cycleEffect(); return; }
    const menu = new Menu();
    for (const t of E.TYPES) {
      menu.addItem(i => {
        i.setTitle(t.name).setIcon(t.icon).onClick(async () => { settings().effect = t.id; try { await plugin.saveSettings(); } catch (err) { console.error(err); } applyEffect(); });
        if (i.setChecked && settings().effect === t.id) i.setChecked(true);
      });
    }
    /* The colours only mean something while leaves are falling. */
    if (settings().effect === 'leaves') {
      if (menu.addSeparator) menu.addSeparator();
      for (const pal of E.LEAF_PALETTES) {
        menu.addItem(i => {
          i.setTitle(pal.name).setIcon(pal.id === 'summer' ? 'sun' : 'leaf').onClick(async () => { settings().leafPalette = pal.id; try { await plugin.saveSettings(); } catch (err) { console.error(err); } applyEffect(); });
          if (i.setChecked && E.leafPalette(settings().leafPalette) === pal.id) i.setChecked(true);
        });
      }
    }
    if (menu.showAtMouseEvent) menu.showAtMouseEvent(e); else if (menu.showAtPosition) menu.showAtPosition({ x: e.clientX, y: e.clientY });
  }

  function openSettings() {
    try {
      if (app.setting && app.setting.open) { app.setting.open(); if (app.setting.openTabById) app.setting.openTabById('vista'); return; }
    } catch (e) { /* fall through */ }
    new Notice('Vista: open Settings → Community plugins → Vista.');
  }

  /* ---- lifecycle -------------------------------------------------------- */

  function renderAll() {
    renderHeader();
    renderTiles();
    renderCols();
    renderFoot();
    applyBackground();
    applyEffect();
    gatherStats(false);
    captureEl.classList.toggle('is-hidden', settings().showCapture === false);
    loadWeather(false);
  }

  /* renderHeader() runs every 15s, but everything else on the page is drawn
     once and left — Rhythm, Tasks, Gym, Nudge, Budget and the calendar's
     "today" all freeze at whatever day it was when they were last rendered.
     Left open across midnight, every one of those reads as yesterday: a
     rhythm tick would even write into TODAY's log for a practice that was
     only ever yesterday's plan. Re-gathering each card's data (not just
     re-rendering the stale state) is what makes them today's again. */
  function onDateChanged() {
    state.rhythmPending.clear();
    rhythmToday().then(() => { if (!stopped) renderCols(); });
    gatherStats(true);
    gatherNudge(true);
    gatherBudget(true);
    if (state.calOpen) { state.calMonth = D.todayISO(); renderCalendar(); }
    loadWeather(false);
  }

  function checkDateRollover() {
    const today = D.todayISO();
    if (today === lastRenderDay) return;
    lastRenderDay = today;
    onDateChanged();
  }

  /* Resuming from the background: the 15s tick did not run while we were
     away, so the clock would otherwise show the time we left. */
  function onVisible() { if (!stopped && document.visibilityState === 'visible') { renderHeader(); checkDateRollover(); } }

  const ctl = {
    state,
    async start() {
      buildShell();
      buildIndex();
      /* Rhythm decides whether its card exists, and reading it is async: give
         it a short head start so the card is on the first paint instead of
         popping in (and shifting the others) a moment later. If the read is
         slow the page draws without it and the columns are redrawn when it
         lands (renderCols' own kick covers that, via rhythmKicked). */
      if (settings().showRhythm !== false) {
        rhythmKicked = true;
        let painted = false, cap = null;
        const read = rhythmToday().then(() => { if (painted && !stopped) renderCols(); });
        await Promise.race([read, new Promise(r => { cap = setTimeout(r, 600); })]);
        clearTimeout(cap);
        painted = true;
        if (stopped) return;
      }
      renderAll();
      /* A new, deleted or renamed file can change the search index; a Rhythm
         file, the Rhythm card. */
      const onVault = file => { state.entries = []; scheduleStats(); if (file && inRhythmFolder(file.path)) scheduleRhythm(); };
      if (view.registerEvent) {
        view.registerEvent(app.vault.on('create', onVault));
        view.registerEvent(app.vault.on('delete', onVault));
        view.registerEvent(app.vault.on('rename', onVault));
        view.registerEvent(app.vault.on('modify', file => {
          scheduleStats();
          if (!file || !file.path) return;
          if (file.path.startsWith((settings().budgetFolder || '') + '/')) scheduleBudget();
          /* Nudge writing its own note, or the user editing it by hand. */
          if (file.path === NU.nudgePath(app)) scheduleNudge();
          /* Rhythm writes its own log; the loader reads note TEXT, so a
             modify (not only a metadata change) is what tells us to re-read. */
          if (inRhythmFolder(file.path)) scheduleRhythm();
        }));
        if (app.metadataCache && app.metadataCache.on) view.registerEvent(app.metadataCache.on('changed', file => {
          /* A note's aliases may have changed: the search index holds them, so
             mark it dirty. It is rebuilt on the next search, not on every
             keystroke of an edit elsewhere. */
          state.entries = [];
          if (file && inRhythmFolder(file.path)) scheduleRhythm();
        }));
        if (app.workspace && app.workspace.on) view.registerEvent(app.workspace.on('file-open', () => { if (!stopped) renderRecent(); }));
        /* Coming back to the app (mobile especially) doesn't always pass
           through the 15s tick before the user sees the page again. */
        if (app.workspace.on) view.registerEvent(app.workspace.on('active-leaf-change', () => { if (!stopped) checkDateRollover(); }));
      }
      /* The Budget plugin says when its own data reloaded — independent of
         Vista's budgetFolder setting, which the modify watcher above relies on.
         syncBudgetApi() subscribes, and re-subscribes if the plugin is reloaded. */
      syncBudgetApi();
      if (view.registerInterval) view.registerInterval(window.setInterval(() => {
        if (stopped) return;
        renderHeader(); checkDateRollover();
        /* The Budget plugin may have been reloaded since the last read. */
        if (syncBudgetApi() && settings().showBudget !== false) { renderBudget(); gatherBudget(true); }
      }, 15000));
      if (view.registerInterval) view.registerInterval(window.setInterval(() => { if (!stopped) loadWeather(false); }, 10 * 60 * 1000));
      if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('visibilitychange', onVisible);
      }
      if (!isMobile) setTimeout(() => { if (!stopped && searchInput) searchInput.focus(); }, 60);
    },
    stop() {
      stopped = true;
      if (activeDragCancel) { activeDragCancel(); activeDragCancel = null; }
      if (typeof document !== 'undefined' && document.removeEventListener) document.removeEventListener('visibilitychange', onVisible);
      if (fx) { fx.stop(); fx = null; }
      if (searchTimer) clearTimeout(searchTimer);
      if (contentTimer) clearTimeout(contentTimer);
      if (statsTimer) clearTimeout(statsTimer);
      if (rhythmTimer) clearTimeout(rhythmTimer);
      if (budgetTimer) clearTimeout(budgetTimer);
      if (typeof unsubscribeBudgetApi === 'function') { try { unsubscribeBudgetApi(); } catch (e) { /* the Budget plugin may already be gone */ } unsubscribeBudgetApi = null; }
      plugin._budgetCache = budgetCacheAfterStop(plugin._budgetCache);
      if (nudgeTimer) clearTimeout(nudgeTimer);
      root.classList.remove('vs-app', 'is-plain');
      clear(root);
    },
    refresh() { if (stopped) return; renderHeader(); renderTiles(); renderCols(); renderFoot(); applyBackground(); applyEffect(); captureEl.classList.toggle('is-hidden', settings().showCapture === false); loadWeather(false); },
    focusSearch() { if (searchInput) { searchInput.focus(); searchInput.select(); } },
    nextPhoto() {
      if (settings().background !== 'photos') return;
      refreshPhotos();
      const next = B.nextPhoto(state.photos, state.photo);
      if (next) applyBackground(next);
    },
    async cycleEffect() {
      const ids = E.TYPES.map(t => t.id);
      const i = ids.indexOf(settings().effect || 'auto');
      settings().effect = ids[(i + 1) % ids.length];
      try { await plugin.saveSettings(); } catch (e) { console.error(e); }
      applyEffect();
      new Notice('Vista: ' + E.TYPES.find(t => t.id === settings().effect).name);
    },
  };
  return ctl;
}

module.exports = {
  mountDashboard, dayTapAction, mergeWidgetOrder, budgetHeadline, budgetCacheAfterStop,
  showBudgetCard, taskRefusedNotice, rhythmRefusedNotice, overlayPending, settledPending, dropSettled,
};
