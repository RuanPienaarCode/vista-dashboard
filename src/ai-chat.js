'use strict';
/* The Ask AI button and its chat panel on the dashboard.

   A round button sits bottom right. It opens a glass panel: the chat, a chip
   saying what the AI is looking at (the dashboard, or the one item the chat
   was opened from), and a box to type in. Every question is sent with the
   page as it reads on screen at that moment (readPage), so the AI sees what
   the user sees.

   The conversation lives on the plugin, not the view: closing the panel or
   the dashboard keeps it until Obsidian closes, or until Clear. A question
   still out when the dashboard closes gets its answer filed there too. Save
   writes it to a note. Each answer has Copy and Add to journal; the AI itself
   never changes anything. */

const obsidian = require('obsidian');
const { Notice, MarkdownRenderer, Component, normalizePath } = obsidian;
const { el, icon, button, clear } = require('./dom');
const P = require('./ai-providers');
const C = require('./ai-context');
const A = require('./actions');

/* An answer's own markup must not reach the network by itself: an image or
   frame loads the moment it is drawn, so a planted instruction could make the
   AI put dashboard text into an image URL. Markdown and HTML embeds are
   stripped before rendering (safeAnswer), and anything that still carries a
   remote source after rendering is removed here as a second layer. */
const REMOTE_TAGS = 'img, iframe, video, audio, source, embed, object, picture, link';
function tameAnswer(node) {
  if (!node || typeof node.querySelectorAll !== 'function') return;
  /* An answer's checklist shows state; ticking it would change nothing. */
  for (const box of node.querySelectorAll('input[type="checkbox"]')) { box.disabled = true; box.tabIndex = -1; }
  for (const n of [...node.querySelectorAll(REMOTE_TAGS)]) {
    const alt = n.getAttribute && n.getAttribute('alt');
    if (alt && n.parentNode) n.parentNode.insertBefore(document.createTextNode(alt), n);
    if (n.parentNode) n.parentNode.removeChild(n);
  }
}

