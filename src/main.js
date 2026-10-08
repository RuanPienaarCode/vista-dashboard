'use strict';
/* ============================================================================
   VISTA — Obsidian plugin (entry point)
   A glass dashboard: search, quick access, vault stats, and a living
   background of your own photos. Vault API only — desktop and iOS/Android.
   Source lives in src/ as CommonJS modules; esbuild bundles them into
   main.js (target safari15 — the real engine floor on mobile).
   ============================================================================ */

const { Plugin } = require('obsidian');
const { VIEW_TYPE, DEFAULT_SETTINGS } = require('./constants');
const { VistaView } = require('./view');
const { VistaSettingTab } = require('./settings-tab');
const W = require('./weather');

class VistaPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE, leaf => new VistaView(leaf, this));
    this.addRibbonIcon('layout-dashboard', 'Open Vista', () => this.activateView());
    this.addCommand({ id: 'open', name: 'Open dashboard', callback: () => this.activateView() });
    this.addCommand({
      id: 'search',
      name: 'Search from the dashboard',
      callback: async () => { await this.activateView(); this.forEachView(c => c.focusSearch()); },
    });
    this.addCommand({ id: 'next-photo', name: 'Next background photo', callback: () => this.forEachView(c => c.nextPhoto()) });
    this.addCommand({ id: 'cycle-effect', name: 'Cycle the background effect', callback: () => this.forEachView(c => c.cycleEffect()) });
    this.settingTab = new VistaSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.app.workspace.onLayoutReady(() => this.maybeOpenOnStartup());
  }

  maybeOpenOnStartup() {
    const mode = this.settings.openOnStartup || 'always';
    if (mode === 'never') return;
    const ws = this.app.workspace;
    if (ws.getLeavesOfType(VIEW_TYPE).length) return;
    if (mode === 'empty' && ws.getLeavesOfType('markdown').length) return;
    this.activateView();
  }

  async activateView() {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      const cur = ws.getMostRecentLeaf ? ws.getMostRecentLeaf() : null;
      const empty = cur && cur.view && typeof cur.view.getViewType === 'function' && cur.view.getViewType() === 'empty';
      leaf = empty ? cur : ws.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    ws.revealLeaf(leaf);
  }

  forEachView(fn) {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const v = leaf.view;
      if (v && v.ctl) fn(v.ctl);
    }
  }

  refreshViews() { this.forEachView(c => c.refresh()); }

  /* data.json syncs between devices. Obsidian calls this when it changed on
     disk behind our back (iCloud/Sync delivering another device's edit). The
     in-memory copy is replaced IN PLACE — the settings tab and the open views
     hold the same object — and the dashboards re-render, so the next save from
     here carries the other device's edit instead of reverting it. */
  async onExternalSettingsChange() {
    await this.loadSettings();
    this.refreshViews();
    /* An OPEN settings tab shows the old values until it is redrawn. */
    if (this.settingTab && typeof this.settingTab.onExternalSettingsChange === 'function') this.settingTab.onExternalSettingsChange();
  }

  async loadSettings() {
    const data = await this.loadData();
    /* A JSON round-trip deep-clones DEFAULT_SETTINGS's own nested objects
       (widgetSizes) — Object.assign only shallow copies, so every vault
       sharing the plain default object meant one vault's setWidgetSize()
       silently mutated every other vault's defaults too. (structuredClone
       would do this in one call, but it is iOS 15.4+ — this plugin's floor is
       15.0.) Data that isn't a plain object (a corrupt data.json, or an array)
       is ignored rather than spread: an array's own index keys ("0", "1", …)
       are enumerable too, and used to leak onto settings as stray properties. */
    const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
    const defaults = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    const next = Object.assign(defaults, isPlainObject(data) ? data : {});
    if (!Array.isArray(next.collapsed)) next.collapsed = [];
    if (!Array.isArray(next.hiddenGroups)) next.hiddenGroups = [];
    /* typeof [] is 'object' too: an array here would never keep a size set on it. */
    if (!isPlainObject(next.widgetSizes)) next.widgetSizes = {};
    if (!Array.isArray(next.widgetOrder)) next.widgetOrder = [];
    /* null = the built-in tiles; anything else must be a list of tile objects. */
    if (next.tiles !== null && !Array.isArray(next.tiles)) next.tiles = null;
    if (Array.isArray(next.tiles)) next.tiles = next.tiles.filter(isPlainObject);
    /* lucide's "cross" is an ✕, not a Christian cross — an early default used it. */
    if (Array.isArray(next.tiles)) for (const t of next.tiles) if (t.icon === 'cross' && /christ|church|faith/i.test(t.label || '')) t.icon = 'church';

    /* The weather cache used to live in data.json. Take it out of settings and
       hand it to this device's storage (once; an entry already here wins). */
    const legacy = { geo: next.weatherGeo, last: next.weatherLast };
    const hadLegacy = 'weatherGeo' in next || 'weatherLast' in next;
    delete next.weatherGeo; delete next.weatherLast;

    if (this.settings) {
      for (const k of Object.keys(this.settings)) delete this.settings[k];
      Object.assign(this.settings, next);
    } else this.settings = next;

    if (hadLegacy) {
      this.migrateWeatherCache(legacy);
      try { await this.saveSettings(); } catch (e) { console.error('vista settings scrub', e); }
    }
  }

  /* data.json without the per-device keys, so nothing — not even a settings tab
     still assigning them — writes the cache back into the synced file. */
  async saveSettings() {
    const out = Object.assign({}, this.settings);
    delete out.weatherGeo; delete out.weatherLast;
    await this.saveData(out);
  }

  /* ---- the per-device weather cache ---------------------------------------
     The geocoded coordinates and the last forecast belong to THIS device. They
     are kept in localStorage, keyed by vault and plugin id (two vaults on one
     device never share them). If storage is unavailable the cache lives in
     memory for the session — weather still works, it just refetches next time.
     The dashboard reads and writes it through these, never through settings. */
  weatherStore() {
    try {
      const ls = typeof window !== 'undefined' ? window.localStorage : null;
      if (ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function') return ls;
    } catch (e) { /* blocked: fall through to memory */ }
    if (!this._wxMemory) { const m = new Map(); this._wxMemory = { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } }; }
    return this._wxMemory;
  }

  weatherCacheKey() {
    let name = '';
    try { name = this.app.vault.getName(); } catch (e) { /* unnamed */ }
    return W.cacheKey(name, (this.manifest && this.manifest.id) || 'vista');
  }

  /* { geo, last } for the place and unit currently set; anything cached for
     another place or unit reads as null. */
  loadWeatherCache() {
    const s = this.settings || {};
    return W.cacheFor(W.readCache(this.weatherStore(), this.weatherCacheKey()), s.weatherLocation, s.weatherUnit);
  }

  /* part: { geo?, last? }. Merges over what is already valid for the current
     place and stamps `last` with the place its coordinates answered, so a
     forecast can never be shown under a different name. Returns false if the
     browser refused the write. */
  saveWeatherCache(part) {
    const s = this.settings || {};
    const cur = this.loadWeatherCache();
    const p = part || {};
    const geo = 'geo' in p ? p.geo : cur.geo;
    let last = 'last' in p ? p.last : cur.last;
    if (last) last = Object.assign({}, last, { query: (geo && geo.query) || String(s.weatherLocation || '').trim() });
    return W.writeCache(this.weatherStore(), this.weatherCacheKey(), { geo: geo || null, last: last || null });
  }

  clearWeatherCache() { return W.writeCache(this.weatherStore(), this.weatherCacheKey(), { geo: null, last: null }); }

  /* One-time move of the old data.json values. An entry already on this device
     is newer than anything that synced, so it is never overwritten. */
  migrateWeatherCache(legacy) {
    const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
    const have = W.readCache(this.weatherStore(), this.weatherCacheKey());
    const geo = have.geo || (isObj(legacy.geo) ? legacy.geo : null);
    let last = have.last;
    if (!last && isObj(legacy.last)) {
      /* old forecasts carry no place stamp; they were fetched for the geo they
         were saved beside, else for the place currently set */
      const place = (geo && geo.query) || String((this.settings || {}).weatherLocation || '').trim();
      last = Object.assign({}, legacy.last, { query: legacy.last.query || place });
    }
    if (geo || last) W.writeCache(this.weatherStore(), this.weatherCacheKey(), { geo, last });
  }
}

module.exports = VistaPlugin;
