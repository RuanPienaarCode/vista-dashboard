'use strict';
/* Vista's window onto the Rhythm plugin's practices: which are due today, and
   a tick that Rhythm writes into its own log.

   Both go through Rhythm's headless API (src/rhythm-api.js,
   app.plugins.plugins.rhythm.api): api.practices.today() is the plan Rhythm's
   own model works out, api.practices.tick() is Rhythm's own writer. Vista
   reads no note and parses no frontmatter - the vendored copies of Rhythm's
   parser and model this file used to carry are gone, along with the drift
   they could have had. What is left is Vista's share: the words. */

const { cannot, result } = require('./rhythm-api');

/* Rhythm's hero words (page-today.js renderToday), for the three states of
   the day. Those words live inline in Rhythm's view, not in anything its api
   returns, so they are mirrored here (and pinned in tests/rhythm.test.cjs).
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

/* { available, focus: [{ name, area, when, whenLabel, reason, path, done, ref }],
     later, done, total, date, folder, streak, streakLabel } - exactly what
   Rhythm's api.practices.today answers; a thin answer is padded, not read. */
async function todayFromRhythm(api, dateISO) {
  if (!api || !api.practices || typeof api.practices.today !== 'function') return { available: false, focus: [], later: 0, done: 0, date: dateISO };
  const t = (await api.practices.today({ date: dateISO })) || {};
  return Object.assign({}, t, {
    available: !!t.available,
    focus: Array.isArray(t.focus) ? t.focus : [],
    later: t.later || 0,
    done: t.done || 0,
    date: t.date || dateISO,
  });
}

/* Tick (or untick) a practice for today. `row` is a focus row as Rhythm gave
   it: its opaque `ref` goes straight back, and Rhythm re-checks it before it
   writes. Resolves to { ok:true, prev } or { ok:false, reason:
   'unreadable' | 'done-that-day' | 'changed' | 'name' | 'bad-ref', key? }; rejects on a real error. */
async function tickPractice(api, row, on) {
  if (!api || !api.practices || typeof api.practices.tick !== 'function') return cannot('unavailable');
  if (!row || !row.ref) return cannot('bad-ref');
  return result(await api.practices.tick(row.ref, !!on));
}

module.exports = { todayFromRhythm, tickPractice, heroLines, emptyLabel };
