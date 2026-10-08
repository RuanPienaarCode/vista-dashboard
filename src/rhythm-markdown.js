'use strict';
/* The markdown files ARE the database. Everything shown is derived from notes
   the user could have written by hand, so a hand-edited note must survive a
   round trip: the frontmatter reader models flat `key: value` lines and
   inline lists `[a, b]`, and passes EVERYTHING ELSE through verbatim (block
   sequences Obsidian's Properties panel writes, nested maps, comments).

   Pure — no DOM, no obsidian import. No lookbehind regex anywhere (a
   lookbehind LITERAL is a parse-time SyntaxError on iOS < 16.4 and kills
   the whole bundle at load). */

const FM_LAYOUT = Symbol.for('rv.fmLayout');
const FM_EOL = Symbol.for('rv.fmEol');
const FM_GAP = Symbol.for('rv.fmGap');
const FM_BOM = Symbol.for('rv.fmBom');

/* Which line ending the note already uses — preserved on write so a CRLF
   file never comes back with mixed endings. */
function detectEOL(text) {
  const i = (text || '').indexOf('\n');
  return i > 0 && text[i - 1] === '\r' ? '\r\n' : '\n';
}

/* An unquoted scalar's trailing ` # comment` is a YAML comment, not part of
   the value. Two things make a `#` NOT a comment: it sits inside quotes, or
   it sits inside a `[[wikilink #heading]]`. A quote character only OPENS a
   quoted span when it is the first non-space character of the scalar (or of
   a flow-list item) — an apostrophe in `Mom's day # note` is just text, and
   treating it as an opener swallowed the comment into the value.
   Char-by-char (no lookbehind). */
function stripComment(s) {
  let i0 = 0;
  while (i0 < s.length && (s[i0] === ' ' || s[i0] === '\t')) i0++;
  const flow = s[i0] === '[' && s[i0 + 1] !== '[';
  let quote = null, atStart = true, wiki = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (quote === '"' && ch === '\\') { i++; continue; }
      if (ch === quote) {
        if (quote === "'" && s[i + 1] === "'") { i++; continue; }
        quote = null;
      }
      continue;
    }
    if (ch === ' ' || ch === '\t') continue;
    if (ch === '#' && wiki === 0 && i > 0 && (s[i - 1] === ' ' || s[i - 1] === '\t')) return s.slice(0, i).replace(/[ \t]+$/, '');
    if (atStart && (ch === '"' || ch === "'")) { quote = ch; atStart = false; continue; }
    if (ch === '[' && s[i + 1] === '[') { wiki++; i++; atStart = false; continue; }
    if (ch === ']' && s[i + 1] === ']' && wiki > 0) { wiki--; i++; continue; }
    if (flow && i === i0) { atStart = true; continue; }
    if (flow && ch === ',' && wiki === 0) { atStart = true; continue; }
    atStart = false;
  }
  return s;
}

/* Strip outer quotes and undo yamlStr's escapes — but only when the final
   quote really is the terminator, so `"a" and "b"` keeps its delimiters.
   Handles both YAML quote styles: double-quoted (`\"` / `\\` escapes) and
   single-quoted (the only escape is a doubled `''` for a literal `'`). */
function unquote(s) {
  if (/^".*"$/.test(s)) {
    const inner = s.slice(1, -1);
    if (/(^|[^\\])"/.test(inner)) return s;
    return inner.replace(/\\(["\\])/g, '$1');
  }
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    const inner = s.slice(1, -1);
    let ok = true;
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === "'") {
        if (inner[i + 1] === "'") { i++; continue; }
        ok = false; break;
      }
    }
    return ok ? inner.replace(/''/g, "'") : s;
  }
  return s;
}

/* Split an inline list on commas OUTSIDE quotes (char-by-char; no
   lookbehind). A quote opens one only as the FIRST non-space character of an
   item, so `[Mom's call, Read]` is two plain items. Once open, whichever
   quote character opened closes it, so a comma or the other quote character
   inside is not a delimiter. */
function splitListItems(inner) {
  const items = [];
  let cur = '', quote = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      cur += ch;
      if (quote === '"' && ch === '\\' && i + 1 < inner.length) { cur += inner[++i]; continue; }
      if (ch === quote) {
        if (quote === "'" && inner[i + 1] === "'") { cur += inner[++i]; continue; }
        quote = null;
      }
      continue;
    }
    if ((ch === '"' || ch === "'") && cur.trim() === '') { quote = ch; cur += ch; continue; }
    if (ch === ',') { items.push(cur); cur = ''; continue; }
    cur += ch;
  }
  items.push(cur);
  return items.map(s => unquote(s.trim())).filter(Boolean);
}

