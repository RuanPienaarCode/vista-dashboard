'use strict';
/* Vista's own smoke test of its vendored Rhythm model (src/rhythm-model.js +
   src/rhythm-dates.js), on made-up areas and practices. It is NOT Rhythm's
   test file. Rhythm's own tests/model.test.cjs is run against these vendored
   files by tests/rhythm-parity.test.cjs when RHYTHM_REPO is set. */
const assert = require('node:assert');
const M = require('../src/rhythm-model');
const D = require('../src/rhythm-dates');

const E = (done = [], skip = [], snooze = [], plan = []) => ({ done: new Set(done), skip: new Set(skip), snooze: new Set(snooze), plan: new Set(plan), note: '' });

/* ---- cadence ---- */
assert.deepStrictEqual(M.parseCadence('daily'), { per: 'day', times: 1 });
assert.deepStrictEqual(M.parseCadence('Weekly'), { per: 'week', times: 1 });
assert.deepStrictEqual(M.parseCadence('3/week'), { per: 'week', times: 3 });
assert.deepStrictEqual(M.parseCadence('2x/week'), { per: 'week', times: 2 });
assert.deepStrictEqual(M.parseCadence('4 per week'), { per: 'week', times: 4 });
assert.deepStrictEqual(M.parseCadence('2/month'), { per: 'month', times: 2 });
assert.deepStrictEqual(M.parseCadence('monthly'), { per: 'month', times: 1 });
assert.strictEqual(M.parseCadence('whenever'), null);
assert.strictEqual(M.cadenceLabel(M.parseCadence('3/week')), '3× a week');
assert.deepStrictEqual(M.parseDays(['Mon', 'wednesday', 'xx', 'mon']), ['mon', 'wed']);

/* ---- fixture: week of Mon 7 Sep 2026, today Fri 11 Sep ---- */
const areas = [{ name: 'Health', order: 1 }, { name: 'Fitness', order: 4 }, { name: 'Hobbies', order: 6 }];
const practices = [
  { name: 'Read 20 pages', area: 'Health', cadence: 'daily', when: 'morning' },
  { name: 'Exercise', area: 'Fitness', cadence: '4/week', when: 'evening' },
  { name: 'Practice guitar', area: 'Hobbies', cadence: 'daily', when: 'evening' },
  { name: 'Paint', area: 'Hobbies', cadence: 'weekly' },
  { name: 'Range', area: 'Hobbies', cadence: 'monthly' },
  { name: 'Weekend walk', area: 'Health', cadence: 'daily', days: ['sat'] },
  { name: 'Journal', area: 'Health', cadence: 'daily', when: 'night' },
];
const log = new Map([
  ['2026-09-07', E(['Exercise', 'Read 20 pages'])],
  ['2026-09-09', E(['Exercise'])],
  ['2026-09-10', E(['Read 20 pages'])],
  ['2026-09-11', E(['Read 20 pages'])],
]);
const data = { areas, practices, goals: [], events: [], log };
const today = '2026-09-11';

/* Exercise: 2 of 4 done, Fri..Sun = 3 days left → urgency 2/3. */
const ex = M.progress(practices[1], log, today, 1);
assert.strictEqual(ex.done, 2);
assert.strictEqual(ex.remaining, 2);
assert.strictEqual(ex.daysLeft, 3);
assert.ok(Math.abs(ex.urgency - 2 / 3) < 1e-9);
assert.strictEqual(ex.due, true);
assert.ok(Math.abs(M.progress(practices[3], log, today, 1).urgency - 1 / 3) < 1e-9);
assert.ok(Math.abs(M.progress(practices[4], log, today, 1).urgency - 1 / 20) < 1e-9);

const rb = M.progress(practices[0], log, today, 1);
assert.strictEqual(rb.doneToday, true);
assert.strictEqual(rb.due, false);
assert.strictEqual(M.progress(practices[5], log, today, 1).due, false);
assert.strictEqual(M.progress(practices[5], log, '2026-09-12', 1).due, true);

