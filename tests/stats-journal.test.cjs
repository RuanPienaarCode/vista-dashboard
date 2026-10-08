'use strict';
/* The journal streak, the calendar's dots and the capture box must agree on
   which notes are journal days: stats.journalStreak asks src/actions.js's
   journalDays, so a folder typed the way the settings tab lets you type it
   ('/Diary/Journal/') counts the same notes everywhere. */
const assert = require('node:assert');
require('./_stub.cjs');
const ST = require('../src/stats');
const A = require('../src/actions');

const file = p => { const name = p.slice(p.lastIndexOf('/') + 1); return { path: p, basename: name.replace(/\.[^.]+$/, ''), extension: name.slice(name.lastIndexOf('.') + 1) }; };
const T = '2026-10-07';
const paths = ['Diary/Journal/2026-10-07.md', 'Diary/Journal/2026-10-06.md', 'Diary/Journal/2026-10-05.md', 'Diary/Journal/2026-10-03.md'];

/* A typed leading slash, a trailing slash, doubled slashes: same folder, same streak. */
for (const folder of ['Diary/Journal', '/Diary/Journal', 'Diary/Journal/', '/Diary//Journal/', '  Diary/Journal  ']) {
  assert.strictEqual(ST.journalStreak(paths, folder, T), 3, `streak for ${JSON.stringify(folder)}`);
}

/* The streak is exactly the run in the day-set journalDays produces. */
for (const folder of ['Diary/Journal', '/Diary/Journal/', '', 'Elsewhere']) {
  const days = A.journalDays(paths.map(file), folder);
  let n = 0, cursor = T;
  const dayBefore = iso => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
  if (!days.has(cursor)) cursor = dayBefore(cursor);
  while (days.has(cursor)) { n++; cursor = dayBefore(cursor); }
  assert.strictEqual(ST.journalStreak(paths, folder, T), n, `streak == run of journalDays for ${JSON.stringify(folder)}`);
}

/* Blank folder = the vault root only (the actions lane's rule): nested notes do not count. */
assert.strictEqual(ST.journalStreak(paths, '', T), 0, 'nested notes are not root journal notes');
assert.strictEqual(ST.journalStreak(['2026-10-07.md', '2026-10-06.md'], '', T), 2, 'root notes count');
assert.strictEqual(ST.journalStreak(['2026-10-07.md', '2026-10-06.md'], '/', T), 2, "'/' is the root too");

/* A year/month layout under the folder still counts; other extensions and look-alikes do not. */
assert.strictEqual(ST.journalStreak(['J/2026/10/2026-10-07.md', 'J/2026/10/2026-10-06.md'], 'J', T), 2);
assert.strictEqual(ST.journalStreak(['J/2026-10-07.png', 'J/2026-10-07.md.bak', 'J/x2026-10-07.md'], 'J', T), 0);
/* Two notes for one day count once. */
assert.strictEqual(ST.journalStreak(['J/2026-10-07.md', 'J/old/2026-10-07.md'], 'J', T), 1);
console.log('stats journal streak OK');
