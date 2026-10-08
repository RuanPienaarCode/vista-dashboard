'use strict';
const assert = require('node:assert');
const T = require('../src/tiles');

assert.ok(T.DEFAULT_TILES.length >= 3 && T.DEFAULT_TILES.length <= 6, 'a short starter set, not a tour of someone’s vault');
for (const t of T.DEFAULT_TILES) {
  assert.strictEqual(T.validateTile(t), null, t.label);
  assert.ok(T.GROUPS.includes(t.group), t.label);
  assert.ok(T.ICONS.includes(t.icon), `${t.label}: icon ${t.icon} must be in the validated picker list`);
}
/* The starter set must work in ANY vault: it may open today's note and Obsidian's
   own core commands, and nothing else — no other plugin, no note name that
   only exists in the author's vault. */
const CORE = new Set(['global-search', 'graph', 'command-palette', 'switcher', 'file-explorer', 'app', 'workspace', 'editor', 'daily-notes', 'random-note']);
for (const t of T.DEFAULT_TILES) {
  assert.ok(t.kind === 'daily' || t.kind === 'command' || t.kind === 'search', `${t.label}: a default tile must not name a note (${t.kind}:${t.target})`);
  if (t.kind === 'command') assert.ok(CORE.has(t.target.split(':')[0]), `${t.label}: ${t.target} is not an Obsidian core command`);
  if (t.kind === 'url') assert.fail('no web links by default');
}
assert.ok(T.DEFAULT_TILES.some(t => t.kind === 'daily'), 'Today is there');
assert.ok(T.DEFAULT_TILES.some(t => t.target === 'global-search:open'), 'and search');
/* Defaults come back as a fresh copy, never the shared array. */
const a = T.resolveTiles({ tiles: null });
a.push({ label: 'x' });
assert.strictEqual(T.resolveTiles({ tiles: null }).length, T.DEFAULT_TILES.length);
assert.deepStrictEqual(T.resolveTiles({ tiles: [] }), [], 'an empty user list is respected');

assert.strictEqual(T.normalizeTile({ kind: 'command', target: ' rhythm:open ' }).icon, 'terminal');
assert.strictEqual(T.normalizeTile({ kind: 'daily' }).label, 'Today');
assert.strictEqual(T.normalizeTile({ kind: 'nonsense', target: 'X', group: 'Nope' }).kind, 'note');
assert.strictEqual(T.normalizeTile({ kind: 'nonsense', target: 'X', group: 'Nope' }).group, T.GROUPS[0]);
assert.strictEqual(T.normalizeTile({ target: 'Task Dashboard' }).label, 'Task Dashboard');

assert.ok(T.validateTile({ kind: 'note', target: '' }));
assert.strictEqual(T.validateTile({ kind: 'daily' }), null);
assert.ok(T.validateTile({ kind: 'url', target: 'example.com' }));
assert.strictEqual(T.validateTile({ kind: 'url', target: 'https://example.com' }), null);
assert.strictEqual(T.validateTile({ kind: 'url', target: 'obsidian://rhythm?tab=today' }), null);

const g = T.groupTiles([{ group: 'Areas', label: 'a' }, { group: 'Apps', label: 'b' }, { group: 'Areas', label: 'c' }, { group: 'Zzz', label: 'd' }]);
assert.deepStrictEqual(g.map(x => x.group), ['Apps', 'Areas']);
assert.deepStrictEqual(g[0].tiles.map(t => t.label), ['b', 'd'], 'unknown groups land in the first');
assert.deepStrictEqual(g[1].tiles.map(t => t.label), ['a', 'c']);
/* A hand-edited data.json can hold things that are not tiles. */
const junk = [null, undefined, 3, 'x', [], { label: 'ok', kind: 'note', target: 'A', group: 'Apps' }];
assert.deepStrictEqual(T.resolveTiles({ tiles: junk }).map(t => t.label), ['ok'], 'non-object entries are dropped');
assert.doesNotThrow(() => T.groupTiles(junk));
assert.deepStrictEqual(T.groupTiles(junk).map(g => g.group), ['Apps']);
const live = [{ label: 'a', kind: 'note', target: 'A', group: 'Apps' }];
assert.strictEqual(T.resolveTiles({ tiles: live }), live, 'a clean list is returned as is');
console.log('tiles OK');
