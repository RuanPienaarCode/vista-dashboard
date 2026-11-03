'use strict';
/* Ask AI is a computer feature (Ruan, 3 Nov 2026): with Platform.isMobile
   true (a phone or an iPad) there is no button, no panel, no command, no
   provider or key setting, no stored key, and no provider call can fire.
   With it false nothing changes. Runs the REAL src files over the shared
   stub and the fake DOM; Platform.isMobile is flipped on the stub's own
   Platform object, which every module reads at call time.

   Negative control (done when this was written): deleting the guard in
   ask(), in send(), in mountAskAI(), in displayAskAI(), in the command
   registration, or in aiDevice()/saveAiDevice() fails a named check below. */
const assert = require('node:assert');
const stub = require('./_stub.cjs');
const { install, FakeEl } = require('./_fake-dom.cjs');
install();

/* ---- obsidian stub additions: a counting requestUrl, a chainable Setting ---- */
const calls = { request: 0, run: 0 };
stub.requestUrl = async () => { calls.request++; return { status: 200, json: { content: [{ type: 'text', text: 'Hello' }], model: 'm', stop_reason: 'end_turn' } }; };
stub.MarkdownRenderer = { render: async () => {} };
stub.Component = class Component { load() {} unload() {} addChild() {} };
const names = [];
const chain = () => new Proxy(function () {}, { get: (_, k) => (k === 'inputEl' ? new FakeEl('input') : chain()), apply: () => chain() });
stub.Setting = class Setting {
  constructor(parent) { this.parent = parent; }
  setName(t) { names.push(String(t)); return this; }
  setDesc() { return this; } setHeading() { return this; }
  addText(fn) { fn(chain()); return this; } addDropdown(fn) { fn(chain()); return this; }
  addToggle(fn) { fn(chain()); return this; } addButton(fn) { fn(chain()); return this; }
  addSlider(fn) { fn(chain()); return this; } addExtraButton(fn) { fn(chain()); return this; }
};
stub.PluginSettingTab = class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; } };
const commands = [];
const disk = { data: null };
stub.Plugin = class Plugin {
  addCommand(c) { commands.push(c.id); } addRibbonIcon() {} registerView() {} addSettingTab() {}
  async loadData() { return disk.data; } async saveData(d) { disk.data = d; }
};

const Module = require('node:module');
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === './view') return { VistaView: class {} };
  return origLoad.call(this, request, ...rest);
};
const VistaPlugin = require('../src/main');
Module._load = origLoad;
const P = require('../src/ai-providers');
const { mountAskAI } = require('../src/ai-chat');
const { VistaSettingTab } = require('../src/settings-tab');
const { DEFAULT_SETTINGS } = require('../src/constants');

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
const mobile = on => { stub.Platform.isMobile = on; };
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const mkStorage = () => { const m = new Map(); return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } }; };
const mkPlugin = async () => {
  const p = new VistaPlugin();
  p.manifest = { id: 'vista' };
  p.app = { vault: { getName: () => 'Home' }, workspace: { getLeavesOfType: () => [], onLayoutReady() {} } };
  await p.loadSettings();
  return p;
};

