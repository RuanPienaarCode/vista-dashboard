'use strict';
/* A stand-in for the Rhythm plugin's headless api that follows the contract
   exactly (app.plugins.plugins.rhythm.api, apiVersion 1). Nothing here is
   Vista code: it plays Rhythm. Every `ref` is opaque to Vista and RE-CHECKED
   here before a write, as the real api does, so a stale row is refused with
   'changed' instead of acting on a different line.

     const { api, plugin, state, emit } = makeRhythm({ reminders, practices, events })
     const app = makeApp(plugin)              // running, with the api
     makeApp(null, { installed: true })       // installed but switched off
*/
const N = require('../src/nudge');

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/* What the real api answers for summary(): the shape Vista's old
   nudge.js summarize(items, today, limit) returned. The stub builds it from
   Vista's own pure helpers; the point is the SHAPE, which the cards read. */
function summarize(items, today, limit) {
  const open = (items || []).filter(i => !i.done);
  const by = { overdue: [], today: [], tomorrow: [], week: [], later: [], someday: [] };
  for (const i of open) by[N.bucketOf(i, today)].push(i);
  for (const k of Object.keys(by)) by[k] = N.sortItems(by[k]);
  const n = Math.max(1, limit || 5);
  const due = [...by.overdue, ...by.today];
  const ahead = [...by.tomorrow, ...by.week, ...by.later];
  const rows = due.slice(0, n);
  if (rows.length < n) rows.push(...ahead.slice(0, n - rows.length));
  return {
    rows, buckets: by,
    counts: { overdue: by.overdue.length, today: by.today.length, due: due.length, ahead: ahead.length, someday: by.someday.length, open: open.length },
    more: Math.max(0, open.length - rows.length),
  };
}

const reminder = (title, f) => Object.assign({ title, done: false, priority: 'normal', due: '', time: '', tags: [], group: '', repeat: '', line: 0, raw: '- [ ] ' + title }, f);

function makeRhythm(init) {
  const o = init || {};
  const state = {
    noteExists: o.noteExists !== false,
    notePath: o.notePath === undefined ? 'Rhythm/Reminders.md' : o.notePath,
    weekStart: o.weekStart === undefined ? 1 : o.weekStart,
    reminders: (o.reminders || []).map((r, i) => Object.assign({}, r, { line: r.line !== undefined ? r.line : i })),
    practices: (o.practices || []).map(p => Object.assign({ area: '', when: '', whenLabel: '', reason: '', done: false }, p)),
    events: (o.events || []).slice(),
    doneThatDay: null,    // a Set of names Rhythm refuses with 'done-that-day'
    unreadable: null,     // set to a key ('done') to make practices.tick refuse as Rhythm does
    repeatStuck: null,    // a repeat string Rhythm "cannot roll forward"
    listeners: new Set(),
  };
  const calls = [];
  const refOf = r => `rem:${r.line}:${r.raw}`;
  const find = ref => state.reminders.find(r => refOf(r) === ref) || null;
  const withRef = r => Object.assign({}, r, { ref: refOf(r) });
  const emit = () => { for (const cb of [...state.listeners]) cb(); };

  const api = {
    apiVersion: 1,
    onChange(cb) { state.listeners.add(cb); calls.push(['onChange']); return () => { state.listeners.delete(cb); calls.push(['unsubscribe']); }; },
    weekStart: () => state.weekStart,
    reminders: {
      notePath: () => state.notePath,
      async summary({ today, limit }) {
        calls.push(['summary', { today, limit }]);
        if (!state.noteExists) return { available: false, path: state.notePath, rows: [], buckets: null, counts: null, more: 0 };
        const s = summarize(state.reminders, today, limit);
        return Object.assign({ available: true, path: state.notePath }, s, {
          rows: s.rows.map(withRef),
          buckets: Object.fromEntries(Object.entries(s.buckets).map(([k, v]) => [k, v.map(withRef)])),
        });
      },
      async toggle(ref, { today }) {
        calls.push(['toggle', ref, { today }]);
        const r = find(ref);
        if (!r) return { ok: false, reason: String(ref).startsWith('rem:') ? 'changed' : 'bad-ref' };
        if (state.repeatStuck && r.repeat === state.repeatStuck) return { ok: false, reason: 'repeat', repeat: r.repeat };
        r.done = true; r.raw = r.raw.replace('- [ ]', '- [x]');   // the old ref is stale from here on
        return { ok: true };
      },
      async snooze(ref, days, { today }) {
        calls.push(['snooze', ref, days, { today }]);
        const r = find(ref);
        if (!r) return { ok: false, reason: String(ref).startsWith('rem:') ? 'changed' : 'bad-ref' };
        const d = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) + days));
        r.due = d.toISOString().slice(0, 10); r.raw = r.raw + ' snoozed';
        return { ok: true };
      },
    },
    practices: {
      async today({ date }) {
        calls.push(['today', { date }]);
        if (!state.practices.length) return { available: false, focus: [], later: 0, done: 0, date, folder: 'Rhythm' };
        const done = state.practices.filter(p => p.done).length;
        return {
          available: true,
          focus: state.practices.map(p => ({ name: p.name, area: p.area, when: p.when, whenLabel: p.whenLabel, reason: p.reason, path: `Rhythm/Practices/${p.name}.md`, done: p.done, ref: `pr:${date}:${p.name}` })),
          later: 0, done, total: state.practices.length, date, folder: 'Rhythm',
          streak: 3, streakLabel: '3-day streak',
        };
      },
      async tick(ref, on) {
        calls.push(['tick', ref, on]);
        const m = /^pr:(\d{4}-\d{2}-\d{2}):(.*)$/.exec(String(ref));
        if (!m) return { ok: false, reason: 'bad-ref' };
        if (!m[2].trim()) return { ok: false, reason: 'name' };
        if (state.doneThatDay && state.doneThatDay.has(m[2])) return { ok: false, reason: 'done-that-day' };
        const p = state.practices.find(x => x.name === m[2]);
        if (!p) return { ok: false, reason: 'changed' };
        if (state.unreadable) return { ok: false, reason: 'unreadable', key: state.unreadable };
        const prev = { done: p.done, skip: false, snooze: false, plan: false };
        p.done = !!on;
        return { ok: true, prev };
      },
    },
    events: {
      async between(from, to) {
        calls.push(['between', from, to]);
        if (!ISO.test(from) || !ISO.test(to)) return [];
        return state.events.filter(e => e.date >= from && e.date <= to).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
      },
    },
  };
  return { api, plugin: { api }, state, calls, emit };
}

/* An app with the Rhythm plugin running (`plugin`), or only installed
   (`installed: true`, plugin null: switched off), or not there at all. */
function makeApp(plugin, opts) {
  const o = opts || {};
  return {
    plugins: {
      plugins: plugin ? { rhythm: plugin } : {},
      manifests: (plugin || o.installed) ? { rhythm: { id: 'rhythm' } } : {},
    },
  };
}

module.exports = { makeRhythm, makeApp, reminder, summarize };
