'use strict';
/* Bundle-safety gates for the real mobile floor (iOS 15 WebKit):
   1. no lookbehind regex literals in src/;  2. no Node APIs in src/ (one
      exception: src/ai-cli.js reaches Node through window.require at run
      time, on a computer only — see the block below);
   3. no innerHTML assignment;  4. the built main.js (when present) evaluates
   against an obsidian stub and exports a Plugin subclass. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');
const NODE_REQUIRES = /require\(\s*['"](?:node:)?(fs|path|os|child_process|crypto|http|https|net|electron)['"]\s*\)/;
/* The only file allowed to touch Node: Claude Code and Codex are run from it. */
const NODE_ALLOWED = 'ai-cli.js';

for (const f of fs.readdirSync(srcDir).filter(f => f.endsWith('.js'))) {
  const text = fs.readFileSync(path.join(srcDir, f), 'utf8');
  assert.ok(!text.includes('(?<'), `${f}: lookbehind/named-group regex literal — iOS 15 fatal`);
  if (f === NODE_ALLOWED) {
    /* Never a bare require (esbuild would try to bundle it), only window.require
       at run time, and only after the desktop check. */
    assert.ok(!/(^|[^.\w])require\(\s*['"](?:node:)?(fs|path|os|child_process)/m.test(text), `${f}: Node reached by a bare require — use window.require`);
    assert.ok(/Platform\.isDesktopApp/.test(text), `${f}: must check Platform.isDesktopApp before window.require`);
  } else {
    assert.ok(!NODE_REQUIRES.test(text), `${f}: Node API require — mobile fatal`);
    assert.ok(!/window\.require\b/.test(text), `${f}: window.require outside ${NODE_ALLOWED}`);
  }
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
