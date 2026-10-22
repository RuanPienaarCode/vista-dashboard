'use strict';
/* Reminders: how Vista shows them.

   Reminders live in the Rhythm plugin (the Nudge plugin is merged into it).
   Reading, ticking and snoozing go through Rhythm's headless API - see
   src/rhythm-api.js - so this file does no I/O at all. What is left is
   Vista's share: how the date reads, which bucket a reminder falls in, the
   order of a list, the words on a refusal. Pure and tested. The file keeps
   its old name; what it describes is Rhythm's reminders.

   Dates are compared as ISO strings, never as local Date objects: a reminder
   due on the 20th is due on the 20th in every timezone. */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/* Rhythm's reminder priority vocabulary (Nudge's, carried over), so the two order a list the same way. */
const RANK = { highest: 5, high: 4, medium: 3, normal: 2, low: 1, lowest: 0 };
const URGENT = new Set(['highest', 'high']);

/* A real calendar date, not just four digits in the right shape: the day has
   to exist in that month and year ('2026-02-30' does not). This is Nudge's own
   check (nudge-vault src/dates.js isISO), copied line for line so Vista and
   Rhythm cannot disagree on which bucket a malformed due date lands in —
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

const isUrgent = item => URGENT.has(String(item && item.priority));

/* Reminders carry anything ungrouped under an "Inbox" heading, so on a row that
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
     here — Rhythm owns that vocabulary. */
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

/* Why a tick did not happen, in Vista's own words. Rhythm's api says WHY
   ({ ok:false, reason }): 'changed' is not "could not find", and a repeat it
   could not roll forward is left open on purpose, not lost. */
const CHANGED_NOTICE = 'Vista: That reminder changed — open the note.';
const MISSING_NOTICE = 'Vista: That reminder is no longer in the note — open it to see.';
const UNAVAILABLE_NOTICE = "Vista: Rhythm's reminders aren't available right now — open Rhythm.";
function tickRefusedNotice(res) {
  if (res && res.reason === 'changed') return CHANGED_NOTICE;
  if (res && (res.reason === 'missing' || res.reason === 'bad-ref')) return MISSING_NOTICE;
  if (res && res.reason === 'unavailable') return UNAVAILABLE_NOTICE;
  if (res && res.reason === 'repeat') return `Vista: Rhythm couldn't work out the next date for "🔁 ${res.repeat}" — the reminder is still open.`;
  return "Vista: Rhythm couldn't tick that reminder — open the note.";
}

/* The same for a snooze that did not happen. */
function snoozeRefusedNotice(res) {
  if (res && res.reason === 'changed') return CHANGED_NOTICE;
  if (res && (res.reason === 'missing' || res.reason === 'bad-ref')) return MISSING_NOTICE;
  if (res && res.reason === 'unavailable') return UNAVAILABLE_NOTICE;
  return 'Vista: Rhythm could not snooze that reminder — open the note.';
}

const SNOOZE = [
  { days: 1, label: 'Tomorrow' },
  { days: 3, label: 'In 3 days' },
  { days: 7, label: 'Next week' },
];

module.exports = {
  isISO, diffDays, dow, rank, bucketOf, sortItems, whenLabel, shortWhen, humanDate, subLabel, detailRows, isUrgent, keyOf,
  tickRefusedNotice, snoozeRefusedNotice,
  PRIORITY_LABEL, SNOOZE, DAYS, DAYS_SHORT, MONTHS,
};
