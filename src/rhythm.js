'use strict';
/* Vista's window onto the Rhythm plugin: which practices are due today, and
   a tick that writes back into Rhythm's own log note.

   The rule that governs everything here: read and write Rhythm's notes
   EXACTLY as Rhythm does. Rhythm's markdown.js is vendored verbatim as
   ./rhythm-markdown (scripts/check-rhythm-vendor.sh), and both directions go
   through it:
     - the loader reads each note's TEXT (vault.cachedRead, as Rhythm's io.js
       does) and parses it with Rhythm's parseFrontmatter - never the
       metadata cache, whose real-YAML reading differs from Rhythm's flat one
       (block-list `days:`, an unquoted `[[Wikilink]]`, scalars) - and derives
       every field the way io.js load() does;
     - tick() runs inside vault.process on the note's text, reads
       done/skip/snooze/plan with that same parser and writes through that
       parser's own patchFrontmatter, patching only the lists that changed
       (as io.js setFlag does) so every other line, comment, quote style,
       BOM, CRLF and the gap above the body stay as the note had them.
   Two deliberate differences from Rhythm's writer, both data-safety:
     - a list line Rhythm's parser cannot read (a multi-line flow list, a
       folded scalar...) REFUSES the tick instead of being read as empty and
       overwritten (Rhythm's own writer would add a second key beside it);
     - an item with an apostrophe anywhere in it is double-quoted. The
       vendored parser opens a quote only at an item's start, but a Rhythm
       from before that fix opens one at ANY apostrophe and reads a bare
       `Mom's call, Walk` back as one glued item. Quoting is read the same by
       both, so it costs nothing.
   Settings (folder, focusCount, weekStart, streakMode) are read from the
   Rhythm plugin when it is loaded, else its defaults. */

const M = require('./rhythm-model');
const RD = require('./rhythm-dates');
const MD = require('./rhythm-markdown');

const FOLDERS = { areas: 'Areas', practices: 'Practices', log: 'Log' };
const FLAGS = ['done', 'skip', 'snooze', 'plan'];

/* Rhythm io.js: `list`, `num`, `listEq`, `realISO` and `areaName`, verbatim.
   A scalar is ONE item. */
const list = v => (Array.isArray(v) ? v : (v ? [v] : [])).map(String);
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : undefined; };
const listEq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
/* A real calendar date in YYYY-MM-DD form (isISO checks the shape only, and
   2026-13-45 has the shape). */
const realISO = s => typeof s === 'string' && RD.isISO(s) && RD.toISO(RD.fromISO(s)) === s;
/* The area a note names, however typed: `Health`, `[[Health]]`, `[[Health|alias]]`
   or `[[Some/Folder/Health]]` all come back as `Health`, the area note's
   basename, which is what every other record is matched against. */
const WIKI = /^\[\[([^\]|]*)(\|[^\]]*)?\]\]$/;
function areaName(v) {
  if (Array.isArray(v)) v = v[0];
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  const m = WIKI.exec(s);
  if (!m) return s;
  const target = m[1].trim();
  return target.slice(target.lastIndexOf('/') + 1).trim();
}

const cleanFolder = f => String(f || 'Rhythm').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '') || 'Rhythm';

/* Rhythm's own settings when it is installed, else its defaults. */
function rhythmSettings(app) {
  let s = null;
  try { const p = app.plugins && app.plugins.plugins && app.plugins.plugins.rhythm; s = p && p.settings ? p.settings : null; } catch (e) { s = null; }
  return {
    folder: cleanFolder(s && s.folder),
    focusCount: Math.max(1, (s && s.focusCount) || 3),
    weekStart: s && s.weekStart === 0 ? 0 : 1,
    streakMode: (s && s.streakMode) || 'days',
    installed: !!s,
  };
}

/* ---- reading ------------------------------------------------------------ */

const baseName = f => (f.basename !== undefined ? f.basename : String(f.name || '').replace(/\.md$/, ''));

/* io.js mdFiles: the folder's markdown children in name order. */
function mdFiles(app, path) {
  const folder = app.vault.getFolderByPath(path);
  if (!folder || !folder.children) return [];
  return folder.children.filter(c => c.extension === 'md' || /\.md$/.test(c.name || ''))
    .sort((a, b) => baseName(a).localeCompare(baseName(b)));
}

async function readAll(app, path) {
  const out = [];
  for (const f of mdFiles(app, path)) {
    let text = '';
    try { text = await app.vault.cachedRead(f); } catch (e) { console.error('vista rhythm read', f.path, e); continue; }
    out.push({ file: f, name: baseName(f), path: f.path, fm: MD.parseFrontmatter(text).fm });
  }
  return out;
}

/* Build Rhythm's records from the vault, field for field as Rhythm's own
   io.js load() does (goals and events are not needed for the day's plan). */
