'use strict';
const assert = require('node:assert');
require('./_stub.cjs');
const G = require('../src/gym');

/* A non-weekday `##` (here "## Notes") does not close the day off — it is
   left unguarded exactly as gym-vault's own plan-parse.js leaves it (its
   comment calls a hand-edit hazard, not a bug), so "- not an exercise here"
   folds into "The Circuit" and counts as its 4th item, matching gym-vault's
   own parsePlanBody on this same text byte for byte. */
const main = G.parsePlan('9 Foundations', '---\nactive: true\n---\nIntro text.\n\n## The Circuit (any)\n\n- Pull-ups | 3 x 5\n- Dips | 3 x 8\n- Rows | 3 x 8\n\n## Notes\n\n- not an exercise here\n');
assert.strictEqual(main.active, true);
assert.deepStrictEqual(main.days, [{ name: 'The Circuit', weekday: 'any', items: 4 }]);
const run = G.parsePlan('Trail Base', '---\nparallel: true\n---\n## Easy Run (tue)\n- Run | 30 min\n## Long Run (sat)\n- Run | 60 min\n');
const rest = G.parsePlan('Rest', '---\nfallback: true\n---\n## Walk (any)\n- Walk | 20 min\n');
const other = G.parsePlan('Other', '---\nactive: false\n---\n## Legs (mon)\n- Squat | 3 x 5\n');
const plans = [other, main, run, rest];

assert.strictEqual(G.activePlan(plans).name, '9 Foundations', 'active: true wins over file order');
assert.deepStrictEqual(G.daysOn(plans, 'tue').map(x => x.plan.name + '/' + x.day.name), ['9 Foundations/The Circuit', 'Trail Base/Easy Run']);
assert.deepStrictEqual(G.daysOn(plans, 'mon').map(x => x.day.name), ['The Circuit'], 'the inactive plan schedules nothing');
assert.deepStrictEqual(G.daysOn([rest, other], 'wed').map(x => x.day.name), ['Legs'].length ? ['Walk'] : [], 'the fallback only when the active plan has nothing that day');

/* 2026-09-13 is a Sunday. */
let n = G.nextSession(plans, [], '2026-09-13');
assert.strictEqual(n.next.when, 'Today');
assert.deepStrictEqual(n.next.sessions.map(s => s.day), ['The Circuit']);
n = G.nextSession(plans, [{ date: '2026-09-13', plan: '9 Foundations', day: 'The Circuit' }], '2026-09-13');
assert.strictEqual(n.next.when, 'Tomorrow', 'today is done, so the next one is tomorrow');
assert.deepStrictEqual(n.doneToday, ['The Circuit']);
n = G.nextSession([run], [{ date: '2026-09-01', plan: 'Trail Base', day: 'Easy Run' }], '2026-09-13');
assert.strictEqual(n.next.when, 'Tuesday');
assert.strictEqual(n.next.date, '2026-09-15');
assert.strictEqual(n.last.daysAgo, 12);
assert.strictEqual(G.nextSession([other], [], '2026-09-13').next.when, 'Tomorrow', 'Sunday the 13th: Monday is tomorrow');
assert.strictEqual(G.nextSession([other], [], '2026-09-12').next.when, 'Monday');

const texts = new Map([
  ['Gym/Plans/9 Foundations.md', '---\nactive: true\n---\n## The Circuit (any)\n- A | 1\n'],
  ['Gym/Workouts/2026-09-01 Easy Run.md', '---\ndate: 2026-09-01\nplan: Trail Base\nday: Easy Run\n---\n| x |\n'],
  ['Home.md', '# nope'],
]);
const g = G.gymFromTexts(texts, 'Gym', '2026-09-13');
assert.strictEqual(g.available, true);
assert.strictEqual(g.next.sessions[0].day, 'The Circuit');
assert.strictEqual(g.last.day, 'Easy Run');
assert.strictEqual(G.gymFromTexts(new Map(), 'Gym').available, false);

/* gym-drift audit #1: a heading and its items inside a ``` fence are an
   EXAMPLE the note is showing, not real plan structure. */
const fenced = G.parsePlan('Strength', '---\nactive: true\n---\nHow to write a day:\n\n```\n## Example (tue)\n- Squat | 3 x 5\n```\n\n## Push (mon)\n- Bench | 3 x 5\n\n## Anything (any)\n- Walk | 1 x 30 min\n');
assert.deepStrictEqual(fenced.days.map(d => d.name), ['Push', 'Anything'], 'the fenced "Example" day is not real');
assert.deepStrictEqual(G.daysOn([fenced], 'tue').map(x => x.day.name), ['Anything'], 'Tuesday falls through to the wildcard day, not the fenced example');

