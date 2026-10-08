'use strict';
/* Tasks due today and overdue, in the Tasks plugin's emoji format
   (`- [ ] text 📅 YYYY-MM-DD`). Pure scan over note texts; toggling goes
   through the Tasks plugin's own API when it is installed. */

const { todayISO } = require('./dates');

/* Optional leading `>` blockquote/callout markers (nested ones too), then
   the usual list marker and checkbox. */
const TASK_RE = /^((?:>\s*)*)(\s*)([-*+]|\d+[.)])\s+\[(.)\]\s+(.*)$/;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const BLOCK_ID_RE = /(\s+\^[^\s]+)\s*$/;

/* Obsidian Tasks (8.4.0, the vault's build) reads a task line from the END:
   it peels one field after another off the tail, in rounds, until nothing
   matches, and whatever is left is the description. A date that is not part
   of that trailing run — `Ask about the 📅 2026-10-01 meeting notes`, or a
   `📅 2026-10-01` followed by a Nudge `⏰ 09:00` — is prose, not a due date.
   These are Tasks' own field regexes (symbol, optional VS16, optional space,
   value, end of line) in Tasks' own order. No `u` flag, like Tasks: every
   quantifier here follows a BMP character or a group, never a bare astral
   emoji. */
const dateField = sym => new RegExp(sym + '\uFE0F? *(\\d{4}-\\d{2}-\\d{2})$');
const ID_CH = '[a-zA-Z0-9\\-_]+';
const FIELD_EXTRACTORS = [
  ['priority', /(🔺|⏫|🔼|🔽|⏬)\uFE0F?$/],
  ['done', dateField('✅')],
  ['cancelled', dateField('❌')],
  ['due', dateField('(?:📅|📆|🗓)')],
  ['scheduled', dateField('(?:⏳|⌛)')],
  ['start', dateField('🛫')],
  ['created', dateField('➕')],
  ['recurrence', /🔁\uFE0F? *([a-zA-Z0-9, !]+)$/],
  ['onCompletion', /🏁\uFE0F? *([a-zA-Z]+)$/],
  ['tag', /(^|\s)#[^ !@#$%^&*(),.?":{}|<>]+$/],
  ['id', new RegExp('🆔\uFE0F? *(' + ID_CH + ')$')],
  ['dependsOn', new RegExp('⛔\uFE0F? *(' + ID_CH + '(?: *, *' + ID_CH + ' *)*)$')],
];
/* Nudge's clock time. Not a Tasks field (so it never helps a due date), but
   on a task Vista is already showing it is not part of the title either. */
const TIME_EXTRACTOR = ['time', /⏰\uFE0F? *\d{1,2}:\d{2}$/];
const BLOCK_LINK_RE = / \^[a-zA-Z0-9-]+$/;

/* Peel the trailing fields. `display` also peels ⏰ HH:MM. Spans are offsets
   into `body` (which is only right-trimmed, so they stay valid). */
function peelFields(body, display) {
  let s = String(body || '').replace(/\s+$/, '');
  const out = { due: null, doneSpans: [], recurring: false, description: '' };
  const bl = BLOCK_LINK_RE.exec(s);
  if (bl) s = s.slice(0, bl.index).replace(/\s+$/, '');
  const extractors = display ? FIELD_EXTRACTORS.concat([TIME_EXTRACTOR]) : FIELD_EXTRACTORS;
  let tags = '', matched, rounds = 0;
  do {
    matched = false;
    for (const [kind, re] of extractors) {
      const m = re.exec(s);
      if (!m) continue;
      if (kind === 'due') out.due = m[1];
      else if (kind === 'done') out.doneSpans.push({ start: m.index, end: m.index + m[0].length });
      else if (kind === 'recurrence') out.recurring = true;
      else if (kind === 'tag') { const t = m[0].trim(); tags = tags ? t + ' ' + tags : t; }
      s = s.slice(0, m.index).replace(/\s+$/, '');
      matched = true;
    }
    rounds++;
  } while (matched && rounds <= 20);
  const desc = s.trim();
  out.description = tags ? (desc ? desc + ' ' : '') + tags : desc;
  return out;
}

/* The display title: description only, trailing fields gone. */
function cleanText(t) {
  return peelFields(t, true).description.replace(/\s{2,}/g, ' ').trim();
}

/* Everything that isn't done (x/X) or cancelled (-) is an open task to the
   Tasks plugin — in-progress (/), question (?), and any other custom
   status all count. */
function isOpenStatus(status) {
  return status !== 'x' && status !== 'X' && status !== '-';
}

/* Walks the lines of a note, skipping fenced code blocks (``` or ~~~, of
   either kind, matched by fence character and length so a shorter nested
   fence of the same kind doesn't close it early), calling cb(lineIndex,
   rawLine, statusChar, body) for every task-shaped line found outside one. */
function eachTaskLine(text, cb) {
  const lines = (text || '').split(/\r?\n/);
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fm = FENCE_RE.exec(line);
    if (fm) {
      const ch = fm[1][0], len = fm[1].length;
      if (!fence) fence = { ch, len };
      else if (ch === fence.ch && len >= fence.len) fence = null;
      continue;
    }
    if (fence) continue;
    const m = TASK_RE.exec(line);
    if (!m) continue;
    cb(i, line, m[4], m[5]);
  }
}

