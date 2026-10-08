'use strict';
/* Parity with a LIVE Rhythm checkout: Vista's loader and tick against
   Rhythm's own io.js, on the same notes. Needs a Rhythm git checkout:
     RHYTHM_REPO=/path/to/rhythm-vault [RHYTHM_REF=<commit>] node tests/rhythm-parity.test.cjs
   RHYTHM_REF defaults to the commit scripts/check-rhythm-vendor.sh pins (the
   one the vendored files came from). Without RHYTHM_REPO it skips - the
   public repo must not depend on a path on any one machine.
   It also runs Rhythm's own tests/model.test.cjs, read from the repo at the
   ref, against Vista's vendored model (see the end of this file). */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');

const repo = process.env.RHYTHM_REPO;
if (!repo) { console.log('rhythm parity SKIPPED (set RHYTHM_REPO to a Rhythm checkout)'); process.exit(0); }
const pinned = (/^PINNED_REF="([^"]+)"/m.exec(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'check-rhythm-vendor.sh'), 'utf8')) || [])[1];
const ref = process.env.RHYTHM_REF || pinned;
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
try { git('rev-parse', '--verify', ref + '^{commit}'); } catch (e) { console.log(`rhythm parity SKIPPED (${ref} is not a commit in ${repo})`); process.exit(0); }

/* Rhythm's src at the ref, in a scratch dir (never its working tree: another
   session may be editing it). */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rhythm-ref-'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* best effort */ } });
const tarFile = path.join(tmp, 'src.tar');
fs.writeFileSync(tarFile, execFileSync('git', ['-C', repo, 'archive', ref, 'src']));
execFileSync('tar', ['-xf', tarFile, '-C', tmp]);

require('./_stub.cjs');
const R = require('../src/rhythm');
const { makeVault, makeApp, mkFile } = require('./_rhythm-fake.cjs');
const { makeStore } = require(path.join(tmp, 'src', 'io.js'));
const DAY = '2026-10-07';
const LOGP = `Rhythm/Log/${DAY}.md`;

const putAll = (v, files) => { for (const [p, t] of Object.entries(files)) { v.files.set(p, mkFile(p, t)); const parts = p.split('/'); for (let i = 1; i < parts.length; i++) v.folders.add(parts.slice(0, i).join('/')); } };
const storeFor = vault => makeStore({ app: { vault }, settings: { folder: 'Rhythm' } });