function parseScalar(val) {
  val = stripComment(val).trim();
  if (/^\[.*\]$/.test(val) && !/^\[\[[^\]]*\]\]$/.test(val)) {
    return splitListItems(val.slice(1, -1));
  }
  /* A bare number comes back as a NUMBER so it can be written back bare.
     Read as a string it would be re-quoted on the next save (yamlStr has
     to quote a numeric string, or a name like "2024" would become an int),
     and every edit would churn `minutes: 45` into `minutes: "45"`.
     Guarded on the canonical form so `007` and `1.50` stay strings. */
  if (/^-?\d+(\.\d+)?$/.test(val) && String(Number(val)) === val) return Number(val);
  return unquote(val);
}

/* Strip a leading `- ` (block-sequence item) marker and unquote what's
   left, single- or double-quoted. */
function unquoteBlockItem(line) {
  return unquote(line.replace(/^\s*-\s?/, '').trim());
}

/* Locate the frontmatter block. The closing fence must be a line of its own
   starting in column 0 (`---`, trailing blanks allowed) — NOT any `---`
   that happens to end a value (`next: write intro ---`) and not an indented
   one inside a `|` block scalar. Returns { head, rest } or null. */
function findFence(text) {
  const open = /^---\r?\n/.exec(text);
  if (!open) return null;
  const start = open[0].length;
  let pos = start;
  for (;;) {
    const nl = text.indexOf('\n', pos);
    const end = nl < 0 ? text.length : nl;
    let line = text.slice(pos, end);
    if (line.length && line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1);
    if (/^---[ \t]*$/.test(line)) {
      const head = text.slice(start, pos).replace(/\r?\n$/, '');
      return { head, rest: nl < 0 ? '' : text.slice(nl + 1) };
    }
    if (nl < 0) return null;
    pos = nl + 1;
  }
}

const cloneVal = v => (Array.isArray(v) ? v.slice() : v);

/* Do two parsed values mean the same thing? Strings, numbers, or lists of
   strings — nothing nested is ever modelled. */
function sameValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
  }
  return a === b;
}

/* Layout: the frontmatter as an ordered list of parts. A `raw` part is lines
   the model does not understand (comments, nested maps, block scalars),
   passed through verbatim. A `key` part is one modelled key together with
   the EXACT source lines it came from (`lines`) and the value they parsed to
   (`orig`) — so a patch that leaves a key's value alone writes its original
   lines back byte-for-byte, whatever quoting, brackets or block form it
   used. Only a key whose value actually changed is re-serialised. */
