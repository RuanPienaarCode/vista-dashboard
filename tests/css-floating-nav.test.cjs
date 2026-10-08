'use strict';
/* Guards the iPhone floating-nav case, and the collapse that the first fix for
   it set up (audit 2026-10-07, item 1).

   History: .vs-app once carried `height: calc(100% - var(--view-top-spacing,
   0px))`. app.css declares `.is-phone { --view-top-spacing: 0 }` — UNITLESS —
   so the 0px fallback never applies, `calc(100% - 0)` is invalid at
   computed-value time, and the height computes to auto: a 0px dashboard (every
   child is absolutely positioned). It only rendered because app.css's own
   `.workspace-tabs .workspace-leaf .view-content { height: 100% }` (0,3,0)
   out-specified it. The floating-nav fit really comes from Obsidian's flex
   layout (view-content shrinks by its margin-top), so Vista must not subtract
   anything itself — it only pads the page's bottom for the floating bar. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

/* Every calc( ... ) expression, parentheses balanced. */
function calcExpressions(text) {
  const out = [];
  let i = text.indexOf('calc(');
  while (i !== -1) {
    let depth = 0, j = i + 4;
    for (; j < text.length; j++) {
      if (text[j] === '(') depth++;
      else if (text[j] === ')') { depth--; if (depth === 0) break; }
    }
    out.push(text.slice(i, j + 1));
    i = text.indexOf('calc(', i + 5);
  }
  return out;
}
/* The offence: --view-top-spacing inside a calc(). Obsidian sets it to a bare 0
   in most contexts, which no length arithmetic can absorb. */
const offenders = text => calcExpressions(text).filter(e => /var\(\s*--view-top-spacing/.test(e));

assert.deepStrictEqual(offenders(bare), [], 'no rule may use var(--view-top-spacing…) inside calc(): app.css sets it to a unitless 0, which invalidates the whole declaration and collapses the view to auto height');

/* Negative control: the detector must catch the exact shape that shipped. */
assert.strictEqual(offenders('.vs-app { height: calc(100% - var(--view-top-spacing, 0px)); }').length, 1, 'sanity: the guard has to flag the old declaration');
assert.strictEqual(offenders('.x { padding-bottom: calc(32px + var(--view-bottom-spacing, 0px)); }').length, 0, 'sanity: the bottom-spacing pad is not the offence');

/* .vs-app's height is Obsidian's to decide (flex + app.css's height: 100%);
   if Vista states one it can only be the plain 100%. */
const appAt = bare.indexOf('.vs-app {');
assert.ok(appAt !== -1, '.vs-app rule not found');
const appRule = bare.slice(appAt, bare.indexOf('\n}', appAt));
const heights = [...appRule.matchAll(/(?:^|[;\s{])height:\s*([^;]+);/g)].map(m => m[1].trim());
assert.ok(heights.every(h => h === '100%'), `.vs-app height must be absent or plain 100%; got ${JSON.stringify(heights)}`);
assert.ok(!/\.vs-app\.is-plain\s*\{[^}]*height:/.test(bare), '.is-plain must not re-declare height');

/* The bottom of the leaf needs the matching pad so the capture bar/footer
   don't sit under the floating nav bar, scoped so desktop/classic-nav phones
   (where --view-bottom-spacing is a unitless 0) are unaffected. */
const floatSel = '.is-phone.is-floating-nav .vs-app .vs-page';
const floatAt = bare.indexOf(floatSel);
assert.ok(floatAt !== -1, `missing "${floatSel}" padding-bottom rule`);
const floatRule = bare.slice(floatAt, bare.indexOf('}', floatAt));
assert.ok(/padding-bottom:\s*calc\([^)]*var\(--view-bottom-spacing,\s*0px\)\)/.test(floatRule), 'floating-nav rule must pad-bottom by var(--view-bottom-spacing, 0px)');
for (const e of calcExpressions(bare).filter(x => /--view-bottom-spacing/.test(x))) {
  assert.ok(floatRule.includes(e), `--view-bottom-spacing may only be added inside the floating-nav scope (it is a unitless 0 elsewhere): ${e}`);
}

console.log('css floating-nav OK');
