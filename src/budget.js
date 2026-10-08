'use strict';
/* Left to spend this period — the Budget plugin's OWN figure where it is
   installed and enabled, this file's own count as a fallback.

   A 2026-09-27 cross-plugin audit (budget-drift.cjs) found this file's own
   reader of the Budget plugin's vault files drifting from the real app in
   thirteen ways — a missing assume-spent provision and a wrong default
   month_start_day among them — because it restated the app's own rule
   instead of reading the app's own answer. budget-vault's branch
   feat/headless-api now exposes exactly that answer headlessly, unreleased
   at the time of writing:
   app.plugins.plugins['budget-app'].api.currentPeriod(). currentBudget()
   below prefers it; the reader in this file runs only when that plugin is not
   installed at all — it cannot see the plugin's privacy lock, so installed-
   but-disabled, an older release without the api, or a failed read are
   no-figures states (2026-10-07 audit), not reasons to read the files.

   The fallback's own rule, unchanged, is the Budget plugin's Dashboard hero
   rule restated (budget-vault src/views/dashboard.js, ISSUE 40):
     budgeted  = Σ budget rows whose live type is a SPENDING type
                 (not income, transfer, savings or investment)
     spent     = outgoings in the period so far, minus the set-aside ones
                 (savings/investment categories), plus the assume-spent
                 provision (a category whose budget is its actual spend, even
                 on a period with no transaction behind it yet), over rows
                 that are not excluded, not in a `budget: false` account, not
                 in a foreign-currency account, not paid out of an earmarked
                 fund, and not under a transfer category
     available = budgeted − spent        (negative = over budget)
     noBudget  = the period's budget table has no rows — the hero's own
                 test (`!(S.budgets[period] || []).length`), which counts every
                 row of the table, readable or not. Then available is null and
                 nothing is over: the hero reads "New period — nothing
                 budgeted yet" over what was spent, and the Budget plugin's API
                 says noBudget with left null and over empty. Without it this
                 reader handed the card 0 − spent, and the card printed
                 "Over budget R X" with every category that had spent anything
                 listed as over (2026-10-07 audit, follow-up).
   "So far" means the period's start up to today. Payday months only
   (month_start_day); interval periods are reported as unsupported rather
   than guessed. Pure below `currentBudget`, which is the only vault reader
   (the API path reads nothing off disk itself — the Budget plugin already
   did). */

const obsidian = require('obsidian');
const { todayISO, pad } = require('./dates');

const SET_ASIDE = new Set(['savings', 'investment']);
const EARMARKED_TYPES = new Set(['savings', 'investment']);

/* ---- tiny readers for the Budget plugin's note formats ------------------- */

function parseFrontmatter(text) {
  const m = (text || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = {};
  if (!m) return fm;
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0 || /^\s/.test(line)) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
    else if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    else if (/^(true|false)$/i.test(v)) v = v.toLowerCase() === 'true';
    else if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
    fm[k] = v;
  }
  return fm;
}

/* The first pipe table in a note: { headers, rows } with cells unescaped. */
function parseTable(text) {
  const lines = (text || '').split(/\r?\n/);
  let headers = null;
  const rows = [];
  const split = line => {
    const cells = [];
    let cur = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '\\' && line[i + 1] === '|') { cur += '|'; i++; }
      else if (ch === '|') { cells.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    cells.push(cur.trim());
    if (cells.length && cells[0] === '') cells.shift();
    if (cells.length && cells[cells.length - 1] === '') cells.pop();
    return cells;
  };
  for (const line of lines) {
    if (!/^\s*\|/.test(line)) { if (headers && rows.length) break; continue; }
    const cells = split(line);
    if (!headers) { headers = cells.map(h => h.toLowerCase()); continue; }
    if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue;
    rows.push(cells);
  }
  return { headers: headers || [], rows };
}

