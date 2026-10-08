'use strict';
const assert = require('node:assert');
require('./_stub.cjs'); // stats.js reaches src/actions.js (journalDays), which imports obsidian
const ST = require('../src/stats');

assert.strictEqual(ST.countWords('---\ntags: [a, b]\n---\n\nHello there, world. Don’t count the frontmatter.'), 7);
assert.strictEqual(ST.countWords(''), 0);
assert.strictEqual(ST.countWords('---\nnot closed'), 2, 'an unclosed frontmatter fence is body text');

assert.deepStrictEqual(ST.countTasks('- [ ] one\n- [x] two\n  - [X] three\n* [ ] four\n- [-] cancelled\n-[ ] not a task'), { open: 2, done: 2 });

/* Same task-shape rules as tasks.js scanTasks: in-progress and other
   non-done/non-cancelled statuses are open, callout tasks count, and a
   fenced code block is skipped entirely — not counted at all. */
assert.deepStrictEqual(
  ST.countTasks('- [/] in progress\n> - [ ] callout task\n```\n- [ ] fenced, not a task\n```\n- [x] done\n'),
  { open: 2, done: 1 },
  'in-progress + callout task are open; the fenced task is skipped'
);

/* Task counts go by checkbox status only: date-field placement (which decides
   what Obsidian Tasks calls a due date, see tasks.js) never changes a count. */
assert.deepStrictEqual(
  ST.countTasks('- [ ] Call 📅 2026-10-01 ⏰ 09:00\n- [ ] Ask about the 📅 2026-10-01 meeting\n- [ ] Renew 🗓 2026-10-01\n'),
  { open: 3, done: 0 }
);

const now = new Date(2026, 8, 12, 20, 0).getTime();
const day = 86400000;
const files = [
  { path: 'Home.md', extension: 'md', ctime: now - 40 * day, mtime: now - 2 * 3600000, size: 1200 },
  { path: 'Diary/Task Dashboard.md', extension: 'md', ctime: now - 10 * day, mtime: now - 3 * day, size: 800 },
  { path: 'Diary/Journal/2026-09-12.md', extension: 'md', ctime: now - 3600000, mtime: now - 3600000, size: 300 },
  { path: 'Diary/Journal/2026-09-11.md', extension: 'md', ctime: now - day, mtime: now - day, size: 300 },
  { path: 'Diary/Journal/2026-09-10.md', extension: 'md', ctime: now - 2 * day, mtime: now - 2 * day, size: 300 },
  { path: 'Diary/Journal/2026-09-08.md', extension: 'md', ctime: now - 4 * day, mtime: now - 4 * day, size: 300 },
  { path: 'Orphan.md', extension: 'md', ctime: now - 100 * day, mtime: now - 100 * day, size: 10 },
  { path: 'Travel/photo.jpg', extension: 'jpg', ctime: now, mtime: now, size: 500000 },
  { path: 'Board.canvas', extension: 'canvas', ctime: now, mtime: now, size: 50 },
];
const texts = new Map([
  ['Home.md', '# Home\n\n- [ ] buy milk\n- [x] done thing\nSome words here.'],
  ['Diary/Task Dashboard.md', 'Two words'],
]);
const s = ST.computeStats({
  files, texts, now,
  resolvedLinks: { 'Home.md': { 'Diary/Task Dashboard.md': 2, 'Diary/Journal/2026-09-12.md': 1 } },
  unresolvedLinks: { 'Home.md': { 'Missing Note': 1 }, 'Orphan.md': { 'Missing Note': 1, 'Other': 1 } },
  tagCounts: { '#a': 3, '#b': 1 },
  journalFolder: 'Diary/Journal',
});
assert.strictEqual(s.notes, 7);
assert.strictEqual(s.attachments, 1, 'canvas is not an attachment');
assert.strictEqual(s.folders, 3, 'Diary, Diary/Journal, Travel');
assert.strictEqual(s.words, ST.countWords(texts.get('Home.md')) + 2);
assert.strictEqual(s.tasksOpen, 1);
assert.strictEqual(s.tasksDone, 1);
assert.strictEqual(s.links, 3);
assert.deepStrictEqual(s.orphans, ['Diary/Journal/2026-09-08.md', 'Diary/Journal/2026-09-10.md', 'Diary/Journal/2026-09-11.md', 'Orphan.md']);
assert.deepStrictEqual(s.unresolved, ['Missing Note', 'Other']);
assert.strictEqual(s.tags, 2);
assert.deepStrictEqual(s.topTags, ['#a', '#b']);
assert.strictEqual(s.createdToday, 1);
assert.strictEqual(s.createdWeek, 4, 'today, -1d, -2d, -4d');
assert.strictEqual(s.modifiedToday, 2);
assert.strictEqual(s.journalStreak, 3, '12, 11, 10 — the gap on the 9th ends it');
assert.strictEqual(s.size, 1200 + 800 + 1200 + 10 + 500000 + 50);

/* Streak counts from yesterday when today has no note yet; a gap resets it. */
assert.strictEqual(ST.journalStreak(['J/2026-09-11.md', 'J/2026-09-10.md'], 'J', '2026-09-12'), 2);
assert.strictEqual(ST.journalStreak(['J/2026-09-09.md'], 'J', '2026-09-12'), 0);
assert.strictEqual(ST.journalStreak(['Elsewhere/2026-09-12.md'], 'J', '2026-09-12'), 0, 'only the journal folder counts');
assert.strictEqual(ST.journalStreak(['2026-09-12.md'], '', '2026-09-12'), 1, 'no folder = anywhere');

assert.strictEqual(ST.fmtNum(999), '999');
assert.strictEqual(ST.fmtNum(1500), '1.5k');
assert.strictEqual(ST.fmtNum(2000), '2k');
assert.strictEqual(ST.fmtNum(48200), '48k');
assert.strictEqual(ST.fmtNum(1200000), '1.2M');
assert.strictEqual(ST.fmtBytes(500), '500 B');
assert.strictEqual(ST.fmtBytes(2048), '2 KB');
assert.strictEqual(ST.fmtBytes(3.5 * 1048576), '3.5 MB');
console.log('stats OK');
