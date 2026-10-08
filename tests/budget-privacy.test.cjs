'use strict';
/* The Budget card must show NO figure that the Budget plugin's privacy lock
   is hiding, and must agree with the Budget plugin about which periods have a
   budget. 2026-10-07 audit, Vista budget lane. Synthetic data only.

   1. A rejected api.currentPeriod() is an error value with no figures — never
      the fallback reader, which has no idea the lock is on.
   2. Vista's own reader runs ONLY when the Budget plugin is not installed at
      all. Installed-but-disabled, or enabled with no usable api, is a
      no-figures state.
   3. The dashboard can tell the api instance changed (budget-app reloads, so
      the lock it holds is a different object) and can tell whether a cached
      figure may still be shown.
   4. budgetRowCount counts only rows with a category — the Budget plugin
      keeps nameless rows out of its budget, so a table of them is "no budget".
   5. The budget folder path goes through obsidian's normalizePath.

     node tests/budget-privacy.test.cjs */
const assert = require('node:assert');
const obsidian = require('./_stub.cjs');
/* _stub.cjs's normalizePath is the identity; the real one collapses repeated
   slashes and strips leading/trailing ones, and returns '/' for an empty path.
   Installed before src/budget is required, which binds it at load. */
obsidian.normalizePath = p => { const s = String(p).replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, ''); return s || '/'; };
const B = require('../src/budget');
const { todayISO } = require('../src/dates');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const TODAY = todayISO();
const PKEY = B.periodFor(TODAY, 1).key;
const FIGURE_FIELDS = ['budgeted', 'spent', 'available', 'left', 'overCats', 'periodLabel', 'asOfLabel', 'currency', 'daysLeft'];
const noFigures = (v, m) => { for (const k of FIGURE_FIELDS) ok(!(k in v), `${m}: no "${k}" field`); };

const FILES = {
  'B/Settings.md': '---\nmonth_start_day: 1\ncurrency: "R"\n---\n',
  'B/Categories/Food.md': '---\ntype: food\n---\n',
  'B/Accounts/Cheque.md': '---\ntype: current\n---\n',
  [`B/Budgets/${PKEY}.md`]: '| Category | Type | Amount | Notes |\n|---|---|--:|---|\n| Food | food | 7000.00 |  |\n',
  [`B/Transactions/Cheque/${PKEY}.md`]: `| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|--:|---|---|\n| ${PKEY}-01 | Shop | Food | -100.00 |  |  |\n`,
};
/* A vault that counts every touch, so "never reached the fallback" is checked
   against the vault itself and not only against the value returned. */
function appWith(files, plugins, manifests) {
  const list = Object.keys(files).map(p => ({ path: p, basename: p.slice(p.lastIndexOf('/') + 1, -3), extension: 'md' }));
  const touched = { n: 0 };
  const app = {
    vault: {
      getFiles: () => { touched.n++; return list; },
      getFileByPath: p => { touched.n++; return files[p] !== undefined ? { path: p } : null; },
      cachedRead: f => { touched.n++; return files[f.path] || ''; },
    },
  };
  if (plugins || manifests) app.plugins = { plugins: plugins || {}, manifests: manifests || {} };
  app.touched = touched;
  return app;
}
const quiet = async fn => { const o = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = o; } };
const API = { apiVersion: 1, currentPeriod: async () => ({ start: '2026-09-01', end: '2999-01-01', asOf: '2026-09-13', label: 'x', budgeted: 1, spent: 1, left: 0, currency: { symbol: 'R' } }), onChange: () => () => {} };

