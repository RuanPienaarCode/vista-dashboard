'use strict';
/* What happens when something on the dashboard is clicked. Every call goes
   through the public vault/workspace API; the two undocumented seams
   (app.commands, internalPlugins global search) are guarded and fall back. */

const { Notice, normalizePath } = require('obsidian');
const { todayISO, pad } = require('./dates');
const { splitEol, joinEol, dominantEol, insertLinesAfter } = require('./tasks');

function openMode(settings) { return settings.openIn === 'same' ? false : 'tab'; }

/* A folder or file path typed into a setting or a tile: trimmed, then run
   through Obsidian's own normalizePath (doubled and leading/trailing slashes,
   non-breaking spaces, NFC). Empty and '/' both mean the vault root and come
   back as ''. */
function typedPath(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  const n = normalizePath(t);
  return n === '/' ? '' : n;
}

function resolveNote(app, target) {
  const t = (target || '').trim();
  if (!t) return null;
  let f = null;
  try { f = app.metadataCache.getFirstLinkpathDest(t.replace(/\.md$/, ''), ''); } catch (e) { f = null; }
  if (!f) {
    const p = typedPath(t);
    f = p ? (app.vault.getFileByPath(p) || app.vault.getFileByPath(p + '.md')) : null;
  }
  return f || null;
}

async function openFile(app, settings, file, forceMode) {
  const leaf = app.workspace.getLeaf(forceMode !== undefined ? forceMode : openMode(settings));
  await leaf.openFile(file);
}

async function openNote(app, settings, target, forceMode) {
  const f = resolveNote(app, target);
  if (!f) { new Notice(`Vista: can't find "${target}".`); return false; }
  await openFile(app, settings, f, forceMode);
  return true;
}

function runCommand(app, id) {
  let ok = false;
  try { ok = !!(app.commands && app.commands.executeCommandById && app.commands.executeCommandById(id)); } catch (e) { ok = false; }
  if (!ok) new Notice(`Vista: the command "${id}" isn't available. Is its plugin enabled?`);
  return ok;
}

