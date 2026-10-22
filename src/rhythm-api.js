'use strict';
/* Vista's one door to planner data: the Rhythm plugin's versioned headless
   API, app.plugins.plugins.rhythm.api (apiVersion 1).

   Reminders, practices, events and the week start all live in Rhythm now.
   Vista reads and writes them ONLY through this API. It opens no planner
   note, reads no Rhythm/ file and asks the metadata cache nothing about
   them: Rhythm owns the parsers, the writers and the rules (rolling a repeat
   forward, a streak's wording), and checks every `ref` it handed out before
   it writes. Vista's share is display words and layout.

   Unlike the Budget card there is NO fallback reader. Without a usable api
   there is nothing to show, and rhythmStatus() says which kind of nothing:
     absent    Rhythm is not installed. The Reminders and "Today, from
               Rhythm" cards are hidden - there is nothing to be unavailable.
     disabled  installed, not running. The cards say so.
     no-api    running, but with no api or one of another version (an older
               release, or a newer one). The cards say so.
     ready     a usable api; `api` is the instance.

   The wrappers below only normalise what the API promised (a missing field
   becomes an empty one) so a card never throws on a thin answer. They do not
   interpret it. */

const PLUGIN_ID = 'rhythm';

/* The api, or null. Version-gated on apiVersion rather than a feature-sniff:
   a future incompatible shape bumps the number. */
function getRhythmApi(app) {
  const plugins = app && app.plugins && app.plugins.plugins;
  const plugin = plugins && plugins[PLUGIN_ID];
  const api = plugin && plugin.api;
  return (api && api.apiVersion === 1) ? api : null;
}

/* "Installed" is the manifest map, or a running instance (a missing map must
   not turn an installed plugin into an absent one). */
function rhythmStatus(app) {
  const reg = app && app.plugins;
  const running = !!(reg && reg.plugins && reg.plugins[PLUGIN_ID]);
  const installed = running || !!(reg && reg.manifests && reg.manifests[PLUGIN_ID]);
  if (!installed) return { kind: 'absent', api: null };
  if (!running) return { kind: 'disabled', api: null };
  const api = getRhythmApi(app);
  return api ? { kind: 'ready', api } : { kind: 'no-api', api: null };
}

/* Did the api instance, or the kind of nothing there is, change since the
   last look? Obsidian builds a NEW plugin object (a new onChange list)
   whenever a plugin is reloaded, switched off and on, or updated; a
   subscription made to the old one never hears the new one. The kind is part
   of the test because a card's existence depends on it (disabled -> absent
   changes no api: both are null). */
function rhythmApiChanged(app, lastApi, lastKind) {
  const st = rhythmStatus(app);
  return { changed: st.api !== (lastApi || null) || st.kind !== lastKind, api: st.api, kind: st.kind };
}

/* Keeps ONE onChange subscription, on whichever api instance is current.
   sync() looks again and, if the instance or the kind changed (or this is
   the first look), drops the old subscription, takes the new one and returns
   true so the caller forgets what it read through the old instance and reads
   again. `onChange` is the caller's reaction to a notification; a
   notification from an instance that has since been replaced is ignored. */
function createRhythmLink(app, onChange) {
  let api = null, kind = null, unsub = null, started = false, stopped = false;
  const drop = () => {
    if (typeof unsub === 'function') { try { unsub(); } catch (e) { /* the old instance may already be gone */ } }
    unsub = null;
  };
  return {
    sync() {
      if (stopped) return false;
      const r = rhythmApiChanged(app, api, kind);
      if (started && !r.changed) return false;
      started = true;
      drop();
      api = r.api; kind = r.kind;
      if (api && typeof api.onChange === 'function') {
        const mine = api;
        try { unsub = api.onChange(() => { if (!stopped && mine === api) onChange(); }); }
        catch (e) { console.error('vista rhythm: onChange', e); }
      }
      return true;
    },
    stop() { stopped = true; drop(); },
    get api() { return api; },
    get kind() { return kind; },
  };
}

/* ---- week start, note path, events (all sync-or-cheap) ------------------- */

/* Rhythm's week start; Monday when there is no api to ask. */
function weekStart(api) {
  if (!api || typeof api.weekStart !== 'function') return 1;
  try { return api.weekStart() === 0 ? 0 : 1; } catch (e) { return 1; }
}

/* The reminders note's path, '' when unknown. Vista's Tasks card skips it. */
function reminderNotePath(api) {
  if (!api || !api.reminders || typeof api.reminders.notePath !== 'function') return '';
  try { return String(api.reminders.notePath() || ''); } catch (e) { return ''; }
}

/* { 'YYYY-MM-DD': [name, ...] } for the events in [from, to]. */
async function eventsByDate(api, fromISO, toISO) {
  const out = new Map();
  if (!api || !api.events || typeof api.events.between !== 'function') return out;
  const list = await api.events.between(fromISO, toISO);
  for (const ev of (Array.isArray(list) ? list : [])) {
    if (!ev || !ev.date) continue;
    const date = String(ev.date);
    if (!out.has(date)) out.set(date, []);
    out.get(date).push(String(ev.name || ''));
  }
  return out;
}

/* ---- reminders ----------------------------------------------------------- */

const EMPTY_COUNTS = () => ({ overdue: 0, today: 0, due: 0, ahead: 0, someday: 0, open: 0 });

/* The Reminders card's whole input: { available, path, rows, buckets, counts,
   more }. `available: false` means Rhythm has no reminders note yet. */
async function loadReminders(api, today, limit) {
  if (!api || !api.reminders || typeof api.reminders.summary !== 'function') {
    return { available: false, path: '', rows: [], buckets: null, counts: null, more: 0 };
  }
  const s = (await api.reminders.summary({ today, limit })) || {};
  const rows = Array.isArray(s.rows) ? s.rows : [];
  return {
    available: s.available !== false,
    path: s.path || '',
    rows,
    buckets: s.buckets || null,
    counts: Object.assign(EMPTY_COUNTS(), { open: rows.length }, s.counts || {}),
    more: Math.max(0, +s.more || 0),
  };
}

/* A write that cannot even be asked: no api or no method ('unavailable'), or
   a row without the ref Rhythm handed out ('bad-ref', Rhythm's own word for a
   ref it cannot use). Neither reaches the api. */
const cannot = reason => ({ ok: false, reason });
const result = res => (res && typeof res === 'object' ? res : { ok: false });

/* Tick through Rhythm. The api re-checks `ref` before it writes and says why
   it refused ({ ok:false, reason:'changed' | 'bad-ref' | 'unavailable' | 'repeat' | ... }), so
   the row is handed over as it was and nothing is re-read here. */
async function tickReminder(api, item, today) {
  if (!api || !api.reminders || typeof api.reminders.toggle !== 'function') return cannot('unavailable');
  if (!item || !item.ref) return cannot('bad-ref');
  return result(await api.reminders.toggle(item.ref, { today }));
}

async function snoozeReminder(api, item, days, today) {
  if (!api || !api.reminders || typeof api.reminders.snooze !== 'function') return cannot('unavailable');
  if (!item || !item.ref) return cannot('bad-ref');
  return result(await api.reminders.snooze(item.ref, days, { today }));
}

const canSnooze = api => !!(api && api.reminders && typeof api.reminders.snooze === 'function');

module.exports = {
  cannot, result,
  PLUGIN_ID, getRhythmApi, rhythmStatus, rhythmApiChanged, createRhythmLink,
  weekStart, reminderNotePath, eventsByDate,
  loadReminders, tickReminder, snoozeReminder, canSnooze,
};
