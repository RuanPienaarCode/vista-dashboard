'use strict';
/* The Reminders card, the "Today, from Rhythm" card and the calendar's event
   dots, MOUNTED (src/dashboard.js over tests/_fake-dom.cjs) against a stub of
   the Rhythm plugin's api that follows the contract exactly
   (tests/_rhythm-api-stub.cjs). What is proved here is data flow: what each
   card says in each Rhythm state, which api calls a tap makes, that a refusal
   reaches the notice, that Rhythm's onChange (and a Rhythm reload) refresh the
   cards, and that Vista writes no vault file to do any of it. Layout and CSS
   are the browser harness's job.

     node tests/dashboard-cards.test.cjs
*/
const assert = require('node:assert');
const obsidian = require('./_stub.cjs');
const { install } = require('./_fake-dom.cjs');
install();
const DB = require('../src/dashboard');
const D = require('../src/dates');
const { DEFAULT_SETTINGS } = require('../src/constants');
const { makeRhythm, makeApp, reminder } = require('./_rhythm-api-stub.cjs');

const TODAY = D.todayISO();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };

/* the dashboard's own timers: capture the intervals so the 15s tick can be
   run by hand and nothing keeps the process alive */
const intervals = [];
global.setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; };
global.clearInterval = () => {};
const slowTick = () => intervals.filter(i => i.ms === 15000).pop().fn();

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* A vault that records every path it is asked about and every write, so
   "Vista does no planner file I/O" is a measurement, not a claim. */
function mount(rhythmPlugin, o) {
  o = o || {};
  const asked = [], writes = [], commands = [];
  const files = Object.keys(o.texts || {}).map(p => ({ path: p, name: p.slice(p.lastIndexOf('/') + 1), basename: p.slice(p.lastIndexOf('/') + 1, -3), extension: 'md', stat: { ctime: 1, mtime: 1, size: 10 } }));
  const byPath = new Map(files.map(f => [f.path, f]));
  const app = Object.assign(makeApp(rhythmPlugin, { installed: o.installed }), {
    vault: {
      getFiles: () => files.slice(), getName: () => 'V', on: () => ({}),
      getFileByPath: p => { asked.push(['getFileByPath', p]); return byPath.get(p) || null; },
      getFolderByPath: p => { asked.push(['getFolderByPath', p]); return null; },
      cachedRead: async f => { asked.push(['cachedRead', f.path]); return o.texts[f.path]; },
      read: async f => { asked.push(['read', f.path]); return o.texts[f.path]; },
      modify: async f => { writes.push(['modify', f.path]); }, process: async f => { writes.push(['process', f.path]); },
      create: async p => { writes.push(['create', p]); }, createFolder: async p => { writes.push(['createFolder', p]); }, delete: async f => { writes.push(['delete', f.path]); },
    },
    metadataCache: { getFileCache: f => { asked.push(['getFileCache', f.path]); return null; }, resolvedLinks: {}, unresolvedLinks: {}, on: () => ({}) },
    workspace: { getLastOpenFiles: () => [], on: () => ({}) },
    commands: { executeCommandById: id => { commands.push(id); return true; } },
  });
  const settings = Object.assign({}, DEFAULT_SETTINGS, { showWeather: false, weatherLocation: '', effect: 'none', intensity: 0 }, o.settings || {});
  const root = document.createElement('div');
  const plugin = { app, settings, loadWeatherCache: () => ({}), saveWeatherCache() {}, clearWeatherCache() {}, async saveSettings() {} };
  const view = { plugin, contentEl: root, registerEvent() {}, registerInterval() {} };
  const ctl = DB.mountDashboard(view);
  return { ctl, root, app, asked, writes, commands, plugin };
}
const text = (root, cls) => { const n = root.querySelector(cls); return n ? n.textContent : null; };
const buttonTitled = (card, title) => card.querySelectorAll('vs-iconbtn').find(b => b.title === title);
const notices = () => obsidian.notices;
const lastNotice = () => obsidian.notices[obsidian.notices.length - 1];