/* ---- focus order is AREA order ----
   Due: guitar (Hobbies, 1.0), Journal (Health, 1.0), Exercise (Fitness, .67),
   Paint (Hobbies, .33), Range (Hobbies, .05). The first pass walks the areas in
   the user's priority — Health, Fitness, Hobbies — and takes each one's most
   pressing row: Journal, Exercise, guitar. (This used to run in plain
   urgency order: Journal, guitar, Exercise.) Range
   (not pressing) waits. */
const plan = M.planDay(data, today, { focusCount: 3, weekStart: 1 });
assert.deepStrictEqual(plan.focus.map(r => r.p.name), ['Journal', 'Exercise', 'Practice guitar']);
assert.deepStrictEqual(plan.later.map(r => r.p.name), ['Paint', 'Range']);
assert.deepStrictEqual(plan.done.map(r => r.p.name), ['Read 20 pages']);

/* With four slots the second Hobbies item (Paint, pressing) joins before
   Range (not pressing). With two slots Fitness still gets in ahead of a
   second Health or Hobbies item. */
assert.deepStrictEqual(M.planDay(data, today, { focusCount: 4, weekStart: 1 }).focus.map(r => r.p.name), ['Journal', 'Exercise', 'Practice guitar', 'Paint']);
const two = { ...data, practices: [...practices, { name: 'Meditate', area: 'Health', cadence: 'daily', when: 'morning' }] };
assert.deepStrictEqual(M.planDay(two, today, { focusCount: 3, weekStart: 1 }).focus.map(r => r.p.name), ['Meditate', 'Exercise', 'Practice guitar'], 'second Health daily (Journal) yields to Fitness');

/* Three Health dailies and nothing else pressing → all three show. */
const healthOnly = { areas, practices: [practices[0], practices[6], { name: 'Meditate', area: 'Health', cadence: 'daily' }], goals: [], events: [], log: new Map() };
assert.strictEqual(M.planDay(healthOnly, today, { focusCount: 3, weekStart: 1 }).focus.length, 3);

/* ---- skip and snooze ---- */
const log2 = new Map(log);
log2.set(today, E(['Read 20 pages'], ['Journal'], ['Exercise']));
const plan2 = M.planDay({ ...data, log: log2 }, today, { focusCount: 3, weekStart: 1 });
assert.deepStrictEqual(plan2.skipped.map(r => r.p.name), ['Journal'], 'skipped today is out of due');
assert.ok(!plan2.focus.some(r => r.p.name === 'Exercise'), 'snoozed weekly item leaves focus');
assert.ok(plan2.later.some(r => r.p.name === 'Exercise'), '…and waits under later');
assert.deepStrictEqual(plan2.focus.map(r => r.p.name), ['Practice guitar', 'Paint', 'Range'], 'free slots fill with quieter items');
/* Snooze is "later today" and nothing more, whatever the cadence: a weekly
   item pushed aside on Wednesday is asked for again on Thursday. Pushing
   something past today is a PLAN, which names the day. */
const log4 = new Map(log);
log4.set('2026-09-09', E(['Exercise'], [], ['Paint']));
assert.strictEqual(M.progress(practices[3], log4, '2026-09-09', 1).snoozed, true, 'quiet on the day it was pushed aside');
assert.strictEqual(M.progress(practices[3], log4, '2026-09-11', 1).snoozed, false, 'and back the next day');

/* ---- reasons ---- */
assert.strictEqual(plan.focus.find(r => r.p.name === 'Exercise').reason, '2 more this week · 3 days left');
/* Journal has never once appeared in this log and has no `created`: a
   LEGACY note, asked since the log began (9 Sep 07), so 10th, 9th, 8th and
   7th were all missed. (A practice made today has `created`; see the M3
   block below.) */
assert.strictEqual(plan.focus.find(r => r.p.name === 'Journal').reason, 'Missed 4 days', 'legacy: counts from when the log began');
assert.strictEqual(M.reasonFor(practices[5], M.progress(practices[5], log, '2026-09-12', 1), log, '2026-09-12'), 'Saturdays');
const lastChance = M.progress(practices[3], log, '2026-09-13', 1);
assert.strictEqual(M.reasonFor(practices[3], lastChance, log, '2026-09-13'), 'Last chance this week');
assert.strictEqual(M.reasonFor(practices[0], rb, log, today), 'Done');