async function loadRhythm(app, folder) {
  const root = cleanFolder(folder);
  if (!app.vault.getFolderByPath(root)) return null;
  const areas = (await readAll(app, `${root}/${FOLDERS.areas}`)).map(r => ({ name: r.name, order: num(r.fm.order), path: r.path }));
  const allPractices = (await readAll(app, `${root}/${FOLDERS.practices}`)).map(r => {
    /* The day a practice was started, for the model's missedRun/practiceStart.
       It comes ONLY from the note's own `created: YYYY-MM-DD` (file ctime is
       the day a sync copied the note); without one the model falls back to
       the practice's first appearance in the log. */
    const c = r.fm.created === undefined ? '' : String(r.fm.created).trim();
    const created = realISO(c) ? c : undefined;
    return {
      name: r.name, area: areaName(r.fm.area), cadence: r.fm.cadence || 'daily', days: r.fm.days,
      minutes: num(r.fm.minutes), when: r.fm.when || '', time: r.fm.time ? String(r.fm.time) : '',
      path: r.path,
      aside: r.fm.status === 'aside' || r.fm.status === 'paused',
      ...(created ? { created } : {}),
    };
  });
  const practices = allPractices.filter(p => !p.aside);
  const aside = allPractices.filter(p => p.aside);
  const log = new Map();
  for (const r of await readAll(app, `${root}/${FOLDERS.log}`)) {
    if (!RD.isISO(r.name)) continue;
    log.set(r.name, { done: new Set(list(r.fm.done)), skip: new Set(list(r.fm.skip)), snooze: new Set(list(r.fm.snooze)), plan: new Set(list(r.fm.plan)), note: '' });
  }
  return { areas, practices, aside, goals: [], events: [], log };
}

/* Rhythm's hero words (page-today.js renderToday), for the three states of
   the day. Those words live inline in Rhythm's view, not in a function Vista
   can vendor, so they are mirrored here and tests/rhythm-parity.test.cjs
   checks every literal against a Rhythm checkout when one is available.
   t = { focus, later, done, total } as todayFromRhythm returns it. */
function heroLines(t) {
  const focus = (t.focus || []).length, later = t.later || 0, done = t.done || 0;
  if (!t.total) return { num: '—', line: 'No practices yet.', rest: 'Add one with the plus button, or write a note in the Practices folder.' };
  if (focus + later === 0) {
    return {
      num: done ? String(done) : '·',
      line: done ? (done === 1 ? 'thing done.' : 'things done.') : 'Nothing is due.',
      rest: done ? 'Nothing more is asked of today.' : 'Rest is allowed.',
    };
  }
  return {
    num: String(focus),
    line: focus === 1 ? 'thing for today.' : 'things for today.',
    rest: later ? `${later} more when there's space.` : (done ? `${done} already done.` : 'That is the whole list.'),
  };
}
/* The line to show when nothing is in front of you; null when something is. */
function emptyLabel(t) { return (t.focus || []).length ? null : heroLines(t); }

/* { available, focus: [{ name, area, when, reason, path }], later, done, date } */
async function todayFromRhythm(app, dateISO) {
  const rs = rhythmSettings(app);
  const data = await loadRhythm(app, rs.folder);
  if (!data || !data.practices.length) return { available: false, focus: [], later: 0, done: 0, date: dateISO, folder: rs.folder };
  const plan = M.planDay(data, dateISO, { focusCount: rs.focusCount, weekStart: rs.weekStart });
  const row = r => ({ name: r.p.name, area: r.p.area, when: r.p.when || '', whenLabel: M.WHEN_LABEL[r.p.when] || '', reason: r.reason, path: r.p.path, done: r.pr.doneToday });
  return {
    available: true,
    focus: plan.focus.map(row),
    later: plan.later.length,
    done: plan.done.length,
    total: plan.all.length,
    date: dateISO,
    folder: rs.folder,
    streak: M.streak(data.log, dateISO),
    streakLabel: M.streakLabel(data, dateISO, { streakMode: rs.streakMode, weekStart: rs.weekStart }),
  };
}

/* ---- writing ------------------------------------------------------------ */

/* Quote one list item for Rhythm's flat reader: Rhythm's own yamlStr, plus a
   double-quote around any item holding an apostrophe (see the header). */
function yamlItem(v) {
  const s = String(v).replace(/\r?\n/g, ' ').trim();
  if (s.indexOf("'") >= 0) return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  return MD.yamlStr(s);
}

/* The key of a top-level `key: ...` line, as Rhythm's parser would take it;
   null for a comment, blank, indented or list-marker line. */
