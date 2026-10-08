'use strict';
/* The rhythm model — pure functions over plain records.

   Records (all produced by io.js from notes; `path` is the note path):
     area     { name, order, note, path }
     practice { name, area, cadence, days, minutes, when, note, path }
     goal     { name, area, horizon, status, next, note, path }
     event    { name, area, date, time, note, path, calendar? }
     log      Map<dateISO, { done:Set, skip:Set, snooze:Set, plan:Set, note:string }>

   The design rule this file enforces: Today shows a SHORT list, and a
   varied one. Everything due is ranked by urgency (what is still owed
   against the days left in its period), then filled in AREA ORDER: the
   areas, in the priority the user gave them, each take their one most
   pressing item first, and only then do second helpings go by rank, then
   everything else; all trimmed to `focusCount`. */

const D = require('./rhythm-dates'); // VENDORED: upstream requires './dates' - the one edit; scripts/check-rhythm-vendor.sh

/* ---- log access ------------------------------------------------------ */

const EMPTY = Object.freeze({ done: new Set(), skip: new Set(), snooze: new Set(), plan: new Set(), note: '' });
const entry = (log, iso) => (log && log.get(iso)) || EMPTY;
const logHas = (log, iso, name) => entry(log, iso).done.has(name);
const isSkipped = (log, iso, name) => entry(log, iso).skip.has(name);
const isSnoozed = (log, iso, name) => entry(log, iso).snooze.has(name);
/* A plan is a promise to a DAY: "this one on Thursday". It is how the load
   gets spread instead of every flexible practice shouting on every day. */
const isPlanned = (log, iso, name) => entry(log, iso).plan.has(name);

/* The next day AFTER `from` that this practice is promised to, if any —
   bounded by `until` when given (a plan only quiets a practice within its
   CURRENT period: a promise made for next week must leave this week's ask
   alone). Without a bound, falls back to a 21-day scan. */
function plannedAhead(log, from, name, until) {
  const cap = until || D.addDays(from, 21);
  let d = from;
  for (;;) {
    d = D.addDays(d, 1);
    if (d > cap) return null;
    if (isPlanned(log, d, name)) return d;
  }
}

/* How many times a practice is promised inside a window. */
function plannedCount(log, from, days, name) {
  let n = 0;
  for (let i = 0; i < days; i++) if (isPlanned(log, D.addDays(from, i), name)) n++;
  return n;
}

/* Daily practices are not planned — they are simply every day (or every
   listed weekday). Only weekly and monthly ones have a "when" to choose,
   so only those reach the board. */
function isFlexible(p) {
  const c = parseCadence(p.cadence) || { per: 'day' };
  return c.per !== 'day';
}

/* ---- cadence -------------------------------------------------------- */

/* daily | weekly | monthly | 3/week | 2x/week | 1/month | 4 per week */
function parseCadence(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'daily' || s === 'every day') return { per: 'day', times: 1 };
  if (s === 'weekly' || s === 'every week') return { per: 'week', times: 1 };
  if (s === 'monthly' || s === 'every month') return { per: 'month', times: 1 };
  const m = /^(\d+)\s*(?:x|times)?\s*(?:\/|per|a|each)?\s*(day|week|month)s?$/.exec(s);
  if (m) {
    const times = Math.max(1, parseInt(m[1], 10));
    return { per: m[2], times: m[2] === 'day' ? 1 : times };
  }
  return null;
}

function cadenceLabel(c) {
  if (!c) return '';
  if (c.per === 'day') return 'Daily';
  if (c.times === 1) return c.per === 'week' ? 'Weekly' : 'Monthly';
  return `${c.times}× a ${c.per}`;
}

/* The last day of the period this cadence sits in right now — the end of
   the week for weekly/N-per-week, the end of the month for monthly/
   N-per-month, `date` itself for daily (which has no ahead-of-today period
   to promise into). */
function periodEnd(c, date, weekStart) {
  if (c.per === 'week') { const d = D.weekDays(date, weekStart); return d[d.length - 1]; }
  if (c.per === 'month') { const d = D.monthDays(date); return d[d.length - 1]; }
  return date;
}