/* ---- grouping by time of day ---- */
const groups = M.groupByWhen(plan.focus);
assert.deepStrictEqual(groups.map(g => g.label), ['Evening', 'Before bed']);
assert.deepStrictEqual(groups[0].rows.map(r => r.p.name), ['Exercise', 'Practice guitar']);

/* ---- summaries ---- */
const ws = M.weekSummary(data, today, 1);
const wsEx = ws.find(r => r.p.name === 'Exercise');
assert.strictEqual(wsEx.done, 2); assert.strictEqual(wsEx.target, 4);
assert.deepStrictEqual(wsEx.ticks, [true, false, true, false, false, false, false]);
assert.strictEqual(ws.find(r => r.p.name === 'Range').target, null);
const ms = M.monthSummary(data, today, 1);
assert.strictEqual(ms.find(r => r.p.name === 'Exercise').target, 16);
assert.strictEqual(ms.find(r => r.p.name === 'Weekend walk').target, 4);

/* The review applies the same "existed for the whole week" rule as the
   good-weeks streak, so give the fixture practices a start before the week. */
const established = { ...data, practices: practices.map(p => ({ ...p, created: '2026-09-01' })) };
const rev = M.weekReview(established, today, 1, today);
assert.strictEqual(rev.asked, 7 + 4 + 7 + 1 + 1 + 7, 'three dailies ×7, Exercise 4, Paint 1, Weekend walk 1');
assert.strictEqual(rev.done, 3 + 2);
assert.strictEqual(rev.slipped[0].done, 0);

/* ---- streaks ---- */
assert.strictEqual(M.streak(log, today), 3);
assert.strictEqual(M.streak(log, '2026-09-08'), 0);
assert.strictEqual(M.streakLabel(data, today, { streakMode: 'days' }), '3 days in a row');
assert.strictEqual(M.streakLabel(data, today, { streakMode: 'off' }), '');
const goodLog = new Map();
for (const d of ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']) {
  goodLog.set(d, E(['Read 20 pages', 'Practice guitar', 'Journal', 'Exercise', 'Paint', 'Weekend walk']));
}
assert.strictEqual(M.weekStreak({ ...data, log: goodLog }, today, 1), 2);
assert.strictEqual(M.weekStreak(data, today, 1), 0);
assert.strictEqual(M.streakLabel({ ...data, log: goodLog }, today, { streakMode: 'weeks', weekStart: 1 }), '2 good weeks in a row');

/* ---- goals and events ---- */
const goals = [
  { name: 'Later', horizon: '2027-06', status: 'active', next: 'x' },
  { name: 'Soon', horizon: '2026-11', status: 'active', next: 'Pick a weekend' },
  { name: 'Done', horizon: '2026-09', status: 'done', next: 'y' },
  { name: 'No step', horizon: '2026-10', status: 'active', next: '' },
];
assert.deepStrictEqual(M.sortGoals(goals).map(g => g.name), ['No step', 'Soon', 'Later']);
assert.strictEqual(M.nextGoal(goals).name, 'Soon');
assert.deepStrictEqual(M.goalsWithoutStep(goals).map(g => g.name), ['No step']);
assert.deepStrictEqual(M.goalsForMonth(goals, '2026-11-03').map(g => g.name), ['No step', 'Soon']);
const events = [
  { name: 'Hike', date: '2026-09-19' }, { name: 'Past', date: '2026-09-01' }, { name: 'Far', date: '2026-10-20' }, { name: 'Undated', date: '' },
];
assert.deepStrictEqual(M.upcoming(events, today, 8).map(e => e.name), ['Hike']);
assert.deepStrictEqual(M.eventsInMonth(events, today).map(e => e.name), ['Past', 'Hike']);