(async () => {
  /* ---- 1. a reject is an error value, not the fallback ---- */
  {
    const rejecting = { apiVersion: 1, currentPeriod: async () => { throw new Error('read failed mid-load'); } };
    const app = appWith(FILES, { 'budget-app': { api: rejecting } }, { 'budget-app': {} });
    const v = await quiet(() => B.currentBudget(app, 'B'));
    eq(v.source, 'budget-app', 'a reject keeps the Budget plugin as the source');
    ok(typeof v.error === 'string' && v.error.length > 0, 'and carries the card\'s error line');
    eq(v.unavailable, 'failed');
    noFigures(v, 'reject');
    eq(app.touched.n, 0, 'the vault was not touched — the fallback reader never ran');

    // a payload that throws inside mapApiPeriod is a reject for this purpose too
    const malformed = { apiVersion: 1, currentPeriod: async () => ({ start: '2026-09-01' }) };
    const app2 = appWith(FILES, { 'budget-app': { api: malformed } }, { 'budget-app': {} });
    const v2 = await quiet(() => B.currentBudget(app2, 'B'));
    ok(typeof v2.error === 'string' && v2.source === 'budget-app', 'a malformed payload is an error value');
    eq(app2.touched.n, 0, 'and no fallback either');
  }

  /* ---- 2. only "not installed at all" may use Vista's own reader ---- */
  {
    const disabled = appWith(FILES, {}, { 'budget-app': { id: 'budget-app' } });
    eq(B.budgetAppStatus(disabled).kind, 'disabled');
    const d = await B.currentBudget(disabled, 'B');
    eq(d.source, 'budget-app'); eq(d.unavailable, 'disabled'); ok(typeof d.error === 'string');
    noFigures(d, 'disabled'); eq(disabled.touched.n, 0, 'disabled: vault untouched');

    const noApi = appWith(FILES, { 'budget-app': {} }, { 'budget-app': {} });
    eq(B.budgetAppStatus(noApi).kind, 'no-api');
    const n = await B.currentBudget(noApi, 'B');
    eq(n.unavailable, 'no-api'); noFigures(n, 'no api'); eq(noApi.touched.n, 0, 'no api: vault untouched');

    const v2api = appWith(FILES, { 'budget-app': { api: { apiVersion: 2, currentPeriod: async () => ({}) } } }, { 'budget-app': {} });
    eq(B.budgetAppStatus(v2api).kind, 'no-api', 'an api of another version is not usable');
    noFigures(await B.currentBudget(v2api, 'B'), 'api v2'); eq(v2api.touched.n, 0);

    // plugin loaded but the manifest map is missing: it is installed, plainly
    const noManifest = appWith(FILES, { 'budget-app': {} });
    eq(B.budgetAppStatus(noManifest).kind, 'no-api');

    for (const [label, app] of [
      ['no plugins registry at all', appWith(FILES)],
      ['a registry with other plugins only', appWith(FILES, { other: {} }, { other: {} })],
    ]) {
      eq(B.budgetAppStatus(app).kind, 'absent', label);
      const v = await B.currentBudget(app, 'B');
      eq(v.source, 'vista', label + ': not installed, so Vista\'s own reader answers');
      eq(v.budgeted, 7000);
    }

    // a ready api that answers null (budget folder not set up) is unchanged: own reader
    const nullApi = appWith(FILES, { 'budget-app': { api: { apiVersion: 1, currentPeriod: async () => null } } }, { 'budget-app': {} });
    eq((await B.currentBudget(nullApi, 'B')).source, 'vista', 'api null still falls through (unchanged)');
  }

  /* ---- 3. api identity and cache ---- */
  {
    const a1 = Object.assign({}, API), a2 = Object.assign({}, API);
    const app = appWith(FILES, { 'budget-app': { api: a1 } }, { 'budget-app': {} });
    eq(B.budgetApiChanged(app, a1), { changed: false, api: a1 }, 'same instance: unchanged');
    app.plugins.plugins['budget-app'] = { api: a2 };
    eq(B.budgetApiChanged(app, a1), { changed: true, api: a2 }, 'a reloaded plugin is a different instance');
    delete app.plugins.plugins['budget-app'];
    eq(B.budgetApiChanged(app, a2), { changed: true, api: null }, 'the instance disappearing is a change, to null');
    eq(B.budgetApiChanged(app, null), { changed: false, api: null }, 'nothing before, nothing now');
    eq(B.budgetApiChanged(appWith(FILES), null), { changed: false, api: null }, 'no registry at all');
    eq(B.budgetApiChanged(app, undefined), { changed: false, api: null }, 'undefined counts as no instance');

    const MAX = 60000, now = 1000000;
    const fig = { source: 'budget-app', budgeted: 1, spent: 1, available: 0 };
    const live = appWith(FILES, { 'budget-app': { api: a1 } }, { 'budget-app': {} });
    ok(B.budgetCacheUsable({ value: fig, at: now - 1000, api: a1 }, live, now, MAX), 'fresh figure from the same instance is usable');
    ok(!B.budgetCacheUsable({ value: fig, at: now - MAX, api: a1 }, live, now, MAX), 'stale is not');
    ok(!B.budgetCacheUsable({ value: fig, at: now - 1000, api: a2 }, live, now, MAX), 'a figure read from another instance is not');
    ok(!B.budgetCacheUsable({ value: fig, at: now - 1000 }, live, now, MAX), 'an untagged entry is not');
    ok(!B.budgetCacheUsable({ value: { source: 'budget-app', locked: true }, at: now, api: a1 }, live, now, MAX), 'a cached lock is never served');
    ok(!B.budgetCacheUsable({ value: { source: 'budget-app', error: 'x', unavailable: 'failed' }, at: now, api: a1 }, live, now, MAX), 'a cached error is never served');
    ok(!B.budgetCacheUsable(null, live, now, MAX));
    const gone = appWith(FILES, {}, { 'budget-app': {} });
    ok(!B.budgetCacheUsable({ value: fig, at: now, api: a1 }, gone, now, MAX), 'budget-app now disabled: its cached figure is not served');
    const absent = appWith(FILES);
    const own = { source: 'vista', budgeted: 1, spent: 1, available: 0 };
    ok(B.budgetCacheUsable({ value: own, at: now, api: null }, absent, now, MAX), 'Vista\'s own figure is usable while the plugin is not installed');
    ok(!B.budgetCacheUsable({ value: own, at: now, api: null }, gone, now, MAX), 'but not once the plugin is installed (its lock may be on)');
    ok(!B.budgetCacheUsable({ value: own, at: now, api: null }, live, now, MAX), 'nor when an api now exists');
  }

  /* ---- 4. rows counted the way the Budget plugin keeps them ---- */
  {
    const mk = table => appWith({ ...FILES, [`B/Budgets/${PKEY}.md`]: `| Category | Type | Amount | Notes |\n|---|---|--:|---|\n${table}` });
    const files = app => app.vault.getFiles();
    const load = async app => B.loadBudget(files(app), async p => { const f = app.vault.getFileByPath(p); return f ? app.vault.cachedRead(f) : ''; }, 'B', TODAY);
    eq((await load(mk('|  | food | 500.00 | a row with no category yet |\n'))).budgetRowCount, 0, 'a nameless row is not a budget row');
    eq((await load(mk('|  |  |  |  |\n|  | food | 11600.00 |  |\n'))).budgetRowCount, 0, 'blank rows are not either');
    eq((await load(mk('| Food | food | lots |  |\n'))).budgetRowCount, 1, 'an unreadable AMOUNT still counts (the plugin keeps the row)');
    eq((await load(mk('| Food | food | 10 |  |\n|  | food | 500 |  |\n| Fuel | transport | 20 |  |\n'))).budgetRowCount, 2, 'only the named rows');

    const v = await B.currentBudget(mk('|  | food | 11600.00 |  |\n'), 'B');
    eq([v.noBudget, v.available, v.overCats], [true, null, []], 'a table of nameless rows reads "Nothing budgeted yet", not "Over budget"');
    const v2 = await B.currentBudget(mk('| Food | food | lots |  |\n'), 'B');
    eq(v2.noBudget, false, 'a named row with an unreadable amount is still a budget');
  }

  /* ---- 5. the folder path goes through normalizePath ---- */
  {
    const app = appWith(FILES);
    ok(B.budgetAvailable(app, 'B'));
    ok(B.budgetAvailable(app, '/B/'), 'leading and trailing slashes');
    ok(B.budgetAvailable(app, '//B//'), 'repeated slashes');
    ok(B.budgetAvailable(app, '\\B\\'), 'backslashes, which normalizePath folds to slashes');
    ok(!B.budgetAvailable(app, ''), 'empty is not a folder');
    ok(!B.budgetAvailable(app, '/'), 'the root is not a budget folder');
    ok(!B.budgetAvailable(app, '   '), 'nor is whitespace');
    const read = async p => { const f = app.vault.getFileByPath(p); return f ? app.vault.cachedRead(f) : ''; };
    const l = await B.loadBudget(app.vault.getFiles(), read, '/B/', TODAY);
    eq(l.budgetRows.length, 1, 'loadBudget over "/B/" finds the same budget rows');
    eq(l.categories.length, 1);
  }

  console.log(`budget-privacy OK (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