/* o: { app, plugin, root, readPage: () => string } */
function mountAskAI(o) {
  const { app, plugin, root } = o;
  /* Computer only: on a phone or tablet nothing is drawn and nothing listens,
     whatever called this. The inert handle keeps every caller working. */
  if (obsidian.Platform && obsidian.Platform.isMobile) return { open() {}, toggle() {}, refresh() {}, stop() {} };
  if (!plugin.aiChat) plugin.aiChat = { messages: [], item: null, pending: null };
  /* pending: the token of the question still out, or null. It lives on the
     chat, not this mount, so an answer that lands after the dashboard closed
     is still filed; Stop and Clear set it to null, which drops the answer. */
  const chat = plugin.aiChat;
  let open = false, stopped = false;
  let fab, panel, listEl, chipEl, nameEl, input, sendBtn;
  /* Owns the Markdown renderer's children for the drawn list; replaced on
     every redraw so they never pile up. */
  let md = null;

  const onKey = e => { if (e.key === 'Escape' && open) { toggle(false); fab.focus(); } };

  function build() {
    fab = button(root, 'vs-ai-fab', null, () => toggle(), 'sparkles');
    fab.setAttribute('aria-label', 'Ask AI');
    fab.title = 'Ask AI about this page';
    fab.setAttribute('aria-haspopup', 'dialog');

    panel = el(root, 'div', 'vs-ai is-hidden');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Ask AI');
    const head = el(panel, 'div', 'vs-ai-head');
    const title = el(head, 'div', 'vs-ai-title');
    el(title, 'span', 'vs-ai-title-text', 'Ask AI');
    nameEl = el(title, 'span', 'vs-ai-provider');
    el(head, 'span', 'vs-spacer');
    const save = button(head, 'vs-ai-iconbtn', null, () => saveChat(), 'save');
    save.title = 'Save this chat to a note'; save.setAttribute('aria-label', 'Save chat');
    const wipe = button(head, 'vs-ai-iconbtn', null, () => clearChat(), 'eraser');
    wipe.title = 'Clear the chat'; wipe.setAttribute('aria-label', 'Clear chat');
    const close = button(head, 'vs-ai-iconbtn', null, () => toggle(false), 'x');
    close.title = 'Close'; close.setAttribute('aria-label', 'Close');

    chipEl = el(panel, 'div', 'vs-ai-about');
    listEl = el(panel, 'div', 'vs-ai-list');
    listEl.setAttribute('aria-live', 'polite');

    const form = el(panel, 'div', 'vs-ai-form');
    input = el(form, 'textarea', 'vs-ai-input');
    input.rows = 1;
    input.placeholder = 'Ask about this page, or anything…';
    input.setAttribute('aria-label', 'Your question');
    input.addEventListener('input', grow);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    });
    sendBtn = button(form, 'vs-ai-send', null, () => (chat.pending ? stop() : send()), 'arrow-up');
    sendBtn.setAttribute('aria-label', 'Send');

    root.addEventListener('keydown', onKey);
    root.classList.add('has-ai');
    /* The newest mount draws an answer that lands for a question an older,
       closed mount sent. */
    chat.redraw = redraw;
  }

  function redraw() { if (!stopped && open) renderList(); }

  function grow() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight || 0, 140) + 'px';
  }

  function deviceProvider() { return P.provider(plugin.aiDevice().provider); }

  function renderHead() {
    const p = deviceProvider();
    nameEl.textContent = p.name;
    clear(chipEl);
    icon(chipEl, chat.item ? 'crosshair' : 'layout-dashboard', 'vs-ai-about-icon');
    el(chipEl, 'span', 'vs-ai-about-text', chat.item ? chat.item.label : 'Looking at your dashboard');
    if (chat.item) {
      const x = button(chipEl, 'vs-ai-about-x', null, () => { chat.item = null; renderHead(); }, 'x');
      x.setAttribute('aria-label', 'Back to the whole dashboard');
      x.title = 'Ask about the whole dashboard instead';
    }
  }

  function renderAnswer(into, text) {
    const safe = C.safeAnswer(text);
    if (md && MarkdownRenderer && typeof MarkdownRenderer.render === 'function') {
      try {
        const done = MarkdownRenderer.render(app, safe, into, '', md);
        tameAnswer(into);
        if (done && typeof done.then === 'function') done.then(() => tameAnswer(into), () => {});
        return;
      } catch (e) { clear(into); }
    }
    for (const para of safe.split(/\n{2,}/)) el(into, 'p', null, para);
  }

  function freshRenderer() {
    if (md) { try { md.unload(); } catch (e) { /* already gone */ } }
    md = null;
    if (typeof Component === 'function') { md = new Component(); md.load(); }
  }

  function renderList() {
    freshRenderer();
    clear(listEl);
    if (!chat.messages.length && !chat.pending) {
      const empty = el(listEl, 'div', 'vs-ai-empty');
      el(empty, 'div', 'vs-ai-empty-title', 'Ask anything about what is on this page.');
      el(empty, 'div', 'vs-ai-empty-sub', 'What is due today? What should I do first? Will it rain this week?');
      el(empty, 'div', 'vs-ai-empty-sub', `Answers come from ${deviceProvider().name}. It can read this page but cannot change anything.`);
    }
    chat.messages.forEach((m, i) => {
      if (m.role === 'user') { el(listEl, 'div', 'vs-ai-msg is-user', m.content); return; }
      const wrap = el(listEl, 'div', 'vs-ai-msg is-ai' + (m.error ? ' is-error' : ''));
      const body = el(wrap, 'div', 'vs-ai-body');
      if (m.error) { body.textContent = m.content; return; }
      renderAnswer(body, m.content);
      const tools = el(wrap, 'div', 'vs-ai-tools');
      button(tools, 'vs-ai-tool', 'Copy', () => copy(m.content), 'copy');
      button(tools, 'vs-ai-tool', 'Add to journal', () => toJournal(i), 'pen-line');
      if (m.cut) el(tools, 'span', 'vs-ai-note', 'cut short');
    });
    if (chat.pending) {
      const t = el(listEl, 'div', 'vs-ai-msg is-ai is-thinking');
      el(t, 'span', 'vs-ai-dot'); el(t, 'span', 'vs-ai-dot'); el(t, 'span', 'vs-ai-dot');
      t.setAttribute('aria-label', 'Thinking');
    }
    listEl.scrollTop = listEl.scrollHeight;
    sendBtn.classList.toggle('is-stop', !!chat.pending);
    clear(sendBtn);
    icon(sendBtn, chat.pending ? 'square' : 'arrow-up');
    sendBtn.setAttribute('aria-label', chat.pending ? 'Stop waiting' : 'Send');
  }

  function toggle(want) {
    open = want === undefined ? !open : !!want;
    panel.classList.toggle('is-hidden', !open);
    fab.classList.toggle('is-open', open);
    fab.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { renderHead(); renderList(); setTimeout(() => { if (!stopped && open) input.focus(); }, 30); }
  }

  /* item: { label, text } — opened from one thing on the page. */
  function openFor(item) {
    if (item && item.text) chat.item = { label: String(item.label || 'One item'), text: String(item.text) };
    toggle(true);
  }

  async function send() {
    if (obsidian.Platform && obsidian.Platform.isMobile) return;
    const q = input.value.trim();
    if (!q || chat.pending) return;
    input.value = ''; grow();
    chat.messages.push({ role: 'user', content: q });
    const token = {};
    chat.pending = token;
    renderList();
    const dev = plugin.aiDevice();
    const p = P.provider(dev.provider);
    const s = plugin.settings || {};
    const runner = plugin.aiRunner();
    let vault = '';
    try { vault = app.vault.getName(); } catch (e) { /* unnamed */ }
    let reply;
    try {
      const res = await P.ask({
        provider: p.id,
        model: (s.aiModels && s.aiModels[p.id]) || p.model,
        apiKey: (dev.keys || {})[p.id] || '',
        system: C.systemPrompt({ now: new Date(), vault, name: s.name, page: o.readPage(), item: chat.item }),
        messages: chat.messages.filter(m => !m.error),
        request: obsidian.requestUrl,
        platform: obsidian.Platform,
        run: runner ? runner.run : null,
        binPath: runner ? runner.find(p.bin, (dev.paths || {})[p.id]) : '',
        timeoutMs: 5 * 60 * 1000,
      });
      const text = String(res.text || '').trim();
      reply = text ? { role: 'assistant', content: text, cut: res.stop === 'max_tokens', model: res.model } : { role: 'assistant', content: `${p.name} sent an empty answer.`, error: true };
    } catch (e) {
      console.error('vista ask ai', e);
      reply = { role: 'assistant', content: String((e && e.message) || e), error: true };
    }
    /* Stopped or cleared while it was out: the answer is dropped. */
    if (chat.pending !== token) return;
    chat.pending = null;
    chat.messages.push(reply);
    if (typeof chat.redraw === 'function') chat.redraw();
  }

  /* Stop waiting. An API call can't be taken back, so its answer is just
     dropped when it lands; a Claude Code or Codex run is ended. The question
     goes back in the box so it can be edited and sent again. */
  function stop() {
    if (!chat.pending) return;
    chat.pending = null;
    endRuns();
    const last = chat.messages[chat.messages.length - 1];
    if (last && last.role === 'user') { chat.messages.pop(); input.value = last.content; grow(); }
    renderList();
  }

  function endRuns() {
    const runner = plugin.aiRunner();
    if (runner) runner.killAll();
  }

  function clearChat() {
    if (chat.pending) endRuns();
    chat.pending = null;
    chat.messages = []; chat.item = null;
    renderHead(); renderList();
    input.focus();
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); new Notice('Copied.'); } catch (e) { new Notice('Vista: could not copy.'); }
  }

  function questionFor(i) {
    for (let j = i - 1; j >= 0; j--) if (chat.messages[j].role === 'user') return chat.messages[j].content;
    return '';
  }

  async function toJournal(i) {
    const m = chat.messages[i];
    if (!m) return;
    try {
      const f = await A.captureToJournal(app, plugin.settings, C.journalEntry(questionFor(i), m.content));
      new Notice(`Added to ${f.basename}.`);
    } catch (e) {
      console.error('vista ask ai journal', e);
      new Notice('Vista: could not write to today\'s journal.');
    }
  }

  async function saveChat() {
    const msgs = chat.messages.filter(m => !m.error);
    if (!msgs.some(m => m.role === 'assistant')) { new Notice('Nothing to save yet — ask something first.'); return; }
    const s = plugin.settings || {};
    const folder = String(s.aiChatFolder || '').trim();
    const now = new Date();
    const first = (msgs.find(m => m.role === 'user') || {}).content;
    const p = deviceProvider();
    const last = msgs.filter(m => m.model).pop();
    try {
      if (folder) await A.ensureFolder(app, normalizePath(folder));
      const base = (folder ? normalizePath(folder) + '/' : '') + C.chatNoteName(now, first);
      let path = normalizePath(base + '.md');
      for (let n = 2; app.vault.getFileByPath(path); n++) path = normalizePath(`${base} ${n}.md`);
      const f = await app.vault.create(path, C.chatMarkdown({ messages: msgs, item: chat.item, provider: p.name, model: last && last.model, now }));
      new Notice(`Saved to ${f.path}.`);
    } catch (e) {
      console.error('vista ask ai save', e);
      new Notice('Vista: could not save the chat.');
    }
  }

  build();
  return {
    open: openFor,
    toggle,
    /* Settings changed (often only a tick elsewhere): the provider name may
       have, the conversation has not, so the list and its scroll are left. */
    refresh() { if (open) renderHead(); },
    stop() {
      stopped = true;
      if (md) { try { md.unload(); } catch (e) { /* already gone */ } md = null; }
      root.removeEventListener('keydown', onKey);
      if (chat.redraw === redraw) chat.redraw = null;
      root.classList.remove('has-ai');
      if (fab && fab.parentNode) fab.parentNode.removeChild(fab);
      if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    },
  };
}

module.exports = { mountAskAI, tameAnswer };
