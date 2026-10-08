'use strict';
/* Audit 2026-10-07, actions.js: fence-aware capture sections, the promised
   "create the heading" behaviour, a deterministic daily-note pick, per-line
   line endings, the createFolder race, moment week/quarter tokens, the
   run-time URL scheme allowlist, and Obsidian's normalizePath for typed
   paths. */
const assert = require('node:assert');
const stub = require('./_stub.cjs');
/* tests/_stub.cjs ships an identity normalizePath. This is a faithful copy of
   Obsidian's (collapse repeated / and \, trim edge slashes, '' -> '/', nbsp
   and narrow nbsp -> space, NFC), installed before actions.js is loaded. */
stub.normalizePath = p => {
  p = p.replace(/([\\/])+/g, '/').replace(/(^\/+|\/+$)/g, '');
  if (p === '') p = '/';
  return p.replace(/[  ]/g, ' ').normalize('NFC');
};
const A = require('../src/actions');
const { todayISO } = require('../src/dates');

const lfCount = s => (s.match(/(^|[^\r])\n/g) || []).length;
const crlfCount = s => (s.match(/\r\n/g) || []).length;

function makeVault(initial, order) {
  const files = new Map();
  const mk = (p, t) => ({ path: p, basename: p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/, ''), extension: 'md', text: t });
  for (const [p, t] of Object.entries(initial || {})) files.set(p, mk(p, t));
  const folders = new Set();
  const queue = new Map();
  const vault = {
    files, folders,
    getFileByPath: p => files.get(p) || null,
    getFiles: () => (order ? order.map(p => files.get(p)).filter(Boolean) : [...files.values()]),
    getFolderByPath: p => (folders.has(p) ? { path: p } : null),
    createFolder: async p => { if (folders.has(p)) throw new Error('Folder already exists.'); folders.add(p); },
    cachedRead: async f => f.text,
    create: async (p, t) => { if (files.has(p)) throw new Error('File already exists.'); const f = mk(p, t); files.set(p, f); return f; },
    process: (f, fn) => {
      const prior = queue.get(f.path) || Promise.resolve();
      const next = prior.then(() => { const out = fn(f.text); f.text = out; return out; });
      queue.set(f.path, next.catch(() => {}));
      return next;
    },
  };
  return vault;
}

/* ---- (4) the section-end scan is fence-aware too -------------------------- */
{
  const note = ['# Day', '', '## Notes', '- earlier thought', '```bash', '# install the tool', 'brew install foo', '```', '- later thought', '', '## Tasks', '- [ ] x', ''].join('\n');
  const out = A.insertCapture(note, 'Notes', '- NEW');
  assert.strictEqual(out, ['# Day', '', '## Notes', '- earlier thought', '```bash', '# install the tool', 'brew install foo', '```', '- later thought', '- NEW', '', '## Tasks', '- [ ] x', ''].join('\n'),
    'the capture lands after the last bullet, outside the code block');
  /* a section that ends in a code block: the capture goes after the closing fence */
  const endsFenced = '## Notes\n- a\n~~~\n# not a heading\n~~~\n\n## Next\n';
  assert.strictEqual(A.insertCapture(endsFenced, 'Notes', '- NEW'), '## Notes\n- a\n~~~\n# not a heading\n~~~\n- NEW\n\n## Next\n');
  /* a longer outer fence is not closed by a shorter inner one */
  const nested = '## Notes\n````md\n```\n# x\n```\n````\n## Next\n';
  assert.strictEqual(A.insertCapture(nested, 'Notes', '- NEW'), '## Notes\n````md\n```\n# x\n```\n````\n- NEW\n## Next\n');
}

