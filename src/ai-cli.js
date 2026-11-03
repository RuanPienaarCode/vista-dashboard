'use strict';
/* Runs the user's own AI app (Claude Code, Codex) for the Ask AI chat — on
   a computer only. Shared shape with Find a Deal's cli.js. Node is reached at run time through window.require, and
   only when Platform.isDesktopApp, so nothing here is bundled and the
   phone never touches it (makeRunner() is null there).

   Each run gets a fresh empty folder in the system temp dir as its working
   directory (no project files, no settings to pick up) and is removed
   after. The prompt goes in on stdin. A run longer than timeoutMs is
   stopped (SIGTERM, then SIGKILL 5 seconds later if it is still there)
   and rejects with code 'TIMEOUT'; one that prints more than 20 MB is
   stopped the same way and rejects with 'TOOBIG'; a missing app rejects
   with 'ENOENT'; killAll() (the plugin unloading) stops every live run
   and rejects with 'KILLED'. What the app may do (talk only, no tools) is
   set by its arguments in src/ai-providers.js. */

const { Platform } = require('obsidian');

function nodeApi() {
  if (!Platform || !Platform.isDesktopApp || typeof window === 'undefined' || typeof window.require !== 'function') return null;
  try {
    return { cp: window.require('child_process'), fs: window.require('fs'), os: window.require('os'), path: window.require('path') };
  } catch (e) { return null; }
}

function makeRunner() {
  const n = nodeApi();
  if (!n) return null;
  const home = n.os.homedir();
  /* Where these apps install themselves. Obsidian started from the Dock
     does not see the shell's PATH, so they are looked for here too. */
  const dirs = [n.path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', n.path.join(home, '.npm-global', 'bin'), n.path.join(home, '.bun', 'bin'), n.path.join(home, '.claude', 'local'), '/usr/bin'];
  const env = () => ({ ...process.env, PATH: [...new Set([...dirs, ...String(process.env.PATH || '').split(n.path.delimiter)])].filter(Boolean).join(n.path.delimiter) });

  /* The app's full path: the one set in Settings if it exists, else the
     first of the usual places, else its bare name (PATH decides). */
  function find(bin, configured) {
    const c = String(configured || '').trim();
    if (c && n.fs.existsSync(c)) return c;
    for (const d of dirs) {
      const p = n.path.join(d, bin);
      if (n.fs.existsSync(p)) return p;
    }
    return c || bin;
  }

  /* Every child that has not exited yet, so unloading can stop them. */
  const live = new Set();
  const GRACE_MS = 5000;
  const MAX_BYTES = 20 * 1024 * 1024;

  function run(bin, args, opts) {
    const o = opts || {};
    return new Promise((resolve, reject) => {
      let dir = '';
      try { dir = n.fs.mkdtempSync(n.path.join(n.os.tmpdir(), 'vista-ai-')); } catch (e) { reject(e); return; }
      const cleanup = () => { try { n.fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* the OS clears temp */ } };
      let out = '', err = '', bytes = 0, done = false, timer = null, killTimer = null, entry = null;
      const finish = fn => { if (done) return; done = true; if (timer) clearTimeout(timer); cleanup(); fn(); };
      const fail = (code, message) => { const e = new Error(message); e.code = code; finish(() => reject(e)); };
      /* SIGTERM now; SIGKILL after the grace period unless it has gone. */
      const stop = () => {
        try { child.kill('SIGTERM'); } catch (e) { /* already gone */ }
        if (killTimer) return;
        killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { /* already gone */ } }, o.graceMs === undefined ? GRACE_MS : o.graceMs);
      };
      const gone = () => { if (killTimer) clearTimeout(killTimer); killTimer = null; if (entry) live.delete(entry); };
      let child;
      try {
        child = n.cp.spawn(bin, args, { cwd: dir, env: env(), stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (e) { finish(() => reject(e)); return; }
      entry = { stop: () => { stop(); fail('KILLED', 'stopped'); } };
      live.add(entry);
      const cap = o.maxBytes || MAX_BYTES;
      const take = (d, into) => {
        if (done) return into;
        bytes += d.length;
        if (bytes > cap) { stop(); fail('TOOBIG', 'output over the limit'); return into; }
        return into + d;
      };
      child.stdout.on('data', d => { out = take(d, out); });
      child.stderr.on('data', d => { err = take(d, err); });
      child.on('error', e => { gone(); finish(() => reject(e)); });
      child.on('close', code => { gone(); finish(() => resolve({ code, stdout: out, stderr: err })); });
      if (o.timeoutMs) {
        timer = setTimeout(() => { stop(); fail('TIMEOUT', 'timeout'); }, o.timeoutMs);
      }
      child.stdin.on('error', () => { /* the app closed stdin early; its exit says why */ });
      child.stdin.end(o.stdin || '');
    });
  }

  /* `<app> --version`: free, proves the app is there and runs. */
  async function check(bin, configured) {
    const path = find(bin, configured);
    const r = await run(path, ['--version'], { timeoutMs: 20000 });
    if (r.code !== 0) throw new Error(String(r.stderr || r.stdout).trim().split(/\r?\n/).pop() || `exit ${r.code}`);
    return { path, version: String(r.stdout).trim().split(/\r?\n/)[0] };
  }

  /* The plugin is unloading: stop every run still going. */
  function killAll() { for (const e of [...live]) e.stop(); }

  return { find, run, check, killAll };
}

module.exports = { makeRunner };
