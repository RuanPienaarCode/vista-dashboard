'use strict';
/* Reminders, from the Nudge plugin.

   Nudge keeps every reminder as one Obsidian Tasks checkbox line in a single
   note, and hangs a store off its plugin instance. So unlike the Budget and
   Gym cards — which re-read another plugin's files because those plugins
   offer nothing else — this one reads AND writes through Nudge's own store.
   That matters most on a tick: `store.toggle` is what rolls a repeating
   reminder forward and leaves the ✅ behind, and re-spelling that rule here
   would be a second copy of something already written down once.

   Vista's share is the part that is Vista's: which handful to put in front of
   you, in what order, and how the date reads. That part is pure and tested.

   Dates are compared as ISO strings, never as local Date objects: a reminder
   due on the 20th is due on the 20th in every timezone. */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/* Nudge's priority vocabulary, so the two apps order a list the same way. */
const RANK = { highest: 5, high: 4, medium: 3, normal: 2, low: 1, lowest: 0 };
const URGENT = new Set(['highest', 'high']);

/* A real calendar date, not just four digits in the right shape: the day has
   to exist in that month and year ('2026-02-30' does not). This is Nudge's own
   check (nudge-vault src/dates.js isISO), copied line for line so the two
   plugins can never disagree on which bucket a malformed due date lands in —
   '2026-13-40' and '2026-02-30' both have the right shape, and Date.UTC would
   quietly normalise them into a real (wrong) date rather than reject them. */
function isISO(s) {
  const m = ISO_RE.exec(String(s || ''));
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}
const rank = p => (RANK[p] === undefined ? RANK.normal : RANK[p]);

