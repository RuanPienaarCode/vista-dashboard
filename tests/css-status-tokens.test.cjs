'use strict';
/* Guards items 8 and 9 of the 2026-09-27 mobile audit. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

/* --- 8: the STATUS colours (late/over/delete/today) read Vista's own tokens.
   Audit 2026-10-07 item 3c: since 27 Sep they read the HOST's
   var(--color-red|green, <hex>) even over a photo, on Vista's own dark glass,
   where a light theme's red (#e93147) is ~2.5:1. The tokens now live on
   .vs-app as dark-glass hexes; only plain mode (host surfaces) re-points them,
   and a light host needs darker ones than Obsidian's own (see contrast below). --- */
const statusChecks = [
  { css: '.vs-task.is-late .vs-row-sub', prop: 'color', token: '--vs-red' },
  { css: '.vs-gym-when.is-today', prop: 'color', token: '--vs-green' },
  { css: '.vs-page .vs-tile-x:hover', prop: 'background', token: '--vs-red-fill' },
  { css: '.vs-budget-num.is-over', prop: 'color', token: '--vs-red' },
  { css: '.vs-meter.is-over .vs-meter-fill', prop: 'background', token: '--vs-red-fill' },
  { css: '.vs-budget-over-amt', prop: 'color', token: '--vs-red' },
  { css: '.vs-nrow.is-late .vs-rwhen.is-late', prop: 'color', token: '--vs-late-ink' },
  { css: '.vs-nrow.is-late .vs-rwhen.is-late', prop: 'background', token: '--vs-late-bg' },
];
for (const c of statusChecks) {
  const at = css.indexOf(c.css + ' {');
  assert.ok(at !== -1, `selector "${c.css}" not found`);
  const close = css.indexOf('}', at);
  const rule = css.slice(at, close);
  assert.ok(new RegExp(`${c.prop}:\\s*var\\(${c.token}\\)`).test(rule), `${c.css}: expected ${c.prop}: var(${c.token}); got: ${rule}`);
}
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
assert.ok(!/--color-(red|green)/.test(bare), 'host --color-red/--color-green must not be read at all: they fail 4.5:1 on a light theme and on Vista\'s dark glass');
assert.ok(!/#ffb3ad/i.test(bare.replace(/--vs-late-ink:\s*#ffb3ad;/, '')), 'the overdue pill ink #ffb3ad (1.33:1 on a light surface) may only appear as the dark-glass default of --vs-late-ink');

/* Token definitions: dark-glass defaults on .vs-app, themed overrides after. */
function declsOf(selector) {
  const at = bare.indexOf(selector + ' {');
  assert.ok(at !== -1, `"${selector}" rule not found`);
  return bare.slice(at, bare.indexOf('}', at));
}
const glass = declsOf('.vs-app'), plain = declsOf('.vs-app.is-plain'), plainLight = declsOf('.theme-light .vs-app.is-plain');
const hexOf = (rule, name) => { const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6});`).exec(rule); assert.ok(m, `${name} must be a plain hex in: ${rule.slice(0, 40)}…`); return m[1]; };
assert.ok(/--vs-faint:\s*var\(--text-muted\)/.test(plain), 'plain mode must map faint ink to --text-muted (host --text-faint is 2.2-2.9:1 yet carries real content)');
assert.ok(!/--vs-faint:\s*var\(--text-faint\)/.test(bare), 'nothing may map --vs-faint to the host --text-faint');

/* Contrast (WCAG), against the worst surface each mode puts text on. */
const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const DARK_SURFACES = ['#1e1e1e', '#262626', '#2e2e2e', '#363636'];   // Obsidian dark: primary, secondary, hover, active-hover
const LIGHT_SURFACES = ['#ffffff', '#f2f3f5', '#e9e8e4'];             // primary, secondary, a warm hover
for (const [name, rule, surfaces] of [['--vs-red', glass, DARK_SURFACES], ['--vs-green', glass, DARK_SURFACES], ['--vs-red', plainLight, LIGHT_SURFACES], ['--vs-green', plainLight, LIGHT_SURFACES]]) {
  const hex = hexOf(rule, name);
  for (const bg of surfaces) assert.ok(ratio(hex, bg) >= 4.5, `${name} ${hex} on ${bg} is ${ratio(hex, bg).toFixed(2)}:1, needs >= 4.5`);
}
/* Negative control: Obsidian's own light status colours really do fail, so the
   override above is earning its place. */
assert.ok(ratio('#e93147', '#f2f3f5') < 4.5 && ratio('#08b94e', '#ffffff') < 4.5, 'sanity: the host light --color-red/--color-green fail 4.5:1');
assert.ok(ratio('#ffb3ad', '#f2f3f5') < 2, 'sanity: the old overdue-pill ink fails on a light surface');

/* Decorative colours (weather bar gradient, event dot) are explicitly OUT of
   scope — they must stay raw hex, not get tokenised along with the status
   set above. */
assert.ok(css.includes('linear-gradient(90deg, #7cc4ff, #ffcf6b)'), 'the weather bar gradient is decorative, not a status colour — must stay as-is');
assert.ok(css.includes('background: #ffb86b;'), 'the calendar event dot is decorative, not a status colour — must stay as-is');

/* --- 9: .is-hidden keeps its !important. Proven, not asserted on faith: a
   representative real rule (.vs-page button.vs-weather, which .is-hidden
   must be able to hide) out-specifies even a maximally page-scoped,
   non-important replacement. --- */
function specificity(selector) {
  let ids = 0, classes = 0, types = 0;
  for (const tok of selector.trim().split(/\s+/)) {
    ids += (tok.match(/#[\w-]+/g) || []).length;
    classes += (tok.match(/\.[\w-]+/g) || []).length;
    classes += (tok.match(/\[[^\]]+\]/g) || []).length;
    classes += (tok.match(/:(?!:)[\w-]+(\([^)]*\))?/g) || []).length;
    const stripped = tok.replace(/\.[\w-]+/g, '').replace(/#[\w-]+/g, '').replace(/\[[^\]]+\]/g, '').replace(/:[\w-]+(\([^)]*\))?/g, '');
    if (stripped && stripped !== '*') types += 1;
  }
  return [ids, classes, types];
}
function higher(a, b) { for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; } return false; }

const isHiddenRule = ruleFor('.vs-app .is-hidden {');
assert.ok(/display:\s*none\s*!important/.test(isHiddenRule), '.is-hidden must still carry !important');

const weatherButtonSel = '.vs-app .vs-page button.vs-weather';
assert.ok(css.includes(weatherButtonSel + ' {'), 'the weather button rule this proof depends on has moved or been renamed — re-check the proof');
const weatherSpec = specificity(weatherButtonSel);
const bestNonImportantReplacement = specificity('.vs-app .vs-page .is-hidden'); // the highest a generic utility could plausibly reach
assert.ok(higher(weatherSpec, bestNonImportantReplacement), `expected button.vs-weather (${weatherSpec}) to out-specify even a page-scoped .is-hidden (${bestNonImportantReplacement}) — if this ever flips, !important really could be dropped`);

/* Negative control: the specificity function itself must actually
   discriminate, or the assertion above would pass vacuously. Strip the
   `button` type selector and the page-scoped replacement wins instead. */
const weakerSel = '.vs-app .vs-weather'; // same rule, minus the `button` type + `.vs-page` scope
const weakerSpec = specificity(weakerSel);
assert.ok(!higher(weakerSpec, bestNonImportantReplacement), 'sanity check: without the `button` type selector, the page-scoped replacement DOES win — proves the comparison above is meaningful, not tautological');

function ruleFor(needle) {
  const at = css.indexOf(needle);
  assert.ok(at !== -1, `"${needle}" not found in styles.css`);
  const close = css.indexOf('}', at);
  return css.slice(at, close + 1);
}

console.log('css status tokens + is-hidden specificity OK');