/* The days "Another day" may move a practice to: after `date`, up to the
   end of its current period, so a promise never quietly writes off this
   week's or month's ask. A daily's period is the day itself, so it gets
   none; a days:-narrowed practice only offers its own weekdays. */
function planWindow(p, date, weekStart) {
  const c = parseCadence(p.cadence);
  const end = periodEnd(c, date, weekStart);
  const only = parseDays(p.days);
  const out = [];
  for (let d = D.addDays(date, 1); d <= end; d = D.addDays(d, 1)) {
    if (!only.length || only.includes(D.dayKey(d))) out.push(d);
  }
  return out;
}

function parseDays(list) {
  const arr = Array.isArray(list) ? list : (list ? String(list).split(',') : []);
  const out = [];
  for (const raw of arr) {
    const k = String(raw).trim().toLowerCase().slice(0, 3);
    if (D.DAY_KEYS.includes(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

/* ---- progress ------------------------------------------------------- */

function countIn(log, days, name) {
  let n = 0;
  for (const d of days) if (logHas(log, d, name)) n++;
  return n;
}

/* Progress of one practice on `date` inside its cadence period.
     { per, target, done, doneToday, skippedToday, snoozed, planned, deferredTo,
       due, remaining, placedAhead, unplanned, daysLeft, urgency, dueDay }

   What a plan covers, and no more. For a weekly or monthly practice:
     remaining   = target - done so far this period
     placedAhead = plans on days AFTER `date` inside the period
     unplanned   = remaining - placedAhead (- 1 when today itself is planned
                   and still open) — what no plan has a day for yet
   Today stays quiet (deferredTo) only when the plans AFTER today cover all
   of `remaining`. Otherwise it is still asked today, with urgency taken on
   the unplanned part over the days left. A daily ignores plans for any
   later day entirely: its period is the day itself. */
function progress(p, log, date, weekStart) {
  const c = parseCadence(p.cadence) || { per: 'day', times: 1 };
  const doneToday = logHas(log, date, p.name);
  const skippedToday = isSkipped(log, date, p.name);
  const days = parseDays(p.days);
  const planned = isPlanned(log, date, p.name);
  if (c.per === 'day') {
    const dueDay = !days.length || days.includes(D.dayKey(date));
    const due = dueDay && !doneToday && !skippedToday;
    const snoozed = isSnoozed(log, date, p.name);
    return { per: 'day', target: 1, done: doneToday ? 1 : 0, doneToday, skippedToday, snoozed, planned, deferredTo: null, due, remaining: due ? 1 : 0, placedAhead: 0, unplanned: due ? 1 : 0, daysLeft: 1, urgency: due ? 1 : 0, dueDay };
  }
  const period = c.per === 'week' ? D.weekDays(date, weekStart) : D.monthDays(date);
  const done = countIn(log, period, p.name);
  const remaining = Math.max(0, c.times - done);
  const idx = period.indexOf(date);
  const daysLeft = idx < 0 ? period.length : period.length - idx; // including today
  const end = period[period.length - 1];
  const open = !doneToday && !skippedToday;
  const due = remaining > 0 && open;
  const placedAhead = idx < 0 ? 0 : plannedCount(log, D.addDays(date, 1), D.diffDays(date, end), p.name);
  const unplanned = Math.max(0, remaining - placedAhead - (planned && open ? 1 : 0));
  const quiet = due && !planned && placedAhead >= remaining;
  const deferredTo = quiet ? plannedAhead(log, date, p.name, end) : null;
  const urgency = due ? Math.min(1, unplanned / Math.max(1, daysLeft)) : 0;
  /* Snooze means "later today", and only today — whatever the cadence.
     Pushing something to a named day is a PLAN, which says which day, so a
     second vaguer mechanism spanning the week would only be a subtler way
     of doing the same job. */
  const snoozed = isSnoozed(log, date, p.name);
  return { per: c.per, target: c.times, done, doneToday, skippedToday, snoozed, planned, deferredTo, due: due || (planned && open), remaining, placedAhead, unplanned, daysLeft, urgency, dueDay: true };
}

/* Days since this was last ticked, counting back from `date` — 0 for
   today, null if it has not happened inside the window. The Areas page
   shows it so "what should I set aside" is answered by the record rather
   than by guilt. */
function lastDone(log, name, from, back = 90) {
  for (let i = 0; i <= back; i++) {
    if (logHas(log, D.addDays(from, -i), name)) return i;
  }
  return null;
}

/* `age` is the practice's age in days (null if its start is unknown). A
   practice with no tick at all is "new" while young and "not yet" until it
   is old enough for "not in 90 days" to be a fair thing to say. */
function sinceLabel(n, back = 90, age = null) {
  if (n === null || n === undefined) {
    if (age !== null && age !== undefined && age > back) return `not in ${back} days`;
    if (age !== null && age !== undefined && age <= 14) return 'new';
    return 'not yet';
  }
  if (n === 0) return 'done today';
  if (n === 1) return 'done yesterday';
  if (n < 14) return `${n} days ago`;
  if (n < 60) return `${Math.round(n / 7)} weeks ago`;
  return `${Math.round(n / 30)} months ago`;
}

/* The Areas line for one practice: { since, age, label, cold }. `cold` is
   the stale styling — only for something genuinely not done for a while,
   never for a practice that simply has not had time to be done. */
function sinceInfo(p, log, today, back = 90) {
  const since = lastDone(log, p.name, today, back);
  const start = practiceStart(p, log);
  const age = start ? Math.max(0, D.diffDays(start, today)) : null;
  const label = sinceLabel(since, back, age);
  const cold = since === null ? (age !== null && age > back) : since > 13;
  return { since, age, label, cold };
}

/* One pass over the log: the earliest date each of `names` appears in it
   (done, skipped, snoozed or planned), and the earliest date of the whole
   log (`logFirst`, null when empty). */
function firstSeen(log, names) {
  const first = new Map();
  let logFirst = null;
  if (log) for (const [k, e] of log) {
    if (!e || !D.isISO(k)) continue;
    if (logFirst === null || k < logFirst) logFirst = k;
    for (const set of [e.done, e.skip, e.snooze, e.plan]) {
      if (!set) continue;
      for (const name of set) {
        if (!names.has(name)) continue;
        const cur = first.get(name);
        if (cur === undefined || k < cur) first.set(name, k);
      }
    }
  }
  return { first, logFirst };
}

/* Start of one practice, in order: (1) its `created` date and (2) its own
   first appearance in the log — the earlier of the two when both exist;
   (3) LEGACY: the earliest date of the whole log, because a note with no
   `created` line predates Rhythm's own tracking and has been asked of the
   user since the log began (so a never-ticked one still counts as missed
   and slipped); (4) null when there is nothing at all — callers then use
   today. A practice made today gets `created` from io, so it starts today. */
function startFrom(p, seen) {
  const own = seen.first.get(p.name) || null;
  const created = D.isISO(p.created) ? p.created : null;
  if (own && created) return own < created ? own : created;
  return own || created || seen.logFirst || null;
}

function practiceStart(p, log) {
  return startFrom(p, firstSeen(log, new Set([p.name])));
}

/* Consecutive PAST days (back from yesterday, capped) on which a daily
   practice was neither ticked nor skipped — the "you've missed this"
   signal. A skip is a decision, not a miss, so like a tick it ends the run.
   A result equal to `cap` means "at least that many". */
const MISSED_CAP = 7;
function missedRun(p, log, date, cap = MISSED_CAP) {
  const days = parseDays(p.days);
  /* Never count back past this practice's start (see startFrom): a
     practice made yesterday has `created` and must not open with "Missed 7
     days"; a legacy note with no `created` counts from when the log began;
     with an empty log there is nothing to miss, so it starts today. */
  const start = practiceStart(p, log) || date;
  let n = 0, d = D.addDays(date, -1);
  while (n < cap && d >= start) {
    const dueDay = !days.length || days.includes(D.dayKey(d));
    if (dueDay) {
      if (logHas(log, d, p.name) || isSkipped(log, d, p.name)) break;
      n++;
    }
    d = D.addDays(d, -1);
  }
  return n;
}

/* One plain sentence for why a row is in front of you. */
function reasonFor(p, pr, log, date) {
  if (pr.doneToday) return 'Done';
  if (pr.skippedToday) return 'Not today';
  if (pr.planned) {
    /* A promise for today is not a promise for the period: say so when more
       is owed than the plans cover. */
    if (pr.per !== 'day' && pr.unplanned > 0) return `You planned this for today · ${pr.unplanned} more to place this ${pr.per}`;
    return 'You planned this for today';
  }
  if (pr.deferredTo) return `Planned for ${D.relative(pr.deferredTo, date)}`;
  if (pr.per === 'day') {
    const days = parseDays(p.days);
    if (days.length) return days.map(k => D.DAY_NAMES[D.DAY_KEYS.indexOf(k)] + 's').join(', ');
    const missed = missedRun(p, log, date);
    if (missed >= MISSED_CAP) return `Missed ${MISSED_CAP}+ days`;
    if (missed >= 2) return `Missed ${missed} days`;
    return 'Every day';
  }
  const per = pr.per;
  if (pr.remaining <= 0) return `Done for the ${per}`;
  const left = pr.unplanned;
  if (left > pr.daysLeft) return `Behind this ${per}`;
  if (left === pr.daysLeft) return pr.daysLeft === 1 ? `Last chance this ${per}` : `Every day left this ${per}`;
  return `${left} more this ${per} · ${pr.daysLeft} days left${pr.placedAhead ? ` · ${pr.placedAhead} planned` : ''}`;
}

/* ---- ranking -------------------------------------------------------- */

function areaRank(areas) {
  const rank = new Map();
  const sorted = [...areas].sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));
  sorted.forEach((a, i) => rank.set(a.name, i));
  return rank;
}

const WHEN_ORDER = { morning: 0, day: 1, evening: 2, night: 3 };

/* An untimed practice sorts after every timed one. The sentinel is a real
   late time rather than a punctuation mark, because localeCompare puts
   punctuation BEFORE digits and would have floated the untimed ones to the
   top of the morning. */
const timeKey = p => p.time || '99:99';
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const WHEN_LABEL = { morning: 'Morning', day: 'During the day', evening: 'Evening', night: 'Before bed', '': 'Any time' };

/* Anything needed within about three days is "pressing". */
const PRESSING = 1 / 3;

function planDay(data, date, opts) {
  const focusCount = Math.max(1, (opts && opts.focusCount) || 3);
  const weekStart = (opts && opts.weekStart) ?? 1;
  const rank = areaRank(data.areas || []);
  const rows = (data.practices || []).map(p => {
    const pr = progress(p, data.log, date, weekStart);
    return { p, pr, reason: reasonFor(p, pr, data.log, date) };
  });
  const done = rows.filter(r => r.pr.doneToday);
  const skipped = rows.filter(r => r.pr.skippedToday && !r.pr.doneToday);
  const byRank = (a, b) =>
    ((b.pr.planned ? 1 : 0) - (a.pr.planned ? 1 : 0))
    || (b.pr.urgency - a.pr.urgency)
    || ((rank.get(a.p.area) ?? 99) - (rank.get(b.p.area) ?? 99))
    || ((WHEN_ORDER[a.p.when] ?? 9) - (WHEN_ORDER[b.p.when] ?? 9))
    || cmp(timeKey(a.p), timeKey(b.p))
    || a.p.name.localeCompare(b.p.name);
  /* A promise to a later day is that day's business: it leaves today
     altogether rather than sinking to the bottom of today's list, and is
     handed back separately so the page can still account for it. */
  const outstanding = rows.filter(r => r.pr.due);
  const deferred = outstanding.filter(r => r.pr.deferredTo);
  const due = outstanding.filter(r => !r.pr.deferredTo).sort(byRank);

  /* Focus order is AREA order. The areas, in the priority the user gave
     them, each take their single most pressing eligible row first (pressing
     = a promise for today, or urgency >= PRESSING; not snoozed), until the
     slots fill. Remaining slots go to the rest of the pressing rows by
     rank, then to everything else by rank. So a life area the user ranks
     high is never crowded out by a lower one's daily. */
  const eligible = due.filter(r => !r.pr.snoozed);
  const pressing = eligible.filter(r => r.pr.planned || r.pr.urgency >= PRESSING);
  const areaOrder = (a, b) => (rank.get(a.p.area) ?? 99) - (rank.get(b.p.area) ?? 99);
  const picked = [];
  const seenAreas = new Set();
  for (const r of [...pressing].sort(areaOrder)) {
    if (picked.length >= focusCount) break;
    if (seenAreas.has(r.p.area)) continue;
    seenAreas.add(r.p.area);
    picked.push(r);
  }
  for (const r of pressing) {
    if (picked.length >= focusCount) break;
    if (!picked.includes(r)) picked.push(r);
  }
  for (const r of eligible) {
    if (picked.length >= focusCount) break;
    if (!picked.includes(r)) picked.push(r);
  }
  const later = due.filter(r => !picked.includes(r));
  return { focus: picked, later, done, skipped, deferred, all: rows };
}

/* Group rows by time of day, keeping their order inside each group. */
function groupByWhen(rows) {
  const groups = new Map();
  for (const r of rows) {
    const k = WHEN_ORDER[r.p.when] !== undefined ? r.p.when : '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === '' ? 9 : WHEN_ORDER[a]) - (b === '' ? 9 : WHEN_ORDER[b]));
  return keys.map(k => ({ when: k, label: WHEN_LABEL[k], rows: groups.get(k) }));
}

/* ---- goals and events ---------------------------------------------- */

const goalActive = g => !g.status || g.status === 'active';

function sortGoals(goals) {
  return [...(goals || [])].filter(goalActive).sort((a, b) => {
    const ea = D.horizonEnd(a.horizon), eb = D.horizonEnd(b.horizon);
    if (ea && eb) return ea < eb ? -1 : ea > eb ? 1 : a.name.localeCompare(b.name);
    if (ea) return -1;
    if (eb) return 1;
    return a.name.localeCompare(b.name);
  });
}

const hasStep = g => !!(g.next && String(g.next).trim());

function nextGoal(goals) {
  return sortGoals(goals).find(hasStep) || null;
}

function goalsWithoutStep(goals) {
  return sortGoals(goals).filter(g => !hasStep(g));
}

const eventKey = e => (e.date || '') + (e.time || '') + (e.name || '');

function upcoming(events, from, days) {
  const to = D.addDays(from, days);
  return (events || [])
    .filter(e => D.isISO(e.date) && e.date >= from && e.date <= to)
    .sort((a, b) => eventKey(a).localeCompare(eventKey(b)));
}

function eventsInMonth(events, iso) {
  const key = D.monthKey(iso);
  return (events || []).filter(e => D.monthKey(e.date) === key)
    .sort((a, b) => eventKey(a).localeCompare(eventKey(b)));
}

function goalsForMonth(goals, iso) {
  const key = D.monthKey(iso);
  return sortGoals(goals).filter(g => {
    const end = D.horizonEnd(g.horizon);
    return end && D.monthKey(end) <= key;
  });
}

/* ---- summaries ------------------------------------------------------ */

function weekSummary(data, date, weekStart) {
  const days = D.weekDays(date, weekStart ?? 1);
  const rank = areaRank(data.areas || []);
  return (data.practices || []).map(p => {
    const c = parseCadence(p.cadence) || { per: 'day', times: 1 };
    const dl = parseDays(p.days);
    const ticks = days.map(d => logHas(data.log, d, p.name));
    const done = ticks.filter(Boolean).length;
    let target;
    if (c.per === 'day') target = dl.length || 7;
    else if (c.per === 'week') target = c.times;
    else target = null;
    const month = c.per === 'month' ? progress(p, data.log, date, weekStart ?? 1) : null;
    return { p, days, ticks, done, target, month, cadence: c };
  }).sort((a, b) => ((rank.get(a.p.area) ?? 99) - (rank.get(b.p.area) ?? 99)) || a.p.name.localeCompare(b.p.name));
}

function monthSummary(data, date, weekStart) {
  const days = D.monthDays(date);
  const rank = areaRank(data.areas || []);
  const weeks = Math.round(days.length / 7);
  return (data.practices || []).map(p => {
    const c = parseCadence(p.cadence) || { per: 'day', times: 1 };
    const dl = parseDays(p.days);
    const done = countIn(data.log, days, p.name);
    let target;
    if (c.per === 'day') target = dl.length ? days.filter(d => dl.includes(D.dayKey(d))).length : days.length;
    else if (c.per === 'week') target = c.times * weeks;
    else target = c.times;
    return { p, done, target, cadence: c, ticks: days.map(d => logHas(data.log, d, p.name)) };
  }).sort((a, b) => ((rank.get(a.p.area) ?? 99) - (rank.get(b.p.area) ?? 99)) || a.p.name.localeCompare(b.p.name));
}

/* Week in review: what got done against what was asked, what slipped.

   A practice only counts toward a week if it existed for the WHOLE of that
   week (its start is on or before the week's first day) — otherwise adding
   a new practice today rewrites the verdict on every past week it was never
   part of. This is the one place that rule lives, so the Week page and the
   good-weeks streak cannot judge the same week differently. A practice with
   no evidence of its own history starts `asOf` (default: today). */
function reviewWeek(data, date, ws, starts, asOf) {
  const first = D.weekStart(date, ws);
  const practices = (data.practices || []).filter(p => (startFrom(p, starts) || asOf) <= first);
  const rows = weekSummary({ ...data, practices }, date, ws).filter(r => r.target !== null);
  const asked = rows.reduce((n, r) => n + r.target, 0);
  const done = rows.reduce((n, r) => n + Math.min(r.done, r.target), 0);
  const met = rows.filter(r => r.done >= r.target);
  const slipped = rows.filter(r => r.done < r.target).sort((a, b) => (a.done / a.target) - (b.done / b.target));
  const ratio = asked ? done / asked : 0;
  return { rows, asked, done, ratio, met, slipped };
}

function weekReview(data, date, weekStart, asOf) {
  const starts = firstSeen(data.log, new Set((data.practices || []).map(p => p.name)));
  return reviewWeek(data, date, weekStart ?? 1, starts, asOf || D.todayISO());
}

/* ---- streaks -------------------------------------------------------- */

/* Days in a row (ending on `date`) with at least one tick. */
function streak(log, date) {
  let n = 0, d = date;
  while (log && log.get(d) && log.get(d).done && log.get(d).done.size) { n++; d = D.addDays(d, -1); }
  return n;
}

/* Good weeks in a row: a week counts when at least 60% of what was asked
   got done. The current week joins the run only once it qualifies; an
   unfinished week never breaks it. Each practice's start is worked out
   once for the whole walk, not once per week. */
const GOOD_WEEK = 0.6;
function weekStreak(data, date, weekStart) {
  const ws = weekStart ?? 1;
  const starts = firstSeen(data.log, new Set((data.practices || []).map(p => p.name)));
  const forWeek = d => reviewWeek(data, d, ws, starts, date);
  let n = 0;
  let d = D.weekStart(date, ws);
  const cur = forWeek(d);
  if (cur.asked && cur.ratio >= GOOD_WEEK) n++;
  d = D.addDays(d, -7);
  for (let i = 0; i < 104; i++) {
    const r = forWeek(d);
    if (!r.asked || r.ratio < GOOD_WEEK) break;
    n++;
    d = D.addDays(d, -7);
  }
  return n;
}

function streakLabel(data, date, opts) {
  const mode = (opts && opts.streakMode) || 'days';
  if (mode === 'off') return '';
  if (mode === 'weeks') {
    const n = weekStreak(data, date, opts && opts.weekStart);
    return n >= 1 ? `${n} good week${n === 1 ? '' : 's'} in a row` : '';
  }
  /* The run only breaks once a whole PAST day had no tick — before
     anything is ticked today, show the run through yesterday rather than
     letting an unticked "today" zero it out every morning. */
  const today = entry(data.log, date);
  const from = today.done && today.done.size ? date : D.addDays(date, -1);
  const n = streak(data.log, from);
  return n >= 2 ? `${n} days in a row` : '';
}

/* ---- the plan board ------------------------------------------------- */

/* `n` day columns from `from`: what is promised to each day, the events
   already fixed there, and how many daily practices sit underneath. */
function boardDays(data, from, n, opts) {
  const weekStart = (opts && opts.weekStart) ?? 1;
  const events = (opts && opts.events) || data.events || [];
  const dailies = (data.practices || []).filter(p => !isFlexible(p));
  const out = [];
  for (let i = 0; i < n; i++) {
    const date = D.addDays(from, i);
    const planned = (data.practices || [])
      .filter(p => isPlanned(data.log, date, p.name))
      .map(p => ({ p, pr: progress(p, data.log, date, weekStart) }))
      .sort((a, b) => a.p.name.localeCompare(b.p.name));
    const dayEvents = events.filter(e => e.date === date)
      .sort((a, b) => ((a.time || '') + a.name).localeCompare((b.time || '') + b.name));
    const dailyCount = dailies.filter(p => {
      const days = parseDays(p.days);
      return !days.length || days.includes(D.dayKey(date));
    }).length;
    out.push({ date, planned, events: dayEvents, dailyCount, load: planned.length + dayEvents.length });
  }
  return out;
}

/* The shelf: flexible practices with sessions still to place. `need` is
   what no plan has a day for yet — the period's remaining sessions minus
   those promised inside the rest of the period — which is exactly the
   `unplanned` figure Today's urgency is taken on, so the two cannot
   disagree. The board's `n` days only decide what is VISIBLE; a promise
   anywhere in this period counts as placed whether or not it is shown. */
function shelf(data, from, n, opts) {
  const weekStart = (opts && opts.weekStart) ?? 1;
  const rank = areaRank(data.areas || []);
  const out = [];
  for (const p of (data.practices || []).filter(isFlexible)) {
    const pr = progress(p, data.log, from, weekStart);
    const need = pr.unplanned;
    if (need <= 0) continue;
    const placed = Math.max(0, pr.remaining - need);
    /* Pressure, not urgency: urgency goes to zero the moment something is
       ticked today, but a 4/week run ticked this morning still has three
       sessions looking for a home. What matters here is how much is left
       against how long is left to place it. */
    const pressure = need / Math.max(1, pr.daysLeft);
    out.push({ p, pr, need, placed, pressure, reason: reasonFor(p, pr, data.log, from) });
  }
  return out.sort((a, b) =>
    (b.pressure - a.pressure)
    || ((rank.get(a.p.area) ?? 99) - (rank.get(b.p.area) ?? 99))
    || a.p.name.localeCompare(b.p.name));
}

module.exports = {
  entry, logHas, isSkipped, isSnoozed, isPlanned, lastDone, sinceLabel, sinceInfo, practiceStart, plannedAhead, plannedCount, isFlexible, planWindow,
  boardDays, shelf,
  parseCadence, cadenceLabel, parseDays, progress, missedRun, reasonFor,
  planDay, groupByWhen, areaRank, WHEN_LABEL,
  sortGoals, nextGoal, goalsWithoutStep, upcoming, eventsInMonth, goalsForMonth,
  weekSummary, monthSummary, weekReview, streak, weekStreak, streakLabel,
};
