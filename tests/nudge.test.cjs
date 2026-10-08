'use strict';
const assert = require('node:assert');
const N = require('../src/nudge');

const TODAY = '2026-09-13';
const item = (title, fields) => Object.assign({ title, done: false, priority: 'normal', due: '', time: '', tags: [], group: '', raw: '- [ ] ' + title, line: 0 }, fields);

/* ---- a real calendar date, not just four digits in the right shape ------ */
assert.strictEqual(N.isISO('2026-09-13'), true);
assert.strictEqual(N.isISO('2026-13-40'), false, 'month 13 is not a month');
assert.strictEqual(N.isISO('2026-00-13'), false, 'month 0 is not a month');
assert.strictEqual(N.isISO('2026-09-00'), false, 'day 0 is not a day');
assert.strictEqual(N.isISO('2026-09-32'), false, 'day 32 is not a day');
assert.strictEqual(N.isISO(''), false);
/* Nudge's own check (src/dates.js): a day must exist in THAT month and year. */
assert.strictEqual(N.isISO('2026-02-30'), false, 'there is no 30 February');
assert.strictEqual(N.isISO('2026-02-29'), false, '2026 is not a leap year');
assert.strictEqual(N.isISO('2028-02-29'), true, '2028 is');
assert.strictEqual(N.isISO('2100-02-29'), false, 'century rule');
assert.strictEqual(N.isISO('2000-02-29'), true, 'and its exception');
assert.strictEqual(N.isISO('2026-04-31'), false);
assert.strictEqual(N.isISO('2026-04-30'), true);
assert.strictEqual(N.isISO('2026-12-31'), true);
assert.strictEqual(N.bucketOf(item('a', { due: '2026-02-30' }), '2026-02-25'), 'someday', 'Nudge files 30 Feb under someday — so must the card');
assert.strictEqual(N.shortWhen(item('a', { due: '2026-02-30' }), '2026-02-25'), 'Someday');
assert.strictEqual(N.bucketOf(item('a', { due: '2026-13-40' }), TODAY), 'someday', 'a malformed due date is someday, not a date Date.UTC quietly normalised');
assert.strictEqual(N.whenLabel(item('a', { due: '2026-13-40' }), TODAY), 'someday');
assert.strictEqual(N.shortWhen(item('a', { due: '2026-13-40' }), TODAY), 'Someday');

/* ---- buckets ----------------------------------------------------------- */
assert.strictEqual(N.bucketOf(item('a', { due: '2026-09-01' }), TODAY), 'overdue');
assert.strictEqual(N.bucketOf(item('a', { due: TODAY }), TODAY), 'today');
assert.strictEqual(N.bucketOf(item('a', { due: '2026-09-14' }), TODAY), 'tomorrow');
assert.strictEqual(N.bucketOf(item('a', { due: '2026-09-20' }), TODAY), 'week');
assert.strictEqual(N.bucketOf(item('a', { due: '2026-09-21' }), TODAY), 'later', 'the week ends at +7 days');
assert.strictEqual(N.bucketOf(item('a', { due: '' }), TODAY), 'someday');
assert.strictEqual(N.bucketOf(item('a', { due: 'not a date' }), TODAY), 'someday');
assert.strictEqual(N.bucketOf(item('a', { due: '2026-09-01', done: true }), TODAY), 'done', 'done is done, however late');

/* Month and year boundaries: the arithmetic is on the string, not a Date. */
assert.strictEqual(N.diffDays('2026-09-30', '2026-10-01'), 1);
assert.strictEqual(N.diffDays('2026-12-31', '2027-01-01'), 1);
assert.strictEqual(N.diffDays('2026-03-01', '2026-02-28'), -1);
assert.strictEqual(N.bucketOf(item('a', { due: '2026-10-01' }), '2026-09-30'), 'tomorrow');

/* ---- labels ------------------------------------------------------------ */
assert.strictEqual(N.whenLabel(item('a', { due: TODAY }), TODAY), 'due today');
assert.strictEqual(N.whenLabel(item('a', { due: '2026-09-14' }), TODAY), 'tomorrow');
assert.strictEqual(N.whenLabel(item('a', { due: '2026-09-12' }), TODAY), '1 day overdue', 'singular, not "1 days"');
assert.strictEqual(N.whenLabel(item('a', { due: '2026-09-10' }), TODAY), '3 days overdue');
assert.strictEqual(N.whenLabel(item('a', { due: '2026-09-18' }), TODAY), 'Friday');
assert.strictEqual(N.whenLabel(item('a', { due: '2026-10-20' }), TODAY), 'Tue 20 Oct');
assert.strictEqual(N.whenLabel(item('a', { due: '2027-01-05' }), TODAY), 'Tue 5 Jan 2027', 'another year is named');
assert.strictEqual(N.whenLabel(item('a', { due: '' }), TODAY), 'someday');

