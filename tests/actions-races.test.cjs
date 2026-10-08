'use strict';
/* R4/R5 (audit findings 4 & the ensureDaily half of 5): captureToJournal and
   ensureDaily races, and the "a note named <iso>.md exists somewhere under
   the journal folder" dedupe the calendar already relies on. */
const assert = require('node:assert');
require('./_stub.cjs');
const A = require('../src/actions');

/* A minimal fake vault: files keyed by path, `process` models Obsidian's
   real per-file serialised read-modify-write (a slow turn queued per path,
   the way the live app's implementation queues concurrent writers), and
   `create` throws "already exists" like the real vault does. */
function makeVault(initial) {
  const files = new Map();
  for (const [p, t] of Object.entries(initial || {})) {
    files.set(p, { path: p, basename: p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/, ''), extension: 'md', text: t });
  }
  const folders = new Set();
  const queue = new Map();
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  return {
    files,
    getFileByPath: p => files.get(p) || null,
    getFiles: () => [...files.values()],
    getFolderByPath: p => (folders.has(p) ? { path: p } : null),
    createFolder: async p => { folders.add(p); },
    cachedRead: async f => f.text,
    read: async f => { await wait(3); return f.text; },
    modify: async (f, t) => { await wait(3); f.text = t; },
    create: async (p, t) => {
      await wait(5);
      if (files.has(p)) throw new Error('File already exists.');
      const f = { path: p, basename: p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/, ''), extension: 'md', text: t };
      files.set(p, f);
      return f;
    },
    process: (f, fn) => {
      const prior = queue.get(f.path) || Promise.resolve();
      const next = prior.then(async () => {
        await wait(3);
        const out = await fn(f.text);
        f.text = out;
        return out;
      });
      queue.set(f.path, next.catch(() => {}));
      return next;
    },
  };
}

(async () => {
  const settings = { journalFolder: 'Diary/Journal', journalTemplate: '', captureHeading: 'Notes', captureTimestamp: false };

  /* (a) two overlapping captures into the same, already-existing note —
     app.vault.process serialises them so neither is lost. */
  {
    const today = require('../src/dates').todayISO(new Date());
    const path = `Diary/Journal/${today}.md`;
    const vault = makeVault({ [path]: '# Day\n\n## Notes\n\n-\n' });
    const app = { vault };
    await Promise.all([
      A.captureToJournal(app, settings, 'first thought'),
      A.captureToJournal(app, settings, 'second thought'),
    ]);
    const text = vault.files.get(path).text;
    assert.ok(text.includes('first thought'), 'first capture is not lost');
    assert.ok(text.includes('second thought'), 'second capture is not lost');
  }

  /* (b) two overlapping captures on a day whose note does not exist yet —
     the loser of the vault.create race re-fetches instead of throwing. */
  {
    const today = require('../src/dates').todayISO(new Date());
    const path = `Diary/Journal/${today}.md`;
    const vault = makeVault({});
    const app = { vault };
    const results = await Promise.allSettled([
      A.captureToJournal(app, settings, 'one'),
      A.captureToJournal(app, settings, 'two'),
    ]);
    assert.ok(results.every(r => r.status === 'fulfilled'), 'neither capture rejects: ' + JSON.stringify(results.map(r => r.reason && r.reason.message)));
    const text = vault.files.get(path).text;
    assert.ok(text.includes('one'), 'first capture landed');
    assert.ok(text.includes('two'), 'second capture landed');
  }

  /* (c) ensureDaily dedupe: a differently-organised (year/month) journal
     already has a note named <iso>.md — the same note the calendar's dot
     already treats as that day's note — so a second, duplicate note at
     <folder>/<iso>.md must not be created. */
  {
    const nested = 'Diary/Journal/2026/09/2026-09-20.md';
    const vault = makeVault({ [nested]: '## Notes\n\n- real entry\n' });
    const app = { vault };
    const f = await A.ensureDaily(app, { journalFolder: 'Diary/Journal', journalTemplate: '' }, '2026-09-20');
    assert.strictEqual(f.path, nested, 'the existing nested note is reused');
    assert.strictEqual(vault.files.size, 1, 'no duplicate note was created');
  }

  console.log('actions-races OK');
})().catch(e => { console.error(e); process.exit(1); });