/* ---- (5) a missing heading is created, and later captures join its list --- */
{
  let t = '# Day\n\nbody\n';
  t = A.insertCapture(t, 'Notes', '- **10:00** one');
  assert.strictEqual(t, '# Day\n\nbody\n\n## Notes\n\n- **10:00** one\n');
  t = A.insertCapture(t, 'Notes', '- **10:01** two');
  t = A.insertCapture(t, 'Notes', '- **10:02** three');
  assert.strictEqual(t, '# Day\n\nbody\n\n## Notes\n\n- **10:00** one\n- **10:01** two\n- **10:02** three\n', 'a tight list, no blank lines between bullets');
  assert.strictEqual(A.insertCapture('', 'Notes', '- a'), '## Notes\n\n- a\n');
  assert.strictEqual(A.insertCapture('# Notes\n\nIntro\n', 'Notes', '- a'), '# Notes\n\nIntro\n\n## Notes\n\n- a\n', 'an H1 of the same name is not the capture section');
  assert.strictEqual(A.insertCapture('prose', 'Log: ', '- a'), 'prose\n\n## Log:\n\n- a\n', 'the heading is created as typed, trimmed');
  assert.strictEqual(A.insertCapture('# Day\r\nbody\r\n', 'Notes', '- a'), '# Day\r\nbody\r\n\r\n## Notes\r\n\r\n- a\r\n', 'a CRLF note stays CRLF');
  /* no heading configured at all: a bullet continues a list that ends the note */
  assert.strictEqual(A.insertCapture('- a\n', '', '- b'), '- a\n- b\n');
  assert.strictEqual(A.insertCapture('prose\n', '', '- b'), 'prose\n\n- b\n');
}

/* ---- (7) mixed line endings: each line keeps its own ---------------------- */
{
  const mixed = '# Day\r\nline\nline\n## Notes\n- a\n';
  const out = A.insertCapture(mixed, 'Notes', '- CAP');
  assert.strictEqual(out, '# Day\r\nline\nline\n## Notes\n- a\n- CAP\n');
  assert.strictEqual(crlfCount(out), 1, 'the one CRLF line is still the only CRLF line');
  const crlfMostly = '# Day\r\n\r\n## Notes\r\n- a\n\r\n## Next\r\n';
  assert.strictEqual(A.insertCapture(crlfMostly, 'Notes', '- CAP'), '# Day\r\n\r\n## Notes\r\n- a\n- CAP\r\n\r\n## Next\r\n', 'the new line takes the dominant ending (CRLF)');
  assert.strictEqual(A.insertCapture('# Day\n\n## Notes\n- a', 'Notes', '- CAP'), '# Day\n\n## Notes\n- a\n- CAP', 'no trailing newline stays none');
  assert.strictEqual(A.insertCapture('# Day\n\nprose', 'Notes', '- CAP'), '# Day\n\nprose\n\n## Notes\n\n- CAP\n');
  assert.strictEqual(lfCount(A.insertCapture('a\r\nb\r\n', 'Notes', '- x')), 0, 'pure CRLF stays pure CRLF');
}

/* ---- (6) deterministic daily-note pick ------------------------------------ */
{
  const iso = '2026-10-07';
  const f = p => ({ path: p, basename: iso, extension: 'md' });
  const a = f(`Diary/Journal/2026/${iso}.md`), b = f(`Diary/Journal/Archive/${iso}.md`), flat = f(`Diary/Journal/${iso}.md`);
  const deep = f(`Diary/Journal/2026/10/${iso}.md`);
  const other = { path: `Elsewhere/${iso}.md`, basename: iso, extension: 'md' };
  const png = { path: `Diary/Journal/${iso}.png`, basename: iso, extension: 'png' };
  for (const order of [[a, b], [b, a]]) assert.strictEqual(A.pickDailyNote(order, 'Diary/Journal', iso).path, a.path, 'shortest path, whatever the order');
  for (const order of [[a, b, flat], [flat, b, a], [b, flat, a]]) assert.strictEqual(A.pickDailyNote(order, 'Diary/Journal', iso).path, flat.path, 'the flat path wins');
  assert.strictEqual(A.pickDailyNote([deep, a], 'Diary/Journal', iso).path, a.path, 'shorter beats deeper');
  const x = f(`Diary/Journal/bb/${iso}.md`), y = f(`Diary/Journal/aa/${iso}.md`);
  for (const order of [[x, y], [y, x]]) assert.strictEqual(A.pickDailyNote(order, 'Diary/Journal', iso).path, y.path, 'equal length: alphabetical');
  assert.strictEqual(A.pickDailyNote([other, png], 'Diary/Journal', iso), null, 'other folders and other extensions never match');
  assert.strictEqual(A.pickDailyNote([a], '/Diary//Journal/', iso).path, a.path, 'the folder setting is normalised');
  assert.strictEqual(A.pickDailyNote([other, flat], '', iso), null, 'with no folder set only the root note counts');
  assert.strictEqual(A.pickDailyNote([f(`${iso}.md`)], '/', iso).path, `${iso}.md`);
  /* journalDays: the same rule, every day at once */
  const days = A.journalDays([b, a, other, png, { path: 'Diary/Journal/2026/2026-10-08.md', basename: '2026-10-08', extension: 'md' }, { path: 'Diary/Journal/notes.md', basename: 'notes', extension: 'md' }], 'Diary/Journal');
  assert.deepStrictEqual([...days.keys()].sort(), ['2026-10-07', '2026-10-08']);
  assert.strictEqual(days.get(iso).path, a.path);
}

