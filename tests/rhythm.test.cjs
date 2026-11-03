'use strict';
/* Vista's Rhythm practices seam: the words Vista owns (heroLines /
   emptyLabel) and the two calls that go to Rhythm's api. Vista no longer
   reads or writes Rhythm's notes, so there is no parser here to test: what is
   pinned is that the plan comes from api.practices.today, that a tick hands
   the row's own `ref` straight to api.practices.tick, and that every refusal
   Rhythm can give reaches the notice. */
const assert = require('node:assert');
require('./_stub.cjs');
const R = require('../src/rhythm');
const DB = require('../src/dashboard');
const { makeRhythm } = require('./_rhythm-api-stub.cjs');

const DAY = '2026-10-07';
const PRACTICES = [
  { name: 'Stretch', area: 'Health', when: 'morning', whenLabel: 'Morning', reason: 'daily' },
  { name: 'Walk', area: 'Health', when: 'day', whenLabel: 'Day', reason: '3/week' },
];

(async () => {
  /* ---- 1. today: what Rhythm answers, rows keep their ref ------------- */
  {
    const rh = makeRhythm({ practices: PRACTICES });
    const t = await R.todayFromRhythm(rh.api, DAY);
    assert.deepStrictEqual(rh.calls, [['today', { date: DAY }]], 'asked for exactly the day, nothing else');
    assert.strictEqual(t.available, true);
    assert.deepStrictEqual(t.focus.map(r => r.name), ['Stretch', 'Walk']);
    assert.deepStrictEqual(Object.keys(t.focus[0]).sort(), ['area', 'done', 'name', 'path', 'reason', 'ref', 'when', 'whenLabel'], 'the contract row, ref included');
    assert.strictEqual(t.streakLabel, '3-day streak', "Rhythm's own streak words pass through");
    assert.strictEqual(t.folder, 'Rhythm');
    assert.strictEqual(t.total, 2);
  }
  /* no practices yet: Rhythm says unavailable and the card hides */
  {
    const t = await R.todayFromRhythm(makeRhythm({ practices: [] }).api, DAY);
    assert.strictEqual(t.available, false);
    assert.deepStrictEqual(t.focus, []);
  }
  /* a thin answer is padded, never read as an error */
  {
    const t = await R.todayFromRhythm({ apiVersion: 1, practices: { today: async () => ({ available: true }) } }, DAY);
    assert.deepStrictEqual([t.available, t.focus, t.later, t.done, t.date], [true, [], 0, 0, DAY]);
    const none = await R.todayFromRhythm({ apiVersion: 1, practices: { today: async () => null } }, DAY);
    assert.strictEqual(none.available, false);
  }
  /* no api at all: nothing, and no throw */
  assert.deepStrictEqual(await R.todayFromRhythm(null, DAY), { available: false, focus: [], later: 0, done: 0, date: DAY });
  /* a rejection is the caller's to catch (the dashboard hides the card) */
  await assert.rejects(R.todayFromRhythm({ apiVersion: 1, practices: { today: async () => { throw new Error('boom'); } } }, DAY), /boom/);

  /* ---- 2. tick: the row's ref goes straight through ------------------- */
  {
    const rh = makeRhythm({ practices: PRACTICES });
    const t = await R.todayFromRhythm(rh.api, DAY);
    rh.calls.length = 0;
    const res = await R.tickPractice(rh.api, t.focus[0], true);
    assert.deepStrictEqual(res, { ok: true, prev: { done: false, skip: false, snooze: false, plan: false } });
    assert.deepStrictEqual(rh.calls, [['tick', t.focus[0].ref, true]], 'ref passed as given, no re-read first');
    assert.strictEqual((await R.todayFromRhythm(rh.api, DAY)).focus[0].done, true, 'and Rhythm now says it is done');
    await R.tickPractice(rh.api, t.focus[0], false);
    assert.strictEqual((await R.todayFromRhythm(rh.api, DAY)).focus[0].done, false, 'untick');
    assert.ok(rh.calls.some(c => c[0] === 'tick' && c[1] === t.focus[0].ref && c[2] === false), 'the untick went through with the same ref');
  }
  /* a row with no ref is never sent: Rhythm cannot re-check what it did not issue */
  {
    const rh = makeRhythm({ practices: PRACTICES });
    assert.deepStrictEqual(await R.tickPractice(rh.api, { name: 'Stretch' }, true), { ok: false, reason: 'bad-ref' });
    assert.deepStrictEqual(await R.tickPractice(rh.api, null, true), { ok: false, reason: 'bad-ref' });
    assert.deepStrictEqual(rh.calls, [], 'the api was not called');
    assert.deepStrictEqual(await R.tickPractice(null, { ref: 'x' }, true), { ok: false, reason: 'unavailable' });
    assert.deepStrictEqual(await R.tickPractice({ apiVersion: 1, practices: { tick: async () => undefined } }, { ref: 'x' }, true), { ok: false }, 'an empty answer is a refusal, never a success');
  }
  /* refusals flow to the notice, in Vista's words */
  {
    const rh = makeRhythm({ practices: PRACTICES });
    const t = await R.todayFromRhythm(rh.api, DAY);
    rh.state.unreadable = 'done';
    const unreadable = await R.tickPractice(rh.api, t.focus[0], true);
    assert.deepStrictEqual(unreadable, { ok: false, reason: 'unreadable', key: 'done' });
    assert.match(DB.rhythmRefusedNotice(unreadable), /the "done" line in today's Rhythm log.*left the note alone/);
    rh.state.unreadable = null;
    const changed = await R.tickPractice(rh.api, { ref: `pr:${DAY}:Gone` }, true);
    assert.deepStrictEqual(changed, { ok: false, reason: 'changed' });
    assert.match(DB.rhythmRefusedNotice(changed), /changed in Rhythm/);
    const bad = await R.tickPractice(rh.api, { ref: 'garbage' }, true);
    assert.deepStrictEqual(bad, { ok: false, reason: 'bad-ref' });
    assert.match(DB.rhythmRefusedNotice(bad), /changed in Rhythm/, "'bad-ref' reads like a stale row");
    rh.state.doneThatDay = new Set(['Walk']);
    const dtd = await R.tickPractice(rh.api, { ref: `pr:${DAY}:Walk` }, true);
    assert.deepStrictEqual(dtd, { ok: false, reason: 'done-that-day' });
    assert.match(DB.rhythmRefusedNotice(dtd), /already has that practice done/);
    const nm = await R.tickPractice(rh.api, { ref: `pr:${DAY}: ` }, true);
    assert.deepStrictEqual(nm, { ok: false, reason: 'name' });
    assert.match(DB.rhythmRefusedNotice(nm), /could not write that tick/, "'name' and anything unknown get the general line");
  }

  /* ---- 3. Rhythm's own words when nothing is due (page-today.js) ------ */
  const all = n => ({ focus: [], later: 0, done: 0, total: n });
  assert.deepStrictEqual(R.emptyLabel({ focus: [], later: 0, done: 0, total: 0 }), { num: '—', line: 'No practices yet.', rest: 'Add one with the plus button, or write a note in the Practices folder.' });
  assert.deepStrictEqual(R.emptyLabel(all(2)), { num: '·', line: 'Nothing is due.', rest: 'Rest is allowed.' }, 'two snoozed practices: Rhythm says Nothing is due, not "Well done"');
  assert.deepStrictEqual(R.emptyLabel({ focus: [], later: 0, done: 1, total: 2 }), { num: '1', line: 'thing done.', rest: 'Nothing more is asked of today.' });
  assert.deepStrictEqual(R.emptyLabel({ focus: [], later: 0, done: 3, total: 3 }), { num: '3', line: 'things done.', rest: 'Nothing more is asked of today.' });
  assert.strictEqual(R.emptyLabel({ focus: [{}], later: 0, done: 0, total: 1 }), null, 'something is due: no empty label');
  assert.deepStrictEqual(R.heroLines({ focus: [{}, {}], later: 1, done: 0, total: 3 }), { num: '2', line: 'things for today.', rest: "1 more when there's space." });
  assert.deepStrictEqual(R.heroLines({ focus: [{}], later: 0, done: 2, total: 3 }), { num: '1', line: 'thing for today.', rest: '2 already done.' });
  assert.deepStrictEqual(R.heroLines({ focus: [{}], later: 0, done: 0, total: 1 }), { num: '1', line: 'thing for today.', rest: 'That is the whole list.' });
  /* the day in the audit's repro (rhythm-empty): both practices snoozed, so the plan has none in focus and two later */
  assert.deepStrictEqual(R.emptyLabel({ focus: [], later: 2, done: 0, total: 2 }), { num: '0', line: 'things for today.', rest: "2 more when there's space." }, 'not "Nothing owed today. Well done."');

  /* ---- 4. the module does I/O through the api and nothing else -------- */
  const fs = require('node:fs'), path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'rhythm.js'), 'utf8');
  assert.ok(!/vault|metadataCache|cachedRead|parseFrontmatter|require\('\.\/rhythm-(markdown|model|dates)'\)/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), 'rhythm.js touches no vault and no vendored parser');
  const home = ['', 'Users', ''].join('/');
  for (const f of ['rhythm.js', 'rhythm-api.js']) assert.ok(!fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8').includes(home), `src/${f}: names an absolute home path`);
  for (const f of ['rhythm.test.cjs', 'rhythm-api.test.cjs', '_rhythm-api-stub.cjs']) assert.ok(!fs.readFileSync(path.join(__dirname, f), 'utf8').includes(home), `${f}: names an absolute home path`);

  console.log('rhythm OK');
})().catch(e => { console.error(e); process.exit(1); });
