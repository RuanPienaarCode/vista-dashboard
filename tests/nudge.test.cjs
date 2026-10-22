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

/* ---- what a row carries ------------------------------------------------- */
const items = [
  item('Sign papers', { due: '2026-09-16', priority: 'high', group: 'Family' }),
  item('Go to gym', { due: '2026-09-15' }),
];

/* the quiet line under the name */
assert.strictEqual(N.subLabel(item('a', { group: 'Family', time: '09:00' })), 'Family · 09:00');
assert.strictEqual(N.subLabel(item('a', { group: 'Inbox', time: '09:00' })), '09:00', '"Inbox" means "no section" — not worth the width');
assert.strictEqual(N.subLabel(item('a', { group: 'Inbox' })), '', 'and on its own it leaves no line at all');
assert.strictEqual(N.subLabel(item('a', { group: 'Family' })), 'Family');
assert.strictEqual(N.subLabel(null), '');

assert.strictEqual(N.isUrgent(item('a', { priority: 'high' })), true);
assert.strictEqual(N.isUrgent(item('a', { priority: 'normal' })), false);
assert.notStrictEqual(N.keyOf(items[0]), N.keyOf(items[1]));

/* ---- the words on a refusal (Rhythm's api says WHY) ---------------------- */
assert.strictEqual(N.tickRefusedNotice({ ok: false, reason: 'repeat', repeat: 'every full moon' }),
  'Vista: Rhythm couldn\'t work out the next date for "🔁 every full moon" — the reminder is still open.');
assert.strictEqual(N.tickRefusedNotice({ ok: false }), "Vista: Rhythm couldn't tick that reminder — open the note.", 'an unknown refusal is never "gone"');
assert.strictEqual(N.tickRefusedNotice(undefined), "Vista: Rhythm couldn't tick that reminder — open the note.");
assert.strictEqual(N.tickRefusedNotice({ ok: false, reason: 'changed' }), 'Vista: That reminder changed — open the note.');
assert.strictEqual(N.snoozeRefusedNotice({ ok: false, reason: 'changed' }), 'Vista: That reminder changed — open the note.');
for (const reason of ['bad-ref', 'missing']) {
  assert.strictEqual(N.tickRefusedNotice({ ok: false, reason }), N.snoozeRefusedNotice({ ok: false, reason }));
  assert.match(N.tickRefusedNotice({ ok: false, reason }), /no longer in the note/);
}
assert.strictEqual(N.tickRefusedNotice({ ok: false, reason: 'unavailable' }), N.snoozeRefusedNotice({ ok: false, reason: 'unavailable' }));
assert.match(N.tickRefusedNotice({ ok: false, reason: 'unavailable' }), /aren't available right now/);
assert.strictEqual(N.snoozeRefusedNotice({ ok: false }), 'Vista: Rhythm could not snooze that reminder — open the note.');
for (const f of ['tickRefusedNotice', 'snoozeRefusedNotice']) assert.ok(!/Nudge/.test(N[f]({ ok: false, reason: 'x', repeat: 'y' })), f + ' names Rhythm, not Nudge');

/* ---- the I/O half is gone: this module only describes ---------------------- */
for (const gone of ['summarize', 'nudgePlugin', 'nudgeStore', 'nudgePath', 'nudgeAvailable', 'loadReminders', 'tickReminder', 'snoozeReminder', 'canSnooze']) {
  assert.strictEqual(N[gone], undefined, gone + ' moved to Rhythm / src/rhythm-api.js');
}
console.log('nudge OK');