(async () => {
  /* ---- (6) ensureDaily / captureToJournal land in the same note either way ---- */
  {
    const iso = todayISO(new Date());
    const a = `Diary/Journal/2026/${iso}.md`, b = `Diary/Journal/Archive/${iso}.md`;
    const s = { journalFolder: 'Diary/Journal', journalTemplate: '', captureHeading: 'Notes', captureTimestamp: false };
    const hits = [];
    for (const order of [[a, b], [b, a]]) {
      const vault = makeVault({ [a]: '## Notes\n', [b]: '## Notes\n' }, order);
      hits.push((await A.captureToJournal({ vault }, s, 'CAP')).path);
    }
    assert.strictEqual(hits[0], hits[1], 'same target in both listing orders');
    assert.strictEqual(hits[0], a);
  }

  /* ---- (8) createFolder race ------------------------------------------------- */
  {
    const iso = todayISO(new Date());
    const s = { journalFolder: 'Diary/Journal', journalTemplate: '', captureHeading: 'Notes', captureTimestamp: false };
    const vault = makeVault({});
    vault.createFolder = async p => { await new Promise(r => setTimeout(r, 5)); if (vault.folders.has(p)) throw new Error('Folder already exists.'); vault.folders.add(p); };
    const res = await Promise.allSettled([A.captureToJournal({ vault }, s, 'first'), A.captureToJournal({ vault }, s, 'second')]);
    assert.deepStrictEqual(res.map(r => r.status), ['fulfilled', 'fulfilled'], JSON.stringify(res.map(r => r.reason && r.reason.message)));
    const text = vault.files.get(`Diary/Journal/${iso}.md`).text;
    assert.ok(text.includes('first') && text.includes('second'), 'both captures landed: ' + JSON.stringify(text));
    /* a createFolder that fails for another reason still fails */
    const bad = makeVault({});
    bad.createFolder = async () => { throw new Error('Permission denied'); };
    await assert.rejects(A.ensureDaily({ vault: bad }, s, iso), /Permission denied/);
  }

  /* ---- (11) typed paths go through normalizePath -------------------------------- */
  {
    const iso = '2026-10-07';
    const vault = makeVault({ 'Templates/Daily.md': '# {{title}}\n\n## Notes\n\n-\n' });
    const f = await A.ensureDaily({ vault }, { journalFolder: ' /Diary//Journal/ ', journalTemplate: '/Templates//Daily ' }, iso);
    assert.strictEqual(f.path, `Diary/Journal/${iso}.md`, 'doubled and edge slashes are normalised');
    assert.ok(f.text.startsWith('# 2026-10-07'), 'the template path was found: ' + JSON.stringify(f.text));
    assert.ok(vault.folders.has('Diary/Journal'));
    const root = makeVault({});
    for (const folder of ['', '/', '  ', '//']) {
      const r = await A.ensureDaily({ vault: root }, { journalFolder: folder, journalTemplate: '' }, iso);
      assert.strictEqual(r.path, `${iso}.md`, JSON.stringify(folder) + ' means the vault root');
      assert.strictEqual(root.folders.size, 0, 'and no folder is created');
    }
    /* tile note targets */
    const note = { path: 'Notes/Plan.md' };
    const app = { metadataCache: { getFirstLinkpathDest: () => null }, vault: { getFileByPath: p => (p === 'Notes/Plan.md' ? note : null) } };
    assert.strictEqual(A.resolveNote(app, '/Notes//Plan'), note);
    assert.strictEqual(A.resolveNote(app, ' Notes/Plan.md '), note);
    assert.strictEqual(A.resolveNote(app, '/'), null);
    assert.strictEqual(A.resolveNote(app, ''), null);
  }

  /* ---- (10) link tiles are re-checked when they run ---------------------------- */
  {
    const opened = [];
    global.window = { open: u => opened.push(u) };
    stub.notices.length = 0;
    const run = target => A.runTile({}, {}, { kind: 'url', target });
    for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'vbscript:x', '//evil.example', 'example.com', '', '\u0001https://x.example']) {
      assert.strictEqual(await run(bad), false, 'refused: ' + JSON.stringify(bad));
    }
    assert.deepStrictEqual(opened, [], 'nothing was opened');
    assert.ok(stub.notices.length >= 1, 'the refusal is explained');
    for (const good of ['https://example.com/a?b=1', 'HTTP://example.com', 'obsidian://open?vault=x', 'mailto:me@example.com', '  https://example.com ']) {
      assert.strictEqual(await run(good), true, 'allowed: ' + JSON.stringify(good));
    }
    assert.deepStrictEqual(opened, ['https://example.com/a?b=1', 'HTTP://example.com', 'obsidian://open?vault=x', 'mailto:me@example.com', 'https://example.com']);
    delete global.window;
  }

  console.log('actions-audit OK');
})().catch(e => { console.error(e); process.exit(1); });

