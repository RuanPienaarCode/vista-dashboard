'use strict';
/* Ask AI: the chat can be copied, and its text highlighted (Ruan, 5 Nov 2026).
   1. chatText(): the whole chat as plain text for the clipboard, answers
      through safeAnswer, trimmed.
   2. The panel, mounted for real over the fake DOM with messages put straight
      into the chat state (no AI is called): a header button for the whole
      chat (disabled while there is nothing), a Copy under each answer, an
      icon-only one on each question; each writes the right text with
      navigator.clipboard.writeText, shows "Copied" with a check for 1.6 s,
      and a refused write shows an error line.
   3. The stylesheet: every message is selectable (Obsidian makes the whole
      app unselectable; iOS 15 reads only the prefixed property), buttons are
      not; the question's button shows on hover, and at .6 where there is none.
   Negative control (done when written): drop user-select from .vs-ai-list,
   or the writeText call, or the catch, and a named check below fails. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const stub = require('./_stub.cjs');
stub.setIcon = (n, name) => { n.iconName = name; };
const { install, FakeEl } = require('./_fake-dom.cjs');
install();

const C = require('../src/ai-context');

/* ---- 1. chatText ---------------------------------------------------------- */
assert.strictEqual(
  C.chatText({ page: 'Vista dashboard', ai: 'Claude', messages: [{ role: 'user', content: 'What first?' }, { role: 'assistant', content: '  Call mom.\n\n' }] }),
  'Ask AI: Vista dashboard\n\nYou: What first?\n\nClaude: Call mom.', 'who said what, the answer trimmed');
assert.strictEqual(C.chatText({ page: 'P', ai: 'X', messages: [] }), 'Ask AI: P', 'no messages: the heading only');
assert.strictEqual(
  C.chatText({ page: 'P', ai: 'X', messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'Look ![chart](https://evil.example/?d=rent) here' }] }),
  'Ask AI: P\n\nYou: q\n\nX: Look chart here', 'an answer goes through safeAnswer, as it is drawn');
assert.strictEqual(
  C.chatText({ page: 'P', ai: 'X', messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'Could not reach X', error: true }, { role: 'assistant', content: 'a' }] }),
  'Ask AI: P\n\nYou: q\n\nX: a', 'an error line is not part of the conversation');

/* ---- 2. the panel, mounted ------------------------------------------------ */
const { mountAskAI } = require('../src/ai-chat');
const written = [];
let clipboardMode = 'ok';
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  get: () => (clipboardMode === 'none' ? {} : { clipboard: { writeText: async t => { if (clipboardMode === 'deny') throw new Error('Document is not focused'); written.push(t); } } }),
});
const timers = [];
global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
global.clearTimeout = id => { if (timers[id - 1]) timers[id - 1].dead = true; };
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

