'use strict';
/* Guards for the 2026-09-27 mobile audit's runtime CSS findings (items 1-4).
   Plain text assertions against src/styles.css — there's no CSS parser in
   this repo (see tests/ios-hazards.test.cjs for the same style of check). */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

/* Helper: pull the full declaration block for the first rule whose selector
   text CONTAINS `needle` (not an exact-match selector parser — good enough
   for a handful of known, distinctively-named rules). */
function ruleContaining(needle) {
  const at = css.indexOf(needle);
  assert.ok(at !== -1, `selector containing "${needle}" not found in styles.css`);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return css.slice(at, close + 1);
}

/* --- 1: tile labels must wrap, and be capped so they can't grow the tile
   without bound. --- */
{
  const rule = ruleContaining('.vs-tile-label {');
  assert.ok(/white-space:\s*normal/.test(rule), 'vs-tile-label must set white-space: normal — app.css\'s bare `button` rule sets nowrap, which inherits');
  assert.ok(/-webkit-line-clamp:\s*2/.test(rule), 'vs-tile-label must clamp to 2 lines so a long label cannot grow the tile unbounded');
  assert.ok(/display:\s*-webkit-box/.test(rule) && /-webkit-box-orient:\s*vertical/.test(rule), 'line-clamp needs the -webkit-box/-webkit-box-orient pair (iOS 15 safe, no `line-clamp` standard fallback needed)');
}

/* --- 2: modal action rows (TileModal + ReminderModal) must wrap instead of
   overflowing the left edge at phone widths. --- */
{
  const rule = ruleContaining('.vs-modal-actions {');
  assert.ok(/flex-wrap:\s*wrap/.test(rule), 'vs-modal-actions must wrap — 3 buttons at 375px with no wrap overflow off the left edge under justify-content:flex-end');
  const buttonRule = ruleContaining('.vs-modal-actions button {');
  assert.ok(/min-width:\s*0/.test(buttonRule), 'modal-action buttons must be allowed to shrink (min-width:0) or a long label alone forces the row wide before it wraps');
}

/* --- 3: :focus-visible (Safari 15.4+) needs a fallback or iOS 15.0-15.3
   loses EVERY focus ring in the app (an unknown pseudo-class invalidates
   the whole rule, not just that selector). --- */
{
  assert.ok(/:focus-visible\s*\{/.test(css), 'the :focus-visible rule itself should still be present');
  const supportsAt = css.indexOf('@supports not selector(:focus-visible)');
  assert.ok(supportsAt !== -1, 'missing the @supports not selector(:focus-visible) fallback block');
  const block = css.slice(supportsAt, css.indexOf('}\n}', supportsAt) + 3);
  assert.ok(/\.vs-app \.vs-page button:focus\s*\{/.test(block), 'fallback block must restyle :focus (not :focus-visible) with the same ring');
  assert.ok(/outline:\s*2px solid var\(--vs-accent\)/.test(block), 'fallback ring must match the :focus-visible one (same colour/width)');
}

/* --- 4: capture input must be >= 16px or iOS auto-zooms the page on focus. --- */
{
  const rule = ruleContaining('.vs-capture-input, .vs-app input.vs-capture-input:hover');
  const m = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(rule);
  assert.ok(m, 'vs-capture-input rule must set an explicit font-size');
  assert.ok(Number(m[1]) >= 16, `vs-capture-input font-size is ${m[1]}px — must be >= 16px to sit at/above iOS's auto-zoom threshold`);
}

console.log('css ios15 fixes OK');
