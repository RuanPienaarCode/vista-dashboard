'use strict';
/* Audit 2026-10-07, tasks.js: due dates and field stripping follow Obsidian
   Tasks 8.4.0 (fields are peeled off the END of the line), the no-API tick
   refuses a repeating task instead of ending its series, a stray done date
   is replaced rather than doubled, and a mixed LF/CRLF note keeps each
   line's own ending. */
const assert = require('node:assert');
const T = require('../src/tasks');
const { todayISO } = require('../src/dates');

const TODAY = '2026-10-07';
const dueOf = body => {
  const r = T.scanTasks(new Map([['n.md', '- [ ] ' + body]]), TODAY, '', null);
  if (r.overdue.length) return { due: r.overdue[0].due, text: r.overdue[0].text };
  if (r.due.length) return { due: r.due[0].due, text: r.due[0].text };
  return null;
};

/* ---- (3) due-date recognition -------------------------------------------- */
assert.strictEqual(dueOf('Renew licence 🗓 2026-10-01').due, '2026-10-01', '🗓 is a due date in Tasks');
assert.strictEqual(dueOf('Renew licence 📆 2026-10-01').due, '2026-10-01', '📆 is a due date in Tasks');
assert.strictEqual(dueOf('Renew licence 📅️ 2026-10-01').due, '2026-10-01', 'an optional VS16 after 📅 is allowed');
assert.strictEqual(dueOf('Renew licence 📅2026-10-01').due, '2026-10-01', 'the space after the symbol is optional');
assert.strictEqual(dueOf('Call 📅 2026-10-01 ⏰ 09:00'), null, 'a ⏰ after the due date hides it from Tasks, so it has none');
assert.strictEqual(dueOf('Ask about the 📅 2026-10-01 meeting notes'), null, 'a date mid-sentence is not a field');
assert.strictEqual(dueOf('Pay 📅 2026-10-01 🏁 delete').due, '2026-10-01', '🏁 is a peelable field');
assert.strictEqual(dueOf('Pay 📅 2026-10-01 ^blk-1').due, '2026-10-01', 'a trailing block id is set aside first');
assert.strictEqual(dueOf('Pay 📅 2026-10-01 #bills #home').due, '2026-10-01', 'trailing tags are peeled too');
assert.strictEqual(dueOf('Pay #bills 📅 2026-10-01 ⏫ 🔁 every week').due, '2026-10-01');
assert.strictEqual(dueOf('Pay 📅 2026-10-01 ⌛ 2026-09-30').due, '2026-10-01', '⌛ is scheduled, peeled before reaching 📅');
assert.strictEqual(dueOf('Pay ⏳ 2026-09-01'), null, 'scheduled alone is not a due date');
/* Nudge writes ⏰ before the fields, so its lines stay due */
assert.deepStrictEqual(dueOf('Sign papers ⏰ 09:00 #family 📅 2026-10-01 ⏫'), { due: '2026-10-01', text: 'Sign papers #family' },
  'Nudge order keeps its due date; the ⏰ is stripped from the display text');

/* ---- (3) cleanText strips trailing fields only ---------------------------- */
assert.strictEqual(T.cleanText('Buy milk 📅 2026-09-13 ⏳ 2026-09-12 🛫 2026-09-10 🔁 every day 🆔 abc ⛔ xyz 🔼'), 'Buy milk');
assert.strictEqual(T.cleanText('Ask about the 📅 2026-10-01 meeting notes'), 'Ask about the 📅 2026-10-01 meeting notes', 'mid-sentence dates are prose');
assert.strictEqual(T.cleanText('Call back about 🔁 loops. 📅 2026-10-01'), 'Call back about 🔁 loops.', 'a 🔁 that Tasks would not read as a field stays');
assert.strictEqual(T.cleanText('Renew 🗓 2026-10-01 ⌛ 2026-09-30 🏁 keep ⏰ 09:00'), 'Renew', '⌛, 🏁 and a trailing ⏰ HH:MM are all stripped from the display text');
assert.strictEqual(T.cleanText('Renew 📅️ 2026-10-01'), 'Renew', 'VS16 variants are stripped whole');
assert.strictEqual(T.cleanText('Pay rent 📅 2026-10-01 ^rent'), 'Pay rent', 'a block id is not description');
assert.strictEqual(T.cleanText('Buy 📚 for school 📅 2026-09-27'), 'Buy 📚 for school', 'astral emoji next to a field survive');

