'use strict';
/* Vista reads and writes Rhythm's notes the way Rhythm does. "Rhythm's
   parser" below is src/rhythm-markdown.js - Rhythm's own markdown.js,
   vendored verbatim (scripts/check-rhythm-vendor.sh keeps it honest) - and
   rlist is Rhythm's io.js `list`. A tick must never erase or mangle what
   Rhythm reads; the loader must see exactly what Rhythm's board sees.
   Parity against a live Rhythm checkout: tests/rhythm-parity.test.cjs. */
const assert = require('node:assert');
require('./_stub.cjs');
const R = require('../src/rhythm');
const MD = require('../src/rhythm-markdown');
const { makeVault, makeApp, mkFile } = require('./_rhythm-fake.cjs');

const rlist = v => (Array.isArray(v) ? v : (v ? [v] : [])).map(String);
const rhythmReads = (text, key) => rlist(MD.parseFrontmatter(text).fm[key]);
const DAY = '2026-10-07';
const LOGP = `Rhythm/Log/${DAY}.md`;
const j = JSON.stringify;

/* Tick `name` on a day whose log note starts as `text`. */
async function ticked(text, name, on, settings) {
  const vault = makeVault({ [LOGP]: text });
  const res = await R.tick(makeApp(vault, settings), DAY, name, on);
  return { res, out: vault.files.get(LOGP).text, vault };
}