/* ---- when was this last actually done ---- */
assert.strictEqual(M.lastDone(log, 'Read 20 pages', today), 0, 'ticked today');
assert.strictEqual(M.lastDone(log, 'Exercise', today), 2, 'Wednesday, two days back');
assert.strictEqual(M.lastDone(log, 'Paint', today), null, 'never, inside the window');
assert.strictEqual(M.sinceLabel(0), 'done today');
assert.strictEqual(M.sinceLabel(1), 'done yesterday');
assert.strictEqual(M.sinceLabel(5), '5 days ago');
assert.strictEqual(M.sinceLabel(21), '3 weeks ago');
assert.strictEqual(M.sinceLabel(75), '3 months ago');
assert.strictEqual(M.sinceLabel(null), 'not yet', 'never done, start unknown: not the cold "not in 90 days"');
assert.strictEqual(M.sinceLabel(null, 90, 3), 'new');
assert.strictEqual(M.sinceLabel(null, 90, 14), 'new');
assert.strictEqual(M.sinceLabel(null, 90, 40), 'not yet');
assert.strictEqual(M.sinceLabel(null, 90, 91), 'not in 90 days', 'only a practice older than the window may say so');

/* ---- a clock time orders things inside a part of the day ---- */
const timed = {
  areas: [{ name: 'Fitness', order: 1 }],
  practices: [
    { name: 'Stretch', area: 'Fitness', cadence: 'daily', when: 'morning', time: '07:00' },
    { name: 'CrossFit', area: 'Fitness', cadence: 'daily', when: 'morning', time: '05:30' },
    { name: 'Walk', area: 'Fitness', cadence: 'daily', when: 'morning' },
  ],
  goals: [], events: [], log: new Map(),
};
assert.deepStrictEqual(
  M.planDay(timed, today, { focusCount: 3, weekStart: 1 }).focus.map(r => r.p.name),
  ['CrossFit', 'Stretch', 'Walk'],
  'earliest first, and anything untimed comes after everything timed');

/* ---- M3: a brand-new practice must not borrow another practice's history ---- */
{
  const freshLog = new Map();
  for (let i = 1; i <= 60; i++) freshLog.set(D.addDays('2026-09-11', -i), E(['Read 20 pages']));
  const stretch = { name: 'Stretch', area: 'Fitness', cadence: 'daily' };
  assert.strictEqual(M.missedRun(stretch, freshLog, '2026-09-11'), 7, 'LEGACY (no created): counts from when the log began');
  const fresh = { name: 'Stretch', area: 'Fitness', cadence: 'daily', created: '2026-09-11' };
  assert.strictEqual(M.missedRun(fresh, freshLog, '2026-09-11'), 0, 'made today (created=today) → starts today, not "Missed 7 days"');
  const pr = M.progress(fresh, freshLog, '2026-09-11', 1);
  assert.strictEqual(M.reasonFor(fresh, pr, freshLog, '2026-09-11'), 'Every day', 'the normal cadence text');
  assert.strictEqual(M.missedRun(stretch, new Map(), '2026-09-11'), 0, 'empty log: nothing to have missed');
  /* With a `created` date it counts back to THAT, not to today and not to
     some other practice's 60-day log. */
  const created = { name: 'Stretch', area: 'Fitness', cadence: 'daily', created: '2026-09-08' };
  assert.strictEqual(M.missedRun(created, freshLog, '2026-09-11'), 3, 'missed the 8th, 9th and 10th — created on the 8th');
}

/* ---- M2: a practice added today must not rewrite past weeks' verdict ---- */
{
  const healthAreas = [{ name: 'Health', order: 1 }];
  const base = [{ name: 'Read', area: 'Health', cadence: 'daily' }];
  const madeToday = { created: '2026-09-11' };
  const weekLog = new Map();
  for (let i = 0; i < 35; i++) weekLog.set(D.addDays('2026-09-11', -i), E(['Read']));
  const before = M.weekStreak({ areas: healthAreas, practices: base, log: weekLog }, '2026-09-11', 1);
  const withNew = [...base, { name: 'Stretch', area: 'Health', cadence: 'daily', ...madeToday }, { name: 'Journal', area: 'Health', cadence: 'daily', ...madeToday }];
  const after = M.weekStreak({ areas: healthAreas, practices: withNew, log: weekLog }, '2026-09-11', 1);
  assert.strictEqual(before, 5, '35 perfect days = 5 good weeks');
  assert.strictEqual(after, before, 'two daily practices made today (created=today) must not zero out the streak');
}

