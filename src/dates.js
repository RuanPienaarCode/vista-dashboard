'use strict';
/* Dates, greetings and relative time. Pure. */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function pad(n) { return (n < 10 ? '0' : '') + n; }

function todayISO(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return todayISO(dt);
}

function greeting(hour) {
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 22) return 'Good evening';
  return 'Good night';
}

function isNight(hour) { return hour < 6 || hour >= 19; }

function fmtDate(d) { return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`; }

function fmtTime(d, h24) {
  let h = d.getHours();
  const m = pad(d.getMinutes());
  if (h24) return pad(h) + ':' + m;
  const suffix = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return h + ':' + m + ' ' + suffix;
}

function relTime(ms, now) {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 45) return 'just now';
  const m = s / 60;
  if (m < 60) return Math.round(m) + 'm ago';
  const h = m / 60;
  if (h < 24) return Math.round(h) + 'h ago';
  const d = h / 24;
  if (d < 2) return 'yesterday';
  if (d < 7) return Math.round(d) + 'd ago';
  if (d < 30) return Math.round(d / 7) + 'w ago';
  if (d < 365) return Math.round(d / 30) + 'mo ago';
  return Math.round(d / 365) + 'y ago';
}

/* FNV-1a, for stable "same photo all day" picks. */
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

module.exports = { todayISO, addDays, greeting, isNight, fmtDate, fmtTime, relTime, hashStr, pad };