/* texts: Map(path -> text); globalFilter: '' or e.g. '#task';
   skipPaths: notes another card already owns, so one task is never counted
   twice on the same page. */
function scanTasks(texts, today, globalFilter, skipPaths) {
  const overdue = [], due = [];
  const gf = (globalFilter || '').trim();
  for (const [path, text] of texts) {
    if (skipPaths && skipPaths.has(path)) continue;
    eachTaskLine(text, (i, line, status, body) => {
      if (!isOpenStatus(status)) return;
      if (gf && !body.includes(gf)) return;
      const f = peelFields(body, false);
      if (!f.due) return;
      const item = { path, line: i, raw: line, text: cleanText(body), due: f.due, status };
      if (f.due < today) overdue.push(item);
      else if (f.due === today) due.push(item);
    });
  }
  overdue.sort((a, b) => a.due.localeCompare(b.due) || a.path.localeCompare(b.path) || a.line - b.line);
  due.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  return { overdue, due };
}

function daysOverdue(due, today) {
  const p = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(today) - p(due)) / 86400000);
}

/* The Tasks plugin's public API, when present. */
function tasksApi(app) {
  try {
    const p = app.plugins && app.plugins.plugins && app.plugins.plugins['obsidian-tasks-plugin'];
    if (!p) return null;
    const api = typeof p.apiV1 === 'function' ? p.apiV1() : p.apiV1;
    return api && typeof api.executeToggleTaskDoneCommand === 'function' ? api : null;
  } catch (e) { return null; }
}

/* [x] for the given status, keeping everything else in the line byte for
   byte — the fallback path never had a leading/trailing whitespace or
   field-order opinion beyond that. */
function markDone(raw, status) {
  const idx = raw.indexOf('[' + status + ']');
  if (idx < 0) return raw.replace(/\[.\]/, '[x]');
  return raw.slice(0, idx) + '[x]' + raw.slice(idx + 3);
}

/* The done-date field goes before a trailing block id (`^id`), never after
   it — a block id must stay the last thing on the line. An open task that
   already carries a trailing ✅ date gets that date replaced (and any extra
   trailing ✅ removed) rather than a second one added. */
function insertDoneDate(line, iso) {
  const bid = BLOCK_ID_RE.exec(line);
  const head = bid ? line.slice(0, bid.index) : line;
  const tail = bid ? bid[1] : '';
  const spans = peelFields(head, false).doneSpans;
  if (!spans.length) return head + ' ✅ ' + iso + tail;
  /* spans come out right-to-left; the leftmost becomes the new date, the
     rest (a doubled ✅ from an older tick) go, with the space before them */
  let out = head;
  spans.forEach((sp, k) => {
    if (k === spans.length - 1) out = out.slice(0, sp.start) + '✅ ' + iso + out.slice(sp.end);
    else { let st = sp.start; while (st > 0 && /\s/.test(out[st - 1])) st--; out = out.slice(0, st) + out.slice(sp.end); }
  });
  return out + tail;
}