/* ---- day streak: an unticked "today" shows the run through yesterday ---- */
{
  const dayLog = new Map();
  for (let i = 1; i <= 10; i++) dayLog.set(D.addDays('2026-09-11', -i), E(['Read']));
  dayLog.set('2026-09-11', E([]));
  assert.strictEqual(M.streakLabel({ log: dayLog }, '2026-09-11', {}), '10 days in a row', 'nothing ticked yet today still reads as the 10-day run through yesterday');
  dayLog.set('2026-09-10', E([])); // yesterday itself blank now — the run really is broken
  assert.strictEqual(M.streakLabel({ log: dayLog }, '2026-09-11', {}), '', 'a whole blank PAST day does break it');
}

/* ---- planWindow: the days "Another day" may move a practice to ----
   Only days after `date` inside the practice's CURRENT period; none for a
   daily (its period is the day itself); a days:-narrowed practice only
   offers its own weekdays. 2026-10-07 is a Wednesday. */
assert.deepStrictEqual(M.planWindow({ cadence: 'daily' }, '2026-10-07', 1), []);
assert.deepStrictEqual(M.planWindow({ cadence: '3/week' }, '2026-10-07', 1), ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
assert.deepStrictEqual(M.planWindow({ cadence: 'weekly' }, '2026-10-11', 1), [], 'Sunday is the last day of a Monday week');
assert.deepStrictEqual(M.planWindow({ cadence: 'weekly' }, '2026-10-07', 0), ['2026-10-08', '2026-10-09', '2026-10-10']);
assert.deepStrictEqual(M.planWindow({ cadence: 'weekly', days: ['sat', 'tue'] }, '2026-10-07', 1), ['2026-10-10']);
assert.deepStrictEqual(M.planWindow({ cadence: 'monthly' }, '2026-10-29', 1), ['2026-10-30', '2026-10-31']);

/* ---- item 1: Today's slots go to the areas in priority order ----
   A user's areas: Health 1, Home 2, Planning 3, Learning lower. Wed 7 Oct,
   week Mon–Sun. A Planning 3/week practice with 3 owed and 5 days left
   (urgency .6) must take a slot over the Learning daily (urgency 1). */
{
  const T = '2026-10-07';
  const ar = [{ name: 'Health', order: 1 }, { name: 'Home', order: 2 }, { name: 'Planning', order: 3 }, { name: 'Fitness', order: 4 }, { name: 'Learning', order: 7 }];
  const ps = [
    { name: 'Read', area: 'Learning', cadence: 'daily' },
    { name: 'Breathe', area: 'Health', cadence: 'daily' },
    { name: 'Journal', area: 'Health', cadence: 'daily' },
    { name: 'Call a friend', area: 'Home', cadence: 'daily' },
    { name: 'Plan the week', area: 'Planning', cadence: '3/week' },
  ];
  const d = { areas: ar, practices: ps, log: new Map() };
  const f = M.planDay(d, T, { focusCount: 3, weekStart: 1 });
  assert.deepStrictEqual(f.focus.map(r => r.p.name), ['Breathe', 'Call a friend', 'Plan the week'], 'one per area in priority order; Learning\'s daily waits');
  assert.ok(f.later.some(r => r.p.name === 'Read'));
  /* Second helpings come only after every pressing area (Learning too) has one: 5 slots. */
  assert.deepStrictEqual(M.planDay(d, T, { focusCount: 5, weekStart: 1 }).focus.map(r => r.p.name), ['Breathe', 'Call a friend', 'Plan the week', 'Read', 'Journal']);
  /* A snoozed row is not eligible for an area's slot; the next one is. */
  const sn = { ...d, log: new Map([[T, E([], [], ['Breathe'])]]) };
  assert.strictEqual(M.planDay(sn, T, { focusCount: 3, weekStart: 1 }).focus[0].p.name, 'Journal');
  /* Not pressing (urgency < 1/3) never takes an area's first slot. */
  const calm = { areas: ar, practices: [{ name: 'Hike', area: 'Health', cadence: 'monthly' }, { name: 'Read', area: 'Learning', cadence: 'daily' }], log: new Map() };
  assert.deepStrictEqual(M.planDay(calm, T, { focusCount: 1, weekStart: 1 }).focus.map(r => r.p.name), ['Read']);
}

/* ---- item 2: a skip is not a miss ---- */
{
  const T = '2026-09-11';
  const stretch = { name: 'Stretch', cadence: 'daily', created: '2026-08-01' };
  const lg = new Map([['2026-09-10', E([], ['Stretch'])]]);
  assert.strictEqual(M.missedRun(stretch, lg, T), 0, 'yesterday skipped: no run');
  /* skipped on the 9th, missed the 10th: the run is 1 day and the skip ends it */
  const lg2 = new Map([['2026-09-09', E([], ['Stretch'])]]);
  assert.strictEqual(M.missedRun(stretch, lg2, T), 1, 'the skip ends the run like a tick does');
  const lg3 = new Map([['2026-09-08', E(['Stretch'])]]);
  assert.strictEqual(M.missedRun(stretch, lg3, T), 2);
  assert.strictEqual(M.reasonFor(stretch, M.progress(stretch, lg3, T, 1), lg3, T), 'Missed 2 days');
  assert.strictEqual(M.reasonFor(stretch, M.progress(stretch, lg, T, 1), lg, T), 'Every day', 'only a skip yesterday: not "Missed"');
  /* capped: never print a capped number as if it were exact */
  const long = new Map();
  const r = M.reasonFor(stretch, M.progress(stretch, long, T, 1), long, T);
  assert.strictEqual(r, 'Missed 7+ days');
  assert.strictEqual(M.missedRun(stretch, long, T), 7);
  const lgExact = new Map([['2026-09-03', E(['Stretch'])]]);
  assert.strictEqual(M.reasonFor(stretch, M.progress(stretch, lgExact, T, 1), lgExact, T), 'Missed 7+ days', 'seven or more reads as 7+');
  const lg6 = new Map([['2026-09-04', E(['Stretch'])]]);
  assert.strictEqual(M.reasonFor(stretch, M.progress(stretch, lg6, T, 1), lg6, T), 'Missed 6 days', 'below the cap the number is exact');
}

/* ---- item 5: the Week page review and the good-weeks streak judge a week identically ---- */
{
  const T = '2026-10-07'; // Wed
  const lg = new Map();
  for (let i = 1; i <= 23; i++) lg.set(D.addDays(T, -i), E(['Meditate']));
  lg.set(T, E(['Meditate', 'Walk']));
  const dd = { areas: [], practices: [{ name: 'Meditate', cadence: 'daily' }, { name: 'Walk', cadence: 'daily' }], log: lg };
  const lastWeek = D.addDays(D.weekStart(T, 1), -7);
  const rev = M.weekReview(dd, lastWeek, 1, T);
  assert.strictEqual(rev.asked, 7, 'Walk did not exist last week: only Meditate is asked');
  assert.strictEqual(rev.ratio, 1);
  assert.deepStrictEqual(rev.rows.map(r => r.p.name), ['Meditate']);
  assert.strictEqual(M.weekStreak(dd, T, 1), 3, 'the streak counts that same week as good (Meditate alone, three full weeks)');
  /* every past week: review good  <=>  streak step good */
  for (let w = 1; w <= 3; w++) {
    const wk = D.addDays(D.weekStart(T, 1), -7 * w);
    const r = M.weekReview(dd, wk, 1, T);
    assert.ok(r.asked && r.ratio >= 0.6, `week -${w} judged good by the page too`);
  }
}

/* ---- item 6: a practice's start is worked out once per call, not per week ---- */
{
  const T = '2026-10-07';
  let passes = 0;
  class CountingMap extends Map { [Symbol.iterator]() { passes++; return super[Symbol.iterator](); } }
  const lg = new CountingMap();
  const ps = Array.from({ length: 20 }, (_, i) => ({ name: 'P' + i, cadence: i % 3 ? 'daily' : '3/week', created: '2024-01-01' }));
  for (let i = 0; i < 730; i++) lg.set(D.addDays(T, -i), E(ps.map(p => p.name)));
  const dd = { areas: [], practices: ps, log: lg };
  assert.strictEqual(M.weekStreak(dd, T, 1), 104);
  assert.strictEqual(passes, 1, 'weekStreak: one pass over the whole log for 105 weeks x 20 practices');
  passes = 0;
  M.weekReview(dd, T, 1);
  assert.strictEqual(passes, 1, 'weekReview: one pass');
  /* the precomputed start equals the per-practice one */
  const t0 = Date.now();
  M.weekStreak(dd, T, 1);
  assert.ok(Date.now() - t0 < 1500, 'sanity bound, not a benchmark');
  const mixed = [{ name: 'A', cadence: 'daily', created: '2026-09-20' }, { name: 'B', cadence: 'daily' }, { name: 'C', cadence: 'daily', created: '2026-12-01' }, { name: 'D', cadence: 'daily' }];
  const ml = new Map([['2026-09-25', E(['A', 'C'], ['B'])], ['2026-09-30', E([], [], ['B'], ['A'])], ['not-a-date', E(['D'])]]);
  assert.strictEqual(M.practiceStart(mixed[0], ml), '2026-09-20', 'created earlier than the first tick');
  assert.strictEqual(M.practiceStart(mixed[1], ml), '2026-09-25', 'a skip counts as appearing');
  assert.strictEqual(M.practiceStart(mixed[2], ml), '2026-09-25', 'first appearance earlier than created');
  assert.strictEqual(M.practiceStart(mixed[3], ml), '2026-09-25', 'legacy: no created, no appearance → the log\'s first real date (junk keys ignored)');
  assert.strictEqual(M.practiceStart(mixed[3], new Map()), null, 'nothing at all → null (callers use today)');
}

/* ---- item 7: a never-done practice is "new" / "not yet", not "not in 90 days" ---- */
{
  const T = '2026-10-07';
  const lg = new Map([[D.addDays(T, -1), E(['Other'])]]);
  const fresh = { name: 'Stretch', cadence: 'daily', created: T };
  const si = M.sinceInfo(fresh, lg, T);
  assert.strictEqual(si.label, 'new');
  assert.strictEqual(si.cold, false);
  assert.strictEqual(M.reasonFor(fresh, M.progress(fresh, lg, T, 1), lg, T), 'Every day', 'Today and Areas agree: nothing is "missed" about it');
  const unknown = { name: 'Stretch', cadence: 'daily' };
  assert.deepStrictEqual([M.sinceInfo(unknown, lg, T).label, M.sinceInfo(unknown, new Map(), T).label], ['new', 'not yet'], 'legacy: the log began yesterday; empty log: start unknown');
  const longLog = new Map([[D.addDays(T, -40), E(['Other'])]]);
  assert.deepStrictEqual([M.sinceInfo(unknown, longLog, T).label, M.sinceInfo(unknown, longLog, T).cold], ['not yet', false]);
  const ancient = new Map([[D.addDays(T, -200), E(['Other'])]]);
  assert.deepStrictEqual([M.sinceInfo(unknown, ancient, T).label, M.sinceInfo(unknown, ancient, T).cold], ['not in 90 days', true], 'legacy and never ticked in 200 days of log');
  const mid = { name: 'Stretch', cadence: 'daily', created: D.addDays(T, -40) };
  assert.deepStrictEqual([M.sinceInfo(mid, lg, T).label, M.sinceInfo(mid, lg, T).cold], ['not yet', false]);
  const old = { name: 'Stretch', cadence: 'daily', created: D.addDays(T, -200) };
  assert.deepStrictEqual([M.sinceInfo(old, lg, T).label, M.sinceInfo(old, lg, T).cold], ['not in 90 days', true], 'older than the window: honest and cold');
  assert.strictEqual(M.reasonFor(old, M.progress(old, lg, T, 1), lg, T), 'Missed 7+ days', '…and Today says the same thing');
  const ticked = { name: 'Walk', cadence: 'daily', created: D.addDays(T, -200) };
  const tl = new Map([[D.addDays(T, -20), E(['Walk'])]]);
  assert.deepStrictEqual([M.sinceInfo(ticked, tl, T).label, M.sinceInfo(ticked, tl, T).cold], ['3 weeks ago', true]);
}

/* ---- item 8: a daily ignores plans for later days entirely ---- */
{
  const T = '2026-10-07';
  const dd = { areas: [], practices: [{ name: 'Stretch', cadence: 'daily' }], log: new Map([[D.addDays(T, 1), E([], [], [], ['Stretch'])], [D.addDays(T, 3), E([], [], [], ['Stretch'])]]) };
  const pl = M.planDay(dd, T, {});
  assert.deepStrictEqual(pl.focus.map(r => r.p.name), ['Stretch']);
  assert.strictEqual(pl.deferred.length, 0);
  assert.strictEqual(M.progress(dd.practices[0], dd.log, T, 1).deferredTo, null);
  assert.strictEqual(pl.focus[0].reason, 'Every day');
}

/* ---- legacy never-ticked practices count in reviews and the streak ----
   Older notes have no `created`. A practice never ticked has been asked of
   the user since the log began, so a past week's review must show it as asked
   and slipped, and the good-weeks streak must feel it. A practice with
   created=today was not part of those weeks. */
{
  const T = '2026-10-07';
  const lg = new Map();
  for (let i = 1; i <= 28; i++) lg.set(D.addDays(T, -i), E(['Meditate']));
  const wk = D.addDays(D.weekStart(T, 1), -7);
  const mk2 = extra => ({ areas: [], practices: [{ name: 'Meditate', cadence: 'daily' }, ...extra], log: lg });
  const none = M.weekReview(mk2([]), wk, 1, T);
  assert.strictEqual(none.asked, 7);
  const legacy = mk2([{ name: 'Walk', cadence: 'daily' }]);
  const r = M.weekReview(legacy, wk, 1, T);
  assert.strictEqual(r.asked, 14, 'the legacy daily is asked');
  assert.deepStrictEqual(r.slipped.map(x => x.p.name), ['Walk'], 'and slipped (0 of 7)');
  assert.strictEqual(r.ratio, 0.5);
  assert.strictEqual(M.weekStreak(mk2([]), T, 1), 3, 'weeks of 14, 21, 28 Sep (the log began mid-week of 7 Sep)');
  assert.ok(M.weekStreak(legacy, T, 1) < M.weekStreak(mk2([]), T, 1), 'the streak drops accordingly (0.5 < 60%)');
  assert.strictEqual(M.weekStreak(legacy, T, 1), 0);
  const madeToday = mk2([{ name: 'Walk', cadence: 'daily', created: T }]);
  assert.strictEqual(M.weekReview(madeToday, wk, 1, T).asked, 7, 'created=today: not part of last week');
  assert.strictEqual(M.weekStreak(madeToday, T, 1), 3);
  assert.strictEqual(M.weekReview(mk2([{ name: 'Walk', cadence: 'daily' }]), D.addDays(wk, -56), 1, T).asked, 0, 'no log existed that week: nothing to judge');
}

/* dates */
assert.strictEqual(D.weekStart('2026-09-13', 1), '2026-09-07');
assert.strictEqual(D.horizonEnd('2026-02'), '2026-02-28');
assert.strictEqual(D.relative('2026-09-15', '2026-09-11'), 'Tuesday');
console.log('model OK');