function parseFrontmatter(rawText) {
  /* A leading BOM (Universal Clipboard / some external editors) must not
     stop the fence from matching — that would push the whole frontmatter
     block into the body instead of losing just the BOM. It is remembered
     and written back. */
  const raw0 = rawText || '';
  const bom = raw0.charCodeAt(0) === 0xFEFF ? '﻿' : '';
  const text = bom ? raw0.slice(1) : raw0;
  const eol = detectEOL(text);
  const fence = findFence(text);
  const fm = {};
  const layout = [];
  let gap, body;
  if (fence) {
    const lines = fence.head === '' ? [] : fence.head.split(/\r?\n/);
    const raw = line => {
      const last = layout[layout.length - 1];
      if (last && last.kind === 'raw') last.lines.push(line);
      else layout.push({ kind: 'raw', lines: [line] });
    };
    const isItem = l => /^\s*-(\s|$)/.test(l);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s/.test(line) || /^-\s/.test(line) || /^#/.test(line) || line.trim() === '') { raw(line); continue; }
      const ci = line.indexOf(':');
      if (ci <= 0) { raw(line); continue; }
      const key = line.slice(0, ci).trim();
      const rest = line.slice(ci + 1).trim();
      const next = lines[i + 1] ?? '';
      /* A block sequence — `key:` with nothing after it, followed by
         `- item` lines, indented (the form Obsidian's own Properties panel
         writes) or not (js-yaml / Python's default). The WHOLE block (key
         line + every item line) is ONE layout slot, so writing this key
         back replaces all of it — never leaves stray `- item` lines behind
         to form a duplicate key. */
      if (rest === '' && isItem(next)) {
        const items = [];
        let j = i + 1;
        while (j < lines.length && isItem(lines[j])) { items.push(unquoteBlockItem(lines[j])); j++; }
        fm[key] = items;
        layout.push({ kind: 'key', key, lines: lines.slice(i, j), orig: items.slice() });
        i = j - 1;
        continue;
      }
      /* An empty value — `key:`, `key: null`, `key: ~` — is a modelled key
         holding null (what Obsidian's Properties panel leaves for an
         emptied list), so a patch replaces THIS line instead of adding a
         second one. Only when nothing indented follows: that is a nested
         map, which stays raw. */
      const bare = stripComment(rest).trim();
      if ((bare === '' || bare === 'null' || bare === '~') && !/^\s+\S/.test(next)) {
        fm[key] = null;
        layout.push({ kind: 'key', key, lines: [line], orig: null });
        continue;
      }
      if (rest === '' || rest === '>' || rest === '|' || /^\s+\S/.test(next)) { raw(line); continue; }
      fm[key] = parseScalar(rest);
      layout.push({ kind: 'key', key, lines: [line], orig: cloneVal(fm[key]) });
    }
    const g = /^(?:\r?\n)+/.exec(fence.rest);
    gap = g ? g[0] : '';
    body = fence.rest.slice(gap.length);
  } else {
    gap = eol;
    body = text;
  }
  const hide = (k, value) => Object.defineProperty(fm, k, { value, enumerable: false, writable: true, configurable: true });
  hide(FM_LAYOUT, layout);
  hide(FM_EOL, eol);
  hide(FM_GAP, gap);
  hide(FM_BOM, bom);
  return { fm, body };
}

/* Where each of `keys` sits in a note right now, so a later patch can put
   it back EXACTLY: { pos (ordinal among the modelled keys), lines (the raw
   source lines), value (what they parse to, through `norm` if given) } or
   null when the key is absent. Handed to patchFrontmatter as opts.restore. */
function captureKeys(text, keys, norm) {
  const layout = parseFrontmatter(text).fm[FM_LAYOUT];
  const out = {};
  for (const k of keys) out[k] = null;
  let ord = 0;
  for (const part of layout) {
    if (part.kind !== 'key') continue;
    if (keys.includes(part.key) && out[part.key] === null) {
      out[part.key] = { pos: ord, lines: part.lines.slice(), value: norm ? norm(part.orig) : cloneVal(part.orig) };
    }
    ord++;
  }
  return out;
}