/* ---- differential: due agrees with an independent reading of Tasks 8.4.0 -- */
{
  const D = '(\\d{4}-\\d{2}-\\d{2})';
  const F = s => new RegExp(s + '️? *' + D + '$');
  const PEEL = { due: F('(?:📅|📆|🗓)'), start: F('🛫'), scheduled: F('(?:⏳|⌛)'), done: F('✅'), created: F('➕'), cancelled: F('❌'),
    priority: /(🔺|⏫|🔼|🔽|⏬)️?$/, recurrence: /🔁️? *([a-zA-Z0-9, !]+)$/, onCompletion: /🏁️? *([a-zA-Z]+)$/,
    id: /🆔️? *([a-zA-Z0-9\-_]+)$/, deps: /⛔️? *([a-zA-Z0-9\-_]+( *, *[a-zA-Z0-9\-_]+ *)*)$/, tag: /(^|\s)#[^ !@#$%^&*(),.?":{}|<>]+$/ };
  const ref = body => {
    let s = body.trim().replace(/ \^[a-zA-Z0-9-]+$/, '').trim(), due = null, moved = true;
    while (moved) { moved = false; for (const [k, re] of Object.entries(PEEL)) { const m = re.exec(s); if (m) { if (k === 'due') due = m[1]; s = s.slice(0, m.index).trim(); moved = true; break; } } }
    return due;
  };
  const corpus = [
    'a 📅 2026-10-01', 'a 🗓 2026-10-01', 'a 📆 2026-10-01', 'a 📅️ 2026-10-01', 'a 📅 2026-10-01 ⏰ 09:00', 'a ⏰ 09:00 📅 2026-10-01',
    'a 📅 2026-10-01 meeting', 'a 📅 2026-10-01 🔁 every day', 'a 🔁 every day 📅 2026-10-01', 'a 📅 2026-10-01 ⏫', 'a ⏫ 📅 2026-10-01',
    'a 📅 2026-10-01 #t', 'a #t 📅 2026-10-01', 'a 📅 2026-10-01 ✅ 2026-10-02', 'a 📅 2026-10-01 🆔 x1 ⛔ y2', 'a 🆔 x1 📅 2026-10-01',
    'a 📅 2026-10-01 🏁 keep', 'a ⌛ 2026-10-02 📅 2026-10-01', 'a 📅 2026-10-01 ⌛ 2026-10-02', 'a 📅 2026-10-01 ^id9', 'a 📅 2026-10-01 ➕ 2026-09-01 🛫 2026-09-02',
    'a 📅 2026-10-01 ⏰ 09:00 #t', 'a 📅 not-a-date', 'a 📅 2026-10-01 trailing words', '📅 2026-10-01', 'a ❌ 2026-10-01 📅 2026-10-02',
  ];
  for (const b of corpus) {
    const want = ref(b);
    const got = dueOf(b);
    assert.strictEqual(got ? got.due : null, want, 'due for ' + JSON.stringify(b));
  }
}

/* ---- the fake vault ------------------------------------------------------- */
function mk(files, api) {
  return {
    plugins: { plugins: api ? { 'obsidian-tasks-plugin': { apiV1: () => api } } : {} },
    vault: {
      getFileByPath: p => (p in files ? { path: p } : null),
      process: async (f, fn) => { const next = await fn(files[f.path]); files[f.path] = next; return next; },
    },
  };
}
const item = (path, text, i) => { const lines = text.split(/\r?\n/); return { path, line: i, raw: lines[i], status: /\[(.)\]/.exec(lines[i])[1] }; };

(async () => {
  /* ---- (1) a repeating task is refused without the Tasks API ---------------- */
  {
    const t = `- [ ] Take pills 🔁 every day 📅 ${TODAY}\n`;
    const files = { 'r.md': t };
    const res = await T.toggleTask(mk(files, null), item('r.md', t, 0));
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'recurring-needs-tasks');
    assert.ok(/repeats/.test(res.message) && /Tasks/.test(res.message), 'a message the dashboard can show: ' + res.message);
    assert.strictEqual(files['r.md'], t, 'the note is untouched');
    /* with the Tasks API the repeat is Tasks' to handle */
    const api = { executeToggleTaskDoneCommand: line => `- [ ] Take pills 🔁 every day 📅 2026-10-08\n- [x] Take pills 🔁 every day 📅 ${TODAY} ✅ ${TODAY}` };
    const ok = await T.toggleTask(mk(files, api), item('r.md', t, 0));
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(files['r.md'], `- [ ] Take pills 🔁 every day 📅 2026-10-08\n- [x] Take pills 🔁 every day 📅 ${TODAY} ✅ ${TODAY}\n`);
  }
  /* other reasons are structured too */
  {
    const files = { 'a.md': '- [ ] one\n' };
    assert.deepStrictEqual(await T.toggleTask(mk(files, null), { path: 'gone.md', line: 0, raw: '- [ ] x' }), { ok: false, reason: 'no-file', message: 'That note is gone.' });
    const r = await T.toggleTask(mk(files, null), { path: 'a.md', line: 0, raw: '- [ ] changed', status: ' ' });
    assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'line-changed');
    const good = await T.toggleTask(mk(files, null), { path: 'a.md', line: 0, raw: '- [ ] one', status: ' ' });
    assert.strictEqual(good.ok, true);
  }

  /* ---- (2) a stray done date is replaced, not doubled ----------------------- */
  {
    const now = todayISO();
    const cases = [
      [`- [ ] Pay rent 📅 ${TODAY} ✅ 2026-01-01`, `- [x] Pay rent 📅 ${TODAY} ✅ ${now}`],
      [`- [ ] Pay rent ✅ 2026-01-01 📅 ${TODAY}`, `- [x] Pay rent ✅ ${now} 📅 ${TODAY}`],
      [`- [ ] Pay rent 📅 ${TODAY} ✅ 2026-01-01 ^rent`, `- [x] Pay rent 📅 ${TODAY} ✅ ${now} ^rent`],
      [`- [ ] Pay rent 📅 ${TODAY}`, `- [x] Pay rent 📅 ${TODAY} ✅ ${now}`],
      [`- [ ] Pay rent 📅 ${TODAY} ^rent`, `- [x] Pay rent 📅 ${TODAY} ✅ ${now} ^rent`],
      [`- [ ] Tick ✅ 2026-01-01 on the form 📅 ${TODAY}`, `- [x] Tick ✅ 2026-01-01 on the form 📅 ${TODAY} ✅ ${now}`],
    ];
    for (const [before, after] of cases) {
      const files = { 'p.md': before + '\n' };
      const res = await T.toggleTask(mk(files, null), item('p.md', before, 0));
      assert.strictEqual(res.ok, true);
      assert.strictEqual(files['p.md'], after + '\n', before);
    }
  }

  /* ---- (7) mixed LF / CRLF: every line keeps its own ending ----------------- */
  {
    const before = `# Mixed\r\nline two\nline three\n- [ ] Mixed EOL 📅 ${TODAY}\nline five\r\n`;
    const files = { 'm.md': before };
    const res = await T.toggleTask(mk(files, null), item('m.md', before, 3));
    assert.strictEqual(res.ok, true);
    assert.strictEqual(files['m.md'], `# Mixed\r\nline two\nline three\n- [x] Mixed EOL 📅 ${TODAY} ✅ ${todayISO()}\nline five\r\n`, 'only the ticked line changed');
    /* a multi-line replacement: new lines take the dominant ending, the original line's ending goes with the last piece */
    const b2 = `a\r\nb\r\n- [ ] t 🔁 every day 📅 ${TODAY}\nz\r\n`;
    const f2 = { 'm.md': b2 };
    const api = { executeToggleTaskDoneCommand: () => '- [ ] n\n- [x] d' };
    await T.toggleTask(mk(f2, api), item('m.md', b2, 2));
    assert.strictEqual(f2['m.md'], 'a\r\nb\r\n- [ ] n\r\n- [x] d\nz\r\n');
    /* no trailing newline stays none */
    const b3 = `x\n- [ ] last 📅 ${TODAY}`;
    const f3 = { 'm.md': b3 };
    await T.toggleTask(mk(f3, null), item('m.md', b3, 1));
    assert.strictEqual(f3['m.md'], `x\n- [x] last 📅 ${TODAY} ✅ ${todayISO()}`);
  }
  /* the helpers other modules use */
  {
    const s = T.splitEol('a\r\nb\nc');
    assert.deepStrictEqual(s.lines, ['a', 'b', 'c']);
    assert.deepStrictEqual(s.eols, ['\r\n', '\n', '']);
    assert.strictEqual(T.joinEol(s.lines, s.eols), 'a\r\nb\nc');
    assert.strictEqual(T.dominantEol(['\r\n', '\n', '\r\n', '']), '\r\n');
    assert.strictEqual(T.dominantEol(['\n', '\r\n']), '\n', 'a tie takes the first ending in the note');
    assert.strictEqual(T.dominantEol(['\r\n', '\n']), '\r\n', 'a tie takes the first ending in the note');
    assert.strictEqual(T.dominantEol(['']), '\n', 'no endings at all: LF');
  }

  console.log('tasks-audit OK');
})().catch(e => { console.error(e); process.exit(1); });
