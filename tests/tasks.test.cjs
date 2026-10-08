'use strict';
const assert = require('node:assert');
const T = require('../src/tasks');

const texts = new Map([
  ['Cars/Service.md', '- [ ] Book car for service 📅 2025-09-30\n- [x] Done thing 📅 2026-09-01 ✅ 2026-09-02\n- [ ] No date here\n'],
  ['Planning/Week.md', '## Tasks\n  - [ ] Call the plumber ⏫ 📅 2026-09-13 🔁 every week\n1. [ ] Pay rates 📅 2026-09-13 ➕ 2026-09-01\n- [ ] Later 📅 2026-09-20\n- [-] Cancelled 📅 2026-09-10\n'],
]);
const r = T.scanTasks(texts, '2026-09-13', '');
assert.deepStrictEqual(r.overdue.map(t => t.text), ['Book car for service']);
assert.deepStrictEqual(r.due.map(t => t.text), ['Call the plumber', 'Pay rates'], 'note order, then line order');
assert.strictEqual(r.due[0].line, 1);
assert.strictEqual(r.due[0].raw, '  - [ ] Call the plumber ⏫ 📅 2026-09-13 🔁 every week');
assert.strictEqual(T.daysOverdue('2025-09-30', '2026-09-13'), 348);
assert.strictEqual(T.cleanText('Buy milk 📅 2026-09-13 ⏳ 2026-09-12 🛫 2026-09-10 🔁 every day 🆔 abc ⛔ xyz 🔼'), 'Buy milk');
assert.deepStrictEqual(T.scanTasks(texts, '2026-09-13', '#task').overdue, [], 'a global filter narrows to lines carrying it');
assert.deepStrictEqual(T.scanTasks(texts, '2026-09-13', '', new Set(['Cars/Service.md'])).overdue, [],
  'a note another card owns is skipped, so one task is never counted twice on the page');
assert.strictEqual(T.scanTasks(texts, '2026-09-13', '', new Set(['Cars/Service.md'])).due.length, 2, 'and nothing else is affected');

/* R1 (audit finding 1): FIELD_RE without the `u` flag operates on UTF-16
   code units and strips the high surrogate of an ordinary astral emoji
   sitting next to a task field. */
{
  const out = T.cleanText('Buy 📚 for school 📅 2026-09-27');
  assert.strictEqual(out, 'Buy 📚 for school', 'the unrelated emoji survives cleanText');
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out), 'no lone surrogate in the output');
}

/* R2 (audit finding 2): task shapes the Tasks plugin treats as open/real —
   in-progress [/], a task inside a callout/blockquote (incl. nested), and
   a fenced code block that must be skipped entirely. */
{
  const note = [
    '- [/] Draft the report 📅 2026-09-20',
    '> - [ ] Callout task 📅 2026-09-20',
    '> > - [ ] Nested callout task 📅 2026-09-20',
    '```',
    '- [ ] Example in a code block 📅 2020-01-01',
    '```',
  ].join('\n');
  const r2 = T.scanTasks(new Map([['n.md', note]]), '2026-09-27', '', null);
  assert.deepStrictEqual(r2.overdue.map(i => i.text).sort(), ['Callout task', 'Draft the report', 'Nested callout task'].sort(),
    'in-progress and callout tasks count; the fenced code block is skipped');
}

