'use strict';
/* Guards the seams between src/dashboard.js and the modules whose APIs changed
   in the 2026-10-07 fix wave (async Rhythm, result objects from Tasks / Rhythm /
   Nudge, the per-device weather cache, the Budget instance sync). mountDashboard
   needs a DOM, so the DOM behaviour is proved in the browser harness; what can
   be decided without one is pinned here, plus source-shape guards that fail if
   a call site goes back to the old contract. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
require('./_stub.cjs');
const DB = require('../src/dashboard');
const SRC = fs.readFileSync(path.join(__dirname, '../src/dashboard.js'), 'utf8');

/* ---- showBudgetCard: the card follows the Budget PLUGIN, not only the folder ---- */
const mkApp = ({ plugins, manifests, files } = {}) => ({
  plugins: { plugins: plugins || {}, manifests: manifests || {} },
  vault: { getFileByPath: p => ((files || []).includes(p) ? { path: p } : null) },
});
const api = { apiVersion: 1, currentPeriod: async () => null, onChange: () => () => {} };
assert.strictEqual(DB.showBudgetCard(mkApp(), { showBudget: true, budgetFolder: '' }), false, 'nothing installed, no folder: no card');
assert.strictEqual(DB.showBudgetCard(mkApp({ files: ['Budget/Settings.md'] }), { budgetFolder: 'Budget' }), true, 'Vista\'s own reader with a real folder');
assert.strictEqual(DB.showBudgetCard(mkApp({ files: ['Budget/Settings.md'] }), { showBudget: false, budgetFolder: 'Budget' }), false, 'switched off wins');
assert.strictEqual(DB.showBudgetCard(mkApp({ plugins: { 'budget-app': { api } } }), { budgetFolder: '' }), true, 'budget-app ready, blank folder: card');
assert.strictEqual(DB.showBudgetCard(mkApp({ manifests: { 'budget-app': {} } }), { budgetFolder: '' }), true, 'budget-app installed but off: card (it says so)');
assert.strictEqual(DB.showBudgetCard(mkApp({ plugins: { 'budget-app': {} } }), { budgetFolder: '' }), true, 'budget-app running without an api: card (it says so)');

/* ---- budgetHeadline never turns an error value into a figure ---- */
assert.deepStrictEqual(DB.budgetHeadline({ error: 'x', source: 'budget-app', unavailable: 'failed' }), { state: 'error' });
assert.strictEqual(DB.budgetHeadline({ available: 5, spent: 1 }).state, 'figure', 'a normal value is untouched');

