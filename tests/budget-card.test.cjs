'use strict';
/* The Budget card's headline: what the big number is and what it is called,
   for each answer currentBudget() can hand back (src/budget.js).

   Two answers arrived with the Budget plugin's 2026-10-07 audit fix
   (budget-vault src/api.js's header has the contract):
     locked   — its privacy splash is up and has not been opened this session.
                The card says so and shows NO figure: not the amount, not the
                period, not a tooltip. Showing one would print what the splash
                is hiding.
     noBudget — the period has no budget yet. The Budget plugin's own hero
                reads "New period — nothing budgeted yet" over what has been
                spent; this card used to read "Over budget R X" for the same
                state, because a budget of 0 minus the spend is negative. Here
                the number is what was spent, the label is the hero's words,
                and there is no meter, so no overflow mark either.
   An older Budget plugin sends neither flag and must read exactly as before.

   Plus the one rule about the card's 60-second cache that the lock needs: a
   figure from the Budget plugin is only kept while this dashboard is
   subscribed to its change and lock notifications, so it is dropped when the
   dashboard stops. Otherwise a figure cached before the lock closed would be
   shown again by the next dashboard opened inside the minute.

   dashboard.js needs obsidian routed to a stub to be required; mountDashboard
   itself is never called here, only the pure exports.

     node tests/budget-card.test.cjs
*/
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
require('./_stub.cjs');
const { budgetHeadline, budgetCacheAfterStop } = require('../src/dashboard');
const BG = require('../src/budget');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const TODAY = '2026-09-13';
const PERIOD = {
  start: '2026-09-01', end: '2026-09-30', asOf: '2026-09-13', label: '1 Sep – 30 Sep, 2026',
  currency: { symbol: 'R' }, over: [], notes: [],
};

/* ---- locked ---- */
{
  const h = budgetHeadline(BG.mapApiPeriod({ locked: true }, TODAY));
  eq(h, { state: 'locked', label: 'Budget locked' }, 'locked: a label and nothing else — no amount, no meter, no over flag');
}

/* ---- noBudget (a current Budget plugin) ---- */
{
  const b = BG.mapApiPeriod(Object.assign({}, PERIOD, { budgeted: 0, spent: 11600, left: null, noBudget: true }), TODAY);
  const h = budgetHeadline(b);
  eq(h.state, 'noBudget', 'no budget for the period: its own state');
  eq(h.label, 'Nothing budgeted yet', "the hero's own words, not \"Over budget\"");
  eq(h.amount, 11600, 'the big number is what was spent, as on the hero');
  eq(h.over, false, 'not over: there is no budget to be over');
  eq(h.meter, false, 'no meter, so no overflow mark against a budget of nothing');
}

/* ---- an ordinary figure, either side of zero ---- */
{
  const under = budgetHeadline(BG.mapApiPeriod(Object.assign({}, PERIOD, { budgeted: 10000, spent: 4200, left: 5800, noBudget: false }), TODAY));
  eq(under, { state: 'figure', amount: 5800, label: 'Left to spend', over: false, meter: true }, 'under budget: left to spend, with the meter');
  const over = budgetHeadline(BG.mapApiPeriod(Object.assign({}, PERIOD, { budgeted: 10000, spent: 12500, left: -2500, noBudget: false }), TODAY));
  eq(over, { state: 'figure', amount: 2500, label: 'Over budget', over: true, meter: true }, 'over budget: still says so when there IS a budget');
}

/* ---- an older Budget plugin: neither flag, read exactly as before ---- */
{
  const old = budgetHeadline(BG.mapApiPeriod(Object.assign({}, PERIOD, { budgeted: 0, spent: 4200, left: -4200 }), TODAY));
  eq(old, { state: 'figure', amount: 4200, label: 'Over budget', over: true, meter: true },
    'no noBudget field: the old reading, unchanged (the plugin did not say there was no budget)');
}

/* ---- Vista's own fallback count is a figure, as before ---- */
{
  const own = BG.computeBudget({
    today: TODAY, settings: { month_start_day: 1, currency: 'R' },
    categories: [{ name: 'Food', type: 'food' }], accounts: [],
    budgetRows: [{ category: 'Food', type: 'food', amount: 1000 }],
    txFiles: [{ label: 'Cheque', month: '2026-09', rows: [{ date: '2026-09-05', cat: 'Food', amount: -300, excluded: false, split: '' }] }],
  });
  eq(budgetHeadline(own), { state: 'figure', amount: 700, label: 'Left to spend', over: false, meter: true },
    "Vista's own reader carries no flags and reads as it always did");
}

/* ---- the cache across a stop ---- */
{
  const at = Date.now();
  eq(budgetCacheAfterStop({ value: BG.mapApiPeriod(Object.assign({}, PERIOD, { budgeted: 1, spent: 0, left: 1 }), TODAY), at }), null,
    "a Budget-plugin figure is dropped when the dashboard stops — no subscriber is left to hear the lock close");
  eq(budgetCacheAfterStop({ value: { source: 'budget-app', locked: true }, at }), null,
    'a cached lock is dropped too, or a gate opened meanwhile would still read as locked');
  const own = { value: { source: 'vista', budgeted: 1, spent: 0, available: 1 }, at };
  eq(budgetCacheAfterStop(own), own, "Vista's own count has no lock to honour and keeps its cache, as before");
  eq(budgetCacheAfterStop(null), null, 'nothing cached: nothing to drop');
  eq(budgetCacheAfterStop(undefined), undefined, 'never cached: left as it was');

  // stop() is inside mountDashboard (DOM-bound), so the call is pinned by name.
  const src = fs.readFileSync(path.join(__dirname, '../src/dashboard.js'), 'utf8');
  const stop = (src.match(/\n    stop\(\) \{([\s\S]*?)\n    \},/) || [])[1] || '';
  ok(stop.length > 0, 'sanity: the controller\'s stop() was found');
  ok(/plugin\._budgetCache = budgetCacheAfterStop\(plugin\._budgetCache\)/.test(stop),
    'stop() hands the cache through budgetCacheAfterStop');
}

console.log(`budget-card OK (${checks} checks)`);
