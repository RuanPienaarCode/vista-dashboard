'use strict';
/* Ask AI's per-device choices: the AI, its keys and app paths live in this
   device's storage, never in data.json (which syncs, and is backed up). */
const assert = require('node:assert');
const stub = require('./_stub.cjs');
const Module = require('node:module');
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === './view' || request === './settings-tab') return {};
  return origLoad.call(this, request, ...rest);
};
const disk = { data: null };
stub.Plugin = class { async loadData() { return disk.data && JSON.parse(JSON.stringify(disk.data)); } async saveData(d) { disk.data = JSON.parse(JSON.stringify(d)); } };
const VistaPlugin = require('../src/main');
const { insertCapture } = require('../src/actions');
const C = require('../src/ai-context');
Module._load = origLoad;

const mkStorage = () => { const m = new Map(); return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } }; };
const storage = mkStorage();
global.window = { localStorage: storage };

(async () => {
  const p = new VistaPlugin();
  p.manifest = { id: 'vista' };
  p.app = { vault: { getName: () => 'Home' }, workspace: { getLeavesOfType: () => [] } };
  await p.loadSettings();
  assert.strictEqual(p.settings.showAskAI, true);
  assert.deepStrictEqual(p.settings.aiModels, {});
  assert.strictEqual(p.settings.aiChatFolder, 'AI Chats');

  /* no runner here: the fallback is Claude over the API (on a phone or tablet Ask AI is off altogether, tests/ai-mobile.test.cjs) */
  assert.strictEqual(p.aiRunner(), null);
  assert.deepStrictEqual(p.aiDevice(), { provider: 'claude', keys: {}, paths: {} });

  assert.strictEqual(p.saveAiDevice({ provider: 'grok', keys: { grok: 'xai-SECRET' } }), true);
  assert.strictEqual(p.saveAiDevice({ keys: { claude: 'sk-ant-SECRET' } }), true);
  assert.deepStrictEqual(p.aiDevice(), { provider: 'grok', keys: { grok: 'xai-SECRET', claude: 'sk-ant-SECRET' }, paths: {} });
  assert.ok(storage.m.has('vista:ai:Home'), 'keyed by plugin id and vault');

  /* a settings save never carries a key */
  p.settings.aiModels = { grok: 'grok-4.6' };
  await p.saveSettings();
  assert.ok(!JSON.stringify(disk.data).includes('SECRET'));
  assert.deepStrictEqual(disk.data.aiModels, { grok: 'grok-4.6' });

  /* junk on disk or in storage falls back safely */
  storage.setItem('vista:ai:Home', '{"provider":"made-up","keys":[1]}');
  assert.deepStrictEqual(p.aiDevice(), { provider: 'claude', keys: {}, paths: {} });
  storage.setItem('vista:ai:Home', 'not json');
  assert.strictEqual(p.aiDevice().provider, 'claude');
  disk.data = { aiModels: ['x'] };
  await p.loadSettings();
  assert.deepStrictEqual(p.settings.aiModels, {});

  /* an answer added to the journal stays one list item, and the next capture
     lands after it, not inside it */
  const note = '# 2026-11-03\n\n## Notes\n\n- earlier\n';
  const one = insertCapture(note, 'Notes', '- ' + C.journalEntry('What first?', 'Pay rent.\n\n- then gym'));
  const two = insertCapture(one, 'Notes', '- later');
  assert.strictEqual(two, '# 2026-11-03\n\n## Notes\n\n- earlier\n- Ask AI: What first?\n  Pay rent.\n  - then gym\n- later\n');

  console.log('ai device OK');
})().catch(e => { console.error(e); process.exit(1); });
