'use strict';
const assert = require('node:assert');
require('./_stub.cjs'); // src/budget requires 'obsidian' (normalizePath)
const B = require('../src/budget');

/* amounts in every shape the Budget files hold */
assert.strictEqual(B.parseAmount('-674.00'), -674);
assert.strictEqual(B.parseAmount('1.19'), 1.19);
assert.strictEqual(B.parseAmount('R 1 234,56'), 1234.56);
assert.strictEqual(B.parseAmount('1,234.56'), 1234.56);
assert.strictEqual(B.parseAmount('1,234'), 1234, 'a lone comma with three digits after it is a thousands separator');
assert.strictEqual(B.parseAmount('12,50'), 12.5);
assert.strictEqual(B.parseAmount('(300)'), -300);
assert.strictEqual(B.parseAmount('−45'), -45);
assert.strictEqual(B.parseAmount('40240.20'), 40240.2);
assert.strictEqual(B.parseAmount(''), null);
assert.strictEqual(B.parseAmount('abc'), null);

/* payday months: 22nd start, named for the month they end in */
assert.deepStrictEqual(B.periodFor('2026-09-13', 22), { key: '2026-09', start: '2026-08-22', end: '2026-09-21' });
assert.deepStrictEqual(B.periodFor('2026-09-22', 22), { key: '2026-10', start: '2026-09-22', end: '2026-10-21' });
assert.deepStrictEqual(B.periodFor('2026-01-05', 22), { key: '2026-01', start: '2025-12-22', end: '2026-01-21' });
assert.deepStrictEqual(B.periodFor('2026-02-10', 1), { key: '2026-02', start: '2026-02-01', end: '2026-02-28' });

/* tables */
const t = B.parseTable('# x\n\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|--:|---|---|\n| 2026-09-01 | A \\| B | Food | -10.00 |  |  |\n| 2026-09-02 | C | Wifi | -5 | yes | n |\n\ntext\n| Other | table |\n|--|--|\n| 1 | 2 |');
assert.deepStrictEqual(t.headers, ['date', 'description', 'category', 'amount', 'excluded', 'note']);
assert.strictEqual(t.rows.length, 2);
assert.strictEqual(t.rows[0][1], 'A | B');
assert.strictEqual(t.rows[1][4], 'yes');

const fm = B.parseFrontmatter('---\nmonth_start_day: 22\ncurrency: "R"\nbudget: false\ntags: [a, b]\n---\nbody');
assert.deepStrictEqual(fm, { month_start_day: 22, currency: 'R', budget: false, tags: ['a', 'b'] });

