'use strict';
/* The next gym session, read from the Gym plugin's plan notes the way its
   own dashboard resolves a weekday (gym-vault src/controller.js
   resolveDaysOn): the active plan's exact day, else its `any` day, then
   every parallel plan's day, and only when nothing is scheduled a fallback
   plan. Pure over plain records. */

const { normalizePath } = require('obsidian');
const { todayISO, addDays } = require('./dates');

const DAY_HEADING = /^##\s+(.+?)\s*\((mon|tue|wed|thu|fri|sat|sun|any)\)\s*$/i;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function weekdayKey(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}

/* A scalar the way gym-app 0.12.1 reads it (gym-vault src/markdown.js
   unquote), so a flag written either way means the same to both plugins.
   YAML single quotes (Obsidian and hand edits write them) have no backslash
   escapes and `''` is one literal `'`. As in gym-app, a value is unquoted only
   when it is ONE quoted string — every quote inside doubled (single) or
   escaped (double) — because `'a' and 'b'` is not one value. Trailing
   `# comments` are not stripped there either, so they are not here. */
function unquote(s) {
  if (/^'.*'$/.test(s)) {
    const inner = s.slice(1, -1);
    return inner.replace(/''/g, '').indexOf("'") === -1 ? inner.replace(/''/g, "'") : s;
  }
  if (!/^".*"$/.test(s)) return s;
  const inner = s.slice(1, -1);
  /* char scan for an unescaped quote (no lookbehind: iOS 15) */
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '"' && (i === 0 || inner[i - 1] !== '\\')) return s;
  }
  return inner.replace(/\\(["\\])/g, '$1');
}

function parseFrontmatter(text) {
  const m = (text || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = {};
  if (!m) return { fm, body: text || '' };
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0 || /^\s/.test(line)) continue;
    let v = line.slice(i + 1).trim();
    v = unquote(v);
    fm[line.slice(0, i).trim()] = v;
  }
  return { fm, body: text.slice(m[0].length) };
}

/* A plan note → { name, active, parallel, fallback, days: [{ name, weekday, items }] }
   Mirrors gym-vault's own plan-parse.js parsePlanBody:
   - a ``` or ~~~ fence marks an EXAMPLE, not plan structure — a heading or
     item written inside one is not real (gym-vault 0.12.0 fenced-heading
     fix);
   - a `##` heading with no `(weekday)` is left unguarded, folding into
     whatever day came before, rather than closing it off — gym-vault's own
     comment calls this a hand-edit hazard left deliberately alone, not a
     bug to fix here;
   - an item is a RAW `- ` line only: an indented annotation (`  - grip:
     overhand`) or a `*`/`+` bullet is the author's own note, not counted. */
function parsePlan(name, text) {
  const { fm, body } = parseFrontmatter(text);
  const days = [];
  let day = null;
  let fenced = false;
  for (const raw of body.split(/\r?\n/)) {
    if (/^(```|~~~)/.test(raw.trim())) { fenced = !fenced; continue; }
    if (fenced) continue;
    const h = DAY_HEADING.exec(raw);
    if (h) { day = { name: h[1].trim(), weekday: h[2].toLowerCase(), items: 0 }; days.push(day); continue; }
    if (day && /^- /.test(raw)) day.items++;
  }
  return { name, active: String(fm.active) === 'true', parallel: String(fm.parallel) === 'true', fallback: String(fm.fallback) === 'true', days };
}

function activePlan(plans) {
  const main = plans.filter(p => !p.parallel);
  return main.find(p => p.active) || main[0] || null;
}

function daysOn(plans, weekday) {
  const out = [];
  const main = activePlan(plans);
  if (main) {
    const own = main.days.filter(d => d.weekday === weekday);
    if (own.length) for (const d of own) out.push({ plan: main, day: d });
    else { const any = main.days.find(d => d.weekday === 'any'); if (any) out.push({ plan: main, day: any }); }
  }
  for (const p of plans.filter(x => x.parallel && !x.fallback)) for (const d of p.days) if (d.weekday === weekday) out.push({ plan: p, day: d });
  if (!out.length) {
    for (const p of plans.filter(x => x.fallback)) {
      const d = p.days.find(x => x.weekday === weekday) || p.days.find(x => x.weekday === 'any');
      if (d) { out.push({ plan: p, day: d }); break; }
    }
  }
  return out;
}

/* workouts: [{ date, plan, day }] from Workouts/*.md frontmatter.
   Returns { sessions: [{plan, day, items}], date, when, last } */
function nextSession(plans, workouts, today) {
  const t = today || todayISO();
  const logged = new Set(workouts.filter(w => w.date === t).map(w => (w.day || '').toLowerCase()));
  let found = null;
  for (let i = 0; i < 8 && !found; i++) {
    const date = addDays(t, i);
    let on = daysOn(plans, weekdayKey(date));
    if (i === 0) on = on.filter(x => !logged.has(x.day.name.toLowerCase()));
    if (on.length) found = { date, when: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : DAY_NAMES[WEEKDAYS.indexOf(weekdayKey(date))], sessions: on.map(x => ({ plan: x.plan.name, day: x.day.name, items: x.day.items })) };
  }
  const past = workouts.filter(w => w.date && w.date <= t).sort((a, b) => b.date.localeCompare(a.date));
  const last = past[0] ? { date: past[0].date, plan: past[0].plan || '', day: past[0].day || '', daysAgo: Math.round((Date.UTC(...t.split('-').map((n, i) => i === 1 ? n - 1 : +n)) - Date.UTC(...past[0].date.split('-').map((n, i) => i === 1 ? n - 1 : +n))) / 86400000) } : null;
  const doneToday = workouts.filter(w => w.date === t).map(w => w.day || w.plan || 'Workout');
  return { next: found, last, doneToday, planCount: plans.length };
}

/* texts: Map(path -> text) for every note; folder: the Gym folder. */
function gymFromTexts(texts, folder, today) {
  /* normalizePath gives '/' for the vault root; as a prefix that is nothing. */
  const norm = normalizePath(folder || 'Gym');
  const prefix = norm === '/' ? '' : norm + '/';
  const plans = [], workouts = [];
  for (const [path, text] of texts) {
    if (path.startsWith(`${prefix}Plans/`) && path.endsWith('.md')) plans.push(parsePlan(path.slice(prefix.length + 6, -3), text));
    else if (path.startsWith(`${prefix}Workouts/`) && path.endsWith('.md')) {
      const { fm } = parseFrontmatter(text);
      workouts.push({ date: String(fm.date || '').slice(0, 10), plan: fm.plan || '', day: fm.day || '' });
    }
  }
  /* gym-vault's own readNotesIn sorts by basename; without this, a fallback
     pick of "the first plan with no active flag" depends on iteration
     order instead of the name the user sees in the Plans folder. */
  plans.sort((a, b) => a.name.localeCompare(b.name));
  if (!plans.length) return { available: false };
  return Object.assign({ available: true }, nextSession(plans, workouts, today));
}

module.exports = { parsePlan, daysOn, nextSession, gymFromTexts, weekdayKey, activePlan };