/* A note as lines plus each line's own ending ('\r\n', '\n', or '' for a
   last line that has none), so a rewrite can touch one line and leave every
   other line's ending exactly as it was. joinEol(splitEol(t)) === t. */
function splitEol(text) {
  const parts = String(text || '').split(/(\r?\n)/);
  const lines = [], eols = [];
  for (let i = 0; i < parts.length; i += 2) { lines.push(parts[i]); eols.push(parts[i + 1] || ''); }
  return { lines, eols };
}
function joinEol(lines, eols) {
  let out = '';
  for (let i = 0; i < lines.length; i++) out += lines[i] + (eols[i] || '');
  return out;
}
/* The ending most of the note uses; a tie takes whichever comes first. New
   lines get this one. No line endings at all: LF. */
function dominantEol(eols) {
  let lf = 0, crlf = 0, first = '';
  for (const e of eols) {
    if (e === '\n') lf++; else if (e === '\r\n') crlf++; else continue;
    if (!first) first = e;
  }
  if (crlf > lf) return '\r\n';
  if (lf > crlf) return '\n';
  return first || '\n';
}
/* Replace line `idx` with `pieces`. The old line's ending goes with the last
   piece (so the note's tail is unchanged); earlier pieces take `dom`. */
function replaceLines(lines, eols, idx, pieces, dom) {
  const keep = eols[idx];
  lines.splice(idx, 1, ...pieces);
  eols.splice(idx, 1, ...pieces.map((_, k) => (k === pieces.length - 1 ? keep : dom)));
}
/* Insert `pieces` after line `idx`, each ending in `dom`. When `idx` was the
   unterminated last line it gains `dom` and the new last piece has none, so
   a note with no trailing newline still has none. */
function insertLinesAfter(lines, eols, idx, pieces, dom) {
  const open = eols[idx] === '';
  if (open) eols[idx] = dom;
  lines.splice(idx + 1, 0, ...pieces);
  eols.splice(idx + 1, 0, ...pieces.map((_, k) => (open && k === pieces.length - 1 ? '' : dom)));
}

const REPEAT_MESSAGE = 'This task repeats \u2014 install or enable the Tasks plugin to tick it here, or open the note.';

/* Toggle one task line in place. Resolves to { ok: true } when written, or
   { ok: false, reason, message }:
     'no-file'               the note is gone
     'line-changed'          the line is no longer in the note as scanned
     'recurring-needs-tasks' a 🔁 task and no Tasks API: ticking it here would
                             complete it and silently end the series
     'api-refused'           the Tasks API handed back no line
   app.vault.process does the read-modify-write as one turn, so two tasks
   ticked back to back in the same note don't race and lose one. */
async function toggleTask(app, item) {
  const api = tasksApi(app);
  if (!api && String(item.raw || '').includes('\u{1F501}')) return { ok: false, reason: 'recurring-needs-tasks', message: REPEAT_MESSAGE };
  const file = app.vault.getFileByPath(item.path);
  if (!file) return { ok: false, reason: 'no-file', message: 'That note is gone.' };
  let result = { ok: false, reason: 'line-changed', message: 'That task line has changed \u2014 open the note.' };
  await app.vault.process(file, text => {
    const { lines, eols } = splitEol(text);
    let line = item.line;
    if (lines[line] !== item.raw) {
      const at = lines.indexOf(item.raw);
      if (at < 0) return text;
      line = at;
    }
    let replacement;
    if (api) replacement = api.executeToggleTaskDoneCommand(item.raw, item.path);
    else replacement = insertDoneDate(markDone(item.raw, item.status || ' '), todayISO());
    if (typeof replacement !== 'string') {
      result = { ok: false, reason: 'api-refused', message: 'Tasks could not tick that task.' };
      return text;
    }
    item.line = line;
    replaceLines(lines, eols, line, replacement.split(/\r?\n/), dominantEol(eols));
    result = { ok: true };
    return joinEol(lines, eols);
  });
  return result;
}

module.exports = { scanTasks, cleanText, peelFields, daysOverdue, toggleTask, tasksApi, isOpenStatus, eachTaskLine, splitEol, joinEol, dominantEol, replaceLines, insertLinesAfter, TASK_RE, FENCE_RE };