/* the hero rule */
const input = {
  today: '2026-09-13',
  settings: { month_start_day: 22, currency: 'R' },
  categories: [
    { name: 'Food', type: 'food' }, { name: 'Rent', type: 'housing' }, { name: 'Salary', type: 'income' },
    { name: 'TFS Ninety One (R)', type: 'investment' }, { name: 'Settle Credit Card', type: 'transfer' }, { name: 'Coffee budget', type: 'treats' },
  ],
  accounts: [
    { name: 'Transaction Account', type: 'current', currency: '', in_budget: true, in_budget_stated: false },
    { name: 'Baby Fund', type: 'savings', currency: '', in_budget: true, in_budget_stated: false, goal_amount: 50000 },
    { name: 'Euro Account', type: 'current', currency: '€', in_budget: true, in_budget_stated: false },
    { name: 'Loan', type: 'loan', currency: '', in_budget: false, in_budget_stated: true },
  ],
  budgetRows: [
    { category: 'Salary', type: 'income', amount: 40000 },
    { category: 'Rent', type: 'housing', amount: 13000 },
    { category: 'Food', type: 'food', amount: 7000 },
    { category: 'Coffee budget', type: 'treats', amount: 400 },
    { category: 'TFS Ninety One (R)', type: 'investment', amount: 2000 },
    { category: 'Settle Credit Card', type: 'transfer', amount: 1000 },
  ],
  txFiles: [
    { label: 'Transaction Account', month: '2026-08', rows: [
      { date: '2026-08-21', cat: 'Food', amount: -999, excluded: false, split: '' },      /* previous period */
      { date: '2026-08-25', cat: 'Food', amount: -1500, excluded: false, split: '' },
      { date: '2026-08-25', cat: 'Salary', amount: 40000, excluded: false, split: '' },
    ] },
    { label: 'Transaction Account', month: '2026-09', rows: [
      { date: '2026-09-01', cat: 'Rent', amount: -13000, excluded: false, split: '' },
      { date: '2026-09-01', cat: 'TFS Ninety One (R)', amount: -2000, excluded: false, split: '' },   /* set aside: not "spent" */
      { date: '2026-09-03', cat: 'Settle Credit Card', amount: -2882, excluded: false, split: '' },   /* transfer: out */
      { date: '2026-09-05', cat: 'Coffee budget', amount: -520, excluded: false, split: '' },        /* over its 400 */
      { date: '2026-09-06', cat: 'Food', amount: -1000, excluded: true, split: '' },                 /* vetoed */
      { date: '2026-09-07', cat: 'Food', amount: -3000, excluded: true, split: 'parent' },
      { date: '2026-09-07', cat: 'Food', amount: -2000, excluded: false, split: 'part' },
      { date: '2026-09-07', cat: 'Coffee budget', amount: -1000, excluded: false, split: 'part' },
      { date: '2026-09-08', cat: 'Food', amount: 200, excluded: false, split: '' },                  /* refund: reduces the category, not "spend" */
      { date: '2026-09-09', cat: '', amount: -50, excluded: false, split: '' },                      /* uncategorised */
      { date: '2026-09-20', cat: 'Food', amount: -700, excluded: false, split: '' },                 /* scheduled ahead: after today */
    ] },
    { label: 'Baby Fund', month: '2026-09', rows: [{ date: '2026-09-02', cat: 'Food', amount: -5000, excluded: false, split: '' }] }, /* paid from an earmarked fund */
    { label: 'Euro Account', month: '2026-09', rows: [{ date: '2026-09-02', cat: 'Food', amount: -300, excluded: false, split: '' }] },
    { label: 'Loan', month: '2026-09', rows: [{ date: '2026-09-02', cat: 'Food', amount: -400, excluded: false, split: '' }] },
  ],
};
const r = B.computeBudget(input);
assert.strictEqual(r.period, '2026-09');
assert.strictEqual(r.budgeted, 13000 + 7000 + 400, 'income, transfer and investment envelopes are not spending');
/* spend: Food 1500 + Rent 13000 + TFS 2000 + Coffee 520 + Food part 2000 + Coffee part 1000 + uncat 50 = 20070; set aside 2000 → spent 18070 */
assert.strictEqual(r.spend, 20070);
assert.strictEqual(r.setAside, 2000);
assert.strictEqual(r.spent, 18070);
assert.strictEqual(r.available, 20400 - 18070);
assert.strictEqual(r.uncategorised, 1);
assert.strictEqual(r.foreign, 1);
assert.strictEqual(r.daysLeft, 8);
assert.strictEqual(r.asOfLabel, '13 Sep');
assert.strictEqual(r.periodLabel, 'September · 22 Aug – 21 Sep');
assert.deepStrictEqual(r.overCats.map(c => [c.category, c.over]), [['Coffee budget', 1120]], 'Food is 3300 net of the refund against 7000, so only coffee is over');

/* a finished period stops at its end; interval periods are declined */
const fin = B.computeBudget(Object.assign({}, input, { today: '2026-10-05' }));
assert.strictEqual(fin.period, '2026-10');
assert.ok(B.computeBudget({ settings: { period_days: 14 } }).error);

/* loader: reads the same shapes from files */
(async () => {
  const files = {
    'B/Settings.md': '---\nmonth_start_day: 22\ncurrency: "R"\n---\n',
    'B/Categories/Food.md': '---\ntype: food\n---\n',
    'B/Accounts/Transaction Account.md': '---\ntype: current\n---\n',
    'B/Budgets/2026-09.md': '| Category | Type | Amount | Notes |\n|---|---|--:|---|\n| Food | food | 7000.00 |  |\n| Salary | income | 40240.20 |  |\n',
    'B/Transactions/Transaction Account/2026-09.md': '---\naccount: "Transaction Account"\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|--:|---|---|\n| 2026-09-01 | Shop | Food | -100.00 |  |  |\n| 2026-09-02 | Shop | Food | -50.00 | x |  |\n',
    'B/Transactions/Transaction Account/2026-05.md': '| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|--:|---|---|\n| 2026-05-01 | Old | Food | -9999 |  |  |\n',
  };
  const list = Object.keys(files).map(p => ({ path: p, basename: p.slice(p.lastIndexOf('/') + 1, -3), extension: 'md' }));
  const input2 = await B.loadBudget(list, async p => files[p] || '', 'B/', '2026-09-13');
  assert.strictEqual(input2.txFiles.length, 1, 'only files inside the period window are read');
  const r2 = B.computeBudget(input2);
  assert.strictEqual(r2.budgeted, 7000);
  assert.strictEqual(r2.spent, 100);
  assert.strictEqual(r2.available, 6900);
  assert.strictEqual(B.money(6900, 'R'), 'R 6 900');
  assert.strictEqual(B.money(-12.5, 'R'), '−R 12,50');
  assert.strictEqual(B.money(1234567, ''), '1 234 567');
  console.log('budget OK');
})().catch(e => { console.error(e); process.exit(1); });