(async () => {
  /* ---- 1. every shape Rhythm reads as a list survives a tick ---------- */
  const keeps = [
    ['inline list + trailing comment', '---\nrhythm: log\ndone: [Walk, Read] # morning\n---\n', '---\nrhythm: log\ndone: [Walk, Read, Run]\n---\n'],
    ['scalar (hand edit)', '---\nrhythm: log\ndone: Walk\n---\n', '---\nrhythm: log\ndone: [Walk, Run]\n---\n'],
    ['comma scalar is ONE item to Rhythm', '---\nrhythm: log\ndone: Walk, Read\n---\n', '---\nrhythm: log\ndone: ["Walk, Read", Run]\n---\n'],
    ['single-quoted item holding a comma', "---\nrhythm: log\ndone: ['Rest, stretch', Walk]\n---\n", '---\nrhythm: log\ndone: ["Rest, stretch", Walk, Run]\n---\n'],
    ['block list with an empty item', '---\nrhythm: log\ndone:\n  - Walk\n  -\n  - Read\n---\n', '---\nrhythm: log\ndone: [Walk, Read, Run]\n---\n'],
    ['skip with a trailing comment is left untouched', '---\nrhythm: log\ndone: []\nskip: [Read] # too tired\n---\n', '---\nrhythm: log\ndone: [Run]\nskip: [Read] # too tired\n---\n'],
    ['a list the tick does not change keeps its exact source line', "---\nrhythm: log\nplan: ['Rest, stretch', Walk]  # why\ndone: []\n---\n", "---\nrhythm: log\nplan: ['Rest, stretch', Walk]  # why\ndone: [Run]\n---\n"],
    ['top-level (unindented) block list is a list', '---\nrhythm: log\ndone:\n- Walk\n- Read\n---\n', '---\nrhythm: log\ndone: [Walk, Read, Run]\n---\n'],
    ['done: null is an empty list, replaced in place', '---\nrhythm: log\ndone: null\nmood: ok\n---\n', '---\nrhythm: log\ndone: [Run]\nmood: ok\n---\n'],
    ['done: ~ with a comment', '---\nrhythm: log\ndone: ~ # none yet\n---\n', '---\nrhythm: log\ndone: [Run]\n---\n'],
    ['a tick clears only its own name from skip/snooze/plan', '---\nrhythm: log\ndone: []\nskip: [Run, Read]\nsnooze: [Run]\nplan: [Run, Walk]\n---\n', '---\nrhythm: log\ndone: [Run]\nskip: [Read]\nplan: [Walk]\n---\n'],
    ['bare empty keys are an empty list: done is replaced in place, an untouched skip: stays', '---\nrhythm: log\ndone:\nskip:\n---\n', '---\nrhythm: log\ndone: [Run]\nskip:\n---\n'],
    ['a nested map that happens to hold a done: line is not the done key', '---\nrhythm: log\nmeta:\n  done: x\n---\n', '---\nrhythm: log\nmeta:\n  done: x\ndone: [Run]\n---\n'],
    ['block done followed by other keys (r08)', '---\nrhythm: log\ndone:\n  - Walk\n  - Read\nmood: good\nplan: [Run]\n---\nbody\n', '---\nrhythm: log\ndone: [Walk, Read, Run]\nmood: good\n---\nbody\n'],
    ['done_at lookalike + comment lines (r08)', '---\n# my log\nrhythm: log\ndone_at: 07:00\ndone: [Walk] \n# trailing comment\n---\nbody', '---\n# my log\nrhythm: log\ndone_at: 07:00\ndone: [Walk, Run]\n# trailing comment\n---\nbody'],
    ['quoted item containing ", " (r08)', '---\nrhythm: log\ndone: ["Rest, stretch", Walk]\n---\n', '---\nrhythm: log\ndone: ["Rest, stretch", Walk, Run]\n---\n'],
    ['CRLF + BOM (r08)', '﻿---\r\nrhythm: log\r\ndone: [Walk]\r\n---\r\nbody\r\n', '﻿---\r\nrhythm: log\r\ndone: [Walk, Run]\r\n---\r\nbody\r\n'],
    ['empty frontmatter, body starts with --- (r08)', '---\n---\n---\nnot fm\n', '---\ndone: [Run]\n---\n---\nnot fm\n'],
    ['frontmatter not on the first line (r08)', '\n---\nrhythm: log\ndone: [Walk]\n---\n', '---\ndone: [Run]\n---\n\n\n---\nrhythm: log\ndone: [Walk]\n---\n'],
    ['no frontmatter at all', 'Just a body', '---\ndone: [Run]\n---\n\nJust a body'],
    ['an empty note (Rhythm\'s own output for it)', '', '---\ndone: [Run]\n---\n\n'],
    ['an empty list the tick does not change is left alone', '---\nrhythm: log\ndone: [A]\nskip: []\n---\n', '---\nrhythm: log\ndone: [A, Run]\nskip: []\n---\n'],
    ['a list the tick EMPTIES drops its key, as Rhythm does', '---\nrhythm: log\ndone: [A]\nskip: [Run]\n---\n', '---\nrhythm: log\ndone: [A, Run]\n---\n'],
  ];
  for (const [label, input, expected] of keeps) {
    const { res, out } = await ticked(input, 'Run', true);
    assert.strictEqual(res.ok, true, `${label}: tick succeeds`);
    assert.strictEqual(out, expected, `${label}: file bytes`);
    assert.ok(rhythmReads(out, 'done').includes('Run'), `${label}: Rhythm sees the tick`);
  }
  /* The earlier entries must still be there in Rhythm's own reading. */
  assert.deepStrictEqual(rhythmReads((await ticked('---\nrhythm: log\ndone: [Walk, Read] # morning\n---\n', 'Run', true)).out, 'done'), ['Walk', 'Read', 'Run']);
  assert.deepStrictEqual(rhythmReads((await ticked('---\nrhythm: log\ndone: Walk\n---\n', 'Run', true)).out, 'done'), ['Walk', 'Run']);

  /* Untick removes only that name, and leaves the rest alone. */
  {
    const { out } = await ticked('---\nrhythm: log\ndone: [Walk, Run]\nskip: [Read]\n---\n', 'Run', false);
    assert.strictEqual(out, '---\nrhythm: log\ndone: [Walk]\nskip: [Read]\n---\n');
    const sc = await ticked('---\nrhythm: log\ndone: Run\n---\n', 'Run', false);
    assert.strictEqual(sc.out, '---\nrhythm: log\ndone: []\n---\n', 'unticking the only (scalar) item leaves an empty list');
  }

  /* ---- 2. a line Rhythm cannot read is never overwritten -------------- */
  const refusals = [
    ['multi-line flow list in done', '---\nrhythm: log\ndone: [Walk,\n  Read]\n---\n', 'done'],
    ['multi-line flow list in skip (a tick clears skip)', '---\nrhythm: log\ndone: [Walk]\nskip: [Read,\n  Rest]\n---\n', 'skip'],
    ['folded scalar in plan', '---\nrhythm: log\ndone: []\nplan: >\n  Walk\n---\n', 'plan'],
    ['literal scalar in snooze', '---\nrhythm: log\nsnooze: |\n  Walk\n---\n', 'snooze'],
    ['an empty key followed past a blank line by an indented list', '---\nrhythm: log\ndone:\n\n  - Walk\n---\n', 'done'],
    ['key with a nested map', '---\nrhythm: log\ndone:\n  a: 1\n---\n', 'done'],
  ];
  for (const [label, input, key] of refusals) {
    const { res, out, vault } = await ticked(input, 'Run', true);
    assert.deepStrictEqual({ ok: res.ok, reason: res.reason, key: res.key }, { ok: false, reason: 'unreadable', key }, `${label}: refused`);
    assert.strictEqual(out, input, `${label}: file untouched`);
    assert.strictEqual(vault.writes, 0, `${label}: nothing written at all`);
  }
  /* Unticking is refused the same way. */
  assert.strictEqual((await ticked('---\nrhythm: log\ndone: [Walk,\n  Run]\n---\n', 'Run', false)).res.ok, false);

  /* ---- 3. names: Vista's writes round-trip through Rhythm's parser ---- */
  const names = ["Mom's call", 'Walk', 'Rest, stretch', 'Rest & recover', '{Focus}', '@home', '%body', '!Stretch', '- Walk', 'Yes', '2024', 'Ünïcödé 🙂', "a 'quoted' word", 'Read (Psalms)', 'Walk ', ' Walk', '~', 'Practice #1', 'Read [chapter 1]', 'True'];
  for (const n of names) {
    const want = n.trim();
    /* A: Vista writes two ticks -> Rhythm reads both, as typed */
    const vA = makeVault({}); vA.folders.add('Rhythm'); vA.folders.add('Rhythm/Log');
    const appA = makeApp(vA);
    await R.tick(appA, DAY, n, true);
    await R.tick(appA, DAY, 'Other', true);
    assert.deepStrictEqual(rhythmReads(vA.files.get(LOGP).text, 'done'), [want, 'Other'], `A ${j(n)}: Rhythm reads what Vista wrote`);
    /* D: unticking the same (untrimmed) name removes it */
    await R.tick(appA, DAY, n, false);
    assert.deepStrictEqual(rhythmReads(vA.files.get(LOGP).text, 'done'), ['Other'], `D ${j(n)}: unticks (name is trimmed before it is compared)`);
    /* B: Rhythm writes it alone, Vista ticks another -> both there */
    const rText = MD.patchFrontmatter('---\nrhythm: log\ndone: []\n---\n', { done: [want] });
    const b = await ticked(rText, 'Other', true);
    assert.deepStrictEqual(rhythmReads(b.out, 'done'), [want, 'Other'], `B ${j(n)}: Rhythm-written item survives a Vista tick`);
    /* C: Obsidian's block list -> Vista tick -> Rhythm */
    const c = await ticked(`---\nrhythm: log\ndone:\n  - ${want}\n---\n`, 'Other', true);
    assert.deepStrictEqual(rhythmReads(c.out, 'done'), [want, 'Other'], `C ${j(n)}: block list read, folded to Rhythm's inline form`);
  }
  assert.strictEqual(R.yamlItem("Mom's call"), '"Mom\'s call"', 'a mid-name apostrophe is double-quoted (Rhythm opens a quote at ANY apostrophe)');
  assert.strictEqual(R.yamlItem("a 'quoted' word"), '"a \'quoted\' word"');
  assert.strictEqual((await ticked('---\nrhythm: log\ndone: []\n---\n', "Mom's call", true)).out, '---\nrhythm: log\ndone: ["Mom\'s call"]\n---\n');
  /* Rhythm's own writer leaves a mid-name apostrophe bare; Vista reads that
     and heals it on its next write. */
  assert.strictEqual((await ticked("---\nrhythm: log\ndone: [Mom's call]\n---\n", 'Run', true)).out, '---\nrhythm: log\ndone: ["Mom\'s call", Run]\n---\n');
  for (const [raw, quoted] of [['Plan a trip, or a surprise', '"Plan a trip, or a surprise"'], ['2024', '"2024"'], ['Read 20 pages', 'Read 20 pages'], ['Practice #1', '"Practice #1"'], ['Read [chapter 1]', '"Read [chapter 1]"'], ['Stretch {am}', '"Stretch {am}"'], ['True', '"True"'], ['null', '"null"'], ['YES', '"YES"'], ['~', '"~"']]) {
    assert.strictEqual(R.yamlItem(raw), quoted, `yamlItem ${raw}`);
  }

  /* The result describes the change; a clean tick reports the flags it replaced. */
  {
    const { res } = await ticked('---\nrhythm: log\ndone: []\nskip: [Run]\nplan: [Run]\n---\n', 'Run', true);
    assert.deepStrictEqual(res, { ok: true, path: LOGP, prev: { done: false, skip: true, snooze: false, plan: true } });
  }

  /* ---- 4. creating the day's log ------------------------------------- */
  {
    const v = makeVault({ 'Rhythm/Practices/Read 20 pages.md': '' });
    const res = await R.tick(makeApp(v), '2026-10-13', 'Read 20 pages', true);
    assert.deepStrictEqual({ ok: res.ok, path: res.path }, { ok: true, path: 'Rhythm/Log/2026-10-13.md' });
    assert.strictEqual(v.files.get(res.path).text, '---\nrhythm: log\ndone: [Read 20 pages]\n---\n');
  }
  /* Two ticks that both see no Log folder: the loser of createFolder must
     carry on, not fail with "Folder already exists." */
  {
    const v = makeVault({ 'Rhythm/Practices/A.md': '' }, { slowFolder: true });
    const app = makeApp(v);
    const rs = await Promise.all([R.tick(app, DAY, 'A', true), R.tick(app, DAY, 'B', true)]);
    assert.ok(rs.every(r => r.ok), 'both ticks succeed');
    assert.deepStrictEqual(rhythmReads(v.files.get(LOGP).text, 'done'), ['A', 'B'], 'both survive the create race');
  }
  /* A folder that really cannot be made still fails loudly. */
  {
    const v = makeVault({});
    v.createFolder = async () => { throw new Error('disk full'); };
    await assert.rejects(R.tick(makeApp(v), DAY, 'A', true), /disk full/);
  }
  /* back-to-back ticks on an existing note each see the other */
  {
    const v = makeVault({ [LOGP]: '---\nrhythm: log\ndone: [Read 20 pages]\n---\n' });
    const app = makeApp(v);
    await R.tick(app, DAY, 'Exercise', true);
    await R.tick(app, DAY, 'Practice guitar', true);
    assert.strictEqual(v.files.get(LOGP).text, '---\nrhythm: log\ndone: [Read 20 pages, Exercise, Practice guitar]\n---\n');
  }
  /* a transform that throws mid-way writes nothing */
  {
    const v = makeVault({ [LOGP]: '---\nrhythm: log\ndone: [Walk]\n---\n' });
    const orig = v.process; v.process = (f, fn) => orig(f, t => { fn(t); throw new Error('boom'); });
    await assert.rejects(R.tick(makeApp(v), DAY, 'Run', true), /boom/);
    assert.strictEqual(v.files.get(LOGP).text, '---\nrhythm: log\ndone: [Walk]\n---\n');
  }
  /* no vault.process on the host: plain read + modify, same bytes */
  {
    const v = makeVault({ [LOGP]: '---\nrhythm: log\ndone: Walk\n---\n' });
    delete v.process;
    await R.tick(makeApp(v), DAY, 'Run', true);
    assert.strictEqual(v.files.get(LOGP).text, '---\nrhythm: log\ndone: [Walk, Run]\n---\n');
  }

  /* ---- 5. the loader reads the NOTES, with Rhythm's parser ------------- */
  const put = (v, path, text, ctime) => { const f = mkFile(path, text, ctime); v.files.set(path, f); const parts = path.split('/'); for (let i = 1; i < parts.length; i++) v.folders.add(parts.slice(0, i).join('/')); return f; };
  const vault = makeVault({});
  const folderFiles = {
    'Rhythm/Areas/Health.md': '---\nrhythm: area\norder: 1\n---\n',
    'Rhythm/Areas/Fitness.md': '---\nrhythm: area\norder: 2\n---\n',
    'Rhythm/Areas/Garden.md': '---\nrhythm: area\norder: 3\n---\n',
    'Rhythm/Practices/Read 20 pages.md': '---\nrhythm: practice\narea: Health\ncadence: daily\nwhen: morning\n---\n',
    'Rhythm/Practices/Call a friend.md': '---\nrhythm: practice\narea: [[Health]]\ncadence: daily\nwhen: morning\n---\n',
    'Rhythm/Practices/Exercise.md': '---\nrhythm: practice\narea: Fitness\ncadence: 3/week\nwhen: day\ndays:\n  - mon\n  - wed\nminutes: 30\n---\n',
    'Rhythm/Practices/Practice guitar.md': '---\nrhythm: practice\narea: Garden\ncadence: daily\nwhen: evening\ntime: 18:30\n---\n',
    'Rhythm/Practices/Paused thing.md': '---\nrhythm: practice\narea: Garden\ncadence: daily\nstatus: paused\n---\n',
    'Rhythm/Practices/Set aside.md': '---\nrhythm: practice\narea: Garden\ncadence: daily\nstatus: aside\n---\n',
    'Rhythm/Log/2026-09-12.md': '---\nrhythm: log\ndone: [Practice guitar]\nsnooze: [Call a friend]\n---\n',
    'Rhythm/Log/2026-09-13.md': '---\nrhythm: log\ndone: [Read 20 pages, Exercise] # evening\nskip: Practice guitar, Call a friend\nplan: Exercise\n---\n',
    'Rhythm/Log/2026-09-14.md': '---\nrhythm: log\ndone: [Read 20 pages,\n  Exercise]\n---\n',
    'Rhythm/Log/2026-09-15.md': '---\nrhythm: log\ndone:\n  - Exercise\n  -\n  - Read 20 pages\n---\n',
    'Rhythm/Log/not-a-date.md': '---\nrhythm: log\ndone: [x]\n---\n',
    'Rhythm/Log/2026-09-16.png': 'binary',
  };
  for (const [p, t] of Object.entries(folderFiles)) put(vault, p, t);
  const app = makeApp(vault, { folder: 'Rhythm', focusCount: 3, weekStart: 1 });

  const data = await R.loadRhythm(app, 'Rhythm');
  assert.deepStrictEqual(data.areas.map(a => [a.name, a.order]), [['Fitness', 2], ['Garden', 3], ['Health', 1]], 'areas read from text, in Rhythm\'s name order');
  assert.deepStrictEqual(data.practices.map(p => p.name), ['Call a friend', 'Exercise', 'Practice guitar', 'Read 20 pages'], 'aside and paused are left out; name order as in Rhythm');
  const byName = n => data.practices.find(p => p.name === n);
  assert.strictEqual(byName('Call a friend').area, 'Health', 'an unquoted [[Health]] area is the area name Health (not a nested array, not the brackets)');
  assert.deepStrictEqual(byName('Exercise').days, ['mon', 'wed'], 'a block-list days: is read as Rhythm reads it');
  assert.strictEqual(byName('Exercise').minutes, 30);
  assert.strictEqual(byName('Practice guitar').time, '18:30');
  assert.strictEqual(byName('Read 20 pages').time, '');
  assert.strictEqual(byName('Read 20 pages').when, 'morning');
  assert.deepStrictEqual(data.aside.map(p => p.name), ['Paused thing', 'Set aside']);
  assert.ok(data.log.has('2026-09-12') && !data.log.has('not-a-date') && !data.log.has('2026-09-16'), 'only date-named .md notes are logs');
  const L = d => { const e = data.log.get(d); return { done: [...e.done], skip: [...e.skip], snooze: [...e.snooze], plan: [...e.plan] }; };
  assert.deepStrictEqual(L('2026-09-13'), { done: ['Read 20 pages', 'Exercise'], skip: ['Practice guitar, Call a friend'], snooze: [], plan: ['Exercise'] }, 'trailing comment stripped; a scalar is ONE item, as Rhythm reads it');
  assert.deepStrictEqual(L('2026-09-14'), { done: [], skip: [], snooze: [], plan: [] }, 'a multi-line flow list is empty to Rhythm, so empty here');
  assert.deepStrictEqual(L('2026-09-15').done, ['Exercise', '', 'Read 20 pages'], 'a block list is read as Rhythm reads it');

  /* area written as an alias / folder wikilink, and quoted */
  {
    const v2 = makeVault({});
    put(v2, 'Rhythm/Practices/A.md', '---\nrhythm: practice\narea: [[Health|my health]]\n---\n');
    put(v2, 'Rhythm/Practices/B.md', '---\nrhythm: practice\narea: "[[Areas/Deep/Health]]"\n---\n');
    put(v2, 'Rhythm/Practices/C.md', '---\nrhythm: practice\narea:  Fitness \n---\n');
    put(v2, 'Rhythm/Practices/D.md', '---\nrhythm: practice\n---\n');
    const d2 = await R.loadRhythm(makeApp(v2), 'Rhythm');
    assert.deepStrictEqual(d2.practices.map(p => p.area), ['Health', 'Health', 'Fitness', '']);
  }
  /* `created` comes ONLY from a real created: YYYY-MM-DD line - never from the file's stat */
  {
    const v2 = makeVault({});
    put(v2, 'Rhythm/Practices/Dated.md', '---\nrhythm: practice\ncreated: 2026-09-01\n---\n', new Date(2026, 9, 1).getTime());
    put(v2, 'Rhythm/Practices/Quoted.md', '---\nrhythm: practice\ncreated: "2026-09-02"\n---\n');
    put(v2, 'Rhythm/Practices/Impossible.md', '---\nrhythm: practice\ncreated: 2026-13-45\n---\n', new Date(2026, 9, 1).getTime());
    put(v2, 'Rhythm/Practices/Junk.md', '---\nrhythm: practice\ncreated: yesterday\n---\n');
    put(v2, 'Rhythm/Practices/OnlyStat.md', '---\nrhythm: practice\n---\n', new Date(2026, 8, 1, 23, 30).getTime());
    const d2 = await R.loadRhythm(makeApp(v2), 'Rhythm');
    const c = n => d2.practices.find(p => p.name === n).created;
    assert.strictEqual(c('Dated'), '2026-09-01');
    assert.strictEqual(c('Quoted'), '2026-09-02');
    assert.strictEqual(c('Impossible'), undefined, 'a shape-valid but impossible date is not a date');
    assert.strictEqual(c('Junk'), undefined);
    assert.strictEqual(c('OnlyStat'), undefined, 'file ctime is the day a sync copied the note, not the day it began');
    assert.ok(!('created' in d2.practices.find(p => p.name === 'OnlyStat')));
    assert.strictEqual(d2.practices.find(p => p.name === 'OnlyStat').cadence, 'daily', 'defaults as Rhythm');
  }
  /* an unreadable file is skipped, not fatal */
  {
    const v3 = makeVault({ 'Rhythm/Practices/A.md': '---\nrhythm: practice\n---\n', 'Rhythm/Practices/B.md': '---\nrhythm: practice\n---\n' }, { failRead: f => f.basename === 'A' });
    const realErr = console.error; console.error = () => {};
    try { assert.deepStrictEqual((await R.loadRhythm(makeApp(v3), 'Rhythm')).practices.map(p => p.name), ['B']); } finally { console.error = realErr; }
  }
  assert.strictEqual(await R.loadRhythm(makeApp(makeVault({})), 'Rhythm'), null, 'no Rhythm folder: null');
  /* the metadata cache is not consulted at all */
  {
    const v4 = makeVault({ 'Rhythm/Practices/A.md': '---\nrhythm: practice\narea: Real\n---\n' });
    const a4 = makeApp(v4); a4.metadataCache = { getFileCache() { throw new Error('metadata cache must not be used'); } };
    assert.strictEqual((await R.loadRhythm(a4, 'Rhythm')).practices[0].area, 'Real');
  }

  /* ---- 6. today: Rhythm's own plan over those records ----------------- */
  const t = await R.todayFromRhythm(app, '2026-09-12');
  assert.strictEqual(t.available, true);
  assert.strictEqual(t.total, 4, 'paused/aside practices are left out');
  assert.strictEqual(t.done, 1);
  const fnames = t.focus.map(r => r.name);
  assert.ok(fnames.includes('Read 20 pages'));
  assert.ok(!fnames.includes('Practice guitar'), 'done today is not in focus');
  assert.ok(!fnames.includes('Call a friend'), 'snoozed is not in focus');
  assert.strictEqual(t.focus.find(r => r.name === 'Read 20 pages').reason, 'Every day');
  assert.strictEqual(t.focus[0].whenLabel, 'Morning');
  assert.strictEqual(t.streakLabel, '', 'one done day is not yet a streak');

  const streakFiles = {
    'Rhythm/Areas/Health.md': '---\nrhythm: area\norder: 1\n---\n',
    'Rhythm/Practices/Journal.md': '---\nrhythm: practice\narea: Health\ncadence: daily\n---\n',
    'Rhythm/Log/2026-09-25.md': '---\nrhythm: log\ndone: [Journal]\n---\n',
    'Rhythm/Log/2026-09-26.md': '---\nrhythm: log\ndone: [Journal]\n---\n',
    'Rhythm/Log/2026-09-27.md': '---\nrhythm: log\ndone: [Journal]\n---\n',
  };
  for (const [mode, want] of [['days', '3 days in a row'], ['off', '']]) {
    const sv = makeVault(streakFiles);
    assert.strictEqual((await R.todayFromRhythm(makeApp(sv, { folder: 'Rhythm', focusCount: 3, weekStart: 1, streakMode: mode }), '2026-09-27')).streakLabel, want, `streakMode ${mode}`);
  }
  /* a custom Rhythm folder and focusCount are honoured */
  {
    const cv = makeVault({
      'Life/Practices/A.md': '---\nrhythm: practice\ncadence: daily\n---\n', 'Life/Practices/B.md': '---\nrhythm: practice\ncadence: daily\n---\n', 'Life/Practices/C.md': '---\nrhythm: practice\ncadence: daily\n---\n',
    });
    const ct = await R.todayFromRhythm(makeApp(cv, { folder: '/Life/', focusCount: 2, weekStart: 0 }), DAY);
    assert.strictEqual(ct.focus.length, 2); assert.strictEqual(ct.later, 1); assert.strictEqual(ct.folder, 'Life');
  }
  /* defaults when Rhythm is not installed; nothing to show without notes */
  assert.deepStrictEqual(R.rhythmSettings({}), { folder: 'Rhythm', focusCount: 3, weekStart: 1, streakMode: 'days', installed: false });
  assert.strictEqual((await R.todayFromRhythm(makeApp(makeVault({}), null), '2026-09-12')).available, false);

  /* time breaks a tie inside one `when`; aside hides a practice (io.js) */
  {
    const tied = makeVault({
      'Rhythm/Areas/Health.md': '---\nrhythm: area\norder: 1\n---\n',
      'Rhythm/Practices/Anchor.md': '---\nrhythm: practice\narea: Health\ncadence: daily\nwhen: morning\ntime: 07:30\n---\n',
      'Rhythm/Practices/Bravo.md': '---\nrhythm: practice\narea: Health\ncadence: daily\nwhen: morning\n---\n',
      'Rhythm/Practices/Zeal.md': '---\nrhythm: practice\narea: Health\ncadence: daily\nwhen: morning\ntime: 06:00\n---\n',
      'Rhythm/Practices/Set aside.md': '---\nrhythm: practice\narea: Health\ncadence: daily\nwhen: morning\nstatus: aside\n---\n',
    });
    const tt = await R.todayFromRhythm(makeApp(tied, { folder: 'Rhythm', focusCount: 3, weekStart: 1 }), '2026-09-12');
    assert.strictEqual(tt.total, 3);
    assert.deepStrictEqual(tt.focus.map(r => r.name), ['Zeal', 'Anchor', 'Bravo']);
  }

  /* ---- 7. Rhythm's own words when nothing is due (page-today.js) ------ */
  const all = n => ({ focus: [], later: 0, done: 0, total: n });
  assert.deepStrictEqual(R.emptyLabel({ focus: [], later: 0, done: 0, total: 0 }), { num: '—', line: 'No practices yet.', rest: 'Add one with the plus button, or write a note in the Practices folder.' });
  assert.deepStrictEqual(R.emptyLabel(all(2)), { num: '·', line: 'Nothing is due.', rest: 'Rest is allowed.' }, 'two snoozed practices: Rhythm says Nothing is due, not "Well done"');
  assert.deepStrictEqual(R.emptyLabel({ focus: [], later: 0, done: 1, total: 2 }), { num: '1', line: 'thing done.', rest: 'Nothing more is asked of today.' });
  assert.deepStrictEqual(R.emptyLabel({ focus: [], later: 0, done: 3, total: 3 }), { num: '3', line: 'things done.', rest: 'Nothing more is asked of today.' });
  assert.strictEqual(R.emptyLabel({ focus: [{}], later: 0, done: 0, total: 1 }), null, 'something is due: no empty label');
  assert.deepStrictEqual(R.heroLines({ focus: [{}, {}], later: 1, done: 0, total: 3 }), { num: '2', line: 'things for today.', rest: "1 more when there's space." });
  assert.deepStrictEqual(R.heroLines({ focus: [{}], later: 0, done: 2, total: 3 }), { num: '1', line: 'thing for today.', rest: '2 already done.' });
  assert.deepStrictEqual(R.heroLines({ focus: [{}], later: 0, done: 0, total: 1 }), { num: '1', line: 'thing for today.', rest: 'That is the whole list.' });
  {
    /* the day in the audit's repro (rhythm-empty): both practices snoozed */
    const sv = makeVault({
      'Rhythm/Practices/Read.md': '---\nrhythm: practice\ncadence: daily\n---\n', 'Rhythm/Practices/Walk.md': '---\nrhythm: practice\ncadence: daily\n---\n',
      [LOGP]: '---\nrhythm: log\nsnooze: [Read, Walk]\n---\n',
    });
    const st = await R.todayFromRhythm(makeApp(sv), DAY);
    assert.strictEqual(st.focus.length, 0); assert.strictEqual(st.later, 2, 'snoozed practices wait under "when there\'s space"');
    assert.deepStrictEqual(R.emptyLabel(st), { num: '0', line: 'things for today.', rest: "2 more when there's space." }, 'Rhythm\'s hero for this day, not "Nothing owed today. Well done."');
  }

  /* ---- 8. no home-directory paths in the public repo's Rhythm tests --- */
  const fs = require('node:fs'), path = require('node:path');
  const home = ['', 'Users', ''].join('/');
  for (const f of fs.readdirSync(__dirname).filter(f => /^(_rhythm-fake|rhythm.*\.test)\.cjs$/.test(f))) {
    assert.ok(!fs.readFileSync(path.join(__dirname, f), 'utf8').includes(home), `${f}: names an absolute home path`);
  }
  for (const f of ['rhythm.js', 'rhythm-markdown.js']) {
    assert.ok(!fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8').includes(home), `src/${f}: names an absolute home path`);
  }

  console.log('rhythm OK');
})().catch(e => { console.error(e); process.exit(1); });
