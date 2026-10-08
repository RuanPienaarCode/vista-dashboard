'use strict';
/* Bundle-safety gates for the real mobile floor (iOS 15 WebKit):
   1. no lookbehind regex literals in src/;  2. no Node APIs in src/;
   3. no innerHTML assignment;  4. the built main.js (when present) evaluates
   against an obsidian stub and exports a Plugin subclass. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');
const NODE_REQUIRES = /require\(\s*['"](?:node:)?(fs|path|os|child_process|crypto|http|https|net|electron)['"]\s*\)/;

for (const f of fs.readdirSync(srcDir).filter(f => f.endsWith('.js'))) {
  const text = fs.readFileSync(path.join(srcDir, f), 'utf8');
  assert.ok(!text.includes('(?<'), `${f}: lookbehind/named-group regex literal — iOS 15 fatal`);
  assert.ok(!NODE_REQUIRES.test(text), `${f}: Node API require — mobile fatal`);
  assert.ok(!/\.innerHTML\s*=/.test(text), `${f}: innerHTML assignment — build DOM instead`);
}

const bundlePath = path.join(root, 'main.js');
if (fs.existsSync(bundlePath)) {
  const stub = {
    Plugin: class Plugin {}, ItemView: class ItemView {}, Modal: class Modal {}, Setting: class Setting {},
    PluginSettingTab: class PluginSettingTab {}, Notice: class Notice {}, TFile: class TFile {}, TFolder: class TFolder {},
    normalizePath: p => p, setIcon: () => {}, FuzzySuggestModal: class FuzzySuggestModal {}, Menu: class Menu {}, Platform: { isMobile: false },
  };
  const origLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'obsidian') return stub;
    return origLoad.call(this, request, ...rest);
  };
  try {
    const text = fs.readFileSync(bundlePath, 'utf8');
    assert.ok(!text.includes('(?<'), 'main.js: lookbehind survived into the bundle');
    delete require.cache[bundlePath];
    const exported = require(bundlePath);
    assert.strictEqual(typeof exported, 'function', 'bundle must export the plugin class');
    assert.ok(exported.prototype instanceof stub.Plugin, 'export must extend obsidian.Plugin');
  } finally {
    Module._load = origLoad;
  }
  console.log('ios hazards OK (bundle evaluated)');
} else {
  console.log('ios hazards OK (src only — main.js not built yet)');
}
