'use strict';
/* Quick-access tiles: the built-in set, the kinds, and validation. Pure. */

const GROUPS = ['Apps', 'Areas', 'Important'];

const KINDS = [
  { id: 'note', name: 'Note', hint: 'A note name or path, like "Task Dashboard"' },
  { id: 'command', name: 'Command', hint: 'A command id, like "rhythm:open"' },
  { id: 'daily', name: "Today's note", hint: 'Opens (or creates) today\'s journal note' },
  { id: 'search', name: 'Vault search', hint: 'A search query, like "tag:#urgent"' },
  { id: 'url', name: 'Web link', hint: 'A full URL' },
];

/* The starter set. It has to work in any vault, so it opens today's note and
   Obsidian's own core commands and nothing else: no other plugin, no note name
   that only exists in one person's vault. Everything beyond this is the user's
   to add (the + on the tiles card); once they edit, their list replaces it. */
const DEFAULT_TILES = [
  { label: 'Today', icon: 'notebook-pen', kind: 'daily', target: '', group: 'Apps' },
  { label: 'Search everything', icon: 'search', kind: 'command', target: 'global-search:open', group: 'Apps' },
  { label: 'Graph view', icon: 'network', kind: 'command', target: 'graph:open', group: 'Apps' },
  { label: 'Command palette', icon: 'terminal', kind: 'command', target: 'command-palette:open', group: 'Apps' },
];

/* Icons offered by the picker. Every name was checked against the lucide set
   bundled in Obsidian (setIcon on an unknown name is a silent blank). */
const ICONS = ['home', 'wallet', 'bell', 'users', 'shield', 'compass', 'dumbbell', 'cross', 'briefcase', 'map', 'gamepad-2', 'list-todo', 'notebook-pen', 'book-open', 'database', 'files', 'heart-pulse', 'car', 'pie-chart', 'bar-chart-3', 'activity', 'target', 'flag', 'bookmark', 'calendar', 'calendar-days', 'clock', 'star', 'sparkles', 'zap', 'flame', 'leaf', 'tree-pine', 'sun', 'moon', 'cloud-rain', 'snowflake', 'droplets', 'waves', 'wind', 'orbit', 'globe', 'mail', 'phone', 'message-circle', 'camera', 'image', 'music', 'film', 'headphones', 'mic', 'pen-line', 'pencil', 'file-text', 'folder', 'folder-open', 'hash', 'tag', 'link', 'external-link', 'search', 'settings', 'terminal', 'code', 'cpu', 'laptop', 'smartphone', 'wifi', 'lock', 'key-round', 'credit-card', 'banknote', 'coins', 'receipt', 'shopping-cart', 'gift', 'cake', 'coffee', 'utensils', 'bed', 'tent', 'mountain', 'plane', 'train-front', 'bike', 'footprints', 'graduation-cap', 'library', 'church', 'baby', 'dog', 'cat', 'palette', 'brush', 'wrench', 'hammer', 'lightbulb', 'rocket', 'trophy', 'medal', 'award', 'circle-check', 'triangle-alert', 'info', 'circle-help', 'layout-dashboard', 'layout-grid', 'list', 'table', 'kanban', 'git-fork', 'network', 'anchor', 'ship', 'sailboat', 'umbrella', 'heart', 'smile', 'user', 'user-round', 'contact', 'id-card', 'stethoscope', 'pill', 'apple', 'carrot', 'piggy-bank', 'landmark', 'building', 'house', 'map-pin', 'navigation', 'bus', 'fuel', 'scroll-text', 'newspaper', 'video', 'tv', 'radio'];

function cloneTiles(tiles) { return tiles.map(t => Object.assign({}, t)); }

/* The tiles to show: the user's list, or the defaults until they edit. */
const isTile = t => !!t && typeof t === 'object' && !Array.isArray(t);

function resolveTiles(settings) {
  if (!Array.isArray(settings.tiles)) return cloneTiles(DEFAULT_TILES);
  /* a hand-edited or damaged data.json can hold entries that are not tiles; a
     clean list is returned as is (callers rely on it being the live array) */
  return settings.tiles.every(isTile) ? settings.tiles : settings.tiles.filter(isTile);
}

function normalizeTile(t) {
  const kind = KINDS.some(k => k.id === t.kind) ? t.kind : 'note';
  const label = String(t.label || '').trim() || (kind === 'daily' ? 'Today' : String(t.target || '').trim() || 'Untitled');
  return {
    label,
    icon: String(t.icon || '').trim() || (kind === 'command' ? 'terminal' : kind === 'url' ? 'external-link' : kind === 'search' ? 'search' : kind === 'daily' ? 'notebook-pen' : 'file-text'),
    kind,
    target: String(t.target || '').trim(),
    group: GROUPS.includes(t.group) ? t.group : GROUPS[0],
  };
}

function validateTile(t) {
  const n = normalizeTile(t);
  if (n.kind !== 'daily' && !n.target) return 'Give the tile something to open.';
  if (n.kind === 'url' && !/^https?:\/\/|^obsidian:\/\//i.test(n.target)) return 'A web link needs to start with http:// or https://.';
  return null;
}

/* Group tiles in display order. */
function groupTiles(tiles) {
  const out = GROUPS.map(g => ({ group: g, tiles: [] }));
  for (const t of tiles) {
    if (!isTile(t)) continue;
    const bucket = out.find(o => o.group === t.group) || out[0];
    bucket.tiles.push(t);
  }
  return out.filter(o => o.tiles.length);
}

module.exports = { isTile, GROUPS, KINDS, DEFAULT_TILES, ICONS, resolveTiles, normalizeTile, validateTile, groupTiles, cloneTiles };
