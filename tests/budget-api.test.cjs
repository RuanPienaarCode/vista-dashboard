'use strict';
/* currentBudget() prefers the Budget plugin's own headless API
   (app.plugins.plugins['budget-app'].api, apiVersion 1) and uses this file's
   own vault reader only when the Budget plugin is not installed at all or its
   API resolves null (budget folder not set up). A reject, a disabled plugin
   or one without a usable API is a no-figures value (the reader cannot see
   the privacy lock; tests/budget-privacy.test.cjs). See src/budget.js's header for why: a 2026-09-27 audit found
   the fallback's own arithmetic drifting from the real app in thirteen ways.

     node tests/budget-api.test.cjs
*/
const assert = require('node:assert');
require('./_stub.cjs'); // src/budget requires 'obsidian' (normalizePath)
const B = require('../src/budget');
const { todayISO } = require('../src/dates');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* A fake vault built the same way tests/budget.test.cjs's loader case is:
   { 'path': 'text' } plus the three vault methods currentBudget's fallback
   path calls. Only reached when the API path does not answer. */
function fakeApp(files) {
  const list = Object.keys(files).map(p => ({ path: p, basename: p.slice(p.lastIndexOf('/') + 1, -3), extension: 'md' }));
  return {
    vault: {
      getFiles: () => list,
      getFileByPath: p => (files[p] !== undefined ? { path: p } : null),
      cachedRead: f => files[f.path] || '',
    },
  };
}

/* currentBudget()'s fallback path reads the real wall clock (todayISO(), no
   injection seam — same as before this change), so both fixtures below are
   built off it rather than a hardcoded date, or this suite goes stale the
   month after it is written. */
const REAL_TODAY = todayISO();

/* month_start_day: 1 keeps the fallback's period the plain calendar month
   real "today" falls in, so the fixture's transaction row (posted on the
   period's own first day) is always inside the window regardless of when
   this suite runs. */
const PKEY = B.periodFor(REAL_TODAY, 1).key;
const FILES = {
  'B/Settings.md': '---\nmonth_start_day: 1\ncurrency: "R"\n---\n',
  'B/Categories/Food.md': '---\ntype: food\n---\n',
  'B/Accounts/Transaction Account.md': '---\ntype: current\n---\n',
  [`B/Budgets/${PKEY}.md`]: '| Category | Type | Amount | Notes |\n|---|---|--:|---|\n| Food | food | 7000.00 |  |\n',
  [`B/Transactions/Transaction Account/${PKEY}.md`]:
    `---\naccount: "Transaction Account"\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|--:|---|---|\n| ${PKEY}-01 | Shop | Food | -100.00 |  |  |\n`,
};

/* daysLeft/finished are computed against the WALL CLOCK (todayISO(), same as
   the fallback's own `today`), not against the api's own `asOf` — so the
   period's `end` is pinned comfortably in the future rather than to a fixed
   date this test would go stale against. */
const FAR_END = todayISO(new Date(Date.now() + 17 * 86400000));
const EXPECT_DAYS_LEFT = Math.max(0, Math.round((new Date(FAR_END) - new Date(REAL_TODAY)) / 86400000));

const API_PERIOD = {
  start: '2026-09-01', end: FAR_END, asOf: '2026-09-13', label: '1 Sep – 30 Sep, 2026',
  budgeted: 10000, spent: 4200, left: 5800,
  over: [{ category: 'Coffee', budgeted: 400, spent: 1520 }, { category: 'Food', budgeted: 7000, spent: 7300 }],
  currency: { symbol: 'R' },
  notes: ['1 account in another currency (€) is not in these figures.'],
};

