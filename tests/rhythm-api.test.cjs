'use strict';
/* src/rhythm-api.js: Vista's only door to planner data. Everything here runs
   against tests/_rhythm-api-stub.cjs, which plays the Rhythm plugin's api
   exactly as the contract describes (apiVersion 1; every ref re-checked by
   Rhythm before it writes).

     node tests/rhythm-api.test.cjs
*/
const assert = require('node:assert');
require('./_stub.cjs');
const RA = require('../src/rhythm-api');
const N = require('../src/nudge');
const { makeRhythm, makeApp, reminder } = require('./_rhythm-api-stub.cjs');

const TODAY = '2026-09-13';
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const REMINDERS = () => [
  reminder('Sign papers', { due: '2026-09-16', priority: 'high', group: 'Family' }),
  reminder('Go to gym', { due: '2026-09-15' }),
  reminder('Send budget', { due: '2026-09-14', priority: 'high' }),
  reminder('Pay rates', { due: '2026-09-11' }),
  reminder('Call the bank', { due: TODAY }),
  reminder('Someday thing', {}),
  reminder('Long done', { due: '2026-09-01', done: true }),
];

(async () => {
  /* ---- 1. status: four kinds, and nothing else ------------------------- */
  {
    const rh = makeRhythm();
    eq(RA.rhythmStatus(makeApp(null)), { kind: 'absent', api: null }, 'not installed');
    eq(RA.rhythmStatus({}), { kind: 'absent', api: null }, 'no plugin registry at all');
    eq(RA.rhythmStatus(null), { kind: 'absent', api: null });
    eq(RA.rhythmStatus(makeApp(null, { installed: true })), { kind: 'disabled', api: null }, 'installed, no instance');
    eq(RA.rhythmStatus(makeApp({})), { kind: 'no-api', api: null }, 'running, no api (an older release)');
    eq(RA.rhythmStatus(makeApp({ api: { apiVersion: 2 } })), { kind: 'no-api', api: null }, 'another version is not ours');
    eq(RA.rhythmStatus(makeApp({ api: { apiVersion: '1' } })), { kind: 'no-api', api: null }, 'the version is a number, not a look-alike');
    const st = RA.rhythmStatus(makeApp(rh.plugin));
    eq(st.kind, 'ready'); ok(st.api === rh.api, 'ready hands back the instance');
    /* a running instance counts as installed even if the manifest map is missing */
    eq(RA.rhythmStatus({ plugins: { plugins: { rhythm: rh.plugin } } }).kind, 'ready');
  }

  /* ---- 2. the version gate --------------------------------------------- */
  {
    const rh = makeRhythm();
    ok(RA.getRhythmApi(makeApp(rh.plugin)) === rh.api, 'apiVersion 1 passes');
    eq(RA.getRhythmApi(makeApp({ api: { apiVersion: 0 } })), null);
    eq(RA.getRhythmApi(makeApp({ api: { apiVersion: 2 } })), null, 'a future incompatible shape is refused, not guessed at');
    eq(RA.getRhythmApi(makeApp(null, { installed: true })), null);
    eq(RA.getRhythmApi(null), null);
    /* only the plugin id `rhythm`: a Nudge install is nobody's api here */
    eq(RA.getRhythmApi({ plugins: { plugins: { 'nudge-reminders': rh.plugin } } }), null);
  }

  /* ---- 3. change detection: instance and kind -------------------------- */
  {
    const a = makeRhythm(), b = makeRhythm();
    const app = makeApp(a.plugin);
    let r = RA.rhythmApiChanged(app, a.api, 'ready');
    eq([r.changed, r.kind], [false, 'ready'], 'same instance, same kind: unchanged');
    app.plugins.plugins.rhythm = b.plugin;                       // reloaded: a NEW api object
    r = RA.rhythmApiChanged(app, a.api, 'ready');
    ok(r.changed && r.api === b.api, 'a new instance is a change');
    delete app.plugins.plugins.rhythm;                           // switched off
    r = RA.rhythmApiChanged(app, b.api, 'ready');
    ok(r.changed && r.api === null && r.kind === 'disabled', 'gone is a change');
    /* disabled -> absent changes no api (both null) but does change the card */
    delete app.plugins.manifests.rhythm;
    r = RA.rhythmApiChanged(app, null, 'disabled');
    ok(r.changed && r.kind === 'absent', 'the kind alone is a change');
    r = RA.rhythmApiChanged(app, null, 'absent');
    ok(!r.changed, 'absent -> absent is not');
  }

  /* ---- 4. the link: one subscription, on the current instance ---------- */
  {
    const a = makeRhythm(), b = makeRhythm();
    const app = makeApp(a.plugin);
    let heard = 0;
    const link = RA.createRhythmLink(app, () => { heard++; });
    ok(link.sync() === true, 'the first look is a change (subscribe)');
    ok(link.api === a.api && link.kind === 'ready');
    eq(a.state.listeners.size, 1, 'subscribed once');
    ok(link.sync() === false, 'nothing changed');
    ok(link.sync() === false);
    eq(a.state.listeners.size, 1, 'a quiet sync never double-subscribes');
    a.emit(); eq(heard, 1, 'a notification from the current instance reaches the caller');

    /* Rhythm reloaded: the old subscription is dropped, the new one taken */
    const staleCb = [...a.state.listeners][0];
    app.plugins.plugins.rhythm = b.plugin;
    ok(link.sync() === true, 'a new instance is a change');
    eq(a.state.listeners.size, 0, 'unsubscribed from the old instance');
    eq(b.state.listeners.size, 1, 'subscribed to the new one');
    ok(a.calls.some(c => c[0] === 'unsubscribe'), 'the old unsubscribe function was actually called');
    staleCb(); eq(heard, 1, 'a late notice from the replaced instance is ignored');
    b.emit(); eq(heard, 2, 'the new instance is heard');
    ok(link.api === b.api);

    /* switched off: nothing to subscribe to */
    delete app.plugins.plugins.rhythm;
    ok(link.sync() === true && link.api === null && link.kind === 'disabled');
    eq(b.state.listeners.size, 0, 'unsubscribed when the plugin is switched off');

    /* back on */
    app.plugins.plugins.rhythm = a.plugin;
    ok(link.sync() === true); eq(a.state.listeners.size, 1);

    /* stop(): unsubscribes, and nothing after it does anything */
    link.stop();
    eq(a.state.listeners.size, 0, 'stop unsubscribes');
    a.emit(); ok(heard === 2, 'and the callback is not called again');
    ok(link.sync() === false, 'a stopped link does not re-subscribe');
    eq(a.state.listeners.size, 0);
  }
  /* an api whose onChange throws or is missing must not break the dashboard */
  {
    const origErr = console.error; console.error = () => {};
    try {
      const bad = makeApp({ api: { apiVersion: 1, onChange() { throw new Error('nope'); } } });
      const l1 = RA.createRhythmLink(bad, () => {});
      ok(l1.sync() === true && l1.kind === 'ready', 'a throwing onChange still leaves the api usable');
      l1.stop();
      const none = RA.createRhythmLink(makeApp({ api: { apiVersion: 1 } }), () => {});
      ok(none.sync() === true, 'no onChange at all is tolerated');
      none.stop();
    } finally { console.error = origErr; }
  }

  /* ---- 5. reminders: the card's data ----------------------------------- */
  {
    const rh = makeRhythm({ reminders: REMINDERS() });
    const r = await RA.loadReminders(rh.api, TODAY, 5);
    eq(rh.calls[0], ['summary', { today: TODAY, limit: 5 }], 'asks with today and the limit');
    ok(r.available && r.path === 'Rhythm/Reminders.md');
    eq(r.rows.map(x => x.title), ['Pay rates', 'Call the bank', 'Send budget', 'Sign papers', 'Go to gym'], 'everything due first, then what is coming — never a done one');
    eq(r.counts, { overdue: 1, today: 1, due: 2, ahead: 3, someday: 1, open: 6 });
    eq(r.more, 1, 'the someday one is not shown but is counted');
    ok(r.rows.every(x => typeof x.ref === 'string' && x.ref), 'every row carries Rhythm\'s ref');
    /* Vista draws these rows with its own helpers */
    eq(N.bucketOf(r.rows[0], TODAY), 'overdue');
    eq(N.shortWhen(r.rows[1], TODAY), 'Today');

    const busy = await RA.loadReminders(rh.api, TODAY, 1);
    eq(busy.rows.map(x => x.title), ['Pay rates']); eq(busy.more, 5);
  }
  /* no note yet: available false, and the card hides */
  {
    const rh = makeRhythm({ reminders: [], noteExists: false });
    const r = await RA.loadReminders(rh.api, TODAY, 5);
    eq([r.available, r.rows, r.more, r.counts.open], [false, [], 0, 0]);
  }
  /* a thin answer is padded; a null api is "not available" */
  {
    const thin = { apiVersion: 1, reminders: { summary: async () => ({ available: true, rows: [{ title: 'x', ref: 'r' }] }) } };
    const r = await RA.loadReminders(thin, TODAY, 5);
    eq([r.available, r.rows.length, r.counts.open, r.more, r.path], [true, 1, 1, 0, '']);
    eq((await RA.loadReminders(null, TODAY, 5)).available, false);
    eq((await RA.loadReminders({ apiVersion: 1 }, TODAY, 5)).available, false);
    await assert.rejects(RA.loadReminders({ apiVersion: 1, reminders: { summary: async () => { throw new Error('boom'); } } }, TODAY, 5), /boom/);
  }

  /* ---- 6. tick and snooze: the ref goes straight back ------------------ */
  {
    const rh = makeRhythm({ reminders: REMINDERS() });
    const r = await RA.loadReminders(rh.api, TODAY, 5);
    const pay = r.rows[0];
    rh.calls.length = 0;
    eq(await RA.tickReminder(rh.api, pay, TODAY), { ok: true });
    eq(rh.calls, [['toggle', pay.ref, { today: TODAY }]], 'toggle(ref, { today }) and nothing read first');
    eq((await RA.loadReminders(rh.api, TODAY, 5)).rows.map(x => x.title).includes('Pay rates'), false, 'Rhythm took it off the list');

    /* the row Vista holds is now stale: Rhythm refuses, Vista says why */
    const stale = await RA.tickReminder(rh.api, pay, TODAY);
    eq(stale, { ok: false, reason: 'changed' });
    eq(N.tickRefusedNotice(stale), 'Vista: That reminder changed — open the note.');
    eq(N.snoozeRefusedNotice(await RA.snoozeReminder(rh.api, pay, 3, TODAY)), 'Vista: That reminder changed — open the note.', 'a snooze on a stale row is refused the same way');

    /* snooze */
    const gym = (await RA.loadReminders(rh.api, TODAY, 5)).rows.find(x => x.title === 'Go to gym');
    rh.calls.length = 0;
    eq(await RA.snoozeReminder(rh.api, gym, 3, TODAY), { ok: true });
    eq(rh.calls, [['snooze', gym.ref, 3, { today: TODAY }]], 'snooze(ref, days, { today }): Rhythm counts from today');

    /* a repeat Rhythm cannot roll forward is left open, and the reason survives */
    const rep = makeRhythm({ reminders: [reminder('Take pills', { due: TODAY, repeat: 'every full moon' })] });
    rep.state.repeatStuck = 'every full moon';
    const row = (await RA.loadReminders(rep.api, TODAY, 5)).rows[0];
    const refused = await RA.tickReminder(rep.api, row, TODAY);
    eq(refused, { ok: false, reason: 'repeat', repeat: 'every full moon' });
    eq(N.tickRefusedNotice(refused), 'Vista: Rhythm couldn\'t work out the next date for "🔁 every full moon" — the reminder is still open.');

    /* 'bad-ref' (Rhythm's word for a ref it cannot use), 'unavailable', an unknown reason, and a bare refusal */
    eq(N.tickRefusedNotice(await RA.tickReminder(rh.api, { ref: 'not-a-ref' }, TODAY)), 'Vista: That reminder is no longer in the note — open it to see.');
    eq(N.tickRefusedNotice({ ok: false, reason: 'something-new' }), "Vista: Rhythm couldn't tick that reminder — open the note.");
  }
  /* what cannot even be asked is never sent and never reads as success */
  {
    const rh = makeRhythm({ reminders: REMINDERS() });
    eq(await RA.tickReminder(rh.api, { title: 'no ref here' }, TODAY), { ok: false, reason: 'bad-ref' });
    eq(await RA.snoozeReminder(rh.api, null, 1, TODAY), { ok: false, reason: 'bad-ref' });
    eq(rh.calls, [], 'the api was not called');
    eq(await RA.tickReminder(null, { ref: 'x' }, TODAY), { ok: false, reason: 'unavailable' });
    eq(await RA.snoozeReminder({ apiVersion: 1, reminders: {} }, { ref: 'x' }, 1, TODAY), { ok: false, reason: 'unavailable' });
    eq(await RA.tickReminder({ apiVersion: 1, reminders: { toggle: async () => undefined } }, { ref: 'x' }, TODAY), { ok: false }, 'an empty answer is a refusal');
    ok(RA.canSnooze(rh.api) && !RA.canSnooze(null) && !RA.canSnooze({ apiVersion: 1, reminders: {} }), 'the snooze chips follow what Rhythm offers');
  }

  /* ---- 7. week start, note path, events -------------------------------- */
  {
    const rh = makeRhythm({ weekStart: 0, notePath: 'Rhythm/Reminders.md' });
    eq(RA.weekStart(rh.api), 0, 'Rhythm\'s week start');
    eq(RA.weekStart(makeRhythm({ weekStart: 1 }).api), 1);
    eq(RA.weekStart(null), 1, 'Monday when Rhythm is not ready');
    eq(RA.weekStart({ apiVersion: 1, weekStart() { throw new Error('x'); } }), 1);
    eq(RA.weekStart({ apiVersion: 1, weekStart: () => 5 }), 1, 'anything but Sunday is Monday');
    eq(RA.reminderNotePath(rh.api), 'Rhythm/Reminders.md');
    eq(RA.reminderNotePath(makeRhythm({ notePath: '' }).api), '', "'' when unknown");
    eq(RA.reminderNotePath(null), '');
    eq(RA.reminderNotePath({ apiVersion: 1, reminders: { notePath() { throw new Error('x'); } } }), '');
  }
  {
    const ev = (name, date, time) => ({ name, date, time: time || '', area: 'Home', path: `Rhythm/Events/${name}.md` });
    const rh = makeRhythm({ events: [ev('Dentist', '2026-10-12', '09:00'), ev('Party', '2026-10-12', '18:00'), ev('Out of month', '2026-11-02'), ev('Trip', '2026-10-30')] });
    const m = await RA.eventsByDate(rh.api, '2026-10-01', '2026-10-31');
    eq(rh.calls, [['between', '2026-10-01', '2026-10-31']]);
    eq([...m.keys()], ['2026-10-12', '2026-10-30']);
    eq(m.get('2026-10-12'), ['Dentist', 'Party'], 'names, in the order Rhythm sorted them');
    eq((await RA.eventsByDate(null, '2026-10-01', '2026-10-31')).size, 0, 'no api: no marks');
    eq((await RA.eventsByDate({ apiVersion: 1, events: { between: async () => null } }, 'a', 'b')).size, 0);
    await assert.rejects(RA.eventsByDate({ apiVersion: 1, events: { between: async () => { throw new Error('boom'); } } }, 'a', 'b'), /boom/);
  }

  /* ---- 8. Vista touches no planner data of its own --------------------- */
  {
    const fs = require('node:fs'), path = require('node:path');
    const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const dir = path.join(__dirname, '..', 'src');
    for (const f of ['rhythm-api.js', 'rhythm.js', 'nudge.js']) {
      const code = strip(fs.readFileSync(path.join(dir, f), 'utf8'));
      ok(!/\bvault\b|metadataCache|cachedRead|getFileCache|\.process\(/.test(code), `src/${f} does no file I/O`);
    }
    const dash = strip(fs.readFileSync(path.join(dir, 'dashboard.js'), 'utf8'));
    ok(!/nudge-reminders|plugins\.rhythm|rhythmSettings|getFolderByPath\([^)]*Events/.test(dash), 'dashboard.js asks the api, not the plugin or the Events folder');
    ok(/RA\.createRhythmLink/.test(dash) && /rhythmLink\.stop\(\)/.test(dash), 'the dashboard subscribes through the link and stops it');
    for (const gone of ['rhythm-markdown.js', 'rhythm-model.js', 'rhythm-dates.js']) ok(!fs.existsSync(path.join(dir, gone)), `${gone} is not vendored any more`);
  }

  console.log(`rhythm-api OK (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
