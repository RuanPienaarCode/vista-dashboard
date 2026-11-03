'use strict';
/* Ask AI answers are drawn by Obsidian's Markdown renderer into a bubble
   that is NOT .markdown-rendered, so app.css leaves tables, quotes and code
   blocks bare and hangs a dark icon off external links. These rules give
   them a look on the glass; checked in live Obsidian on 3 Nov 2026. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = sel => {
  const at = css.indexOf(sel + ' {');
  assert.ok(at !== -1, `missing rule ${sel}`);
  return css.slice(at, css.indexOf('}', at));
};

assert.ok(/border-bottom:\s*1px/.test(rule('.vs-app .vs-ai-body th, .vs-app .vs-ai-body td')), 'table rows need a line');
assert.ok(/padding:/.test(rule('.vs-app .vs-ai-body th, .vs-app .vs-ai-body td')), 'table cells need padding');
assert.ok(/border-left:/.test(rule('.vs-app .vs-ai-body blockquote')) && /margin:\s*0/.test(rule('.vs-app .vs-ai-body blockquote')), 'a quote is a bar, not a 40px indent');
assert.ok(/overflow-x:\s*auto/.test(rule('.vs-app .vs-ai-body pre')), 'a code block scrolls inside the bubble');
assert.ok(/background:\s*none/.test(rule('.vs-app .vs-ai-body pre code')), 'code inside a block is not a second chip');
assert.ok(/position:\s*absolute/.test(rule('.vs-app .vs-ai .vs-ai-body button.copy-code-button')), 'the copy button sits in the corner');
assert.ok(/background-image:\s*none/.test(rule('.vs-app .vs-ai-body a.external-link')), 'no invisible link icon gap');
assert.ok(/pointer-events:\s*none/.test(rule('.vs-app .vs-ai-body .task-list-item-checkbox')), 'an answer checklist cannot be ticked');
assert.ok(/overflow-x:\s*auto/.test(rule('.vs-app .vs-ai-body table')), 'a wide table scrolls inside the bubble');

console.log('css ai answer OK');