/* toggle: through the Tasks API when present, else a plain [x] + done date */
(async () => {
  const files = { 'Cars/Service.md': texts.get('Cars/Service.md') };
  const mk = api => ({
    plugins: { plugins: api ? { 'obsidian-tasks-plugin': { apiV1: () => api } } : {} },
    vault: {
      getFileByPath: p => (p in files ? { path: p } : null),
      read: async f => files[f.path],
      modify: async (f, t) => { files[f.path] = t; },
      process: async (f, fn) => { const next = await fn(files[f.path]); files[f.path] = next; return next; },
    },
  });
  const item = r.overdue[0];
  const app = mk({ executeToggleTaskDoneCommand: (line, path) => line.replace('[ ]', '[x]') + ' ✅ 2026-09-13' });
  assert.strictEqual((await T.toggleTask(app, item)).ok, true);
  assert.ok(files['Cars/Service.md'].startsWith('- [x] Book car for service 📅 2025-09-30 ✅ 2026-09-13\n'));
  /* the line moved: matched by content, not index */
  files['Cars/Service.md'] = '- [ ] New first line\n- [ ] Book car for service 📅 2025-09-30\n';
  assert.strictEqual((await T.toggleTask(mk(null), { path: 'Cars/Service.md', line: 0, raw: '- [ ] Book car for service 📅 2025-09-30' })).ok, true);
  assert.ok(/^- \[ \] New first line\n- \[x\] Book car for service 📅 2025-09-30 ✅ \d{4}-\d{2}-\d{2}\n$/.test(files['Cars/Service.md']));
  assert.strictEqual((await T.toggleTask(mk(null), { path: 'Cars/Service.md', line: 0, raw: '- [ ] gone' })).ok, false, 'a line that no longer exists is not touched');

  /* R3 (audit findings 3 & 6): the done date is today in LOCAL time (not
     toISOString's UTC — 00:30 SAST on the 27th is still the 26th in UTC),
     and it is inserted before a trailing block id so the id stays last. */
  files['Id.md'] = '- [ ] Pay rent 📅 2026-09-01 ^rent\n';
  const savedTZ = process.env.TZ;
  process.env.TZ = 'Africa/Johannesburg';
  const before = new Date(2026, 8, 27, 0, 30); // 00:30 SAST — 2026-09-26 22:30 UTC
  const RealDate = Date;
  global.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [before.getTime()])); } static now() { return before.getTime(); } };
  try {
    assert.strictEqual(before.toISOString().slice(0, 10), '2026-09-26', 'sanity: UTC really is a day behind here');
    const res = await T.toggleTask(mk(null), { path: 'Id.md', line: 0, raw: '- [ ] Pay rent 📅 2026-09-01 ^rent', status: ' ' });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(files['Id.md'], '- [x] Pay rent 📅 2026-09-01 ✅ 2026-09-27 ^rent\n', 'local (SAST) today, id kept last');
  } finally { global.Date = RealDate; process.env.TZ = savedTZ; }

  /* R4 (audit finding 4): two tasks in the same note ticked back to back —
     app.vault.process serialises the read-modify-write so neither is lost. */
  files['Two.md'] = '- [ ] Pay rent 📅 2026-09-01\n- [ ] Call bank 📅 2026-09-02\n';
  const raceApp = mk(null);
  // model process as a per-file queue with a slow read-modify-write turn,
  // the way Obsidian's real implementation serialises concurrent writers.
  const rawProcess = async (f, fn) => {
    const cur = files[f.path];
    await new Promise(res => setTimeout(res, 5));
    const next = await fn(cur);
    files[f.path] = next;
    return next;
  };
  const queue = new Map();
  raceApp.vault.process = (f, fn) => {
    const prior = queue.get(f.path) || Promise.resolve();
    const next = prior.then(() => rawProcess(f, fn));
    queue.set(f.path, next.catch(() => {}));
    return next;
  };
  await Promise.all([
    T.toggleTask(raceApp, { path: 'Two.md', line: 0, raw: '- [ ] Pay rent 📅 2026-09-01', status: ' ' }),
    T.toggleTask(raceApp, { path: 'Two.md', line: 1, raw: '- [ ] Call bank 📅 2026-09-02', status: ' ' }),
  ]);
  assert.strictEqual(files['Two.md'].match(/\[x\]/g).length, 2, 'both ticks land, neither overwrites the other');

  console.log('tasks OK');
})().catch(e => { console.error(e); process.exit(1); });