/* ---- (9) moment week / quarter tokens (expected values from moment 2.30.1, locale en) ---- */
{
  const at = (y, m, d) => new Date(y, m, d, 12);
  const rows = [
    // [date, Q, w, ww, W, WW, gggg, GGGG]
    [[2026, 0, 1], '1', '1', '01', '1', '01', '2026', '2026'],
    [[2026, 11, 31], '4', '1', '01', '53', '53', '2027', '2026'],
    [[2026, 0, 3], '1', '1', '01', '1', '01', '2026', '2026'],
    [[2026, 0, 4], '1', '2', '02', '1', '01', '2026', '2026'],
    [[2025, 11, 28], '4', '1', '01', '52', '52', '2026', '2025'],
    [[2025, 11, 29], '4', '1', '01', '1', '01', '2026', '2026'],
    [[2024, 11, 30], '4', '1', '01', '1', '01', '2025', '2025'],
    [[2027, 0, 1], '1', '1', '01', '53', '53', '2027', '2026'],
    [[2021, 0, 3], '1', '2', '02', '53', '53', '2021', '2020'],
    [[2020, 11, 31], '4', '1', '01', '53', '53', '2021', '2020'],
    [[2026, 9, 7], '4', '41', '41', '41', '41', '2026', '2026'],
    [[2026, 5, 15], '2', '25', '25', '25', '25', '2026', '2026'],
    [[2027, 11, 26], '4', '1', '01', '51', '51', '2028', '2027'],
    [[2027, 11, 27], '4', '1', '01', '52', '52', '2028', '2027'],
  ];
  const toks = ['Q', 'w', 'ww', 'W', 'WW', 'gggg', 'GGGG'];
  for (const [d, ...want] of rows) {
    toks.forEach((tok, i) => assert.strictEqual(A.formatToken(tok, at(...d)), want[i], `${tok} on ${d.join('-')}`));
  }
  assert.strictEqual(A.formatToken('YYYY-[W]WW', at(2026, 11, 31)), '2026-W53', 'bracket escapes still win');
  assert.strictEqual(A.formatToken('GGGG-[W]WW-E', at(2026, 0, 1)), '2026-W01-E', 'unlisted letters stay literal');
  assert.strictEqual(A.fillTemplate('{{date:[Week] ww, gggg}} Q{{date:Q}}', at(2026, 9, 7), 'x'), 'Week 41, 2026 Q4');
  /* DST and timezone cannot shift a week: walk two years of days */
  for (let n = 0; n < 800; n++) {
    const d = new Date(2025, 0, 1 + n, 0, 30);
    const w = Number(A.formatToken('w', d));
    assert.ok(w >= 1 && w <= 53, 'w in range for ' + d.toDateString());
  }
}