/* ---- the pill, in Nudge's own vocabulary -------------------------------- */
assert.strictEqual(N.shortWhen(item('a', { due: TODAY }), TODAY), 'Today');
assert.strictEqual(N.shortWhen(item('a', { due: '2026-09-14' }), TODAY), 'Tomorrow');
assert.strictEqual(N.shortWhen(item('a', { due: '2026-09-12' }), TODAY), 'Yesterday');
assert.strictEqual(N.shortWhen(item('a', { due: '2026-09-10' }), TODAY), '3 days ago');
assert.strictEqual(N.shortWhen(item('a', { due: '2026-09-18' }), TODAY), 'Friday');
assert.strictEqual(N.shortWhen(item('a', { due: '2026-10-20' }), TODAY), 'Tue 20 Oct');
assert.strictEqual(N.shortWhen(item('a', { due: '' }), TODAY), 'Someday');

/* ---- what the popup shows ---------------------------------------------- */
assert.strictEqual(N.humanDate('2026-09-16'), '16 Sep 2026');
assert.strictEqual(N.humanDate('nope'), '');
const full = N.detailRows(item('Sign papers', {
  due: '2026-09-16', time: '09:00', priority: 'high', repeat: 'every month',
  group: 'Family', tags: ['#family'], raw: "- [ ] Sign papers 📅 2026-09-16",
}), TODAY);
assert.deepStrictEqual(full, [
  { label: 'Due', value: '16 Sep 2026 · Wednesday' },
  { label: 'Time', value: '09:00' },
  { label: 'Priority', value: 'High' },
  { label: 'Repeats', value: 'every month' },
  { label: 'Section', value: 'Family' },
  { label: 'Tag', value: '#family' },
]);
const bare = N.detailRows(item('Find a plumber', {}), TODAY);
assert.deepStrictEqual(bare, [{ label: 'Due', value: 'No date — someday' }], 'an empty field is a row not worth printing');
assert.deepStrictEqual(N.detailRows(item('x', { due: '2026-09-11', done: true, doneDate: TODAY }), TODAY).map(r => r.label),
  ['Due', 'Done']);
assert.deepStrictEqual(N.detailRows(null, TODAY).length, 1, 'no reminder is still a readable popup');

/* ---- order ------------------------------------------------------------- */
const sorted = N.sortItems([
  item('zebra', { due: TODAY }),
  item('apple', { due: TODAY }),
  item('early', { due: TODAY, time: '07:00' }),
  item('urgent', { due: '2026-09-20', priority: 'high' }),
  item('sooner', { due: '2026-09-01' }),
]);
assert.deepStrictEqual(sorted.map(x => x.title), ['urgent', 'sooner', 'early', 'apple', 'zebra'],
  'priority first, then date, then time, then title');
assert.deepStrictEqual(N.sortItems([]), []);

/* ---- what the card shows ------------------------------------------------ */
const items = [
  item('Sign papers', { due: '2026-09-16', priority: 'high', group: 'Family' }),
  item('Go to gym', { due: '2026-09-15' }),
  item('Send budget', { due: '2026-09-14', priority: 'high' }),
  item('Pay rates', { due: '2026-09-11' }),
  item('Call the bank', { due: TODAY }),
  item('Someday thing', {}),
  item('Long done', { due: '2026-09-01', done: true }),
];
const s = N.summarize(items, TODAY, 5);
assert.deepStrictEqual(s.rows.map(r => r.title), ['Pay rates', 'Call the bank', 'Send budget', 'Sign papers', 'Go to gym'],
  'everything due first, then the next ones coming — never a done one');
assert.deepStrictEqual(s.counts, { overdue: 1, today: 1, due: 2, ahead: 3, someday: 1, open: 6 });
assert.strictEqual(s.more, 1, 'the someday one is not shown but is counted');

