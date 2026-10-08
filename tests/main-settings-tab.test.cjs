'use strict';
/* The plugin keeps its settings tab so an external data.json change (iCloud /
   Sync delivering another device's edit) can redraw an OPEN tab, after the
   views have been refreshed from the freshly loaded settings. */
const assert = require('node:assert');
const stub = require('./_stub.cjs');
const Module = require('node:module');
const origLoad = Module._load;
const order = [];
class FakeTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; } onExternalSettingsChange() { order.push('tab'); } }
Module._load = function (request, ...rest) {
  if (request === './view') return { VistaView: class {} };
  if (request === './settings-tab') return { VistaSettingTab: FakeTab };
  return origLoad.call(this, request, ...rest);
};
const added = [];
stub.Plugin = class {
  async loadData() { return null; } async saveData() {}
  registerView() {} addRibbonIcon() {} addCommand() {} addSettingTab(t) { added.push(t); }
};
const VistaPlugin = require('../src/main');
Module._load = origLoad;

(async () => {
  const p = new VistaPlugin();
  p.manifest = { id: 'vista' };
  p.app = { vault: { getName: () => 'V' }, workspace: { onLayoutReady() {}, getLeavesOfType: () => [] } };
  p.refreshViews = () => { order.push('views'); };
  await p.onload();
  assert.ok(p.settingTab instanceof FakeTab, 'the tab instance is kept on the plugin');
  assert.strictEqual(added.length, 1);
  assert.strictEqual(added[0], p.settingTab, 'and it is the one registered');
  order.length = 0;
  await p.onExternalSettingsChange();
  assert.deepStrictEqual(order, ['views', 'tab'], 'views refresh first, then the open tab redraws');

  /* no tab yet (change arrives before onload finished) must not throw */
  const q = new VistaPlugin();
  q.manifest = { id: 'vista' };
  q.app = p.app;
  q.refreshViews = () => {};
  await q.onExternalSettingsChange();
  console.log('main settings tab OK');
})().catch(e => { console.error(e); process.exit(1); });