function openGlobalSearch(app, query) {
  try {
    const gs = app.internalPlugins && app.internalPlugins.getEnabledPluginById && app.internalPlugins.getEnabledPluginById('global-search');
    if (gs && typeof gs.openGlobalSearch === 'function') { gs.openGlobalSearch(query || ''); return true; }
  } catch (e) { /* fall through */ }
  return runCommand(app, 'global-search:open');
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* moment's day-of-month ordinal: 1st, 2nd, 3rd, 4th... 11th, 12th, 13th
   (the teens are always -th, not -st/-nd/-rd), 21st, 22nd, 23rd, 24th... */
function ordinal(n) {
  if (n % 100 >= 11 && n % 100 <= 13) return n + 'th';
  switch (n % 10) {
    case 1: return n + 'st';
    case 2: return n + 'nd';
    case 3: return n + 'rd';
    default: return n + 'th';
  }
}

const DAY_MS = 86400000;
/* whole days since the epoch for a calendar date — no timezone or DST in it */
function dayNumber(y, m, d) { return Math.round(Date.UTC(y, m, d) / DAY_MS); }
function yearOfDay(n) { return new Date(n * DAY_MS).getUTCFullYear(); }

/* ISO 8601 week (moment's W / WW / GGGG): weeks start Monday, week 1 holds
   the year's first Thursday, and a week belongs to its Thursday's year. */
function isoWeek(d) {
  const n = dayNumber(d.getFullYear(), d.getMonth(), d.getDate());
  const thursday = n - ((d.getDay() + 6) % 7) + 3;
  const year = yearOfDay(thursday);
  return { year, week: Math.floor((thursday - dayNumber(year, 0, 1)) / 7) + 1 };
}

/* Locale week for moment's default `en` locale (w / ww / gggg): weeks start
   Sunday, and week 1 is the week holding 1 January, so a week belongs to
   the year its Saturday falls in. (A different Obsidian language changes
   moment's week rules; the core Templates plugin follows that, this doesn't.) */
function localeWeek(d) {
  const n = dayNumber(d.getFullYear(), d.getMonth(), d.getDate());
  const saturday = n - d.getDay() + 6;
  const year = yearOfDay(saturday);
  const jan1 = dayNumber(year, 0, 1);
  const firstSaturday = jan1 + ((6 - new Date(jan1 * DAY_MS).getUTCDay() + 7) % 7);
  return { year, week: Math.floor((saturday - firstSaturday) / 7) + 1 };
}

/* The subset of moment tokens the core Templates plugin users reach for.
   `[literal]` escapes a run of text (moment's own escape syntax) so it is
   never mistaken for a token — tried first in the alternation, and `Do`
   before the bare `D` it would otherwise be swallowed by. */
function formatToken(fmt, d) {
  return fmt.replace(/\[[^\]]*\]|YYYY|YY|GGGG|gggg|MMMM|MMM|MM|M|DD|Do|D|dddd|ddd|HH|H|hh|h|mm|ss|WW|W|ww|w|Q|A|a/g, tok => {
    if (tok[0] === '[') return tok.slice(1, -1);
    switch (tok) {
      case 'Q': return String(Math.floor(d.getMonth() / 3) + 1);
      case 'W': return String(isoWeek(d).week);
      case 'WW': return pad(isoWeek(d).week);
      case 'GGGG': return String(isoWeek(d).year);
      case 'w': return String(localeWeek(d).week);
      case 'ww': return pad(localeWeek(d).week);
      case 'gggg': return String(localeWeek(d).year);
      case 'YYYY': return String(d.getFullYear());
      case 'YY': return String(d.getFullYear()).slice(2);
      case 'MMMM': return MONTHS[d.getMonth()];
      case 'MMM': return MONTHS[d.getMonth()].slice(0, 3);
      case 'MM': return pad(d.getMonth() + 1);
      case 'M': return String(d.getMonth() + 1);
      case 'DD': return pad(d.getDate());
      case 'Do': return ordinal(d.getDate());
      case 'D': return String(d.getDate());
      case 'dddd': return DAYS[d.getDay()];
      case 'ddd': return DAYS[d.getDay()].slice(0, 3);
      case 'HH': return pad(d.getHours());
      case 'H': return String(d.getHours());
      case 'hh': return pad(d.getHours() % 12 || 12);
      case 'h': return String(d.getHours() % 12 || 12);
      case 'mm': return pad(d.getMinutes());
      case 'ss': return pad(d.getSeconds());
      case 'A': return d.getHours() >= 12 ? 'PM' : 'AM';
      case 'a': return d.getHours() >= 12 ? 'pm' : 'am';
      default: return tok;
    }
  });
}

function fillTemplate(text, d, title) {
  return (text || '')
    .replace(/\{\{\s*title\s*\}\}/g, title)
    .replace(/\{\{\s*date\s*:\s*([^}]+)\}\}/g, (m, f) => formatToken(f.trim(), d))
    .replace(/\{\{\s*time\s*:\s*([^}]+)\}\}/g, (m, f) => formatToken(f.trim(), d))
    .replace(/\{\{\s*date\s*\}\}/g, formatToken('YYYY-MM-DD', d))
    .replace(/\{\{\s*time\s*\}\}/g, formatToken('HH:mm', d));
}

async function openDaily(app, settings) { return openDailyFor(app, settings, todayISO(new Date())); }

/* Which of two notes named <iso>.md under the journal folder is THE day's
   note: the flat path <folder>/<iso>.md, then the shortest path, then
   alphabetical — so the answer never depends on the order the vault lists
   its files in (which differs per device and per load). */
function betterDaily(a, b, flat) {
  const ra = a.path === flat ? 0 : 1, rb = b.path === flat ? 0 : 1;
  if (ra !== rb) return ra < rb;
  if (a.path.length !== b.path.length) return a.path.length < b.path.length;
  return a.path < b.path;
}

/* Is this file a journal note for some day under `dir` (already cleaned)?
   Under a folder: any note named <iso>.md anywhere below it. With no folder
   set: only the root <iso>.md. */
function dailyIso(f, dir) {
  if (!f || f.extension !== 'md') return null;
  const m = /^(\d{4}-\d{2}-\d{2})$/.exec(f.basename || '');
  if (!m) return null;
  const flat = (dir ? dir + '/' : '') + m[1] + '.md';
  if (dir ? !f.path.startsWith(dir + '/') : f.path !== flat) return null;
  return m[1];
}

/* The one note for `iso` among `files`, or null. ensureDaily (Today tile,
   capture, calendar taps) and the calendar's day dots both use this rule. */
