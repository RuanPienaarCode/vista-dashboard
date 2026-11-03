'use strict';
/* What the Ask AI chat tells the AI, and how a chat is written down.

   The context is the dashboard as it reads on screen: the page's own visible
   text, gathered by the chat panel (src/ai-chat.js), so every card the user
   can see is in it and nothing they can't. An "item" (a reminder opened in
   its popup) is added on top when the chat was opened from one.

   Pure: no DOM, no obsidian. */

const D = require('./dates');

/* The most page text sent with a question. A dashboard reads well under it;
   the cap stops a giant search result list from riding along. */
const PAGE_MAX = 12000;

const pad = n => String(n).padStart(2, '0');

/* Trims every line, drops empty ones and runs of the same line (an icon
   label repeated by a tooltip), and caps the length. */
function tidyText(text, max) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line || line === out[out.length - 1]) continue;
    out.push(line);
  }
  const joined = out.join('\n');
  const cap = max || PAGE_MAX;
  return joined.length > cap ? joined.slice(0, cap) + '\n…(cut short)' : joined;
}

/* o: { now: Date, vault, name, page, item: { label, text } | null } */
function systemPrompt(o) {
  const now = o.now || new Date();
  const when = `${D.todayISO(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const lines = [
    'You are the assistant inside Vista, a dashboard in the user\'s Obsidian vault.',
    `It is ${now.toLocaleDateString('en-GB', { weekday: 'long' })} ${when} on the user's device.` + (o.vault ? ` The vault is called "${o.vault}".` : ''),
    o.name ? `The user's name is ${o.name}.` : '',
    'Answer questions about what is on their dashboard right now, or anything else they ask.',
    'You can only read and answer: you cannot tick, move, create or change anything. If they want something changed, tell them where to do it.',
    'Keep answers short and plain. Use Markdown lists when they help. If the dashboard does not show what you would need, say so instead of guessing.',
  ].filter(Boolean);
  const page = tidyText(o.page);
  lines.push('', 'The dashboard as it reads on screen right now:', '<dashboard>', page || '(nothing readable on the page)', '</dashboard>');
  if (o.item && o.item.text) {
    lines.push('', `They opened this chat from one item on the dashboard, ${o.item.label || 'an item'}. Questions are most likely about it:`, '<item>', tidyText(o.item.text, 4000), '</item>');
  }
  return lines.join('\n');
}

/* An answer as it may be drawn: no image, frame or media embed, in Markdown
   (`![alt](url)`, `![alt][ref]`, Obsidian's `![[file]]`) or HTML, because
   drawing one fetches it with no click — a way for text planted in a note
   to make the AI leak what the dashboard shows. The alt text is kept.
   Links stay: they only go anywhere when tapped. */
function safeAnswer(text) {
  return String(text || '')
    .replace(/!\[\[([^\]]*)\]\]/g, (m, inner) => `[[${inner}]]`)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/<\/?(img|iframe|video|audio|source|embed|object|picture|link|frame|frameset|svg|image)\b[^>]*>/gi, '');
}

/* A chat note's file name: "2026-11-03 2214 What should I". No characters
   a file name can't hold, at most six words of the first question. */
function chatNoteName(now, firstQuestion) {
  const d = now || new Date();
  const words = String(firstQuestion || '').replace(/[\\/:*?"<>|#^[\]\n\r]+/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
  const base = `${D.todayISO(d)} ${pad(d.getHours())}${pad(d.getMinutes())}`;
  return words ? `${base} ${words}` : `${base} Ask AI`;
}

const yamlStr = s => JSON.stringify(String(s || ''));

/* The note a saved chat becomes. o: { messages, item, provider, model, now } */
function chatMarkdown(o) {
  const now = o.now || new Date();
  const fm = ['---', 'type: ai-chat', `created: ${D.todayISO(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`, `ai: ${yamlStr(o.provider)}`];
  if (o.model) fm.push(`model: ${yamlStr(o.model)}`);
  fm.push(`about: ${yamlStr(o.item && o.item.label ? o.item.label : 'Vista dashboard')}`, '---', '');
  const body = [];
  for (const m of o.messages || []) {
    if (!m || !String(m.content || '').trim()) continue;
    if (m.role === 'user') body.push('## ' + String(m.content).split(/\r?\n/)[0].slice(0, 120), '', '> ' + String(m.content).split(/\r?\n/).join('\n> '), '');
    else if (m.role === 'assistant') body.push(String(m.content).trim(), '');
  }
  return fm.join('\n') + body.join('\n');
}

/* One journal entry for an answer: the question as the bullet, the answer
   indented under it so it stays part of that list item. Blank lines are
   dropped: one would end the list, and the next capture would land above
   the rest of the answer. */
function journalEntry(question, answer) {
  const q = String(question || '').replace(/\s+/g, ' ').trim();
  const a = String(answer || '').trim().split(/\r?\n/).filter(l => l.trim()).map(l => '  ' + l.replace(/\s+$/, '')).join('\n');
  return `Ask AI${q ? ': ' + q : ''}\n${a}`;
}

module.exports = { PAGE_MAX, tidyText, safeAnswer, systemPrompt, chatNoteName, chatMarkdown, journalEntry };