/* ---- the refusal notices ---- */
assert.match(DB.taskRefusedNotice({ ok: false, reason: 'line-changed', message: 'That task line has changed — open the note.' }), /that task line has changed/);
assert.strictEqual(DB.taskRefusedNotice({ ok: false, reason: 'recurring-needs-tasks', message: 'Needs the Tasks plugin.' }), 'Vista: Needs the Tasks plugin.');
assert.match(DB.taskRefusedNotice({ ok: false, reason: 'api-refused', message: 'Tasks could not tick that task.' }), /Tasks could not tick/);
assert.match(DB.taskRefusedNotice(undefined), /could not update/, 'no result at all still says something');
assert.match(DB.rhythmRefusedNotice({ ok: false, reason: 'unreadable', key: 'done' }), /the "done" line in today's Rhythm log.*left the note alone/);
assert.match(DB.rhythmRefusedNotice({ ok: false, reason: 'name' }), /could not write that tick/);

/* ---- pending Rhythm ticks: one per practice, two quick ticks both show ---- */
const focus = [{ name: 'Stretch', done: false }, { name: 'Walk', done: false }, { name: 'Read', done: true }];
const pending = new Map();
pending.set('Stretch', { on: true, settled: false });
pending.set('Walk', { on: true, settled: false });
let rows = DB.overlayPending(focus, pending);
assert.deepStrictEqual(rows.map(r => r.done), [true, true, true], 'both quick ticks show as ticked at once (a single slot lost the first)');
pending.set('Read', { on: false, settled: false });
assert.strictEqual(DB.overlayPending(focus, pending)[2].done, false, 'an untick overlays a done row');
assert.strictEqual(focus[0].done, false, 'the read-in rows are not mutated');
assert.deepStrictEqual(DB.overlayPending(null, pending), []);

/* only SETTLED entries are dropped by a refresh; an in-flight write keeps its row ticked */
const snap = DB.settledPending(pending);
assert.strictEqual(snap.length, 0, 'nothing has landed yet');
pending.get('Stretch').settled = true;
const snap2 = DB.settledPending(pending);
assert.deepStrictEqual(snap2.map(([n]) => n), ['Stretch']);
const replaced = { on: false, settled: false };
pending.set('Stretch', replaced);            // the user toggled it again while the refresh was reading
DB.dropSettled(pending, snap2);
assert.strictEqual(pending.get('Stretch'), replaced, 'a newer tick on the same practice survives the refresh');
pending.get('Stretch').settled = true;
DB.dropSettled(pending, DB.settledPending(pending));
assert.ok(!pending.has('Stretch') && pending.has('Walk') && pending.has('Read'), 'settled gone, in-flight kept');

/* ---- source-shape guards (each has a negative control below) ---- */
const body = (src, name) => {
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i >= 0, `${name} exists`);
  const open = src.indexOf('{', src.indexOf(')', i));
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error('unbalanced ' + name);
};
const violations = src => {
  const out = [];
  if (/weatherLast|weatherGeo/.test(src)) out.push('weather cache read/written through settings');
  if (/function loadWeather\(/.test(src) && /saveSettings/.test(body(src, 'loadWeather'))) out.push('loadWeather writes data.json');
  if (/const ok = await TK\.toggleTask|if \(!ok\)/.test(src)) out.push('TK.toggleTask treated as a boolean');
  if (/state\.rhythm = RH\.todayFromRhythm|\|\| rhythmToday\(\)|rhythmToday\(\)\.available/.test(src)) out.push('async todayFromRhythm used synchronously');
  if (/Nothing owed today|No practices yet\./.test(src)) out.push('Rhythm empty-state words hard-coded');
  if (/rhythmPending\s*=\s*(null|\{)/.test(src)) out.push('rhythmPending is a single slot again');
  if (/BG\.getBudgetApi/.test(src)) out.push('budget api subscribed once instead of via syncBudgetApi');
  if (/_budgetCache;\s*if \(!force && cached && Date\.now\(\) - cached\.at/.test(src)) out.push('budget cache tested by age alone');
  if (/W\.todayHiLo\(/.test(src)) out.push('header H/L not from forecastView');
  if (/could not find that reminder/.test(src)) out.push('snooze refusal hard-codes "could not find"');
  return out;
};
assert.deepStrictEqual(violations(SRC), [], 'dashboard.js honours the new module contracts');

/* negative controls: each old shape is caught */
const bad = {
  'weather cache read/written through settings': 'const w = state.weather || s.weatherLast;',
  'loadWeather writes data.json': 'async function loadWeather(force) { await plugin.saveSettings(); }',
  'TK.toggleTask treated as a boolean': 'const ok = await TK.toggleTask(app, item);',
  'async todayFromRhythm used synchronously': 'const t = state.rhythm || rhythmToday();',
  'Rhythm empty-state words hard-coded': "'Nothing owed today. Well done.'",
  'rhythmPending is a single slot again': 'state.rhythmPending = null;',
  'budget api subscribed once instead of via syncBudgetApi': 'const budgetApi = BG.getBudgetApi(app);',
  'budget cache tested by age alone': 'const cached = plugin._budgetCache;\n    if (!force && cached && Date.now() - cached.at < STATS_FRESH_MS)',
  'header H/L not from forecastView': 'const hl = W.todayHiLo(w, D.todayISO());',
  'snooze refusal hard-codes "could not find"': "new Notice('Vista: Nudge could not find that reminder')",
};
for (const [want, snippet] of Object.entries(bad)) assert.ok(violations(snippet).includes(want), `guard catches: ${want}`);

console.log('dashboard integration OK');