/* Quote a scalar for YAML only when it would otherwise change meaning. */
function yamlStr(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v).replace(/\r?\n/g, ' ').trim();
  /* Dates (2026-09-12) stay bare: Obsidian reads them as date properties.
     Bare numbers are quoted so a name like "2024" stays a string. */
  /* Any colon or hash gets quotes, not just one followed by a space: bare
     `05:30` is a sexagesimal number to a YAML 1.1 reader (330), and a bare
     `#` starts a comment. Obsidian's own Properties panel reads these
     files too, so the safe form is the right one. `{ } [ ] ,` are flow
     indicators and matter ANYWHERE in the scalar, not just at the start;
     `? ` `- ` and the remaining indicator characters only matter there. */
  const needsQuote = s === '' || /[{}[\]:#,]/.test(s) || /^[?\-]\s/.test(s)
    || /^[&*!|>'"%@`]/.test(s) || /^\s|\s$/.test(s)
    || /^(true|false|null|yes|no|~)$/i.test(s) || /^-?\d+(\.\d+)?$/.test(s);
  if (!needsQuote) return s;
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function yamlVal(v) {
  if (Array.isArray(v)) return '[' + v.map(yamlStr).join(', ') + ']';
  return yamlStr(v);
}

/* Re-emit the frontmatter: parts in their original order, a key whose value
   is unchanged as its ORIGINAL lines, a changed key re-serialised, raw lines
   verbatim, and any NEW key (not in the layout) at the end. Keys set to
   undefined are dropped.
   opts.restore = { key: { pos, lines, value } } (see captureKeys) puts a key
   that is absent now back at its old ordinal position, and uses its old
   lines when the value being written equals the old value. */
function serializeFrontmatter(fm, opts) {
  const layout = fm[FM_LAYOUT] || [];
  const eol = fm[FM_EOL] || '\n';
  const restore = (opts && opts.restore) || {};
  const parts = [];
  const seen = new Set();
  for (const part of layout) {
    if (part.kind === 'raw') { parts.push({ lines: part.lines }); continue; }
    seen.add(part.key);
    const v = fm[part.key];
    if (v === undefined) continue;
    const snap = restore[part.key];
    const lines = sameValue(v, part.orig) ? part.lines
      : snap && sameValue(v, snap.value) ? snap.lines
        : [`${part.key}: ${yamlVal(v)}`];
    parts.push({ key: part.key, lines });
  }
  const fresh = [];
  for (const [k, v] of Object.entries(fm)) {
    if (seen.has(k) || v === undefined) continue;
    const snap = restore[k];
    fresh.push({
      key: k,
      pos: snap && Number.isInteger(snap.pos) ? snap.pos : null,
      lines: snap && sameValue(v, snap.value) ? snap.lines : [`${k}: ${yamlVal(v)}`],
    });
  }
  fresh.filter(f => f.pos !== null).sort((a, b) => a.pos - b.pos).forEach(f => {
    let n = 0, at = -1;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].key === undefined) continue;
      if (n === f.pos) { at = i; break; }
      n++;
    }
    const item = { key: f.key, lines: f.lines };
    if (at < 0) parts.push(item); else parts.splice(at, 0, item);
  });
  fresh.filter(f => f.pos === null).forEach(f => parts.push({ key: f.key, lines: f.lines }));
  const out = [];
  for (const p of parts) out.push(...p.lines);
  return `---${eol}${out.length ? out.join(eol) + eol : ''}---${eol}`;
}

/* A note read as CRLF must be written back CRLF, never a mix of the two —
   the body is passed through verbatim (untouched, whatever endings it
   already has). The gap between the closing fence and the body (zero, one
   or several blank lines) is the note's own and is kept as found; a note
   built from scratch gets one blank line. */
function buildNote(fm, body, opts) {
  const eol = fm[FM_EOL] || '\n';
  let gap, b;
  if (fm[FM_GAP] !== undefined) { gap = fm[FM_GAP]; b = body || ''; }
  else { b = (body || '').replace(/^(\r?\n)+/, ''); gap = b ? eol : ''; }
  return (fm[FM_BOM] || '') + serializeFrontmatter(fm, opts) + gap + b;
}

/* Patch keys in an existing note's frontmatter, leaving the body and every
   other key's source lines untouched. */
function patchFrontmatter(text, patch, opts) {
  const { fm, body } = parseFrontmatter(text);
  for (const [k, v] of Object.entries(patch)) fm[k] = v;
  return buildNote(fm, body, opts);
}

/* Windows/macOS-illegal filename characters folded to '-'. */
function safeName(s) {
  const cleaned = (s || '').toString().replace(/[\\/:*?"<>|#^\[\]]/g, '-').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 200).trim() || '-';
}

module.exports = { parseFrontmatter, serializeFrontmatter, buildNote, patchFrontmatter, captureKeys, detectEOL, yamlStr, safeName, FM_LAYOUT };
