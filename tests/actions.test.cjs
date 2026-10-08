'use strict';
const assert = require('node:assert');
const stub = require('./_stub.cjs');
const A = require('../src/actions');

const d = new Date(2026, 8, 12, 9, 7, 3);
assert.strictEqual(A.formatToken('YYYY-MM-DD', d), '2026-09-12');
assert.strictEqual(A.formatToken('dddd, D MMMM YYYY', d), 'Saturday, 12 September 2026');
assert.strictEqual(A.formatToken('ddd D MMM YY', d), 'Sat 12 Sep 26');
assert.strictEqual(A.formatToken('HH:mm:ss', d), '09:07:03');
assert.strictEqual(A.formatToken('h:mm a', d), '9:07 am');
assert.strictEqual(A.formatToken('h A', new Date(2026, 0, 1, 13)), '1 PM');

const tpl = '# {{date:dddd, D MMMM YYYY}}\n\n{{title}} · {{date}} · {{time}} · {{ time:HH }}h';
assert.strictEqual(A.fillTemplate(tpl, d, '2026-09-12'), '# Saturday, 12 September 2026\n\n2026-09-12 · 2026-09-12 · 09:07 · 09h');

/* R6 (audit finding 6): `Do` ordinal day and `[literal]` moment escapes. */
const d2 = new Date(2026, 8, 27, 9, 5);
assert.strictEqual(A.formatToken('MMMM Do', d2), 'September 27th');
assert.strictEqual(A.formatToken('YYYY [at] HH:mm', d2), '2026 at 09:05');
assert.strictEqual(A.formatToken('Do', new Date(2026, 0, 1)), '1st');
assert.strictEqual(A.formatToken('Do', new Date(2026, 0, 2)), '2nd');
assert.strictEqual(A.formatToken('Do', new Date(2026, 0, 3)), '3rd');
assert.strictEqual(A.formatToken('Do', new Date(2026, 0, 4)), '4th');
assert.strictEqual(A.formatToken('Do', new Date(2026, 0, 11)), '11th');
assert.strictEqual(A.formatToken('Do', new Date(2026, 0, 12)), '12th');
assert.strictEqual(A.formatToken('Do', new Date(2026, 0, 13)), '13th');
assert.strictEqual(A.formatToken('Do', new Date(2026, 0, 21)), '21st');
assert.strictEqual(A.formatToken('Do', new Date(2026, 0, 22)), '22nd');
assert.strictEqual(A.formatToken('Do', new Date(2026, 0, 23)), '23rd');
assert.strictEqual(A.formatToken('Do', new Date(2026, 0, 31)), '31st');
/* existing formats must still render identically */
assert.strictEqual(A.formatToken('dddd, D MMMM YYYY', d), 'Saturday, 12 September 2026');

/* Command execution: the guarded seam reports missing commands with a Notice. */
stub.notices.length = 0;
const app = { commands: { executeCommandById: id => id === 'ok:go' } };
assert.strictEqual(A.runCommand(app, 'ok:go'), true);
assert.strictEqual(A.runCommand(app, 'nope:go'), false);
assert.strictEqual(stub.notices.length, 1);
assert.strictEqual(A.runCommand({}, 'x'), false, 'no commands API at all is survivable');

/* Note resolution: link text first, then exact path, then path + .md. */
const files = { 'Planning/Task Dashboard.md': { path: 'Planning/Task Dashboard.md' }, 'raw.md': { path: 'raw.md' } };
const app2 = {
  metadataCache: { getFirstLinkpathDest: (t) => (t === 'Task Dashboard' ? files['Planning/Task Dashboard.md'] : null) },
  vault: { getFileByPath: p => files[p] || null },
};
assert.strictEqual(A.resolveNote(app2, 'Task Dashboard'), files['Planning/Task Dashboard.md']);
assert.strictEqual(A.resolveNote(app2, 'Task Dashboard.md'), files['Planning/Task Dashboard.md']);
assert.strictEqual(A.resolveNote(app2, 'raw'), files['raw.md']);
assert.strictEqual(A.resolveNote(app2, 'missing'), null);
assert.strictEqual(A.resolveNote(app2, ''), null);

