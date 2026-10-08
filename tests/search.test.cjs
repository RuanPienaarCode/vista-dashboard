'use strict';
const assert = require('node:assert');
const S = require('../src/search');

const entries = [
  { basename: 'Task Dashboard', path: 'Planning/Task Dashboard.md', extension: 'md', folder: 'Planning', mtime: 5, aliases: [] },
  { basename: 'Budget Home', path: 'Money/Budget/Budget Home.md', extension: 'md', folder: 'Money/Budget', mtime: 9, aliases: ['Budget'] },
  { basename: 'Home', path: 'Home.md', extension: 'md', folder: '', mtime: 1, aliases: ['Dashboard', 'Start Here'] },
  { basename: 'Budget-2026-09', path: 'Money/Budget/Budgets/Budget-2026-09.md', extension: 'md', folder: 'x', mtime: 20, aliases: [] },
  { basename: 'holiday', path: 'Travel/photos/holiday.jpg', extension: 'jpg', folder: 'Travel/photos', mtime: 2, aliases: [] },
  { basename: 'Tasks weekly', path: 'Planning/Tasks weekly.md', extension: 'md', folder: 'Planning', mtime: 3, aliases: [] },
];

/* Empty query → nothing. */
assert.deepStrictEqual(S.rank(entries, '   '), []);

/* Exact word-start substring beats a subsequence. */
let r = S.rank(entries, 'task');
assert.strictEqual(r[0].entry.basename, 'Task Dashboard');
assert.ok(r.some(x => x.entry.basename === 'Tasks weekly'));

/* Aliases match, and the field is reported so the UI can say so. */
r = S.rank(entries, 'start here');
assert.strictEqual(r[0].entry.basename, 'Home');
assert.strictEqual(r[0].field, 'alias');

/* "budget" — the alias on Budget Home and the real name both hit; the
   shorter exact name wins the tie, and the jpg never appears. */
r = S.rank(entries, 'budget');
assert.ok(r.length >= 2);
assert.ok(r.every(x => x.entry.extension === 'md'));
assert.ok(r.slice(0, 2).map(x => x.entry.basename).includes('Budget Home'));

/* Subsequence still finds it; ordering of letters must be respected. */
r = S.rank(entries, 'tdb');
assert.strictEqual(r[0].entry.basename, 'Task Dashboard');
assert.deepStrictEqual(S.rank(entries, 'zzz'), []);

/* Path-only matches rank below name matches and carry field=path. */
r = S.rank(entries, 'travel');
assert.strictEqual(r[0].entry.basename, 'holiday');
assert.strictEqual(r[0].field, 'path');

/* Limit is honoured. */
assert.strictEqual(S.rank(entries, 'a', null, 2).length, 2);

/* Injected matcher (the shape of prepareFuzzySearch) is used when given. */
const calls = [];
const fake = q => text => { calls.push(text); return text.startsWith('Home') ? { score: -0.1, matches: [[0, 1]] } : null; };
r = S.rank(entries, 'h', fake);
assert.strictEqual(r.length, 1);
assert.strictEqual(r[0].entry.basename, 'Home');
assert.ok(calls.length > 0);

/* Matches are index pairs into the text the UI renders. */
const m = S.fallbackFuzzy('dash')('Task Dashboard');
assert.deepStrictEqual(m.matches, [[5, 9]]);

/* Icons per extension. */
assert.strictEqual(S.fileIcon('md'), 'file-text');
assert.strictEqual(S.fileIcon('JPG'), 'file-image');
assert.strictEqual(S.fileIcon('canvas'), 'layout-grid');
assert.strictEqual(S.fileIcon('base'), 'database');
assert.strictEqual(S.fileIcon('xyz'), 'file');

/* Frontmatter aliases in every shape Obsidian writes. */
assert.deepStrictEqual(S.aliasesOf({ aliases: ['A', 'B'] }), ['A', 'B']);
assert.deepStrictEqual(S.aliasesOf({ aliases: 'A, B' }), ['A', 'B']);
assert.deepStrictEqual(S.aliasesOf({ alias: 'Solo' }), ['Solo']);
assert.deepStrictEqual(S.aliasesOf({ aliases: [1, 'ok', null] }), ['ok']);
assert.deepStrictEqual(S.aliasesOf(null), []);
console.log('search OK');