function pickDailyNote(files, folder, iso) {
  const dir = typedPath(folder);
  const flat = (dir ? dir + '/' : '') + iso + '.md';
  let best = null;
  for (const f of files || []) {
    if (dailyIso(f, dir) !== iso) continue;
    if (!best || betterDaily(f, best, flat)) best = f;
  }
  return best;
}

/* Every journal day at once: Map(iso -> the note pickDailyNote would pick). */
function journalDays(files, folder) {
  const dir = typedPath(folder);
  const days = new Map();
  for (const f of files || []) {
    const iso = dailyIso(f, dir);
    if (!iso) continue;
    const cur = days.get(iso);
    if (!cur || betterDaily(f, cur, (dir ? dir + '/' : '') + iso + '.md')) days.set(iso, f);
  }
  return days;
}

/* Create a folder unless it is there. Two overlapping first-time callers
   both see "no folder", and the loser's createFolder throws "Folder already
   exists." — if the folder is there now, that is success. */
async function ensureFolder(app, folder) {
  if (!folder || app.vault.getFolderByPath(folder)) return;
  try { await app.vault.createFolder(folder); }
  catch (e) { if (!app.vault.getFolderByPath(folder)) throw e; }
}

/* The journal note for a day, created from the template if needed. */
async function ensureDaily(app, settings, isoIn) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoIn || '');
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
  const iso = todayISO(d);
  const folder = typedPath(settings.journalFolder);
  const path = (folder ? folder + '/' : '') + iso + '.md';
  let f = app.vault.getFileByPath(path);
  /* the calendar already treats any note named <iso>.md anywhere under the
     journal folder as that day's note — match the same convention here so
     a differently-organised (e.g. year/month) journal doesn't get a second,
     duplicate note created for the same day. */
  if (!f && folder) f = pickDailyNote(app.vault.getFiles(), folder, iso);
  if (!f) {
    let body = '';
    const tp = typedPath(settings.journalTemplate);
    const tpl = tp ? (app.vault.getFileByPath(tp) || app.vault.getFileByPath(tp + '.md')) : null;
    if (tpl) body = fillTemplate(await app.vault.cachedRead(tpl), d, iso);
    await ensureFolder(app, folder);
    try {
      f = await app.vault.create(path, body);
    } catch (e) {
      /* two overlapping calls (e.g. two Vista views) both found no file and
         both tried to create it — the loser re-fetches instead of failing. */
      f = app.vault.getFileByPath(path);
      if (!f) throw e;
    }
  }
  return f;
}

/* Open (creating from the template if needed) the journal note for a day. */
async function openDailyFor(app, settings, iso) {
  const f = await ensureDaily(app, settings, iso);
  await openFile(app, settings, f);
}

const CAPTURE_HEADING_LEVEL = 2;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

/* A heading's text, tolerant of the trailing punctuation/space real notes
   carry ("## Notes:", "## Notes "). */
function normHeading(s) {
  return s.trim().replace(/[:\s]+$/, '').toLowerCase();
}

/* Which lines are inside fenced code, or are the fence lines themselves
   (``` or ~~~, closed by the same character and at least the same length).
   One walk, shared by the heading lookup and the section-end scan, so the
   two can never disagree about what is code. */
function fenceMask(lines) {
  const mask = new Array(lines.length).fill(false);
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const fm = FENCE_RE.exec(lines[i]);
    if (fm) {
      const ch = fm[1][0], len = fm[1].length;
      if (!fence) fence = { ch, len };
      else if (ch === fence.ch && len >= fence.len) fence = null;
      mask[i] = true;
    } else if (fence) mask[i] = true;
  }
  return mask;
}

/* Heading lines outside fenced code, in document order — a "# Notes"
   inside a ```code block``` is not a heading and must never be matched. */
function headingLines(lines, mask) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (mask[i]) continue;
    const hm = HEADING_RE.exec(lines[i]);
    if (hm) out.push({ index: i, level: hm[1].length, text: hm[2] });
  }
  return out;
}

/* The last non-blank line of the section under the heading at `hIdx` — it
   ends at the next heading outside fenced code (a `# comment` inside a code
   block is not one), and a code block under the heading is part of it. */
