'use strict';
/* Guards audit 2026-10-07 item 2: the Orphans / unresolved-links list rows were
   crushed to 12px. .vs-modal-list is a column flexbox with a max-height and
   each .vs-modal-item has overflow:hidden (so its min-height is 0): with the
   default flex-shrink:1 a long list shrinks every row to a sliver instead of
   overflowing and scrolling. Rows must not shrink; the list must scroll. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const rule = sel => { const at = css.indexOf(sel + ' {'); assert.ok(at !== -1, `"${sel}" not found`); return css.slice(at, css.indexOf('}', at)); };
const shrinks = r => { const f = /(?:^|[;{\s])flex:\s*(\S+)\s+(\S+)/.exec(r); const fs_ = /flex-shrink:\s*(\S+)/.exec(r); return !((f && f[2] === '0') || (fs_ && fs_[1] === '0')); };

const item = rule('.vs-modal .vs-modal-item'), list = rule('.vs-modal .vs-modal-list');
assert.ok(!shrinks(item), 'rows must not shrink (flex: 0 0 auto / flex-shrink: 0) or a long list crushes them');
assert.ok(/display:\s*flex/.test(list) && /flex-direction:\s*column/.test(list), 'the list is a column flexbox');
assert.ok(/max-height:/.test(list) && /overflow-y:\s*auto/.test(list), 'the list must be height-capped and scrollable');

/* Negative control: the shipped rule shrinks, and the detector sees it. */
assert.ok(shrinks('.vs-modal .vs-modal-item { display: block; overflow: hidden; }'), 'sanity: the old rule is flagged');

console.log('css modal list OK');
