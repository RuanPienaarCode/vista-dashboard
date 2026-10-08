'use strict';
const assert = require('node:assert');
const C = require('../src/calendar');

assert.deepStrictEqual(C.weekdayRow(1), ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
assert.deepStrictEqual(C.weekdayRow(0), ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']);
assert.strictEqual(C.monthLabel('2026-09-13'), 'September 2026');
assert.strictEqual(C.shiftMonth('2026-09-13', 1), '2026-10-01');
assert.strictEqual(C.shiftMonth('2026-01-31', -1), '2025-12-01');
assert.strictEqual(C.shiftMonth('2026-12-05', 1), '2027-01-01');

/* September 2026 starts on a Tuesday. Monday-start grid begins 31 Aug. */
const g = C.monthGrid('2026-09-13', 1, '2026-09-13');
assert.strictEqual(g.length, 6);
assert.ok(g.every(r => r.length === 7));
assert.strictEqual(g[0][0].iso, '2026-08-31');
assert.strictEqual(g[0][0].inMonth, false);
assert.strictEqual(g[0][1].iso, '2026-09-01');
assert.strictEqual(g[0][1].inMonth, true);
const today = g.flat().find(d => d.isToday);
assert.strictEqual(today.iso, '2026-09-13');
assert.strictEqual(today.day, 13);
assert.strictEqual(g.flat().filter(d => d.inMonth).length, 30);
assert.strictEqual(g.flat().find(d => d.iso === '2026-09-14').future, true);
assert.strictEqual(g.flat().find(d => d.iso === '2026-09-12').future, false);
/* Sunday start shifts the first cell back one day further. */
assert.strictEqual(C.monthGrid('2026-09-13', 0, '2026-09-13')[0][0].iso, '2026-08-30');
/* February 2026 (starts Sunday) on a Monday grid: six rows still. */
assert.strictEqual(C.monthGrid('2026-02-10', 1, '2026-09-13')[0][0].iso, '2026-01-26');
console.log('calendar OK');