function sectionLastLine(lines, mask, hIdx) {
  let last = hIdx;
  for (let i = hIdx + 1; i < lines.length; i++) {
    if (!mask[i] && /^#{1,6}\s+/.test(lines[i])) break;
    if (lines[i].trim() !== '') last = i;
  }
  return last;
}

/* Where a captured line goes inside a note: after the last line of the
   list under `## <heading>` — that level first, so an H1 page title of the
   same name is never mistaken for it; then the first same-named heading at
   any deeper level (a template that uses `### Notes`); the first match wins.
   With no such heading the section is created at the end of the note
   (`## <heading>`, a blank line, the bullet) and later captures join its
   list with no blank lines between bullets. Every existing line keeps its
   own line ending; new lines take the note's dominant one. Pure. */
function insertCapture(text, heading, line) {
  const { lines, eols } = splitEol(text);
  const dom = dominantEol(eols);
  const want = normHeading(heading || '');
  if (want) {
    const mask = fenceMask(lines);
    const named = headingLines(lines, mask).filter(hh => normHeading(hh.text) === want);
    const h = named.find(hh => hh.level === CAPTURE_HEADING_LEVEL) || named.find(hh => hh.level > 1);
    if (h) {
      const last = sectionLastLine(lines, mask, h.index);
      /* an empty template bullet ("-") is replaced rather than left dangling */
      if (last > h.index && /^\s*[-*+]\s*$/.test(lines[last])) { lines[last] = line; return joinEol(lines, eols); }
      insertLinesAfter(lines, eols, last, last === h.index ? ['', line] : [line], dom);
      return joinEol(lines, eols);
    }
  }
  while (lines.length && lines[lines.length - 1].trim() === '') { lines.pop(); eols.pop(); }
  const pieces = [];
  if (want) {
    if (lines.length) pieces.push('');
    pieces.push('#'.repeat(CAPTURE_HEADING_LEVEL) + ' ' + String(heading).trim(), '', line);
  } else {
    /* no heading configured: a bullet joins a list that ends the note, anything else gets a blank line */
    if (lines.length && !/^\s*(?:[-*+]|\d+[.)])\s/.test(lines[lines.length - 1])) pieces.push('');
    pieces.push(line);
  }
  if (lines.length && eols[eols.length - 1] === '') eols[eols.length - 1] = dom;
  for (const p of pieces) { lines.push(p); eols.push(dom); }
  return joinEol(lines, eols);
}

/* Append one line to today's journal note. app.vault.process does the
   read-modify-write as one turn, so two overlapping captures (or a capture
   racing a task toggle) into the same note don't lose one to the other. */
async function captureToJournal(app, settings, text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const f = await ensureDaily(app, settings, todayISO(new Date()));
  const now = new Date();
  const stamp = settings.captureTimestamp !== false ? `**${pad(now.getHours())}:${pad(now.getMinutes())}** ` : '';
  const line = `- ${stamp}${t}`;
  await app.vault.process(f, cur => insertCapture(cur, settings.captureHeading || 'Notes', line));
  return f;
}

/* The only schemes a link tile may open. An allowlist, so `javascript:`,
   `data:`, `file:` and anything else never reach window.open. */
const SAFE_URL_RE = /^(?:https?|obsidian|mailto):/i;

async function runTile(app, settings, tile, forceMode) {
  try {
    switch (tile.kind) {
      case 'note': return openNote(app, settings, tile.target, forceMode);
      case 'command': return runCommand(app, tile.target);
      case 'daily': await openDaily(app, settings); return true;
      case 'search': return openGlobalSearch(app, tile.target);
      case 'url': {
        /* validateTile checked this when the tile was edited, but data.json
           can be hand-edited (or synced from elsewhere): re-check at run time. */
        const url = String(tile.target || '').trim();
        if (!SAFE_URL_RE.test(url)) { new Notice('Vista: that link isn\'t allowed. Only web, obsidian: and mailto: links open from a tile.'); return false; }
        window.open(url);
        return true;
      }
      default: return false;
    }
  } catch (e) {
    console.error('vista tile', e);
    new Notice('Vista: that didn\'t open. See the console for why.');
    return false;
  }
}

module.exports = { openMode, resolveNote, openFile, openNote, runCommand, openGlobalSearch, openDaily, openDailyFor, ensureDaily, pickDailyNote, journalDays, captureToJournal, insertCapture, runTile, fillTemplate, formatToken };
