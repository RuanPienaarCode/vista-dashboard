'use strict';
/* Vista's OWN budget reader, for a period with no budget yet.

   When the Budget plugin is not installed (or not enabled), currentBudget()
   reads the Budget files itself (src/budget.js's computeBudget/loadBudget).
   For a period with no budget file it computed budgeted 0 and
   available = 0 − spent, and the card printed "Over budget R X" — and listed
   every category with any spending as "R X over". The Budget plugin's own
   hero reads "New period — nothing budgeted yet" over what was spent for the
   same state, and its API says noBudget (left null, nothing over); the card
   already prints the hero's words for THAT answer. Its fallback now says the
   same thing the same way:
     noBudget  true when the period's budget table has no rows — the Budget
               plugin's own test (`!(S.budgets[period] || []).length`, which
               counts every table row, readable or not);
     available null — there is no budget for anything to be left of;
     overCats  [] — nothing is over a budget of nothing;
   and a period WITH a budget reads exactly as before.

   Synthetic data. The vault-reader case reads the real wall clock, as
   currentBudget() does (no injection seam), so its fixture is built off it.

     node tests/budget-fallback-no-budget.test.cjs */
const assert = require('node:assert');
require('./_stub.cjs');
const B = require('../src/budget');
const { budgetHeadline } = require('../src/dashboard');
const { todayISO } = require('../src/dates');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SPENDING = [{ label: 'Cheque', month: '2026-09', rows: [
  { date: '2026-09-03', cat: 'Food', amount: -2400, excluded: false, split: '' },
  { date: '2026-09-05', cat: 'Fuel', amount: -900, excluded: false, split: '' },
] }];
const input = budgetRows => ({
  today: '2026-09-13', settings: { month_start_day: 1, currency: 'R' },
  categories: [{ name: 'Food', type: 'food' }, { name: 'Fuel', type: 'transport' }, { name: 'Pay', type: 'income' }],
  accounts: [], budgetRows, txFiles: SPENDING,
});

/* ---- 1. computeBudget: no budget rows ---- */
{
  const r = B.computeBudget(input([]));
  eq(r.noBudget, true, 'no budget rows for the period: noBudget');
  eq(r.available, null, 'available is null — not 0 − spent');
  eq(r.spent, 3300, 'what was spent is still counted');
  eq(r.budgeted, 0, 'and budgeted is still stated, as 0');
  eq(r.overCats, [], 'nothing is "over" a budget of nothing');
  eq(budgetHeadline(r), { state: 'noBudget', amount: 3300, label: 'Nothing budgeted yet', over: false, meter: false },
    'the card reads "Nothing budgeted yet" over the spend, with no meter — not "Over budget R 3 300"');
}

/* ---- 2. a period WITH a budget reads exactly as before ---- */
{
  const r = B.computeBudget(input([{ category: 'Food', type: 'food', amount: 2000 }]));
  eq(r.noBudget, false, 'a budget row: not noBudget');
  eq(r.available, 2000 - 3300, 'available is budgeted − spent, negative and all');
  eq(r.overCats.map(c => [c.category, c.over, !!c.unbudgeted]), [['Fuel', 900, true], ['Food', 400, false]],
    'and the over list is what it always was');
  eq(budgetHeadline(r).label, 'Over budget', 'over a REAL budget it still says so');

  const incomeOnly = B.computeBudget(input([{ category: 'Pay', type: 'income', amount: 30000 }]));
  eq(incomeOnly.noBudget, false,
    'a budget file with only an income row IS a budget — the Budget plugin counts its rows, whatever their type');
}

/* ---- 3. through the vault reader ---- */
(async () => {
  const today = todayISO();
  const key = B.periodFor(today, 1).key;
  const files = {
    'B/Settings.md': '---\nmonth_start_day: 1\ncurrency: "R"\n---\n',
    'B/Categories/Food.md': '---\ntype: food\n---\n',
    'B/Accounts/Cheque.md': '---\ntype: current\n---\n',
    [`B/Transactions/Cheque/${key}.md`]: '| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|--:|---|---|\n'
      + `| ${key}-01 | Shop | Food | -250.00 |  |  |\n`,
  };
  const app = f => {
    const list = Object.keys(f).map(p => ({ path: p, basename: p.slice(p.lastIndexOf('/') + 1, -3), extension: 'md' }));
    return { vault: { getFiles: () => list, getFileByPath: p => (f[p] !== undefined ? { path: p } : null), cachedRead: x => f[x.path] || '' } };
  };

  const none = await B.currentBudget(app(files), 'B');
  eq(none.source, 'vista', 'no Budget plugin: Vista\'s own reader answered');
  eq([none.noBudget, none.available, none.spent, none.overCats], [true, null, 250, []],
    'no budget file for the period: noBudget, nothing left of, the spend, nothing over');
  eq(budgetHeadline(none).label, 'Nothing budgeted yet', 'and the card says so');

  const headerOnly = await B.currentBudget(app({ ...files,
    [`B/Budgets/${key}.md`]: '| Category | Type | Amount | Notes |\n|---|---|--:|---|\n' }), 'B');
  eq(headerOnly.noBudget, true, 'a budget file whose table is empty is no budget either (the Budget page\'s own test)');

  const unreadable = await B.currentBudget(app({ ...files,
    [`B/Budgets/${key}.md`]: '| Category | Type | Amount | Notes |\n|---|---|--:|---|\n| Food | food | lots |  |\n' }), 'B');
  eq(unreadable.noBudget, false,
    'a row Vista cannot read the amount of is still a budget row — the Budget plugin counts it, so the two do not disagree on which periods are empty');

  const budgeted = await B.currentBudget(app({ ...files,
    [`B/Budgets/${key}.md`]: '| Category | Type | Amount | Notes |\n|---|---|--:|---|\n| Food | food | 1000.00 |  |\n' }), 'B');
  eq([budgeted.noBudget, budgeted.available], [false, 750], 'with a budget: a figure, as before');

  console.log(`budget-fallback-no-budget OK (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