function toUTC(iso) {
  const m = ISO_RE.exec(String(iso || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
}

/* Whole days from a to b: negative when b is in the past. */
function diffDays(a, b) {
  const x = toUTC(a), y = toUTC(b);
  if (isNaN(x) || isNaN(y)) return 0;
  return Math.round((y - x) / 86400000);
}

function dow(iso) {
  const t = toUTC(iso);
  return isNaN(t) ? 0 : new Date(t).getUTCDay();
}

function bucketOf(item, today) {
  if (item.done) return 'done';
  if (!isISO(item.due)) return 'someday';
  const n = diffDays(today, item.due);
  if (n < 0) return 'overdue';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n <= 7) return 'week';
  return 'later';
}

/* Priority, then the earlier date, then the earlier time, then the title —
   fully determined, so the card never reshuffles between two renders. */
function sortItems(items) {
  return (items || []).slice().sort((a, b) => {
    const r = rank(b.priority) - rank(a.priority);
    if (r) return r;
    const ad = a.due || '9999-99-99', bd = b.due || '9999-99-99';
    if (ad !== bd) return ad < bd ? -1 : 1;
    const at = a.time || '99:99', bt = b.time || '99:99';
    if (at !== bt) return at < bt ? -1 : 1;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
}

/* How the date reads under the title. Overdue is said in days, because that
   is the thing you actually want to know about a date that has passed. */
function whenLabel(item, today) {
  if (!isISO(item.due)) return 'someday';
  const n = diffDays(today, item.due);
  if (n === 0) return 'due today';
  if (n === 1) return 'tomorrow';
  if (n < 0) return `${-n} day${n === -1 ? '' : 's'} overdue`;
  if (n <= 6) return DAYS[dow(item.due)];
  const m = ISO_RE.exec(item.due);
  const sameYear = String(today).slice(0, 4) === m[1];
  return `${DAYS_SHORT[dow(item.due)]} ${+m[3]} ${MONTHS[+m[2] - 1]}${sameYear ? '' : ' ' + m[1]}`;
}

/* The same thing in a pill's worth of words, in Nudge's own vocabulary so
   the board and the card never call one date two names. */
function shortWhen(item, today) {
  if (!isISO(item.due)) return 'Someday';
  const n = diffDays(today, item.due);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n < 0) return `${-n} days ago`;
  if (n <= 6) return DAYS[dow(item.due)];
  const m = ISO_RE.exec(item.due);
  const sameYear = String(today).slice(0, 4) === m[1];
  return `${DAYS_SHORT[dow(item.due)]} ${+m[3]} ${MONTHS[+m[2] - 1]}${sameYear ? '' : ' ' + m[1]}`;
}

/* The handful to show: everything already due, topped up with what is coming
   next, so a day with nothing overdue still says something useful. */
function summarize(items, today, limit) {
  const open = (items || []).filter(i => !i.done);
  const by = { overdue: [], today: [], tomorrow: [], week: [], later: [], someday: [] };
  for (const i of open) by[bucketOf(i, today)].push(i);
  for (const k of Object.keys(by)) by[k] = sortItems(by[k]);
  const n = Math.max(1, limit || 5);
  const due = [...by.overdue, ...by.today];
  const ahead = [...by.tomorrow, ...by.week, ...by.later];
  const rows = due.slice(0, n);
  if (rows.length < n) rows.push(...ahead.slice(0, n - rows.length));
  return {
    rows,
    buckets: by,
    counts: {
      overdue: by.overdue.length, today: by.today.length, due: due.length,
      ahead: ahead.length, someday: by.someday.length, open: open.length,
    },
    more: Math.max(0, open.length - rows.length),
  };
}

const isUrgent = item => URGENT.has(String(item && item.priority));

/* Nudge files anything ungrouped under an "Inbox" heading, so on a row that
   word means "no section" — it earns none of the width it costs. */
const DEFAULT_GROUP = 'Inbox';

/* The quiet line under the name: where it lives and when in the day, if
   either is worth saying. The date is on the pill, not here. */
function subLabel(item) {
  const it = item || {};
  const group = it.group && it.group !== DEFAULT_GROUP ? it.group : '';
  return [group, it.time].filter(Boolean).join(' · ');
}

const PRIORITY_LABEL = { highest: 'Highest', high: 'High', medium: 'Medium', normal: 'Normal', low: 'Low', lowest: 'Lowest' };

/* "16 Sep 2026" — the long form, for the one place there is room for it. */
function humanDate(iso) {
  const m = ISO_RE.exec(String(iso || ''));
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : '';
}

/* Everything the line carries, in the order it is worth reading. Only what
   is actually set: an empty row says nothing and costs a glance. */
function detailRows(item, today) {
  const it = item || {};
  const rows = [];
  rows.push({ label: 'Due', value: isISO(it.due) ? `${humanDate(it.due)} · ${whenLabel(it, today)}` : 'No date — someday' });
  if (it.time) rows.push({ label: 'Time', value: it.time });
  if (it.priority && it.priority !== 'normal') rows.push({ label: 'Priority', value: PRIORITY_LABEL[it.priority] || it.priority });
  /* The repeat rule is shown as the line spells it, rather than re-worded
     here — Nudge owns that vocabulary. */
  if (it.repeat) rows.push({ label: 'Repeats', value: String(it.repeat) });
  if (it.group) rows.push({ label: 'Section', value: it.group });
  if (it.tags && it.tags.length) rows.push({ label: it.tags.length === 1 ? 'Tag' : 'Tags', value: it.tags.join(' ') });
  if (it.start) rows.push({ label: 'Starts', value: humanDate(it.start) });
  if (it.scheduled) rows.push({ label: 'Scheduled', value: humanDate(it.scheduled) });
  if (it.done) rows.push({ label: 'Done', value: it.doneDate ? humanDate(it.doneDate) : 'yes' });
  return rows;
}

/* A stable key for one reminder while the card waits for the write. */
const keyOf = item => `${item && item.line}:${item && item.raw}`;

/* ---- the Nudge plugin, when it is there -------------------------------- */

function nudgePlugin(app) {
  try {
    const all = app && app.plugins && app.plugins.plugins;
    /* Nudge's id is nudge-reminders; plain `nudge` is someone else's plugin. */
    const p = all && all['nudge-reminders'];
    return p || null;
  } catch (e) { return null; }
}

/* Nudge's store is the seam: everything below goes through it, and nothing
   here touches the reminders note directly. */
function nudgeStore(app) {
  const p = nudgePlugin(app);
  const s = p && p.store;
  return s && typeof s.load === 'function' && typeof s.path === 'function' ? s : null;
}

function nudgePath(app) {
  const s = nudgeStore(app);
  if (!s) return '';
  try { return s.path() || ''; } catch (e) { return ''; }
}

/* The card is shown only once there is a note to read: an empty dashboard
   slot is worse than no slot. */
function nudgeAvailable(app) {
  const p = nudgePath(app);
  if (!p) return false;
  try { return !!app.vault.getFileByPath(p); } catch (e) { return false; }
}

async function loadReminders(app, today, limit) {
  const store = nudgeStore(app);
  if (!store) return { available: false, rows: [], buckets: null, counts: null, more: 0, path: '' };
  const { items } = await store.load();
  return Object.assign({ available: true, path: nudgePath(app) }, summarize(items, today, limit));
}

/* Ticking goes through Nudge so a repeating reminder rolls forward. The
   store's result carries WHY a tick did not happen — a repeat whose next
   date it could not work out is left open on purpose rather than silently
   ending the series (`{ ok: false, reason: 'repeat', repeat }`). Collapsing
   that to a bare boolean, as this used to, threw the reason away before
   dashboard.js ever saw it, so every refusal read as "line not found". */
/* Vista's rows come from its last load. If the reminder was ticked somewhere
   else since (Nudge's board, another device), handing that old item to the
   store is dangerous: its locate() falls back to "same title, same state" and
   would find the occurrence the roll-forward just created — so this tick would
   complete the NEXT one too. So re-read first and act only on a line that is
   still exactly what the row showed (same line number, identical raw text),
   passing the store its own fresh object. Anything else is 'changed': the
   caller says so and the user looks at the note. */
async function freshItem(store, item) {
  const loaded = await store.load();
  const items = loaded && Array.isArray(loaded.items) ? loaded.items : [];
  return items.find(x => x && item && x.line === item.line && x.raw === item.raw) || null;
}

async function tickReminder(app, item, today) {
  const store = nudgeStore(app);
  if (!store || typeof store.toggle !== 'function') return { ok: false };
  const fresh = await freshItem(store, item);
  if (!fresh) return { ok: false, reason: 'changed' };
  const res = await store.toggle(fresh, today);
  return res || { ok: false };
}

/* Snoozing counts from today, not from a due date that has passed — the same
   rule Nudge's own store follows, which is why this only asks it. */
async function snoozeReminder(app, item, days, today) {
  const store = nudgeStore(app);
  if (!store || typeof store.snooze !== 'function') return { ok: false };
  const fresh = await freshItem(store, item);
  if (!fresh) return { ok: false, reason: 'changed' };
  const res = await store.snooze(fresh, days, today);
  return res || { ok: false };
}

/* Why a tick did not happen, in Vista's own words — Nudge's board answers
   the same question for itself (tickRefused() in board.js); this is not
   copied from there, it just never says "could not find" for a refusal
   that was never about a missing line. */
const CHANGED_NOTICE = 'Vista: That reminder changed — open the note.';
function tickRefusedNotice(res) {
  if (res && res.reason === 'changed') return CHANGED_NOTICE;
  if (res && res.reason === 'repeat') return `Vista: Nudge couldn't work out the next date for "🔁 ${res.repeat}" — the reminder is still open.`;
  return "Vista: Nudge couldn't tick that reminder — open the note.";
}

/* The same for a snooze that did not happen. */
function snoozeRefusedNotice(res) {
  if (res && res.reason === 'changed') return CHANGED_NOTICE;
  return 'Vista: Nudge could not find that reminder — open the note.';
}

const canSnooze = app => {
  const store = nudgeStore(app);
  return !!(store && typeof store.snooze === 'function');
};

const SNOOZE = [
  { days: 1, label: 'Tomorrow' },
  { days: 3, label: 'In 3 days' },
  { days: 7, label: 'Next week' },
];

module.exports = {
  isISO, diffDays, dow, rank, bucketOf, sortItems, whenLabel, shortWhen, humanDate, subLabel, detailRows, summarize, isUrgent, keyOf,
  nudgePlugin, nudgeStore, nudgePath, nudgeAvailable, loadReminders, tickReminder, snoozeReminder, tickRefusedNotice, snoozeRefusedNotice, canSnooze,
  PRIORITY_LABEL, SNOOZE, DAYS, DAYS_SHORT, MONTHS,
};