const quiet = N.summarize([item('Next week', { due: '2026-09-19' })], TODAY, 5);
assert.deepStrictEqual(quiet.rows.map(r => r.title), ['Next week'], 'a day with nothing due still shows what is coming');
assert.strictEqual(quiet.counts.due, 0);

const busy = N.summarize(items, TODAY, 1);
assert.deepStrictEqual(busy.rows.map(r => r.title), ['Pay rates']);
assert.strictEqual(busy.more, 5);
assert.deepStrictEqual(N.summarize([], TODAY, 5).rows, []);
assert.deepStrictEqual(N.summarize(null, TODAY, 5).counts.open, 0);

/* the quiet line under the name */
assert.strictEqual(N.subLabel(item('a', { group: 'Family', time: '09:00' })), 'Family · 09:00');
assert.strictEqual(N.subLabel(item('a', { group: 'Inbox', time: '09:00' })), '09:00', '"Inbox" is Nudge for "no section" — not worth the width');
assert.strictEqual(N.subLabel(item('a', { group: 'Inbox' })), '', 'and on its own it leaves no line at all');
assert.strictEqual(N.subLabel(item('a', { group: 'Family' })), 'Family');
assert.strictEqual(N.subLabel(null), '');

assert.strictEqual(N.isUrgent(item('a', { priority: 'high' })), true);
assert.strictEqual(N.isUrgent(item('a', { priority: 'normal' })), false);
assert.notStrictEqual(N.keyOf(items[0]), N.keyOf(items[1]));

/* ---- the plugin seam ---------------------------------------------------- */
const mk = (store, hasFile) => ({
  plugins: { plugins: store ? { 'nudge-reminders': { store } } : {} },
  vault: { getFileByPath: p => (hasFile && p === 'Reminders.md' ? { path: p } : null) },
});
const store = {
  path: () => 'Reminders.md',
  load: async () => ({ items }),
  toggle: async (it, today) => (it.title === 'Pay rates' && today === TODAY ? { ok: true, rolled: null } : { ok: false }),
};
assert.strictEqual(N.nudgeAvailable(mk(store, true)), true);
assert.strictEqual(N.nudgeAvailable(mk(store, false)), false, 'no note yet, no card');
assert.strictEqual(N.nudgeAvailable(mk(null, true)), false, 'Nudge not installed, no card');
assert.strictEqual(N.nudgeAvailable({}), false);
/* Plain `nudge` is a different store plugin; its store is not ours. */
assert.strictEqual(N.nudgeAvailable({ plugins: { plugins: { nudge: { store } } }, vault: mk(store, true).vault }), false, 'the other nudge is ignored');
assert.strictEqual(N.nudgeStore(mk({ path: () => 'x' }, true)), null, 'a store missing load() is not a store');

