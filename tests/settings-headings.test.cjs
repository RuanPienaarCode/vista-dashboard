'use strict';
/* Guard: Obsidian's guidelines want section headings in a settings tab built
   as `new Setting(el).setName(...).setHeading()`, not a raw <h3> (item 5 of
   the 2026-09-27 audit). This runs the REAL src/settings-tab.js display()
   against a tiny in-process DOM + Setting fake — not tests/_stub.cjs's
   (whose Setting/PluginSettingTab are empty classes with no fluent API) —
   so everything needed lives in this one file and no shared test stub is
   touched. Negative control: an `<h3 class="vs-settings-h">` regression
   would show up as an H3 node in the walk, which the assertion below
   catches.
*/
const assert = require('node:assert');
const stub = require('./_stub.cjs');

/* ---- minimal DOM: just enough for src/dom.js's el()/icon()/button() and
   settings-tab.js's own containerEl.empty()/classList/insertBefore. ---- */
class FakeNode {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this._classes = new Set();
    this._text = '';
    this.style = {};
  }
  set className(v) { this._classes = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  get className() { return [...this._classes].join(' '); }
  get classList() {
    const self = this;
    return {
      add: (...c) => c.forEach(x => self._classes.add(x)),
      remove: (...c) => c.forEach(x => self._classes.delete(x)),
      contains: c => self._classes.has(c),
      toggle: (c, force) => { if (force === undefined) (self._classes.has(c) ? self._classes.delete(c) : self._classes.add(c)); else if (force) self._classes.add(c); else self._classes.delete(c); },
    };
  }
  set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; }
  get textContent() { return this._text; }
  appendChild(c) { this.children.push(c); c.parent = this; return c; }
  append(...cs) { cs.forEach(c => this.appendChild(c)); }
  insertBefore(node, ref) { const i = this.children.indexOf(ref); this.children.splice(i < 0 ? 0 : i, 0, node); node.parent = this; return node; }
  get firstChild() { return this.children[0] || null; }
  removeChild(c) { this.children = this.children.filter(x => x !== c); return c; }
  empty() { this.children = []; }
  addEventListener() {}
}
global.document = { createElement: tag => new FakeNode(tag) };

function walk(node, fn) { fn(node); for (const c of node.children) walk(c, fn); }

/* ---- Setting: just the chainable surface settings-tab.js calls. Each
   api object is built empty, then given self-referencing methods once it
   exists — referencing the `api` binding inside its own literal (before the
   assignment completes) would be a TDZ error. ---- */
class FakeSetting {
  constructor(parent) {
    this.settingEl = new FakeNode('div'); this.settingEl.className = 'setting-item';
    this.nameEl = new FakeNode('div');
    this.descEl = new FakeNode('div');
    this.controlEl = new FakeNode('div');
    this.settingEl.append(this.nameEl, this.descEl, this.controlEl);
    if (parent) parent.appendChild(this.settingEl);
  }
  setName(t) { this.nameEl.textContent = t; return this; }
  setDesc(t) { this.descEl.textContent = t; return this; }
  setHeading() { this.settingEl.classList.add('setting-item-heading'); return this; }
  addText(fn) { const api = {}; api.inputEl = new FakeNode('input'); api.setPlaceholder = () => api; api.setValue = () => api; api.onChange = () => api; fn(api); return this; }
  addDropdown(fn) { const api = {}; api.addOption = () => api; api.setValue = () => api; api.onChange = () => api; fn(api); return this; }
  addToggle(fn) { const api = {}; api.setValue = () => api; api.onChange = () => api; fn(api); return this; }
  addSlider(fn) { const api = {}; api.setLimits = () => api; api.setValue = () => api; api.setDynamicTooltip = () => api; api.onChange = () => api; fn(api); return this; }
  addExtraButton(fn) { const api = {}; api.setIcon = () => api; api.setTooltip = () => api; api.setDisabled = () => api; api.onClick = () => api; fn(api); return this; }
  addButton(fn) { const api = {}; api.setButtonText = () => api; api.setCta = () => api; api.onClick = () => api; fn(api); return this; }
}
class FakePluginSettingTab {
  constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = new FakeNode('div'); }
}

/* Swap the shared stub's Setting/PluginSettingTab for the fakes above —
   `stub` is the exact object Module._load hands back for every
   require('obsidian') from here on in THIS process, so settings-tab.js
   (required below, after the swap) picks these up without editing the
   shared tests/_stub.cjs file on disk. */
stub.Setting = FakeSetting;
stub.PluginSettingTab = FakePluginSettingTab;

const { VistaSettingTab } = require('../src/settings-tab');
const { DEFAULT_SETTINGS } = require('../src/constants');

const app = {
  vault: { getFiles: () => [] },
};
const plugin = {
  settings: Object.assign({}, DEFAULT_SETTINGS),
  async saveSettings() {},
  refreshViews() {},
};

const tab = new VistaSettingTab(app, plugin);
tab.display();

let h3Count = 0;
let headingCount = 0;
const headingNames = [];
walk(tab.containerEl, n => {
  if (n.tagName === 'H3') h3Count++;
  if (n.classList && n.classList.contains('setting-item-heading')) { headingCount++; headingNames.push(n.firstChild ? n.firstChild.textContent : ''); }
});

assert.strictEqual(h3Count, 0, 'no raw <h3> should remain — Obsidian wants Setting().setHeading()');
assert.strictEqual(headingCount, 5, `expected 5 Setting().setHeading() sections, found ${headingCount}`);
assert.deepStrictEqual(headingNames, ['Background', 'Effect', 'Panels', 'Weather', 'Tiles']);

/* The CSS class that only existed to style the old raw <h3> must not survive
   orphaned in styles.css once nothing references it. */
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
assert.ok(!css.includes('vs-settings-h'), 'vs-settings-h is unused now (settings-tab.js no longer emits it) and must be removed from styles.css');

console.log('settings headings OK');