(async () => {
  /* ---- 1. api present, resolves → card figures equal the api's ---- */
  {
    let calledWith = null;
    const app = Object.assign(fakeApp(FILES), {
      plugins: { plugins: { 'budget-app': { api: { apiVersion: 1, currentPeriod: async () => { calledWith = true; return API_PERIOD; } } } } },
    });
    const b = await B.currentBudget(app, 'B');
    ok(calledWith, 'the api was actually asked');
    eq(b.source, 'budget-app', 'source names the api as the origin');
    eq(b.budgeted, API_PERIOD.budgeted, 'budgeted is the api\'s own, not re-derived');
    eq(b.spent, API_PERIOD.spent, 'spent is the api\'s own');
    eq(b.available, API_PERIOD.left, 'available is the api\'s own left, not budgeted-minus-spent computed twice');
    eq(b.currency, 'R', 'currency is unwrapped to the plain symbol the card\'s money() calls take');
    eq(b.periodLabel, API_PERIOD.label, 'periodLabel is the api\'s label');
    eq(b.asOfLabel, '13 Sep', 'asOfLabel is shortDate(api.asOf)');
    eq(b.finished, false, 'a period whose end is still ahead of today is not finished');
    eq(b.daysLeft, EXPECT_DAYS_LEFT, 'daysLeft counts from today (the wall clock) to the api\'s own end');
    eq(b.overCats, [
      { category: 'Coffee', budget: 400, actual: 1520, over: 1120 },
      { category: 'Food', budget: 7000, actual: 7300, over: 300 },
    ], 'over is mapped {category, budgeted, spent} -> {category, budget, actual, over}, order preserved');
    eq(b.notes, API_PERIOD.notes, 'notes pass through verbatim — the hero\'s own caveats, not a re-worded count');
    eq(b.uncategorised, 0, 'the fallback\'s own counts are silenced on the api path, not fabricated');
    eq(b.foreign, 0, 'ditto — the caveat already lives in notes');
  }

  /* ---- 2. api present, resolves null (Budget plugin not configured) → own count ---- */
  {
    const app = Object.assign(fakeApp(FILES), {
      plugins: { plugins: { 'budget-app': { api: { apiVersion: 1, currentPeriod: async () => null } } } },
    });
    const b = await B.currentBudget(app, 'B');
    eq(b.source, 'vista', 'null from the api falls all the way through to the own reader');
    eq(b.budgeted, 7000, 'own reader ran over the fake vault');
  }

  /* ---- 3. api present, rejects → an error value with no figures, and the rejection does not propagate ---- */
  {
    const app = Object.assign(fakeApp(FILES), {
      plugins: { plugins: { 'budget-app': { api: { apiVersion: 1, currentPeriod: async () => { throw new Error('boom'); } } } } },
    });
    const origError = console.error;
    console.error = () => {}; // the rejection is logged; keep the test's own output clean
    let b;
    try { b = await B.currentBudget(app, 'B'); } finally { console.error = origError; }
    eq(b.source, 'budget-app', 'a rejected api promise is NOT answered by the own reader (it cannot see the lock)');
    ok(typeof b.error === 'string' && b.budgeted === undefined && b.available === undefined, 'an error line and no figure');
  }

  /* ---- 4. no budget-app plugin at all → own count, same as always ---- */
  {
    const app = fakeApp(FILES);
    const b = await B.currentBudget(app, 'B');
    eq(b.source, 'vista', 'no plugins registry at all is "absent", not an error');
    eq(b.budgeted, 7000);
  }

  /* ---- 5. budget-app running but with no `api` (an older release) → no figures ---- */
  {
    const app = Object.assign(fakeApp(FILES), { plugins: { plugins: { 'budget-app': {} } } });
    eq(B.getBudgetApi(app), null, 'getBudgetApi is null when the plugin carries no api at all');
    const b = await B.currentBudget(app, 'B');
    eq(b.source, 'budget-app', 'installed, so the own reader (no lock knowledge) does not run');
    eq(b.unavailable, 'no-api');
    ok(b.budgeted === undefined && b.available === undefined);
  }

  /* ---- 6. an api of a future, incompatible shape is not adopted, and not guessed around ---- */
  {
    const app = Object.assign(fakeApp(FILES), {
      plugins: { plugins: { 'budget-app': { api: { apiVersion: 2, currentPeriod: async () => API_PERIOD } } } },
    });
    eq(B.getBudgetApi(app), null, 'apiVersion 2 is not apiVersion 1 — not adopted, not guessed at');
    const b = await B.currentBudget(app, 'B');
    eq(b.unavailable, 'no-api');
    ok(b.budgeted === undefined);
  }

  /* ---- 7. the two fallback fixes ---- */
  {
    // 7a. month_start_day default is 23, via parseInt, matching budget-vault's
    // load.js (`parseInt(fm.month_start_day, 10) || 23`) rather than the old
    // Number()-with-a-default-of-1.
    eq(B.periodFor('2026-09-13', undefined), { key: '2026-09', start: '2026-08-23', end: '2026-09-22' },
      'an absent month_start_day now defaults to 23, not 1');
    eq(B.periodFor('2026-09-13', ''), { key: '2026-09', start: '2026-08-23', end: '2026-09-22' },
      'a blank Settings.md cell parses the same way, through parseInt\'s fallback');
    eq(B.periodFor('2026-09-13', '22'), { key: '2026-09', start: '2026-08-22', end: '2026-09-21' },
      'a string cell (as read straight off frontmatter, unparsed) still works via parseInt');

    // 7b. assume-spent provision: a category whose budget is its own actual
    // spend counts as spent up to budget even with nothing posted yet, and
    // only the shortfall once something has.
    const base = {
      today: '2026-09-13',
      settings: { month_start_day: 1, currency: 'R' },
      categories: [{ name: 'Rent', type: 'housing' }, { name: 'Carry', type: 'housing', assumeSpent: true }],
      accounts: [],
      budgetRows: [{ category: 'Rent', type: 'housing', amount: 5000 }, { category: 'Carry', type: 'housing', amount: 1200 }],
      txFiles: [],
    };
    const noSpend = B.computeBudget(base);
    eq(noSpend.spent, 1200, 'Carry (assume-spent, R1200 budgeted) counts as fully spent with no transaction behind it');
    eq(noSpend.budgeted, 6200, 'budgeted is unaffected — it already summed every spend-type row');
    eq(noSpend.available, 6200 - 1200, 'available reflects the provision');

    const partSpend = Object.assign({}, base, {
      txFiles: [{ label: 'Cheque', month: '2026-09', rows: [{ date: '2026-09-05', cat: 'Carry', amount: -300, excluded: false, split: '' }] }],
    });
    const part = B.computeBudget(partSpend);
    eq(part.spent, 1200, 'R300 real plus a R900 provision still totals the R1200 budget — never double-counted');

    const overSpend = Object.assign({}, base, {
      txFiles: [{ label: 'Cheque', month: '2026-09', rows: [{ date: '2026-09-05', cat: 'Carry', amount: -1800, excluded: false, split: '' }] }],
    });
    const over = B.computeBudget(overSpend);
    eq(over.spent, 1800, 'once real spend passes the budget, the provision adds nothing further');
    eq(over.overCats, [{ category: 'Carry', budget: 1200, actual: 1800, over: 600 }],
      'the over-budget row reads the same provisioned actual, not the raw real spend');
  }

  /* ---- 8. api says { locked: true } → a locked value, and NO fallback ----
     The Budget plugin's privacy splash is up and has not been opened this
     session. Falling back to this file's own reader here would put on the
     card exactly the figure the splash is hiding — the lock would hide
     nothing — so the reader must not even be reached. */
  {
    const touched = { getFiles: 0, getFileByPath: 0, cachedRead: 0 };
    const base = fakeApp(FILES);
    const vault = {
      getFiles: () => { touched.getFiles++; return base.vault.getFiles(); },
      getFileByPath: p => { touched.getFileByPath++; return base.vault.getFileByPath(p); },
      cachedRead: f => { touched.cachedRead++; return base.vault.cachedRead(f); },
    };
    const app = { vault, plugins: { plugins: { 'budget-app': { api: { apiVersion: 1, currentPeriod: async () => ({ locked: true }) } } } } };
    const b = await B.currentBudget(app, 'B');
    eq(b, { source: 'budget-app', locked: true }, 'a locked api answer maps to the locked value — no figure field at all');
    eq(touched, { getFiles: 0, getFileByPath: 0, cachedRead: 0 }, 'and the fallback reader never touched the vault');
    eq(B.mapApiPeriod({ locked: true }, REAL_TODAY), { source: 'budget-app', locked: true },
      'mapApiPeriod itself owns the rule, so no other caller can map a lock into a figure');
  }

  /* ---- 9. api says noBudget → the flag rides along, available is null ---- */
  {
    const NO_BUDGET = Object.assign({}, API_PERIOD, { budgeted: 0, spent: 4200, left: null, noBudget: true, over: [] });
    const app = Object.assign(fakeApp(FILES), {
      plugins: { plugins: { 'budget-app': { api: { apiVersion: 1, currentPeriod: async () => NO_BUDGET } } } },
    });
    const b = await B.currentBudget(app, 'B');
    eq(b.source, 'budget-app', 'still the api\'s own answer, not the fallback');
    eq(b.noBudget, true, 'noBudget is carried onto the card value');
    eq(b.available, null, 'available is null: there is no budget for anything to be left of');
    eq(b.spent, 4200, 'spent is still the api\'s own — the number the card shows in this state');
    eq(b.budgeted, 0, 'budgeted is still stated');
    eq(b.overCats, [], 'nothing is "over" a budget of nothing');
  }

  /* ---- 10. an older Budget plugin: no noBudget, no locked → exactly as before ---- */
  {
    const OLD_OVER = Object.assign({}, API_PERIOD, { budgeted: 0, spent: 4200, left: -4200, over: [] });
    const mapped = B.mapApiPeriod(OLD_OVER, REAL_TODAY);
    eq(mapped.available, -4200, 'an older payload with no noBudget keeps available = left, negative and all');
    eq(mapped.noBudget, false, 'and reads as a period with a budget, which is what that plugin claimed');
    eq(mapped.locked, undefined, 'no lock is invented for a plugin that has none');
    const current = B.mapApiPeriod(API_PERIOD, REAL_TODAY);
    eq(current.available, API_PERIOD.left, 'the ordinary payload maps exactly as in case 1');
  }

  console.log(`budget-api: ${checks} checks passed.`);
})().catch(e => { console.error(e); process.exit(1); });
