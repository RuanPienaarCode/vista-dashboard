'use strict';
/* A fake vault for the Rhythm tests: the Vault calls Vista and Rhythm's own
   io.js make, with the same semantics that matter here - `process` is a
   queued read -> fn -> write per file (an fn that throws writes nothing, as
   in Obsidian), `create` throws on an existing file, `createFolder` throws
   "Folder already exists." (and with opts.slowFolder yields first, so two
   callers that both saw no folder both try to make it). */
function mkFile(path, text, ctime) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return { path, name, basename: dot > 0 ? name.slice(0, dot) : name, extension: dot > 0 ? name.slice(dot + 1) : '', text, stat: ctime === null ? undefined : { ctime: ctime === undefined ? Date.now() : ctime, mtime: Date.now() } };
}
function makeVault(initial, opts) {
  const o = opts || {};
  const files = new Map();
  for (const [p, t] of Object.entries(initial || {})) files.set(p, mkFile(p, t));
  const folders = new Set();
  const addParents = p => { const parts = p.split('/'); for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/')); };
  for (const p of files.keys()) addParents(p);
  const queue = new Map();
  const parentOf = p => p.slice(0, p.lastIndexOf('/'));
  const vault = {
    files, folders, writes: 0,
    getFileByPath: p => files.get(p) || null,
    getFolderByPath: p => (folders.has(p) ? { path: p, children: [...files.values()].filter(f => parentOf(f.path) === p) } : null),
    createFolder: async p => {
      if (o.slowFolder) await null;
      if (folders.has(p)) throw new Error('Folder already exists.');
      folders.add(p); addParents(p + '/x');
    },
    cachedRead: async f => { if (o.failRead && o.failRead(f)) throw new Error('read failed'); return f.text; },
    read: async f => f.text,
    modify: async (f, t) => { vault.writes++; f.text = t; },
    create: async (p, t) => { if (files.has(p)) throw new Error('File already exists.'); const f = mkFile(p, t); files.set(p, f); addParents(p); vault.writes++; return f; },
    process: (f, fn) => {
      const prior = queue.get(f.path) || Promise.resolve();
      const next = prior.then(() => { const out = fn(f.text); if (out !== f.text) vault.writes++; f.text = out; return out; });
      queue.set(f.path, next.catch(() => {}));
      return next;
    },
  };
  return vault;
}
const makeApp = (vault, rhythmSettings) => ({ vault, plugins: { plugins: rhythmSettings ? { rhythm: { settings: rhythmSettings } } : {} } });
module.exports = { mkFile, makeVault, makeApp };
