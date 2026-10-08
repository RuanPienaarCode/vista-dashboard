'use strict';
/* Local-date helpers on ISO 'YYYY-MM-DD' strings. Pure; no Date parsing of
   ISO strings via the Date constructor (that reads them as UTC and shifts
   the day in any timezone east or west of Greenwich). */

const pad = n => (n < 10 ? '0' : '') + n;

function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

const isISO = s => !!fromISO(s);

function todayISO(now) {
  return toISO(now instanceof Date ? now : new Date());
}

function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/* Days from a to b (b - a). */
function diffDays(a, b) {
  const da = fromISO(a), db = fromISO(b);
  return Math.round((db - da) / 86400000);
}

/* 0 = Sunday … 6 = Saturday. */
const weekday = iso => fromISO(iso).getDay();

/* Monday-start by default; weekStart=0 for Sunday. */
function weekStart(iso, start = 1) {
  const wd = weekday(iso);
  const back = (wd - start + 7) % 7;
  return addDays(iso, -back);
}

function weekDays(iso, start = 1) {
  const s = weekStart(iso, start);
  const out = [];
  for (let i = 0; i < 7; i++) out.push(addDays(s, i));
  return out;
}

const monthKey = iso => (iso || '').slice(0, 7);
const monthStart = iso => `${monthKey(iso)}-01`;

function daysInMonth(iso) {
  const d = fromISO(monthStart(iso));
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function monthDays(iso) {
  const start = monthStart(iso);
  const n = daysInMonth(iso);
  const out = [];
  for (let i = 0; i < n; i++) out.push(addDays(start, i));
  return out;
}

function addMonths(iso, n) {
  const d = fromISO(monthStart(iso));
  d.setMonth(d.getMonth() + n);
  return toISO(d);
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const dayKey = iso => DAY_KEYS[weekday(iso)];

/* 'Friday 12 September' */
function fmtLong(iso) {
  const d = fromISO(iso);
  if (!d) return '';
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/* 'Fri 12' */
function fmtShort(iso) {
  const d = fromISO(iso);
  if (!d) return '';
  return `${DAY_NAMES[d.getDay()].slice(0, 3)} ${d.getDate()}`;
}

/* '12 Sep' */
function fmtDay(iso) {
  const d = fromISO(iso);
  if (!d) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
}

/* 'September 2026' */
function fmtMonth(iso) {
  const d = fromISO(monthStart(iso));
  if (!d) return '';
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/* A horizon is 'YYYY-MM' or 'YYYY-MM-DD'; normalise to the last day it
   covers so "by September" sorts after "by 3 September". */
function horizonEnd(h) {
  if (!h) return null;
  const s = String(h);
  if (isISO(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) {
    const first = `${s}-01`;
    return addDays(first, daysInMonth(first) - 1);
  }
  return null;
}

/* Relative phrasing for a date seen from `from`: today, tomorrow, in 3
   days, Sat 20 Sep. */
function relative(iso, from) {
  const n = diffDays(from, iso);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return DAY_NAMES[weekday(iso)];
  return fmtDay(iso);
}

module.exports = {
  toISO, fromISO, isISO, todayISO, addDays, diffDays, weekday, weekStart, weekDays,
  monthKey, monthStart, daysInMonth, monthDays, addMonths, dayKey, DAY_KEYS, DAY_NAMES, MONTHS,
  fmtLong, fmtShort, fmtDay, fmtMonth, horizonEnd, relative,
};