/* gym-drift audit #2: gymFromTexts sorts plans by basename, like
   gym-vault's readNotesIn — so with no plan flagged active, the fallback
   pick is the alphabetically-first plan, not whichever the Map happened to
   iterate first. */
const noActive = new Map([
  ['Gym/Plans/Zercher Block.md', '---\nactive: false\n---\n## Legs (wed)\n- Zercher Squat | 5 x 5\n'],
  ['Gym/Plans/Athlete Base.md', '---\nactive: false\n---\n## Full body (wed)\n- Clean | 5 x 3\n'],
]);
const gNoActive = G.gymFromTexts(noActive, 'Gym', '2026-09-30'); // a Wednesday
assert.strictEqual(gNoActive.next.sessions[0].plan, 'Athlete Base', 'alphabetically-first plan wins the fallback, matching gym-vault');

/* gym-drift audit #3: an item is a raw `- ` line only — an indented
   annotation under an exercise, or a `*` bullet, is the author's own note
   and must not inflate the count. */
const annotated = G.parsePlan('Pull', '---\nactive: true\n---\n## Pull (thu)\n- Pull-ups | 5 x submax\n  - grip: overhand\n  - band if needed\n## Coaching notes\n- Rows | 3 x 10\n* Dead hang | 2 x 30s\n');
assert.strictEqual(annotated.days[0].items, 2, 'only the two raw "- " lines count (Pull-ups, Rows)');

/* gym-app 0.12.1 unquotes YAML single quotes as well as double (Obsidian's
   Properties panel and hand edits write both). Vista reads the same flags, so
   `active: 'true'` must mean what it means to the plugin that wrote it. */
const planWith = fm => G.parsePlan('P', '---\n' + fm + '\n---\n## A (mon)\n- x\n');
assert.strictEqual(planWith("active: 'true'").active, true, "single-quoted true");
assert.strictEqual(planWith('active: "true"').active, true, 'double-quoted true');
assert.strictEqual(planWith("parallel: 'true'").parallel, true);
assert.strictEqual(planWith("fallback: 'true'").fallback, true);
assert.strictEqual(planWith("active: 'false'").active, false);
assert.strictEqual(planWith("active: 'tr''ue'").active, false, "'' is one literal quote, so this is tr'ue");
assert.strictEqual(planWith("active: 'true' and 'x'").active, false, 'two quoted pieces are not one quoted value');
assert.strictEqual(planWith('active: true # current').active, false, "gym-app does not strip trailing comments either, so neither does the card");
assert.strictEqual(planWith('active: True').active, false, 'case matters, as in gym-app');
assert.strictEqual(planWith('active: "tr\\"ue"').active, false, 'escaped quote inside double quotes is unescaped, not stripped');
const wk = G.gymFromTexts(new Map([
  ['Gym/Plans/P.md', '---\nactive: true\n---\n## Push (mon)\n- x\n## Pull (tue)\n- y\n'],
  ['Gym/Workouts/2026-09-14 Push.md', "---\ndate: 2026-09-14\nplan: 'P'\nday: 'Push'\n---\n"],
]), 'Gym', '2026-09-14');
assert.deepStrictEqual(wk.doneToday, ['Push'], "a single-quoted workout day matches the plan's day (not \"'Push'\")");
assert.strictEqual(wk.last.plan, 'P');
assert.strictEqual(wk.next.sessions[0].day, 'Pull', 'so Monday is done and the card moves on');

/* the folder goes through Obsidian's normalizePath */
const planAt = path => new Map([[path, '---\nactive: true\n---\n## A (any)\n- x\n']]);
for (const f of ['Gym', 'Gym/', '/Gym', '//Gym//', 'Gym\\']) {
  assert.strictEqual(G.gymFromTexts(planAt('Gym/Plans/P.md'), f, '2026-09-14').available, true, JSON.stringify(f));
}
assert.strictEqual(G.gymFromTexts(planAt('Fitness/Gym/Plans/P.md'), 'Fitness\\Gym', '2026-09-14').available, true, 'a backslash path');
assert.strictEqual(G.gymFromTexts(planAt('Gym/Plans/P.md'), '', '2026-09-14').available, true, 'blank -> the plugin default folder, Gym');
assert.strictEqual(G.gymFromTexts(planAt('Plans/P.md'), '/', '2026-09-14').available, true, 'the vault root is a folder too');
assert.strictEqual(G.gymFromTexts(planAt('Gym/Plans/P.md'), '/', '2026-09-14').available, false, 'and does not match Gym/Plans');
console.log('gym OK');