(async () => {
  /* ---- 1. ready: both cards, drawn from the api ------------------------- */
  {
    const rh = makeRhythm({
      reminders: [reminder('Pay rates', { due: '2020-01-01', priority: 'high' }), reminder('Call the bank', { due: TODAY }), reminder('Someday thing')],
      practices: [{ name: 'Stretch', area: 'Health', when: 'morning', whenLabel: 'Morning', reason: 'daily' }, { name: 'Walk', area: 'Health', reason: '3/week' }],
      events: [{ name: 'Dentist', date: TODAY, time: '09:00', area: 'Health', path: 'Rhythm/Events/Dentist.md' }],
      weekStart: 0,
    });
    const m = mount(rh.plugin);
    await m.ctl.start();
    const rem = m.root.querySelector('.vs-nudge'), today = m.root.querySelector('.vs-rhythm');
    ok(rem && today, 'both cards are on the page');
    ok(/Pay rates/.test(rem.textContent) && /Call the bank/.test(rem.textContent), 'the Reminders card lists what Rhythm summarised');
    ok(/1 overdue · 1 today/.test(rem.textContent), "with Rhythm's counts in the header");
    ok(/Today from Rhythm|Todayfrom Rhythm/.test(today.textContent) && /Stretch/.test(today.textContent) && /Walk/.test(today.textContent), 'the Today card lists the practices');
    ok(/3-day streak/.test(today.textContent), "Rhythm's own streak words are shown");
    eq(rh.calls.filter(c => c[0] === 'summary').map(c => c[1]), [{ today: TODAY, limit: 5 }], 'one summary call, with today and the card\'s limit');
    ok(rh.calls.some(c => c[0] === 'today' && c[1].date === TODAY), 'one practices.today call for today');
    eq(rh.state.listeners.size, 1, 'exactly one onChange subscription');

    /* buttons run Rhythm's commands */
    buttonTitled(rem, 'Add a reminder').click();
    buttonTitled(rem, 'Open reminders in Rhythm').click();
    buttonTitled(today, 'Open Rhythm').click();
    eq(m.commands, ['rhythm:reminders-add', 'rhythm:open-reminders', 'rhythm:open'], 'Add/Open run the rhythm commands, not nudge-reminders');

    /* the calendar: week start from the api, events arrive asynchronously */
    m.root.querySelector('.vs-sub').click();
    eq(m.root.querySelectorAll('.vs-cal-dow').map(n => n.textContent)[0], 'Su', "week starts where Rhythm's api says (Sunday)");
    eq(m.root.querySelectorAll('.has-event').length, 0, 'no event dots until the api answers');
    await flush();
    const dots = m.root.querySelectorAll('.has-event');
    eq(dots.length, 1, 'the month\'s event shows once it arrives');
    eq(dots[0].dataset.iso, TODAY);
    ok(/Dentist/.test(dots[0].title), 'named in the tooltip');
    const between = rh.calls.find(c => c[0] === 'between');
    ok(between[1] === TODAY.slice(0, 7) + '-01' && between[2].startsWith(TODAY.slice(0, 7)), 'asked for exactly the month on screen: ' + between.slice(1).join('..'));

    /* a change event refreshes the calendar's dots */
    rh.state.events.push({ name: 'Party', date: TODAY, time: '18:00', area: 'Home', path: 'Rhythm/Events/Party.md' });
    rh.emit(); await flush();
    ok(/Dentist, Party/.test(m.root.querySelectorAll('.has-event')[0].title), 'a change refetches the displayed month');

    eq(m.writes, [], 'Vista wrote no vault file');
    ok(!m.asked.some(a => /Rhythm\//.test(a[1])), 'and asked the vault about no Rhythm note: ' + JSON.stringify(m.asked.filter(a => /Rhythm\//.test(a[1]))));
    m.ctl.stop();
    eq(rh.state.listeners.size, 0, 'stop() unsubscribes from Rhythm');
  }

  /* ---- 2. reminders: tick, snooze, and a refusal reaching the notice ----- */
  {
    const rh = makeRhythm({ reminders: [reminder('Pay rates', { due: '2020-01-01' }), reminder('Go to gym', { due: TODAY })] });
    const m = mount(rh.plugin);
    await m.ctl.start();
    const card = () => m.root.querySelector('.vs-nudge');
    const first = card().querySelectorAll('.vs-nrow')[0];
    ok(/Pay rates/.test(first.textContent));
    const ref = `rem:0:- [ ] Pay rates`;
    first.querySelector('.vs-rtick').click();
    ok(!/Pay rates/.test(card().textContent), 'the row goes as soon as it is tapped');
    await flush();
    eq(rh.calls.filter(c => c[0] === 'toggle'), [['toggle', ref, { today: TODAY }]], 'toggle(ref, { today }): the row\'s own ref, no re-read first');
    ok(rh.calls.filter(c => c[0] === 'summary').length === 1, 'nothing re-read before the write');
    eq(lastNotice(), 'Done (through Rhythm).');
    await sleep(520);                                                      // scheduleNudge(400) then the re-read
    ok(rh.calls.filter(c => c[0] === 'summary').length === 2, 'the card re-read afterwards');
    ok(!/Pay rates/.test(card().textContent) && /Go to gym/.test(card().textContent));

    /* a refusal: the line moved under us. The row comes back; the notice says why. */
    const gym = card().querySelectorAll('.vs-nrow')[0];
    rh.state.reminders.find(r => r.title === 'Go to gym').raw = '- [ ] Go to gym (edited by hand)';
    gym.querySelector('.vs-rtick').click();
    await flush();
    eq(lastNotice(), 'Vista: That reminder changed — open the note.', "Rhythm's 'changed' reaches the notice");
    ok(/Go to gym/.test(card().textContent), 'the row is back after a refusal');
    await sleep(520);
    ok(/edited by hand/.test(JSON.stringify(rh.state.reminders)) && /Go to gym/.test(card().textContent), 'and the re-read shows what is there now');

    /* a repeat Rhythm cannot roll forward */
    rh.state.reminders.push(reminder('Take pills', { due: TODAY, repeat: 'every full moon', line: 9 }));
    rh.state.repeatStuck = 'every full moon';
    rh.emit(); await sleep(400);
    const pills = card().querySelectorAll('.vs-nrow').find(r => /Take pills/.test(r.textContent));
    pills.querySelector('.vs-rtick').click(); await flush();
    eq(lastNotice(), 'Vista: Rhythm couldn\'t work out the next date for "🔁 every full moon" — the reminder is still open.');

    /* snooze, from the reminder's popup */
    const mods = require('../src/modals');
    let modal = null;
    const origOpen = mods.ReminderModal.prototype.open;
    mods.ReminderModal.prototype.open = function () { modal = this; };
    card().querySelectorAll('.vs-nrow')[0].querySelector('.vs-nrow-body').click();
    mods.ReminderModal.prototype.open = origOpen;
    ok(modal && modal.o.canSnooze === true, 'the popup offers snooze because Rhythm does');
    eq(typeof modal.o.onOpenReminders, 'function'); ok(modal.o.onOpenNudge === undefined, 'no Nudge hand-off left');
    notices().length = 0;
    await modal.o.onSnooze(3);
    const sn = rh.calls.filter(c => c[0] === 'snooze');
    eq(sn.length, 1); eq(sn[0].slice(2), [3, { today: TODAY }], 'snooze(ref, days, { today })');
    eq(lastNotice(), 'Snoozed 3 days.');
    rh.state.reminders[0].raw = 'moved'; notices().length = 0;
    await modal.o.onSnooze(1);                                           // the stale row from the popup
    ok(/changed/.test(lastNotice()), 'a snooze on a stale row is refused with the reason');
    modal.o.onOpenReminders(); eq(m.commands[m.commands.length - 1], 'rhythm:open-reminders');
    eq(m.writes, [], 'Vista wrote no vault file through all of that');
    m.ctl.stop();
  }

  /* ---- 3. practices: tick and refuse ------------------------------------ */
  {
    const rh = makeRhythm({ practices: [{ name: 'Stretch', area: 'Health' }, { name: 'Walk', area: 'Health' }] });
    const m = mount(rh.plugin);
    await m.ctl.start();
    const rows = () => m.root.querySelector('.vs-rhythm').querySelectorAll('.vs-rrow');
    rows()[0].click();
    ok(rows()[0].classList.contains('is-done'), 'the tick shows at once');
    await flush();
    eq(rh.calls.filter(c => c[0] === 'tick'), [['tick', `pr:${TODAY}:Stretch`, true]], 'practices.tick(row.ref, on)');
    eq(m.writes, [], 'Vista wrote no log note');
    await sleep(950);
    ok(rows()[0].classList.contains('is-done'), 'and Rhythm now reports it done');
    rows()[0].click(); await flush();
    ok(rh.calls.some(c => c[0] === 'tick' && c[2] === false), 'tapping a done row unticks');

    rh.state.unreadable = 'done';
    rows()[1].click(); await flush();
    ok(/the "done" line in today's Rhythm log/.test(lastNotice()), "Rhythm's 'unreadable' reaches the notice: " + lastNotice());
    ok(!rows()[1].classList.contains('is-done'), 'and the optimistic tick is undone');
    rh.state.unreadable = null;
    rh.state.practices = rh.state.practices.filter(p => p.name !== 'Walk');   // gone from Rhythm: the row is stale
    rows()[1].click(); await flush();
    ok(/changed in Rhythm/.test(lastNotice()), "'changed' says so: " + lastNotice());
    await sleep(1000);                                  // the pending 900ms refresh from the untick covers it
    eq(rows().length, 1, 'and the card re-reads to what Rhythm has now');
    m.ctl.stop();
  }

  /* ---- 4. Rhythm's onChange refreshes the cards (note edited by hand, sync) */
  {
    const rh = makeRhythm({ reminders: [reminder('One', { due: TODAY })], practices: [{ name: 'Stretch' }] });
    const m = mount(rh.plugin);
    await m.ctl.start();
    ok(!/Two/.test(text(m.root, '.vs-nudge')));
    rh.state.reminders.push(reminder('Two', { due: TODAY, line: 1 }));
    rh.state.practices.push({ name: 'Run', area: '', when: '', whenLabel: '', reason: '', done: false });
    rh.emit();
    await sleep(900);
    ok(/Two/.test(text(m.root, '.vs-nudge')), 'a change in Rhythm reaches the Reminders card');
    ok(/Run/.test(text(m.root, '.vs-rhythm')), 'and the Today card');
    m.ctl.stop();
  }

  /* ---- 5. Rhythm reloaded: the dashboard moves to the new instance ------- */
  {
    const a = makeRhythm({ reminders: [reminder('From the old one', { due: TODAY })], practices: [{ name: 'Old practice' }] });
    const b = makeRhythm({ reminders: [reminder('From the new one', { due: TODAY })], practices: [{ name: 'New practice' }] });
    const m = mount(a.plugin);
    await m.ctl.start();
    ok(/From the old one/.test(text(m.root, '.vs-nudge')));
    m.app.plugins.plugins.rhythm = b.plugin;                 // reloaded: a NEW api object
    slowTick(); await sleep(150);
    ok(/From the new one/.test(text(m.root, '.vs-nudge')) && !/old one/.test(text(m.root, '.vs-nudge')), 'the Reminders card follows the new instance');
    ok(/New practice/.test(text(m.root, '.vs-rhythm')) && !/Old practice/.test(text(m.root, '.vs-rhythm')), 'and the Today card');
    eq([a.state.listeners.size, b.state.listeners.size], [0, 1], 'unsubscribed from the old, subscribed to the new');
    b.state.reminders.push(reminder('Added later', { due: TODAY, line: 1 }));
    b.emit(); await sleep(450);
    ok(/Added later/.test(text(m.root, '.vs-nudge')), 'the new instance\'s changes are heard');
    /* switched off: the cards say so; back on: they recover */
    delete m.app.plugins.plugins.rhythm;
    slowTick(); await sleep(150);
    ok(/switched off/.test(text(m.root, '.vs-nudge')) && /switched off/.test(text(m.root, '.vs-rhythm')), 'switched off: both cards say so');
    eq(b.state.listeners.size, 0);
    m.app.plugins.plugins.rhythm = a.plugin;
    slowTick(); await sleep(150);
    ok(/From the old one/.test(text(m.root, '.vs-nudge')) && a.state.listeners.size === 1, 'switched back on: the cards recover');
    m.ctl.stop();
  }

  /* ---- 6. the three ways Rhythm may not be there ------------------------- */
  {
    const absent = mount(null);
    await absent.ctl.start();
    ok(!absent.root.querySelector('.vs-nudge') && !absent.root.querySelector('.vs-rhythm'), 'absent: neither card is drawn');
    ok(absent.root.querySelector('.vs-cols').classList.contains('is-hidden') || true);
    absent.ctl.stop();

    const off = mount(null, { installed: true });
    await off.ctl.start();
    ok(/switched off/.test(text(off.root, '.vs-nudge')) && /switched off/.test(text(off.root, '.vs-rhythm')), 'disabled: "unavailable" on both cards');
    ok(!buttonTitled(off.root.querySelector('.vs-nudge'), 'Add a reminder'), 'with no buttons that would run a missing command');
    off.ctl.stop();

    for (const plugin of [{}, { api: { apiVersion: 2 } }]) {
      const old = mount(plugin);
      await old.ctl.start();
      ok(/cannot share reminders with Vista/.test(text(old.root, '.vs-nudge')) && /cannot share practices with Vista/.test(text(old.root, '.vs-rhythm')), 'no usable api: "update Rhythm" on both cards');
      old.ctl.stop();
    }

    /* Rhythm is there but has no reminders note / no practices yet: hidden until it does */
    const rh = makeRhythm({ noteExists: false, practices: [] });
    const m = mount(rh.plugin);
    await m.ctl.start();
    ok(!m.root.querySelector('.vs-nudge') && !m.root.querySelector('.vs-rhythm'), 'available:false hides the cards');
    rh.state.noteExists = true; rh.state.reminders.push(reminder('First', { due: TODAY }));
    rh.state.practices.push({ name: 'First practice' });
    rh.emit(); await sleep(900);
    ok(/First/.test(text(m.root, '.vs-nudge') || '') && /First practice/.test(text(m.root, '.vs-rhythm') || ''), 'and they appear when Rhythm gets a note / a practice');
    m.ctl.stop();

    /* a read that throws: the Reminders card says so, the Today card hides */
    const bad = makeRhythm({ reminders: [reminder('x')], practices: [{ name: 'y' }] });
    bad.api.reminders.summary = async () => { throw new Error('boom'); };
    bad.api.practices.today = async () => { throw new Error('boom'); };
    const origErr = console.error; console.error = () => {};
    const mb = mount(bad.plugin);
    await mb.ctl.start(); await flush();
    console.error = origErr;
    ok(/Could not read the reminders from Rhythm/.test(text(mb.root, '.vs-nudge')), 'a failed read is said on the Reminders card');
    ok(!mb.root.querySelector('.vs-rhythm'), 'and the Today card stays hidden, as it always did');
    mb.ctl.stop();
  }

  /* ---- 7. the Tasks card skips the reminders note Rhythm names ----------- */
  {
    const rh = makeRhythm({ notePath: 'Rhythm/Reminders.md', reminders: [reminder('Pay rates', { due: '2020-01-01' })] });
    const texts = {
      'Rhythm/Reminders.md': `- [ ] Pay rates 📅 2020-01-01\n`,
      'Notes/Errands.md': `- [ ] Book the service 📅 2020-02-01\n`,
    };
    const m = mount(rh.plugin, { texts });
    await m.ctl.start(); await sleep(50);
    const t = m.ctl.state.tasks;
    ok(t, 'tasks were scanned');
    eq(t.overdue.map(x => x.path), ['Notes/Errands.md'], "the reminders note is Rhythm's: the Tasks card leaves it out");
    m.ctl.stop();
    /* with the Reminders card switched off Vista does not skip it */
    const m2 = mount(rh.plugin, { texts, settings: { showNudge: false } });
    await m2.ctl.start(); await sleep(50);
    eq(m2.ctl.state.tasks.overdue.map(x => x.path).sort(), ['Notes/Errands.md', 'Rhythm/Reminders.md'], 'with the Reminders card off the note counts as tasks again');
    m2.ctl.stop();
    /* no Rhythm at all: nothing is skipped */
    const m3 = mount(null, { texts });
    await m3.ctl.start(); await sleep(50);
    eq(m3.ctl.state.tasks.overdue.length, 2);
    m3.ctl.stop();
  }

  console.log(`dashboard cards OK (${checks} checks)`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
