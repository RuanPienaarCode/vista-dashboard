'use strict';
/* Vault statistics. Pure functions over plain records so they can be tested
   without Obsidian; dashboard.js gathers the inputs from the app. */

const { todayISO, addDays } = require('./dates');
const { eachTaskLine, isOpenStatus } = require('./tasks');
const A = require('./actions');

const ATTACH_SKIP = new Set(['md', 'canvas', 'base']);

function countWords(text) {
  if (!text) return 0;
  let body = text;
  if (body.startsWith('---')) {
    const end = body.indexOf('\n---', 3);
    if (end > 0) body = body.slice(end + 4);
  }
  const m = body.match(/[A-Za-z0-9À-ɏЀ-ӿ'’]+/g);
  return m ? m.length : 0;
}

/* Same task shapes tasks.js scans for: blockquote/callout tasks count,
   fenced code blocks are skipped, and any status that isn't done (x/X) or
   cancelled (-) — in-progress (/), question (?), etc. — counts as open. */
function countTasks(text) {
  let open = 0, done = 0;
  if (!text) return { open, done };
  eachTaskLine(text, (i, line, status) => {
    if (status === 'x' || status === 'X') done++;
    else if (status === '-') { /* cancelled: neither open nor done */ }
    else if (isOpenStatus(status)) open++;
  });
  return { open, done };
}

/* Consecutive days with a YYYY-MM-DD note, ending today or yesterday.
   Which notes ARE journal days is not decided here: it is src/actions.js's
   journalDays — the rule the calendar's dots and the capture box use — so the
   streak, the dots and the note a tap opens can never disagree (a typed
   '/Diary/Journal/' is the same folder as 'Diary/Journal'; a blank
   folder means the vault root only). `paths` are vault paths. */
function journalStreak(paths, folder, today) {
  const files = [];
  for (const p of paths) {
    const name = p.slice(p.lastIndexOf('/') + 1);
    const dot = name.lastIndexOf('.');
    files.push({ path: p, basename: dot > 0 ? name.slice(0, dot) : name, extension: dot > 0 ? name.slice(dot + 1) : '' });
  }
  const days = A.journalDays(files, folder);
  let cursor = today;
  if (!days.has(cursor)) cursor = addDays(today, -1);
  let n = 0;
  while (days.has(cursor)) { n++; cursor = addDays(cursor, -1); }
  return n;
}

function fmtNum(n) {
  if (n === null || n === undefined) return '—';
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n < 1000000) return Math.round(n / 1000) + 'k';
  return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
}

function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}

/* files: [{ path, extension, ctime, mtime, size }]
   resolvedLinks: { srcPath: { dstPath: count } }
   unresolvedLinks: { srcPath: { linkText: count } }
   tagCounts: { '#tag': n }
   texts: Map(path -> markdown) for the notes whose words/tasks are counted */
function computeStats(input) {
  const files = input.files || [];
  const now = input.now || Date.now();
  const today = todayISO(new Date(now));
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const weekStart = dayStart.getTime() - 6 * 86400000;
  const resolved = input.resolvedLinks || {};
  const unresolved = input.unresolvedLinks || {};
  const texts = input.texts || new Map();

  const notes = files.filter(f => f.extension === 'md');
  const attachments = files.filter(f => !ATTACH_SKIP.has(f.extension));
  const folders = new Set();
  let size = 0;
  for (const f of files) {
    size += f.size || 0;
    let p = f.path;
    while (p.includes('/')) { p = p.slice(0, p.lastIndexOf('/')); folders.add(p); }
  }

  let words = 0, tasksOpen = 0, tasksDone = 0;
  for (const t of texts.values()) {
    words += countWords(t);
    const c = countTasks(t);
    tasksOpen += c.open; tasksDone += c.done;
  }

  let links = 0;
  const inbound = new Set(), outbound = new Set();
  for (const src of Object.keys(resolved)) {
    const targets = resolved[src];
    for (const dst of Object.keys(targets)) {
      links += targets[dst] || 0;
      inbound.add(dst);
      outbound.add(src);
    }
  }
  const orphans = notes.filter(f => !inbound.has(f.path) && !outbound.has(f.path)).map(f => f.path).sort();

  const unresolvedNames = new Set();
  for (const src of Object.keys(unresolved)) for (const name of Object.keys(unresolved[src])) unresolvedNames.add(name);

  const createdToday = notes.filter(f => (f.ctime || 0) >= dayStart.getTime()).length;
  const createdWeek = notes.filter(f => (f.ctime || 0) >= weekStart).length;
  const modifiedToday = notes.filter(f => (f.mtime || 0) >= dayStart.getTime()).length;

  const tagCounts = input.tagCounts || {};
  const tags = Object.keys(tagCounts).length;
  const topTags = Object.keys(tagCounts).sort((a, b) => tagCounts[b] - tagCounts[a]).slice(0, 5);

  return {
    notes: notes.length,
    attachments: attachments.length,
    folders: folders.size,
    files: files.length,
    size,
    words,
    tasksOpen,
    tasksDone,
    links,
    orphans,
    unresolved: [...unresolvedNames].sort(),
    tags,
    topTags,
    createdToday,
    createdWeek,
    modifiedToday,
    journalStreak: journalStreak(notes.map(f => f.path), input.journalFolder, today),
    computedAt: now,
  };
}

module.exports = { computeStats, countWords, countTasks, journalStreak, fmtNum, fmtBytes };