(async () => {
  /* ---- the vendored files are Rhythm's, at this ref ------------------- */
  execFileSync('bash', [path.join(__dirname, '..', 'scripts', 'check-rhythm-vendor.sh'), ref], { env: Object.assign({}, process.env, { RHYTHM_REPO: repo }), stdio: 'pipe' });

  /* ---- loader: Vista's records == Rhythm's io.load() ------------------ */
  const notes = {
    'Rhythm/Areas/Health.md': '---\nrhythm: area\norder: 1\n---\n',
    'Rhythm/Areas/Fitness.md': '---\nrhythm: area\norder: 2\n---\nFitness note.\n',
    'Rhythm/Practices/Read 20 pages.md': '---\nrhythm: practice\narea: Health\ncadence: daily\nwhen: morning\ncreated: 2026-09-01\n---\n',
    'Rhythm/Practices/Call a friend.md': '---\nrhythm: practice\narea: [[Health]]\ncadence: daily\nwhen: morning\n---\n',
    'Rhythm/Practices/Alias.md': '---\nrhythm: practice\narea: [[Areas/Health|f]]\ncadence: daily\n---\n',
    'Rhythm/Practices/Exercise.md': '---\nrhythm: practice\narea: Fitness\ncadence: 3/week\nwhen: day\ndays:\n  - mon\n  - wed\nminutes: 30\ncreated: 2026-13-45\n---\n',
    'Rhythm/Practices/Guitar.md': '---\nrhythm: practice\narea: Garden\ncadence: daily\nwhen: evening\ntime: 18:30\n---\n',
    'Rhythm/Practices/Paused.md': '---\nrhythm: practice\ncadence: daily\nstatus: paused\n---\n',
    'Rhythm/Practices/Aside.md': '---\nrhythm: practice\ncadence: daily\nstatus: aside\n---\n',
    'Rhythm/Log/2026-09-12.md': '---\nrhythm: log\ndone: [Guitar]\nsnooze: [Call a friend]\n---\n',
    'Rhythm/Log/2026-09-13.md': '---\nrhythm: log\ndone: [Read 20 pages, Exercise] # evening\nskip: Guitar, Call a friend\nplan: Exercise\n---\n',
    'Rhythm/Log/2026-09-14.md': '---\nrhythm: log\ndone: [Read 20 pages,\n  Exercise]\n---\n',
    'Rhythm/Log/2026-09-15.md': '---\nrhythm: log\ndone:\n- Exercise\n-\n  - Read 20 pages\n---\n',
    'Rhythm/Log/2026-09-16.md': "---\nrhythm: log\ndone: [Mom's call, Read 20 pages]\nskip: ['Rest, stretch', Walk]\n---\n",
    'Rhythm/Log/not-a-date.md': '---\nrhythm: log\ndone: [x]\n---\n',
  };
  {
    const v = makeVault({}); putAll(v, notes);
    const theirs = await storeFor(v).load();
    const ours = await R.loadRhythm(makeApp(v), 'Rhythm');
    const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k]]));
    const PK = ['name', 'area', 'cadence', 'days', 'minutes', 'when', 'time', 'path', 'aside', 'created'];
    assert.deepStrictEqual(ours.areas.map(a => pick(a, ['name', 'order', 'path'])), theirs.areas.map(a => pick(a, ['name', 'order', 'path'])), 'areas');
    assert.deepStrictEqual(ours.practices.map(p => pick(p, PK)), theirs.practices.map(p => pick(p, PK)), 'practices');
    assert.deepStrictEqual(ours.aside.map(p => pick(p, PK)), theirs.aside.map(p => pick(p, PK)), 'aside');
    assert.deepStrictEqual([...ours.log.keys()], [...theirs.log.keys()], 'log days');
    for (const [d, e] of theirs.log) for (const k of ['done', 'skip', 'snooze', 'plan']) assert.deepStrictEqual([...ours.log.get(d)[k]], [...e[k]], `log ${d} ${k}`);
  }

  /* ---- tick: Vista's bytes == Rhythm's setDone bytes ------------------ */
  const shapes = {
    'inline + comment': '---\nrhythm: log\ndone: [Walk, Read] # morning\n---\n',
    'scalar': '---\nrhythm: log\ndone: Walk\n---\n',
    'comma scalar': '---\nrhythm: log\ndone: Walk, Read\n---\n',
    'single-quoted item': "---\nrhythm: log\ndone: ['Rest, stretch', Walk]\n---\n",
    'block list': '---\nrhythm: log\ndone:\n  - Walk\n  - Read\nmood: good\nplan: [Run]\n---\nbody\n',
    'unindented block list': '---\nrhythm: log\ndone:\n- Walk\n---\n',
    'null done': '---\nrhythm: log\ndone: null\n---\n',
    'bare done + bare skip': '---\nrhythm: log\ndone:\nskip:\n---\n',
    'skip comment': '---\nrhythm: log\ndone: []\nskip: [Read] # too tired\n---\n',
    'tick clears skip/snooze/plan': '---\nrhythm: log\ndone: []\nskip: [Run, Read]\nsnooze: [Run]\nplan: [Run, Walk]\n---\n',
    'lookalike key + comments': '---\n# my log\nrhythm: log\ndone_at: 07:00\ndone: [Walk] \n# trailing comment\n---\nbody',
    'CRLF + BOM': '﻿---\r\nrhythm: log\r\ndone: [Walk]\r\n---\r\nbody\r\n',
    'blank gap above body': '---\nrhythm: log\ndone: [A]\n---\n\n\nNote\n',
    'empty frontmatter': '---\n---\n---\nnot fm\n',
    'no frontmatter': 'Just a body',
    'frontmatter not first': '\n---\nrhythm: log\ndone: [Walk]\n---\n',
    'empty note': '',
    'unticks': '---\nrhythm: log\ndone: [Walk, Run]\nskip: [Read]\n---\n',
  };
  for (const [label, text] of Object.entries(shapes)) {
    for (const on of label === 'unticks' ? [false] : [true]) {
      const a = makeVault({ [LOGP]: text }), b = makeVault({ [LOGP]: text });
      await storeFor(a).setDone(DAY, 'Run', on);
      const res = await R.tick(makeApp(b), DAY, 'Run', on);
      assert.strictEqual(res.ok, true, `${label}: tick ok`);
      assert.strictEqual(b.files.get(LOGP).text, a.files.get(LOGP).text, `${label}: same bytes as Rhythm's own setDone`);
    }
  }
  /* a day with no log note yet */
  {
    const a = makeVault({}), b = makeVault({});
    await storeFor(a).setDone(DAY, 'Read 20 pages', true);
    await R.tick(makeApp(b), DAY, 'Read 20 pages', true);
    assert.strictEqual(b.files.get(LOGP).text, a.files.get(LOGP).text, 'new log: same bytes');
  }
  /* Rhythm's setDone reads what Vista wrote, apostrophes included */
  {
    const b = makeVault({ [LOGP]: '---\nrhythm: log\ndone: []\n---\n' });
    await R.tick(makeApp(b), DAY, "Mom's call", true);
    await R.tick(makeApp(b), DAY, 'Other', true);
    const read = (await storeFor(b).load()).log.get(DAY);
    assert.deepStrictEqual([...read.done], ["Mom's call", 'Other']);
  }
  /* A shape Rhythm's own writer would corrupt (adds a second `done:` beside
     the unread multi-line list) is the one place Vista deliberately refuses. */
  {
    const text = '---\nrhythm: log\ndone: [Walk,\n  Read]\n---\n';
    const a = makeVault({ [LOGP]: text });
    await storeFor(a).setDone(DAY, 'Run', true);
    assert.ok((a.files.get(LOGP).text.match(/^done:/gm) || []).length === 2, 'Rhythm duplicates the key (its own bug, reported upstream)');
    const b = makeVault({ [LOGP]: text });
    assert.strictEqual((await R.tick(makeApp(b), DAY, 'Run', true)).ok, false);
    assert.strictEqual(b.files.get(LOGP).text, text);
  }

  /* ---- Rhythm's hero words: every literal is in page-today.js --------- */
  const pageToday = git('show', `${ref}:src/page-today.js`);
  for (const lit of ['No practices yet.', 'Add one with the plus button, or write a note in the Practices folder.', 'Nothing is due.', 'Rest is allowed.', "'thing done.'", "'things done.'", 'Nothing more is asked of today.', "'thing for today.'", "'things for today.'", "more when there's space.", 'already done.', 'That is the whole list.']) {
    assert.ok(pageToday.includes(lit), `page-today.js at ${ref} no longer says: ${lit}`);
  }

  /* ---- Rhythm's OWN model test, run against Vista's vendored model ----
     Vista ships only its own smoke test (tests/rhythm-model-smoke.test.cjs).
     Here Rhythm's tests/model.test.cjs at the ref is read with `git show`
     (never shipped, never its working tree), its two requires are pointed at
     Vista's vendored files, and it runs in a child process: verbatim parity of
     the model's behaviour, proven locally. */
  const upstreamTest = git('show', `${ref}:tests/model.test.cjs`);
  const REQ_MODEL = "require('../src/model')", REQ_DATES = "require('../src/dates')";
  assert.strictEqual(upstreamTest.split(REQ_MODEL).length, 2, `tests/model.test.cjs at ${ref} no longer has exactly one ${REQ_MODEL}`);
  assert.strictEqual(upstreamTest.split(REQ_DATES).length, 2, `tests/model.test.cjs at ${ref} no longer has exactly one ${REQ_DATES}`);
  const vendoredTest = upstreamTest
    .replace(REQ_MODEL, () => `require(${JSON.stringify(path.join(__dirname, '..', 'src', 'rhythm-model.js'))})`)
    .replace(REQ_DATES, () => `require(${JSON.stringify(path.join(__dirname, '..', 'src', 'rhythm-dates.js'))})`);
  const upstreamTestFile = path.join(tmp, 'upstream-model.test.cjs');
  fs.writeFileSync(upstreamTestFile, vendoredTest);
  try {
    execFileSync(process.execPath, [upstreamTestFile], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    console.error(`Rhythm's own tests/model.test.cjs at ${ref} FAILS against Vista's vendored model:\n${e.stderr || e.message}`);
    process.exit(1);
  }

  console.log(`rhythm parity OK (against ${ref}; includes Rhythm's own model test)`);
})().catch(e => { console.error(e); process.exit(1); });