(async () => {
  const root = new FakeEl('div');
  const plugin = {
    settings: {}, aiChat: { messages: [], item: null, pending: null },
    aiDevice: () => ({ provider: 'claude', keys: { claude: 'k' }, paths: {} }), aiRunner: () => null,
  };
  const handle = mountAskAI({ app: { vault: { getName: () => 'Home' } }, plugin, root, readPage: () => 'page' });
  handle.toggle(true);
  const q = s => root.querySelector(s);
  const all = s => root.querySelectorAll(s);
  const copyAll = q('.vs-ai-copyall');
  assert.ok(copyAll, 'the header has a copy-the-whole-chat button');
  assert.strictEqual(copyAll.getAttribute('aria-label'), 'Copy the whole chat');
  assert.strictEqual(copyAll.querySelector('.vs-icon').iconName, 'copy', 'it wears the lucide copy icon');
  assert.strictEqual(copyAll.disabled, true, 'nothing to copy yet: disabled');

  plugin.aiChat.messages.push({ role: 'user', content: 'What first?' }, { role: 'assistant', content: 'Start with **Call mom** ![x](https://evil.example/a.png).\n' });
  handle.toggle(false); handle.toggle(true);
  assert.strictEqual(q('.vs-ai-copyall').disabled, false, 'a chat to copy: enabled');
  const copyAll2 = q('.vs-ai-copyall');
  const aiEl = q('.vs-ai-msg.is-ai'), youEl = q('.vs-ai-msg.is-user');
  const answerBtn = aiEl.querySelector('.vs-ai-copy');
  assert.ok(answerBtn, 'a Copy button under the answer');
  assert.strictEqual(answerBtn.querySelector('.vs-btn-label').textContent, 'Copy');
  assert.strictEqual(answerBtn.getAttribute('aria-label'), 'Copy this answer');
  assert.ok(aiEl.children.indexOf(answerBtn.parentNode) > aiEl.children.indexOf(aiEl.querySelector('.vs-ai-body')), 'it sits after the answer');
  assert.strictEqual(aiEl.querySelectorAll('.vs-ai-tool').length, 2, 'Add to journal is still there beside it');
  const qBtn = youEl.querySelector('.vs-ai-copy-q');
  assert.ok(qBtn, 'an icon-only copy button on the question');
  assert.strictEqual(qBtn.querySelector('.vs-btn-label'), null, 'no label on it');
  assert.strictEqual(qBtn.getAttribute('aria-label'), 'Copy this question');
  assert.ok(!aiEl.querySelector('.vs-ai-copy-q'), 'only questions get the icon-only button');
  assert.strictEqual(youEl.querySelector('.vs-ai-qtext').textContent, 'What first?', 'the question text is its own node, apart from the button');

  answerBtn.click(); await flush();
  assert.deepStrictEqual(written, ['Start with **Call mom** x.'], 'Copy writes the answer, made safe and trimmed');
  assert.strictEqual(stub.notices.length, 0, 'the button says so; no toast');
  assert.ok(answerBtn.classList.contains('is-copied'));
  assert.strictEqual(answerBtn.querySelector('.vs-btn-label').textContent, 'Copied');
  assert.strictEqual(answerBtn.querySelector('.vs-icon').iconName, 'check', 'with a check');
  const t = timers[timers.length - 1];
  assert.ok(t.ms >= 1500 && t.ms <= 1700, 'for about 1.6 s');
  t.fn();
  assert.ok(!answerBtn.classList.contains('is-copied') && answerBtn.querySelector('.vs-btn-label').textContent === 'Copy', 'then goes back');
  assert.strictEqual(answerBtn.querySelector('.vs-icon').iconName, 'copy');

  qBtn.click(); await flush();
  assert.strictEqual(written[1], 'What first?', 'the question button writes the question');
  assert.ok(qBtn.classList.contains('is-copied') && qBtn.querySelector('.vs-icon').iconName === 'check');
  timers[timers.length - 1].fn();
  assert.strictEqual(qBtn.querySelector('.vs-icon').iconName, 'copy');

  copyAll2.click(); await flush();
  assert.strictEqual(written[2], 'Ask AI: Vista dashboard\n\nYou: What first?\n\nClaude: Start with **Call mom** x.', 'the header button writes the whole chat');
  assert.ok(copyAll2.classList.contains('is-copied'));

  /* a chat opened from one item names it */
  plugin.aiChat.item = { label: 'Reminder: Pay rent', text: 'Due today' };
  handle.toggle(false); handle.toggle(true);
  q('.vs-ai-copyall').click(); await flush();
  assert.ok(written[3].startsWith('Ask AI: Reminder: Pay rent\n\n'), 'the heading names the item the chat is about');
  plugin.aiChat.item = null;
  handle.toggle(false); handle.toggle(true);

  /* a refused write is shown, never swallowed */
  const errors = () => all('.vs-ai-msg.is-error').map(e => e.textContent);
  assert.deepStrictEqual(errors(), []);
  clipboardMode = 'deny';
  q('.vs-ai-msg.is-ai').querySelector('.vs-ai-copy').click(); await flush();
  assert.ok(errors().some(e => /Could not copy: Document is not focused/.test(e)), 'a failed write shows an error line: ' + errors());
  assert.ok(!q('.vs-ai-msg.is-ai').querySelector('.vs-ai-copy').classList.contains('is-copied'), 'and no false "Copied"');
  clipboardMode = 'none';
  q('.vs-ai-copyall').click(); await flush();
  assert.strictEqual(errors().filter(e => /Could not copy/.test(e)).length, 2, 'no clipboard at all is shown too');
  assert.strictEqual(plugin.aiChat.messages.filter(m => m.error).length, 2);
  assert.ok(!/Could not copy/.test(C.chatText({ page: 'P', ai: 'X', messages: plugin.aiChat.messages })), 'an error line is never copied into a chat');
  assert.ok(all('.vs-ai-copy').concat(all('.vs-ai-copy-q'), all('.vs-ai-copyall')).every(b => b.getAttribute('aria-label')), 'every copy button is named');
  handle.stop();

  /* ---- 3. the stylesheet ---------------------------------------------------- */
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) rules.push({ sel: m[1].trim(), body: m[2] });
  const hasSel = (rx, prop) => rules.filter(r => r.sel.split(',').some(s => rx.test(s.trim()))).some(r => prop.test(r.body));
  const TEXT = /(?:^|[^-])user-select:\s*text/, TEXT_PFX = /-webkit-user-select:\s*text/;
  const NONE = /(?:^|[^-])user-select:\s*none/, NONE_PFX = /-webkit-user-select:\s*none/;
  for (const cls of ['vs-ai-list', 'vs-ai-msg', 'vs-ai-body', 'vs-ai-qtext']) {
    const rx = new RegExp(`^\\.vs-app \\.${cls}$`);
    assert.ok(hasSel(rx, TEXT) && hasSel(rx, TEXT_PFX), `.${cls} is selectable, prefixed and plain`);
  }
  assert.ok(hasSel(/^\.vs-app \.vs-ai-body \*$/, TEXT), 'and everything the Markdown renderer draws inside an answer');
  assert.ok(hasSel(/^\.vs-app \.vs-ai-list button$/, NONE) && hasSel(/^\.vs-app \.vs-ai-list button$/, NONE_PFX), 'buttons stay unselectable');
  assert.ok(hasSel(/^\.vs-app \.vs-ai \.vs-ai-copy-q$/, /opacity:\s*0\b/), 'the question button is hidden until hover');
  const media = cond => { let out = ''; for (let i = css.indexOf(cond); i >= 0; i = css.indexOf(cond, i + 1)) out += css.slice(i, css.indexOf('\n}', i) > 0 ? css.indexOf('\n}', i) : i + 400); return out; };
  assert.ok(/vs-ai-copy-q[^{]*\{[^}]*opacity:\s*1/.test(media('@media (hover: hover)')), 'it shows on hover (inside @media (hover: hover))');
  assert.ok(/vs-ai-copy-q[^{]*\{[^}]*opacity:\s*0\.6/.test(media('@media (hover: none)')), 'and sits at .6 on touch');
  assert.ok(!/\(\?<[=!]/.test(css), 'no lookbehind');

  console.log('ai copy OK');
})().catch(e => { console.error(e); process.exit(1); });
