'use strict';
/* Guards audit 2026-10-07 item 10 (+ the weather-cache move): folder / template
   inputs go through Obsidian's normalizePath, not a hand-rolled strip; blank
   stays blank; the Place field clears the per-device weather cache instead of
   poking settings fields that no longer exist. Runs the REAL settings-tab.js
   display() over a recording fake of the Setting API. */
const assert = require('node:assert');
const stub = require('./_stub.cjs');

class N {
  constructor() { this.children = []; this._c = new Set(); this.style = {}; this._t = ''; }
  set className(v) { this._c = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  get classList() { const s = this; return { add: (...c) => c.forEach(x => s._c.add(x)), contains: c => s._c.has(c) }; }
  set textContent(v) { this._t = String(v); } get textContent() { return this._t; }
  appendChild(c) { this.children.push(c); return c; } append(...c) { c.forEach(x => this.appendChild(x)); }
  insertBefore(n) { this.children.unshift(n); return n; } get firstChild() { return this.children[0] || null; }
  empty() { this.children = []; } addEventListener() {}
}
global.document = { createElement: () => new N() };

const settings = [];
class FakeSetting {
  constructor(parent) { this.nameEl = new N(); this.descEl = new N(); this.controlEl = new N(); this.settingEl = new N(); this.rec = { name: '', desc: '', text: null }; settings.push(this.rec); if (parent) parent.appendChild(this.settingEl); }
  setName(t) { this.rec.name = t; return this; } setDesc(t) { this.rec.desc = t; return this; } setHeading() { return this; }
  addText(fn) { const api = { setPlaceholder: p => { this.rec.placeholder = p; return api; }, setValue: () => api, onChange: cb => { this.rec.text = cb; return api; } }; fn(api); return this; }
  addDropdown(fn) { const api = { addOption: () => api, setValue: () => api, onChange: cb => { this.rec.change = cb; return api; } }; fn(api); return this; }
  addToggle(fn) { const api = { setValue: () => api, onChange: () => api }; fn(api); return this; }
  addSlider(fn) { const api = { setLimits: () => api, setValue: () => api, setDynamicTooltip: () => api, onChange: () => api }; fn(api); return this; }
  addExtraButton(fn) { const api = { setIcon: () => api, setTooltip: () => api, setDisabled: () => api, onClick: () => api }; fn(api); return this; }
  addButton(fn) { const api = { setButtonText: () => api, setCta: () => api, onClick: () => api }; fn(api); return this; }
}
stub.Setting = FakeSetting;
stub.PluginSettingTab = class { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = new N(); } };
/* Obsidian's normalizePath: forward slashes, collapsed, no leading/trailing; '' -> '/'. */
let normalizeCalls = 0;
stub.normalizePath = p => { normalizeCalls++; return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '') || '/'; };

const { VistaSettingTab } = require('../src/settings-tab');
const { DEFAULT_SETTINGS } = require('../src/constants');

let cleared = 0, saved = 0;
const plugin = { settings: Object.assign({}, DEFAULT_SETTINGS, { background: 'photos' }), async saveSettings() { saved++; }, refreshViews() {}, clearWeatherCache() { cleared++; } };
const tab = new VistaSettingTab({ vault: { getFiles: () => [] } }, plugin);
tab.display();
const by = name => { const r = settings.find(x => x.name === name); assert.ok(r, `setting "${name}" not found`); return r; };

(async () => {
  const cases = [
    ['Photo folder', 'photoFolder', ' /Dashboard//Backgrounds/ ', 'Dashboard/Backgrounds'],
    ['Budget folder', 'budgetFolder', '\\Money\\Budget\\', 'Money/Budget'],
    ['Gym folder', 'gymFolder', '/Gym/', 'Gym'],
    ['Journal folder', 'journalFolder', ' Notes//Journal/ ', 'Notes/Journal'],
    ['Journal template', 'journalTemplate', '/Templates//Daily note', 'Templates/Daily note'],
  ];
  for (const [name, key, input, want] of cases) {
    await by(name).text(input);
    assert.strictEqual(plugin.settings[key], want, `${name}: ${JSON.stringify(input)} should normalise to ${want}, got ${plugin.settings[key]}`);
  }
  assert.ok(normalizeCalls >= cases.length, 'values must go through obsidian\'s normalizePath');

  /* Blank stays blank (normalizePath("") would be "/", which is truthy). */
  for (const [name, key] of [['Photo folder', 'photoFolder'], ['Budget folder', 'budgetFolder'], ['Journal folder', 'journalFolder'], ['Journal template', 'journalTemplate']]) {
    await by(name).text('   ');
    assert.strictEqual(plugin.settings[key], '', `${name}: blank must stay '' (not '/')`);
  }
  await by('Gym folder').text('');
  assert.strictEqual(plugin.settings.gymFolder, 'Gym', 'a blank gym folder falls back to the plugin default');

  /* Negative control: the hand-rolled strip this replaced left a doubled slash in. */
  assert.strictEqual('Notes//Journal'.replace(/^\/+|\/+$/g, ''), 'Notes//Journal', 'sanity: the old strip does not collapse interior slashes');

  /* Place: copy for the blank state, and the cache is cleared on edit (debounced save). */
  assert.ok(/Set a place to show weather/.test(by('Place').desc), 'Place description must say "Set a place to show weather"');
  by('Place').text('London');
  assert.strictEqual(plugin.settings.weatherLocation, 'London');
  assert.strictEqual(cleared, 1, 'editing the place must clear the weather cache');
  assert.ok(!('weatherGeo' in plugin.settings) || plugin.settings.weatherGeo === undefined || plugin.settings.weatherGeo === null, 'settings tab must not write weatherGeo');
  const before = saved;
  await new Promise(r => setTimeout(r, 700));
  assert.strictEqual(saved, before + 1, 'the place save is still debounced to one trailing save');
  await by('Units').change('f');
  assert.ok(!('weatherLast' in plugin.settings), 'changing units must not touch weatherLast (the cache invalidates itself on read)');

  /* The open tab can be redrawn after another device's edit; a closed one is left alone. */
  const n = settings.length;
  tab.onExternalSettingsChange();
  assert.ok(settings.length > n, 'an open tab must redraw on an external settings change');
  tab.hide();
  const m = settings.length;
  tab.onExternalSettingsChange();
  assert.strictEqual(settings.length, m, 'a hidden tab must not redraw');

  console.log('settings paths OK');
})().catch(e => { console.error(e); process.exit(1); });