(async () => {
  const msgs = [{ role: 'user', content: 'What is due?' }];
  const everyAI = P.PROVIDERS.map(p => p.id);
  ok(everyAI.length === 6, 'all six AIs are covered');

  /* ---- 1. the provider call: the one function that sends ---- */
  mobile(true);
  for (const id of everyAI) {
    await assert.rejects(
      P.ask({ provider: id, system: 'S', messages: msgs, apiKey: 'k', model: 'x', request: stub.requestUrl, platform: stub.Platform, binPath: '/x', run: async () => { calls.run++; return { code: 0, stdout: '', stderr: '' }; } }),
      new RegExp(P.MOBILE_REFUSAL), `${id}: refused on mobile`);
  }
  ok(calls.request === 0 && calls.run === 0, 'no request and no run was made by a refused ask()');
  mobile(false);
  const r = await P.ask({ provider: 'claude', system: 'S', messages: msgs, apiKey: 'k', request: stub.requestUrl, platform: stub.Platform });
  ok(r.text === 'Hello' && calls.request === 1, 'desktop ask() still reaches the provider');
  const r2 = await P.ask({ provider: 'claude', system: 'S', messages: msgs, apiKey: 'k', request: stub.requestUrl });
  ok(r2.text === 'Hello' && calls.request === 2, 'a caller that passes no platform is unchanged');
  calls.request = 0;

  /* ---- 2. commands ---- */
  mobile(true);
  commands.length = 0;
  await (await mkPlugin()).onload();
  ok(commands.includes('open') && commands.includes('search'), 'mobile keeps the ordinary commands');
  ok(!commands.includes('ask-ai'), 'mobile registers no ask-ai command');
  mobile(false);
  commands.length = 0;
  await (await mkPlugin()).onload();
  ok(commands.includes('ask-ai'), 'desktop registers the ask-ai command');

  /* ---- 3. settings: no AI provider, key or button settings on mobile ---- */
  const tab = plugin => new VistaSettingTab({ vault: { getFiles: () => [] } }, plugin);
  const settingsFor = async () => {
    const p = await mkPlugin();
    p.aiRunner = () => ({ find: b => b, run: async () => ({}) });
    names.length = 0;
    tab(p).displayAskAI(new FakeEl('div'), p.settings, async () => {});
    return names.slice();
  };
  mobile(true);
  const m = await settingsFor();
  ok(m.length === 1 && m[0] === 'Ask AI', `mobile Settings has only the Ask AI heading, got ${JSON.stringify(m)}`);
  ok(!m.some(n => /API key|AI on this device|Claude Code app|Model|Show the Ask AI|Try it|Saved chats/i.test(n)), 'no provider, key or button settings on mobile');
  mobile(false);
  const d = await settingsFor();
  ok(d.includes('Show the Ask AI button') && d.includes('Try it') && d.includes('AI on this device') && d.includes('Model'), `desktop Settings keeps the AI settings, got ${JSON.stringify(d)}`);

  /* ---- 4. no key is read or stored on mobile ---- */
  const storage = mkStorage();
  global.window.localStorage = storage;
  const dev = await mkPlugin();
  mobile(false);
  ok(dev.saveAiDevice({ provider: 'grok', keys: { grok: 'xai-SECRET' } }) === true, 'desktop saves a key');
  ok(dev.aiDevice().keys.grok === 'xai-SECRET', 'desktop reads it back');
  const before = JSON.stringify([...storage.m]);
  mobile(true);
  ok(dev.saveAiDevice({ keys: { claude: 'sk-ant-SECRET2' } }) === false, 'mobile saves nothing');
  ok(JSON.stringify([...storage.m]) === before, 'mobile wrote nothing to storage');
  const mdev = dev.aiDevice();
  ok(JSON.stringify(mdev.keys) === '{}' && mdev.provider === 'claude-code', 'mobile has no keys, even if storage holds some, and no API default');

  /* ---- 5. the panel: nothing mounted on mobile; desktop mounts and works ---- */
  const mountOn = async isMobile => {
    mobile(isMobile);
    const plugin = await mkPlugin();
    plugin.aiDevice = () => ({ provider: 'claude', keys: { claude: 'sk-ant-X' }, paths: {} });
    plugin.aiRunner = () => null;
    const root = new FakeEl('div');
    const handle = mountAskAI({ app: plugin.app, plugin, root, readPage: () => 'page text' });
    return { plugin, root, handle };
  };
  const mm = await mountOn(true);
  ok(mm.root.children.length === 0 && !mm.root.classList.contains('has-ai'), 'mobile mount draws no button or panel');
  mm.handle.open({ label: 'x', text: 'y' }); mm.handle.refresh(); mm.handle.stop();
  ok(mm.root.children.length === 0 && calls.request === 0, 'the inert handle does nothing');

  const dm = await mountOn(false);
  ok(dm.root.querySelector('vs-ai-fab') && dm.root.querySelector('vs-ai') && dm.root.classList.contains('has-ai'), 'desktop mount draws the button and panel');

  /* ---- 6. send(): even if a panel was mounted before the platform read mobile ---- */
  const input = dm.root.querySelector('vs-ai-input');
  const sendBtn = dm.root.querySelector('vs-ai-send');
  mobile(true);
  input.value = 'What is due?'; sendBtn.click(); await flush();
  ok(calls.request === 0, 'send() fires no provider call on mobile');
  ok(dm.plugin.aiChat.messages.length === 0, 'send() did not even start a chat on mobile');
  mobile(false);
  input.value = 'What is due?'; sendBtn.click(); await flush();
  ok(calls.request === 1, 'send() on desktop reaches the provider once');
  ok(dm.plugin.aiChat.messages.some(x => x.role === 'assistant' && x.content === 'Hello'), 'desktop chat gets the answer');

  /* ---- 7. the dashboard asks askAIOn(settings, Platform), never settings alone ---- */
  const SRC = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/dashboard.js'), 'utf8');
  ok(/askAIOn\(settings\(\), Platform\)/.test(SRC) && !/showAskAI !== false/.test(SRC), 'dashboard.js decides through askAIOn with Platform');
  ok(DEFAULT_SETTINGS.showAskAI === true, 'the default setting is unchanged on desktop');

  mobile(false);
  console.log(`ai mobile OK (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
