'use strict';
/* Vault search: a fuzzy ranker over file names, aliases and paths. Pure —
   the matcher is injected (Obsidian's prepareFuzzySearch in the app, the
   fallback below in tests and the preview harness). */

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'heic']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'mkv', 'm4v']);
const AUDIO_EXT = new Set(['mp3', 'm4a', 'wav', 'ogg', 'flac', 'aac']);

function fileIcon(ext) {
  const e = (ext || '').toLowerCase();
  if (e === 'md') return 'file-text';
  if (IMAGE_EXT.has(e)) return 'file-image';
  if (VIDEO_EXT.has(e)) return 'file-video';
  if (AUDIO_EXT.has(e)) return 'file-audio';
  if (e === 'canvas') return 'layout-grid';
  if (e === 'base') return 'database';
  if (e === 'pdf') return 'book-open';
  if (e === 'js' || e === 'css' || e === 'json' || e === 'html') return 'file-code';
  return 'file';
}

const isBoundary = ch => !ch || /[\s\/_\-.,()]/.test(ch);

/* Substring first (word-start bonus), then an ordered-subsequence match with
   a bonus for runs and for word starts. Higher is better. */
function fallbackFuzzy(query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) return () => null;
  return text => {
    const t = (text || '').toLowerCase();
    const idx = t.indexOf(q);
    if (idx >= 0) {
      const bonus = (isBoundary(t[idx - 1]) ? 0.3 : 0) + (isBoundary(t[idx + q.length]) ? 0.1 : 0);
      return { score: 1 + bonus - idx / 1000 - t.length / 10000, matches: [[idx, idx + q.length]] };
    }
    let ti = 0, score = 0, prev = -2;
    const matches = [];
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi];
      if (c === ' ') continue;
      const at = t.indexOf(c, ti);
      if (at < 0) return null;
      score += at === prev + 1 ? 0.15 : 0.05;
      if (isBoundary(t[at - 1])) score += 0.1;
      if (matches.length && matches[matches.length - 1][1] === at) matches[matches.length - 1][1] = at + 1;
      else matches.push([at, at + 1]);
      prev = at;
      ti = at + 1;
    }
    return { score: score / q.length - t.length / 10000, matches };
  };
}

/* entries: [{ basename, path, extension, folder, mtime, aliases }] */
function rank(entries, query, makeMatcher, limit) {
  if (!query || !query.trim()) return [];
  const match = (makeMatcher || fallbackFuzzy)(query);
  const out = [];
  for (const e of entries) {
    let best = null, field = 'name';
    const r = match(e.basename);
    if (r) best = r;
    for (const a of e.aliases || []) {
      const ra = match(a);
      if (ra && (!best || ra.score > best.score)) { best = ra; field = 'alias'; }
    }
    if (!best) {
      const rp = match(e.path);
      if (rp) { best = { score: rp.score - 0.5, matches: rp.matches }; field = 'path'; }
    }
    if (best) out.push({ entry: e, score: best.score, matches: best.matches, field });
  }
  out.sort((a, b) => (b.score - a.score) || (a.entry.basename.length - b.entry.basename.length) || ((b.entry.mtime || 0) - (a.entry.mtime || 0)));
  return out.slice(0, limit || 8);
}

function aliasesOf(frontmatter) {
  if (!frontmatter) return [];
  const a = frontmatter.aliases !== undefined ? frontmatter.aliases : frontmatter.alias;
  if (!a) return [];
  if (Array.isArray(a)) return a.filter(x => typeof x === 'string');
  if (typeof a === 'string') return a.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

module.exports = { fileIcon, fallbackFuzzy, rank, aliasesOf, isBoundary };
