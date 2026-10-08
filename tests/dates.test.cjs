'use strict';
const assert = require('node:assert');
const D = require('../src/dates');

assert.strictEqual(D.greeting(6), 'Good morning');
assert.strictEqual(D.greeting(12), 'Good afternoon');
assert.strictEqual(D.greeting(18), 'Good evening');
assert.strictEqual(D.greeting(23), 'Good night');
assert.strictEqual(D.greeting(3), 'Good night');
assert.ok(D.isNight(22) && D.isNight(3) && !D.isNight(12));

const d = new Date(2026, 8, 12, 21, 5);
assert.strictEqual(D.todayISO(d), '2026-09-12');
assert.strictEqual(D.addDays('2026-09-12', -12), '2026-08-31');
assert.strictEqual(D.addDays('2026-12-31', 1), '2027-01-01');
assert.strictEqual(D.fmtDate(d), 'Saturday, 12 September');
assert.strictEqual(D.fmtTime(d, true), '21:05');
assert.strictEqual(D.fmtTime(d, false), '9:05 pm');
assert.strictEqual(D.fmtTime(new Date(2026, 0, 1, 0, 7), false), '12:07 am');

const now = Date.UTC(2026, 8, 12, 12, 0, 0);
assert.strictEqual(D.relTime(now - 10 * 1000, now), 'just now');
assert.strictEqual(D.relTime(now - 5 * 60 * 1000, now), '5m ago');
assert.strictEqual(D.relTime(now - 3 * 3600 * 1000, now), '3h ago');
assert.strictEqual(D.relTime(now - 30 * 3600 * 1000, now), 'yesterday');
assert.strictEqual(D.relTime(now - 4 * 86400 * 1000, now), '4d ago');
assert.strictEqual(D.relTime(now - 21 * 86400 * 1000, now), '3w ago');
assert.strictEqual(D.relTime(now - 100 * 86400 * 1000, now), '3mo ago');
assert.strictEqual(D.relTime(now + 5000, now), 'just now', 'future mtimes never go negative');

assert.strictEqual(D.hashStr('2026-09-12'), D.hashStr('2026-09-12'));
assert.notStrictEqual(D.hashStr('2026-09-12'), D.hashStr('2026-09-13'));
console.log('dates OK');