/* "-674.00", "R 1 234,56", "1,234.56", "(300)" → a number, or null. */
function parseAmount(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^[-−–]/.test(s)) { neg = true; s = s.slice(1); }
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return null;
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  let intPart = s, frac = '';
  if (lastDot >= 0 && lastComma >= 0) {
    const sep = Math.max(lastDot, lastComma);
    intPart = s.slice(0, sep); frac = s.slice(sep + 1);
  } else if (lastComma >= 0) {
    const after = s.slice(lastComma + 1);
    if (after.length === 2 && s.indexOf(',') === lastComma) { intPart = s.slice(0, lastComma); frac = after; }
    else if (after.length !== 3) { intPart = s.slice(0, lastComma); frac = after; }
  } else if (lastDot >= 0) {
    const after = s.slice(lastDot + 1);
    if (after.length !== 3 || s.indexOf('.') !== lastDot) { intPart = s.slice(0, lastDot); frac = after; }
  }
  const n = Number(intPart.replace(/[.,]/g, '') + (frac ? '.' + frac.replace(/[.,]/g, '') : ''));
  if (!isFinite(n)) return null;
  return neg ? -n : n;
}

const truthy = cell => { const v = String(cell == null ? '' : cell).trim(); return !!v && !/^(no|false|0|off|n|-)$/i.test(v); };
const safeKey = s => String(s || '').replace(/[\/\\:*?"<>|]/g, '').trim().toLowerCase();

/* ---- the period ------------------------------------------------------------ */

function isoLocal(y, m, d) { const dt = new Date(y, m, d); return todayISO(dt); }

/* Payday month containing `today`: named for the month it ends in.
   parseInt + a default of 23, not Number + a default of 1 — budget-vault's
   own load.js clamps a hand-edited or absent month_start_day the same way,
   and a household that has never set the key (every vault created before it
   existed) runs on 23, not the 1st. */
function periodFor(today, monthStartDay) {
  const n = Math.max(1, Math.min(28, parseInt(monthStartDay, 10) || 23));
  const [y, m, d] = today.split('-').map(Number);
  let py = y, pm = m;
  if (n > 1 && d >= n) { pm += 1; if (pm > 12) { pm = 1; py += 1; } }
  const key = `${py}-${pad(pm)}`;
  if (n === 1) return { key, start: `${key}-01`, end: isoLocal(py, pm, 0) };
  return { key, start: isoLocal(py, pm - 2, n), end: isoLocal(py, pm - 1, n - 1) };
}

function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number), [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const shortDate = iso => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

/* ---- the sum ---------------------------------------------------------------- */

/* input: { settings: {month_start_day, currency, period_days},
            categories: [{name, type, assumeSpent}], accounts: [{...}],
            budgetRows: [{category, type, amount}],
            budgetRowCount,   // optional: every row of the period's budget table,
                              // readable or not (loadBudget's count); absent, the
                              // rows above are all the table there is
            txFiles: [{label, month, rows: [{date, cat, amount, excluded, split}]}],
            today } */
function computeBudget(input) {
  const s = input.settings || {};
  const today = input.today || todayISO();
  if (Number(s.period_days) > 0) return { error: 'Interval pay periods are not supported here yet — open Budget for the figure.' };
  const period = periodFor(today, s.month_start_day);
  const finished = today > period.end;
  const asOf = finished ? period.end : today;
  const currency = String(s.currency || 'R');

  const catType = new Map();
  const catAssumeSpent = new Map();
  for (const c of input.categories || []) {
    catType.set(c.name, String(c.type || 'expense').toLowerCase());
    catAssumeSpent.set(c.name, !!c.assumeSpent);
  }
  const typeOf = (cat, fallback) => catType.has(cat) ? catType.get(cat) : (fallback ? String(fallback).toLowerCase() : null);
  const isSpendType = t => t && t !== 'income' && t !== 'transfer' && !SET_ASIDE.has(t);

  const accounts = input.accounts || [];
  const accountFor = label => accounts.find(a => a.tx_label === label || a.name === label || (a.tx_label && safeKey(a.tx_label) === safeKey(label)) || safeKey(a.name) === safeKey(label)) || null;
  const earmarked = a => {
    if (!a || a.in_budget_stated) return false;
    const ef = a.emergency_fund;
    if (ef === true || (typeof ef === 'number' && ef > 0)) return true;
    if (!EARMARKED_TYPES.has(String(a.type || '').trim().toLowerCase())) return false;
    return (a.goal_amount > 0) || !!a.target_date || (a.monthly_contribution > 0);
  };

  let budgeted = 0;
  const budgetByCat = new Map();
  for (const b of input.budgetRows || []) {
    const t = typeOf(b.category, b.type);
    if (!isSpendType(t)) continue;
    budgeted += b.amount || 0;
    budgetByCat.set(b.category, (budgetByCat.get(b.category) || 0) + (b.amount || 0));
  }

  let spend = 0, setAside = 0, uncategorised = 0, foreign = 0, rows = 0;
  const outByCat = new Map();
  const startMonth = period.start.slice(0, 7), endMonth = period.end.slice(0, 7);
  for (const f of input.txFiles || []) {
    if (f.month < startMonth || f.month > endMonth) continue;
    const a = accountFor(f.label);
    const skipAccount = a && a.in_budget === false;
    const isForeign = !!(a && a.currency && String(a.currency).trim() !== currency.trim());
    const fund = earmarked(a);
    for (const r of f.rows) {
      if (!r.date || r.date < period.start || r.date > asOf) continue;
      if (r.excluded || r.split === 'parent') continue;
      if (skipAccount) continue;
      if (isForeign) { foreign++; continue; }
      const amount = r.amount || 0;
      if (fund && amount < 0) continue;
      const t = typeOf(r.cat, null);
      if (t === 'transfer') continue;
      rows++;
      if (!r.cat) uncategorised++;
      if (t === 'income') continue;
      if (amount < 0) {
        spend += -amount;
        if (SET_ASIDE.has(t)) setAside += -amount;
        if (r.cat) outByCat.set(r.cat, (outByCat.get(r.cat) || 0) + -amount);
      } else if (r.cat) {
        outByCat.set(r.cat, (outByCat.get(r.cat) || 0) - amount);
      }
    }
  }
  /* Assume-spent provision — the Budget plugin's own rule (money-flow.js's
     assumedActual/assumedProvision): a category whose budget IS its actual
     spend counts as spent up to its budget even on a period with nothing
     posted against it yet, and only the shortfall between the two is the
     provision (a category already spent past its budget adds nothing extra).
     Scoped to spend-type categories, matching budgetByCat above — the same
     scope the real app's own denominator (`budgeted`) uses; a savings or
     investment category marked assume_spent is left to the real app, not
     guessed at here. */
  let assumedProvision = 0;
  const actualFor = cat => {
    const real = Math.max(0, outByCat.get(cat) || 0);
    if (!catAssumeSpent.get(cat)) return outByCat.get(cat) || 0;
    return Math.max(budgetByCat.get(cat) || 0, real);
  };
  for (const [cat, budgetAmt] of budgetByCat) {
    if (!catAssumeSpent.get(cat)) continue;
    const real = Math.max(0, outByCat.get(cat) || 0);
    assumedProvision += Math.max(budgetAmt, real) - real;
  }
  const spent = spend - setAside + assumedProvision;
  const available = budgeted - spent;
  const overCats = [];
  for (const [cat, budget] of budgetByCat) {
    const actual = actualFor(cat);
    if (actual > budget) overCats.push({ category: cat, budget, actual, over: actual - budget });
  }
  for (const [cat, actual] of outByCat) {
    if (!budgetByCat.has(cat) && actual > 0 && isSpendType(typeOf(cat, null))) overCats.push({ category: cat, budget: 0, actual, over: actual, unbudgeted: true });
  }
  overCats.sort((x, y) => y.over - x.over);
  /* No budget for the period (the header's noBudget): the hero's own test,
     on the table's rows — so a row this reader could not read the amount of
     still makes it a budget, as it does for the Budget plugin, and the two
     never disagree about which periods are empty. Then there is nothing to
     be left of and nothing to be over, and budgetHeadline() in dashboard.js
     prints the hero's words over what was spent. */
  const tableRows = Math.max((input.budgetRows || []).length, Number(input.budgetRowCount) || 0);
  const noBudget = tableRows === 0;
  return {
    period: period.key, start: period.start, end: period.end, asOf, finished,
    periodLabel: `${MONTHS_FULL[Number(period.key.slice(5, 7)) - 1]} · ${shortDate(period.start)} – ${shortDate(period.end)}`,
    asOfLabel: shortDate(asOf),
    daysLeft: finished ? 0 : Math.max(0, daysBetween(today, period.end)),
    currency, budgeted, spent, spend, setAside,
    available: noBudget ? null : available, noBudget,
    overCats: noBudget ? [] : overCats, uncategorised, foreign, rows,
  };
}

/* ---- vault adapters ------------------------------------------------------- */

/* The budget folder as a vault path. normalizePath is Obsidian's own rule
   (repeated and edge slashes, backslashes, NBSP); it answers '/' for an empty
   path, which is "no folder" here, not the vault root — an empty setting must
   not make `/Settings.md` look like a budget. */
const norm = p => {
  const s = String(p == null ? '' : p).trim();
  if (!s) return '';
  const n = obsidian.normalizePath(s);
  return n === '/' ? '' : n;
};

function budgetAvailable(app, folder) {
  const f = norm(folder);
  return !!f && !!app.vault.getFileByPath(f + '/Settings.md');
}

/* files: [{ path, basename, extension }]; read(path) → text */
async function loadBudget(files, read, folder, today) {
  const root = norm(folder);
  const under = sub => files.filter(f => f.extension === 'md' && f.path.startsWith(`${root}/${sub}/`));
  const settings = parseFrontmatter(await read(`${root}/Settings.md`));
  const period = periodFor(today || todayISO(), settings.month_start_day);

  const categories = [];
  for (const f of under('Categories')) {
    const fm = parseFrontmatter(await read(f.path));
    categories.push({ name: fm.name || f.basename, type: fm.type || 'expense', assumeSpent: truthy(fm.assume_spent) });
  }
  const accounts = [];
  for (const f of under('Accounts')) {
    const fm = parseFrontmatter(await read(f.path));
    accounts.push({
      name: f.basename, type: fm.type || 'other', tx_label: fm.tx_label || '', currency: String(fm.currency || '').trim(),
      in_budget: !/^(false|no|off|0)$/i.test(String(fm.budget === undefined || fm.budget === null ? '' : fm.budget).trim()),
      in_budget_stated: String(fm.budget === undefined || fm.budget === null ? '' : fm.budget).trim() !== '',
      emergency_fund: fm.emergency_fund, goal_amount: Number(fm.goal_amount) || 0, target_date: fm.target_date || '', monthly_contribution: Number(fm.monthly_contribution) || 0,
    });
  }
  const budgetRows = [];
  const bt = parseTable(await read(`${root}/Budgets/${period.key}.md`));
  if (bt.headers.length) {
    const ci = bt.headers.indexOf('category'), ti = bt.headers.indexOf('type'), ai = bt.headers.indexOf('amount');
    for (const r of bt.rows) {
      const amount = parseAmount(r[ai]);
      if (!r[ci] || amount === null) continue;
      budgetRows.push({ category: r[ci], type: r[ti] || '', amount });
    }
  }
  /* Every row the Budget plugin would keep, the unreadable AMOUNTS too —
     computeBudget's noBudget. The plugin (budget-vault load.js) keeps a row
     only with a category: a nameless row is held beside the budget, not in it,
     and an all-blank row is dropped. Counting bt.rows.length let a table of
     nameless rows read as a budget, so the card said "Over budget" where the
     Budget plugin said "Nothing budgeted yet". Its column is positional (the
     first); a header row that names Category elsewhere is followed here. */
  const catCol = bt.headers.length && bt.headers.indexOf('category') >= 0 ? bt.headers.indexOf('category') : 0;
  const budgetRowCount = bt.rows.filter(r => String(r[catCol] == null ? '' : r[catCol]).trim() !== '').length;
  const txFiles = [];
  const startMonth = period.start.slice(0, 7), endMonth = period.end.slice(0, 7);
  for (const f of under('Transactions')) {
    const rel = f.path.slice(root.length + '/Transactions/'.length).split('/');
    if (rel.length !== 2) continue;
    const label = rel[0], month = f.basename;
    if (!/^\d{4}-\d{2}$/.test(month) || month < startMonth || month > endMonth) continue;
    const t = parseTable(await read(f.path));
    const h = t.headers;
    const di = h.indexOf('date'), ci = h.indexOf('category'), ai = h.indexOf('amount'), ei = h.indexOf('excluded'), si = h.indexOf('split');
    if (di < 0 || ai < 0) continue;
    txFiles.push({ label, month, rows: t.rows.map(r => ({
      date: (r[di] || '').slice(0, 10), cat: ci >= 0 ? (r[ci] || '') : '', amount: parseAmount(r[ai]) || 0,
      excluded: ei >= 0 ? truthy(r[ei]) : false, split: si >= 0 ? String(r[si] || '').trim().toLowerCase() : '',
    })) });
  }
  return { settings, categories, accounts, budgetRows, budgetRowCount, txFiles, today };
}

/* The Budget plugin itself, if installed and enabled and carrying the
   headless API (budget-vault's src/api.js, release 1.50.0). Version-gated on
   apiVersion rather than a feature-sniff — a future incompatible shape
   bumps the number. Returns the api or null; null covers every way of not
   having a usable one, so use budgetAppStatus() when the reason matters. */
function getBudgetApi(app) {
  const plugins = app && app.plugins && app.plugins.plugins;
  const plugin = plugins && plugins['budget-app'];
  const api = plugin && plugin.api;
  return (api && api.apiVersion === 1) ? api : null;
}

/* Why there is, or is not, a usable api — the one decision about whether
   Vista's own reader may run:
     absent    the Budget plugin is not installed at all. The only state in
               which this file's reader is allowed: it knows nothing of the
               privacy lock, so it may run only where there is no lock.
     disabled  installed, not running (no instance in plugins.plugins). Its
               lock setting is unknown and its files may be locked — no figure.
     no-api    running, but with no api, or an api of another version (an older
               release, or a newer one). No figure either; the same lock
               applies and Vista cannot ask it.
     ready     a usable api; `api` is the instance.
   "Installed" is the manifest map, or a running instance (a map that is
   missing must not turn an installed plugin into an absent one). */
function budgetAppStatus(app) {
  const reg = app && app.plugins;
  const running = !!(reg && reg.plugins && reg.plugins['budget-app']);
  const installed = running || !!(reg && reg.manifests && reg.manifests['budget-app']);
  if (!installed) return { kind: 'absent', api: null };
  if (!running) return { kind: 'disabled', api: null };
  const api = getBudgetApi(app);
  return api ? { kind: 'ready', api } : { kind: 'no-api', api: null };
}

/* Did the Budget plugin's api instance change since `lastApi`? Obsidian builds
   a NEW plugin object (and so a new lock, a new onChange list) each time a
   plugin is reloaded, disabled and re-enabled or updated; a subscription made
   to the old one never hears the new one. The dashboard calls this on every
   gather and on its slow tick: on `changed` it unsubscribes from lastApi,
   subscribes to `api` (when there is one), drops the cached figure and
   re-reads. `api` is null when the instance is gone or unusable. */
function budgetApiChanged(app, lastApi) {
  const api = budgetAppStatus(app).api;
  return { changed: api !== (lastApi || null), api };
}

/* May a cached card value be shown again? `cache` is { value, at, api } where
   api is what budgetAppStatus(app).api returned when the read began (null for
   Vista's own count). Never a lock or an error — the gate may have opened
   since, and an error is only a moment's. Never a figure read through another
   api instance, nor any figure while the plugin is installed-but-unusable. */
function budgetCacheUsable(cache, app, now, maxAgeMs) {
  if (!cache || !cache.value || !(now - cache.at < maxAgeMs)) return false;
  const v = cache.value;
  if (v.locked === true || v.error || v.unavailable) return false;
  const st = budgetAppStatus(app);
  if (st.kind !== 'absent' && st.kind !== 'ready') return false;
  if (v.source === 'budget-app' && !st.api) return false;
  return (cache.api || null) === st.api;
}

/* The no-figures values. `error` is the line the card already prints for a
   failed read (dashboard.js renderBudget), so nothing here needs a new card
   state; `unavailable` names the cause for anything that wants to tell them
   apart. Not one figure field — see tests/budget-privacy.test.cjs. */
const UNAVAILABLE_COPY = {
  failed: 'Budget couldn\'t be read. Open Budget to show it here.',
  disabled: 'Budget is switched off. Turn it on to show it here.',
  'no-api': 'Budget can\'t share its figure with this Vista. Update both plugins to show it here.',
};
const unavailable = why => ({ source: 'budget-app', unavailable: why, error: UNAVAILABLE_COPY[why] });

/* api.currentPeriod()'s payload, mapped onto the shape renderBudget() in
   dashboard.js already reads off `state.budget` — see budget.js's own header
   for the contract. `source: 'budget-app'` lets the (separately owned)
   dashboard.js tell this apart from the fallback below, for the label and
   for the footer's caveats: unlike the fallback, this carries `notes` — full
   sentences, not raw counts, because the API states the caveats the
   Dashboard hero itself prints rather than a count Vista would have to
   re-word into its own sentence (an exported figure must carry the caveats
   its on-screen twin prints, not a paraphrase of them).

   Two answers the Budget plugin added with its 2026-10-07 audit fix
   (budget-vault src/api.js's header has the contract):
     { locked: true } — its privacy splash is up and has not been opened this
       session. Mapped to a figure-free locked value, and deliberately NOT to
       the fallback reader below: reading the same files with this module's
       own reader would put on the card exactly what the splash is hiding, so
       the lock would hide nothing. Mapped here rather than in currentBudget()
       so no other caller can turn a lock into a figure — before this, the
       shortDate() call below threw on the lock's missing dates, and
       currentBudget()'s catch then fell back to that very reader.
     noBudget: true — the period has no budget yet. `left` comes as null (there
       is nothing to be left of), so `available` is null too, and the card
       prints the Budget plugin's own words instead of "Over budget".
   A Budget plugin from before either existed sends neither, and maps exactly
   as it always did: noBudget false, available = left. */
function mapApiPeriod(p, today) {
  if (p.locked === true) return { source: 'budget-app', locked: true };
  const finished = today > p.end;
  return {
    source: 'budget-app',
    start: p.start, end: p.end, asOf: p.asOf, finished,
    periodLabel: p.label,
    asOfLabel: shortDate(p.asOf),
    daysLeft: finished ? 0 : Math.max(0, daysBetween(today, p.end)),
    currency: p.currency.symbol,
    budgeted: p.budgeted, spent: p.spent, available: p.left, noBudget: p.noBudget === true,
    overCats: (p.over || []).map(o => ({ category: o.category, budget: o.budgeted, actual: o.spent, over: o.spent - o.budgeted })),
    // The fallback counts these; the API states them as sentences instead
    // (see `notes` below) — left at 0 so a footer built off them (today's
    // dashboard.js) stays silent rather than printing a false "0 foreign".
    uncategorised: 0, foreign: 0,
    notes: Array.isArray(p.notes) ? p.notes : [],
  };
}

async function currentBudget(app, folder) {
  const status = budgetAppStatus(app);
  /* Vista's own reader knows nothing of the Budget plugin's privacy lock, so
     it runs only where that plugin does not exist; installed-but-disabled or
     without a usable api is a no-figures state, never a quiet fallback. */
  if (status.kind === 'disabled' || status.kind === 'no-api') return unavailable(status.kind);
  if (status.kind === 'ready') {
    try {
      const period = await status.api.currentPeriod();
      // A lock returns here too, as the card's locked value (mapApiPeriod) —
      // it must never fall through to the reader below.
      if (period) return mapApiPeriod(period, todayISO());
      // null: the Budget plugin is installed but its own budget folder isn't
      // set up. Falling through re-reads Vista's OWN folder setting, which —
      // being a different setting — may still be configured; if it is not
      // either, budgetAvailable() already kept this card off screen.
    } catch (e) {
      /* Reject: a failure reading the OTHER plugin's state, possibly the lock
         itself. Vista's reader would ignore the lock and print what the splash
         hides (2026-10-07 audit), so this is an error value with no figures,
         not a fallback. The next gather (change event, tick) tries again. */
      console.error('vista budget: budget-app api.currentPeriod() failed', e);
      return unavailable('failed');
    }
  }
  const files = app.vault.getFiles().map(f => ({ path: f.path, basename: f.basename, extension: f.extension }));
  const read = async p => { const f = app.vault.getFileByPath(p); return f ? app.vault.cachedRead(f) : ''; };
  const input = await loadBudget(files, read, folder, todayISO());
  return Object.assign({ source: 'vista' }, computeBudget(input));
}

/* "R 12 345" — whole units with thin-space thousands; cents only under 100. */
function money(n, symbol) {
  const v = Math.abs(Number(n) || 0);
  const sign = n < 0 ? '−' : '';
  const whole = v >= 100 ? Math.round(v).toString() : v.toFixed(2);
  const [i, f] = whole.split('.');
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${symbol || ''}${symbol && /[A-Za-z]$/.test(symbol) ? ' ' : ''}${grouped}${f ? ',' + f : ''}`;
}

module.exports = {
  computeBudget, loadBudget, currentBudget, budgetAvailable, periodFor, parseAmount, parseTable, parseFrontmatter, money,
  getBudgetApi, mapApiPeriod, budgetAppStatus, budgetApiChanged, budgetCacheUsable,
};
