'use strict';
/* Guards the two pure decisions dashboard.js pulls out of its DOM code:
   what tapping a calendar day should do, and how a drag's new visible
   order gets merged back into the full (visible + hidden) widget order.
   Requiring dashboard.js needs obsidian routed to a stub — mountDashboard()
   itself is never called here, only the two pure exports. */
const assert = require('node:assert');
require('./_stub.cjs');
const { dayTapAction, mergeWidgetOrder } = require('../src/dashboard');

/* ---- dayTapAction -------------------------------------------------------- */
assert.strictEqual(dayTapAction('2026-09-27', '2026-09-27', true), 'open', 'a note that exists always opens, even today');
assert.strictEqual(dayTapAction('2026-09-01', '2026-09-27', true), 'open', 'a note that exists always opens, even in the past');
assert.strictEqual(dayTapAction('2026-10-05', '2026-09-27', true), 'open', 'a note that exists always opens, even in the future');
assert.strictEqual(dayTapAction('2026-09-27', '2026-09-27', false), 'create', 'today with no note is created');
assert.strictEqual(dayTapAction('2026-10-05', '2026-09-27', false), 'create', 'a future day with no note is created');
assert.strictEqual(dayTapAction('2026-09-01', '2026-09-27', false), 'none', 'a past day with no note is left alone');
assert.strictEqual(dayTapAction('2026-08-31', '2026-09-01', false), 'none', 'across a month boundary, still none');
assert.strictEqual(dayTapAction('2026-09-02', '2026-09-01', false), 'create', 'across a month boundary, still create for tomorrow');
console.log('dayTapAction OK');

/* ---- mergeWidgetOrder ----------------------------------------------------- */
const full = ['budget', 'rhythm', 'tasks', 'nudge', 'gym', 'recent', 'stats'];
/* nudge and recent are hidden (not part of the visible drag); the user
   dragged the five visible cards into a new order. */
const visible = ['stats', 'budget', 'rhythm', 'tasks', 'gym'];
const merged = mergeWidgetOrder(full, visible);
assert.deepStrictEqual(merged, ['stats', 'budget', 'rhythm', 'nudge', 'tasks', 'recent', 'gym'],
  'hidden keys (nudge, recent) keep their relative slot; visible ones take the dragged order');
assert.deepStrictEqual(mergeWidgetOrder(full, full), full, 'no reorder is a no-op');
assert.deepStrictEqual(mergeWidgetOrder([], []), []);
/* the bug this replaced: hidden widgets pushed to the end instead of kept in place */
assert.notDeepStrictEqual(merged, [...visible, 'nudge', 'recent'], 'must not be the old behaviour (visible order, then every hidden key appended)');
console.log('mergeWidgetOrder OK');