(async () => {
  const r = await N.loadReminders(mk(store, true), TODAY, 5);
  assert.strictEqual(r.available, true);
  assert.strictEqual(r.path, 'Reminders.md');
  assert.deepStrictEqual(r.rows.map(x => x.title), ['Pay rates', 'Call the bank', 'Send budget', 'Sign papers', 'Go to gym']);

  const none = await N.loadReminders(mk(null, false), TODAY, 5);
  assert.strictEqual(none.available, false);
  assert.deepStrictEqual(none.rows, []);

  assert.deepStrictEqual(await N.tickReminder(mk(store, true), items[3], TODAY), { ok: true, rolled: null }, 'the tick goes through Nudge and keeps its result');
  assert.deepStrictEqual(await N.tickReminder(mk(store, true), items[1], TODAY), { ok: false }, 'a line Nudge could not find is reported');
  assert.deepStrictEqual(await N.tickReminder(mk({ path: () => 'x', load: async () => ({ items: [] }) }, true), items[3], TODAY), { ok: false },
    'a store with no toggle() never silently swallows a tick');

  /* A repeat Nudge cannot roll forward is left open, and says so — the one
     shape a bare boolean used to throw away before this reached dashboard.js. */
  const repeatStore = Object.assign({}, store, { toggle: async () => ({ ok: false, reason: 'repeat', repeat: 'every full moon' }) });
  assert.deepStrictEqual(await N.tickReminder(mk(repeatStore, true), items[0], TODAY), { ok: false, reason: 'repeat', repeat: 'every full moon' });
  assert.strictEqual(N.tickRefusedNotice({ ok: false, reason: 'repeat', repeat: 'every full moon' }),
    'Vista: Nudge couldn\'t work out the next date for "🔁 every full moon" — the reminder is still open.');
  assert.strictEqual(N.tickRefusedNotice({ ok: false }), "Vista: Nudge couldn't tick that reminder — open the note.", 'an unknown refusal is never "could not find"');
  assert.strictEqual(N.tickRefusedNotice(undefined), "Vista: Nudge couldn't tick that reminder — open the note.");

  /* ---- a stale row must never tick the NEXT occurrence ------------------ */
  /* Vista holds the item from its last load. If the reminder was ticked in
     Nudge's board meanwhile, store.toggle's locate() falls back to "same title,
     same state" and finds the freshly rolled occurrence — so a tick from the
     stale row would complete the next one too. Vista re-reads first and only
     acts on a line that is still exactly what the row showed. */
  {
    let live = [item('Take pills', { line: 4, raw: '- [ ] Take pills 🔁 every day 📅 2026-09-13', due: TODAY, repeat: 'every day' })];
    const stale = live[0];
    const seen = [];
    const st = {
      path: () => 'Reminders.md',
      load: async () => ({ items: live }),
      toggle: async it => { seen.push(['toggle', it]); return { ok: true, rolled: null }; },
      snooze: async (it, d) => { seen.push(['snooze', it, d]); return { ok: true }; },
    };
    /* unchanged: goes through, and with the FRESH object, not the stale one */
    live = [Object.assign({}, stale)];
    assert.deepStrictEqual(await N.tickReminder(mk(st, true), stale, TODAY), { ok: true, rolled: null });
    assert.strictEqual(seen[0][1], live[0], 'toggle gets the object from the fresh load');
    assert.notStrictEqual(seen[0][1], stale);
    assert.deepStrictEqual(await N.snoozeReminder(mk(st, true), stale, 3, TODAY), { ok: true });
    assert.strictEqual(seen[1][1], live[0], 'snooze gets the fresh object too');
    seen.length = 0;
    /* ticked elsewhere: the same line now holds the rolled-forward occurrence */
    live = [item('Take pills', { line: 4, raw: '- [ ] Take pills 🔁 every day 📅 2026-09-14', due: '2026-09-14', repeat: 'every day' })];
    assert.deepStrictEqual(await N.tickReminder(mk(st, true), stale, TODAY), { ok: false, reason: 'changed' });
    assert.deepStrictEqual(await N.snoozeReminder(mk(st, true), stale, 3, TODAY), { ok: false, reason: 'changed' });
    /* removed or moved */
    live = [];
    assert.deepStrictEqual(await N.tickReminder(mk(st, true), stale, TODAY), { ok: false, reason: 'changed' }, 'gone');
    live = [Object.assign({}, stale, { line: 5 })];
    assert.deepStrictEqual(await N.tickReminder(mk(st, true), stale, TODAY), { ok: false, reason: 'changed' }, 'a different line is not provably the same reminder');
    assert.strictEqual(seen.length, 0, 'toggle/snooze were never called on a changed line');
    assert.strictEqual(N.tickRefusedNotice({ ok: false, reason: 'changed' }), 'Vista: That reminder changed — open the note.');
    assert.strictEqual(N.snoozeRefusedNotice({ ok: false, reason: 'changed' }), 'Vista: That reminder changed — open the note.');
    assert.strictEqual(N.snoozeRefusedNotice({ ok: false }), 'Vista: Nudge could not find that reminder — open the note.');
  }

  /* Snoozing is Nudge's rule (it counts from today), so Vista only asks. */
  const snoozed = [];
  const snoozeStore = Object.assign({}, store, { snooze: async (it, days, today) => { snoozed.push([it.title, days, today]); return { ok: true }; } });
  assert.strictEqual(N.canSnooze(mk(store, true)), false, 'a store without snooze() offers no snooze');
  assert.strictEqual(N.canSnooze(mk(snoozeStore, true)), true);
  assert.deepStrictEqual(await N.snoozeReminder(mk(snoozeStore, true), items[3], 3, TODAY), { ok: true });
  assert.deepStrictEqual(snoozed, [['Pay rates', 3, TODAY]]);
  assert.deepStrictEqual(await N.snoozeReminder(mk(store, true), items[3], 3, TODAY), { ok: false }, 'and never pretends it snoozed');
  console.log('nudge OK');
})().catch(e => { console.error(e); process.exit(1); });