function topKey(line) {
  if (/^\s/.test(line) || /^-\s/.test(line) || /^#/.test(line) || line.trim() === '') return null;
  const ci = line.indexOf(':');
  return ci > 0 ? line.slice(0, ci).trim() : null;
}

/* Where Rhythm's parser left a `key:` line UNMODELLED (passed through as a
   raw line): a shape it cannot read as a list or a scalar. A modelled key,
   including an empty one (`done:`, `done: null`), is in fm instead. */
function hasRawKey(layout, key) {
  return layout.some(p => p.kind === 'raw' && p.lines.some(l => topKey(l) === key));
}

/* An empty `key:` modelled as null, followed (past blanks) by an indented
   line or list item: that is a block the parser did not attach to it, and
   writing the key would orphan those lines. */
function hasOrphanedBlock(layout, key) {
  for (let i = 0; i < layout.length; i++) {
    const part = layout[i];
    if (part.kind !== 'key' || part.key !== key || part.orig !== null) continue;
    const next = layout[i + 1];
    if (!next || next.kind !== 'raw') continue;
    const first = next.lines.find(l => l.trim() !== '');
    if (first !== undefined && (/^\s/.test(first) || /^-(\s|$)/.test(first))) return true;
  }
  return false;
}

/* The patched note text for one tick/untick, or { refuse: key }. Mirrors
   Rhythm io.js setFlag('done', ...): a tick also clears the name from skip,
   snooze and plan, and only the lists that CHANGED are patched (an emptied
   skip/snooze/plan drops its key; `done` stays `[]` unless it was never
   there). */
function patchTick(text, name, on) {
  const { fm } = MD.parseFrontmatter(text);
  const layout = fm[MD.FM_LAYOUT];
  for (const key of FLAGS) {
    if ((fm[key] === undefined && hasRawKey(layout, key)) || hasOrphanedBlock(layout, key)) return { refuse: key };
  }
  const orig = {}, cur = {}, prev = { done: false, skip: false, snooze: false, plan: false };
  for (const key of FLAGS) { orig[key] = list(fm[key]); cur[key] = orig[key].slice(); prev[key] = orig[key].includes(name); }
  const toggle = (arr, add) => (add ? (arr.includes(name) ? arr : [...arr, name]) : arr.filter(n => n !== name));
  cur.done = toggle(cur.done, on);
  if (on) for (const k of ['skip', 'snooze', 'plan']) cur[k] = toggle(cur[k], false);
  const doneWasAbsent = !layout.some(p => p.kind === 'key' && p.key === 'done');
  const fields = {}, restore = {};
  for (const key of FLAGS) {
    if (listEq(orig[key], cur[key])) continue;
    /* an empty item (`  -` in a block list) carries no name; drop it from a
       list being rewritten anyway */
    const arr = cur[key].filter(n => n !== '');
    fields[key] = arr.length ? arr : (key === 'done' && !doneWasAbsent ? [] : undefined);
    /* Rhythm's serializer writes a list line from its value unless told the
       line to use for that value: hand it ours for items it would leave bare
       around an apostrophe. */
    if (arr.some(n => n.indexOf("'") >= 0)) restore[key] = { value: arr, lines: [`${key}: [${arr.map(yamlItem).join(', ')}]`] };
  }
  return { text: MD.patchFrontmatter(text, fields, { restore }), prev };
}

/* Read-modify-write a log note as one unit, through app.vault.process when
   the host offers it (the atomic, queued transform) so a second tick fired
   before the first's write lands still sees it; plain read + modify only for
   a host/test double with no `process`. A refused patch hands the text back
   unchanged, so nothing is written. */
async function withNoteText(app, file, transform) {
  if (typeof app.vault.process === 'function') return app.vault.process(file, transform);
  const text = await app.vault.read(file);
  const next = transform(text);
  if (next !== text) await app.vault.modify(file, next);
  return next;
}

async function ensureFolder(app, path) {
  if (app.vault.getFolderByPath(path)) return;
  try { await app.vault.createFolder(path); }
  catch (e) { if (!app.vault.getFolderByPath(path)) throw e; } // lost the race to make it
}

/* Tick (or untick) a practice for the day. Resolves to
     { ok: true, path, prev }   prev = the four flags the name held before
     { ok: false, reason: 'unreadable', key }   a `key:` line Rhythm's parser
        cannot read as a list: the note is left exactly as it was
     { ok: false, reason: 'name' }              a blank name
   and rejects on a real vault error. */
async function tick(app, dateISO, name, on) {
  const nm = String(name).replace(/\r?\n/g, ' ').trim();
  if (!nm) return { ok: false, reason: 'name' };
  const rs = rhythmSettings(app);
  const dir = `${rs.folder}/${FOLDERS.log}`;
  const path = `${dir}/${dateISO}.md`;
  let result = null;
  const apply = text => {
    const r = patchTick(text, nm, on);
    if (r.refuse) { result = { ok: false, reason: 'unreadable', key: r.refuse }; return text; }
    result = { ok: true, path, prev: r.prev };
    return r.text;
  };
  let file = app.vault.getFileByPath(path);
  if (!file) {
    await ensureFolder(app, rs.folder);
    await ensureFolder(app, dir);
    file = app.vault.getFileByPath(path);
  }
  if (file) { await withNoteText(app, file, apply); return result; }
  try {
    await app.vault.create(path, apply('---\nrhythm: log\ndone: []\n---\n'));
  } catch (e) {
    /* Lost the race to create the day's log - another tick (or Rhythm's own
       view) just made it. Process what is there now instead of losing this
       tick. */
    file = app.vault.getFileByPath(path);
    if (!file) throw e;
    await withNoteText(app, file, apply);
  }
  return result;
}

module.exports = { loadRhythm, todayFromRhythm, tick, yamlItem, rhythmSettings, list, heroLines, emptyLabel };