/* Global search: the internal plugin when present, else the command. */
let opened = null;
const app3 = { internalPlugins: { getEnabledPluginById: id => (id === 'global-search' ? { openGlobalSearch: q => { opened = q; } } : null) } };
assert.strictEqual(A.openGlobalSearch(app3, 'tag:#x'), true);
assert.strictEqual(opened, 'tag:#x');
let ran = null;
assert.strictEqual(A.openGlobalSearch({ commands: { executeCommandById: id => { ran = id; return true; } } }, 'q'), true);
assert.strictEqual(ran, 'global-search:open');

assert.strictEqual(A.openMode({ openIn: 'same' }), false);
assert.strictEqual(A.openMode({ openIn: 'tab' }), 'tab');
assert.strictEqual(A.openMode({}), 'tab');
console.log('actions OK');

/* capture: under the heading's list, replacing an empty template bullet */
const tplNote = '---\ntags: [x]\n---\n\n# Sunday\n\n## Word\n\n>\n\n## Notes\n\n-\n\n## Gratitude\n\n-\n';
assert.strictEqual(A.insertCapture(tplNote, 'Notes', '- **09:07** hello'), '---\ntags: [x]\n---\n\n# Sunday\n\n## Word\n\n>\n\n## Notes\n\n- **09:07** hello\n\n## Gratitude\n\n-\n');
const once = A.insertCapture(tplNote, 'Notes', '- one');
assert.strictEqual(A.insertCapture(once, 'Notes', '- two'), once.replace('- one\n', '- one\n- two\n'), 'the next line goes under the last one');
assert.strictEqual(A.insertCapture('# Day\n\n### Notes\n\n## Gratitude\n', 'Notes', '- h3'), '# Day\n\n### Notes\n\n- h3\n\n## Gratitude\n', 'a template with ### Notes still gets the capture');
assert.strictEqual(A.insertCapture('# Notes\n\n### Notes\n- a\n\n## Notes\n- b\n', 'Notes', '- c'), '# Notes\n\n### Notes\n- a\n\n## Notes\n- b\n- c\n', '## wins over ### and the H1 title');
assert.strictEqual(A.insertCapture('# T\n\n## Notes\n\n## Next\n', 'Notes', '- a'), '# T\n\n## Notes\n\n- a\n\n## Next\n', 'an empty section gets a blank line first');
assert.strictEqual(A.insertCapture('# T\n\nbody\n\n\n', 'Missing', '- a'), '# T\n\nbody\n\n## Missing\n\n- a\n', 'no heading → the section is created at the end');
assert.strictEqual(A.insertCapture('', 'Notes', '- a'), '## Notes\n\n- a\n');

/* R5 (audit finding 5): a heading-shaped line inside fenced code is not a
   heading; an H1 of the same name doesn't beat the H2 at the configured
   level; and trailing punctuation/space on the real heading is tolerated. */
assert.strictEqual(
  A.insertCapture('# Day\n\n```bash\n# Notes\necho hi\n```\n\n## Notes\n\n- a\n', 'Notes', '- CAPTURED'),
  '# Day\n\n```bash\n# Notes\necho hi\n```\n\n## Notes\n\n- a\n- CAPTURED\n',
  'the fenced "# Notes" is not a heading; the real ## Notes section is used'
);
assert.strictEqual(
  A.insertCapture('# Notes\n\nIntro.\n\n## Log\n\n- x\n\n## Notes\n\n- a\n', 'Notes', '- CAPTURED'),
  '# Notes\n\nIntro.\n\n## Log\n\n- x\n\n## Notes\n\n- a\n- CAPTURED\n',
  'the H1 page title "Notes" does not win over the H2 "## Notes" section'
);
assert.strictEqual(
  A.insertCapture('## Notes:\n\n- a\n\n## Gratitude\n\n- thanks\n', 'Notes', '- CAPTURED'),
  '## Notes:\n\n- a\n- CAPTURED\n\n## Gratitude\n\n- thanks\n',
  '"## Notes:" (trailing colon) still matches "Notes"'
);
assert.strictEqual(
  A.insertCapture('## Notes \n\n- a\n', 'Notes', '- CAPTURED'),
  '## Notes \n\n- a\n- CAPTURED\n',
  '"## Notes " (trailing space) still matches "Notes"'
);
console.log('capture OK');
