'use strict';
/* A month grid for the header calendar. Pure. */

const { addDays, todayISO } = require('./dates');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function fromISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

function monthKey(iso) { return (iso || '').slice(0, 7); }
function monthLabel(iso) { const d = fromISO(iso.slice(0, 7) + '-01'); return d ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : ''; }

function shiftMonth(iso, n) {
  const d = fromISO(iso.slice(0, 7) + '-01');
  d.setMonth(d.getMonth() + n);
  return todayISO(d);
}

/* Weekday header in display order. weekStart 1 = Monday, 0 = Sunday. */
function weekdayRow(weekStart) {
  const out = [];
  for (let i = 0; i < 7; i++) out.push(DAY_SHORT[(weekStart + i) % 7]);
  return out;
}

/* Six rows (always, so the popover never changes height) of seven days,
   covering the month that contains `iso`. */
function monthGrid(iso, weekStart, today) {
  const key = monthKey(iso);
  const first = fromISO(key + '-01');
  const back = (first.getDay() - weekStart + 7) % 7;
  let cursor = addDays(key + '-01', -back);
  const t = today || todayISO();
  const rows = [];
  for (let r = 0; r < 6; r++) {
    const row = [];
    for (let c = 0; c < 7; c++) {
      row.push({ iso: cursor, day: Number(cursor.slice(8, 10)), inMonth: monthKey(cursor) === key, isToday: cursor === t, future: cursor > t });
      cursor = addDays(cursor, 1);
    }
    rows.push(row);
  }
  return rows;
}

module.exports = { monthGrid, weekdayRow, monthLabel, shiftMonth, monthKey, MONTHS };
