'use strict';
/* Guard: the weather Place field must not save (and so geocode) on every
   keystroke — item 6 of the 2026-09-27 audit. settings-tab.js wraps its
   save with debounce(); this tests that helper directly (pure, no DOM). */
const assert = require('node:assert');
require('./_stub.cjs');
const { debounce } = require('../src/settings-tab');

let calls = 0;
let lastArg = null;
const record = v => { calls++; lastArg = v; };
const debounced = debounce(record, 40);

/* Three rapid "keystrokes" — like typing "Lon", "Lond", "London". */
debounced('Lon');
debounced('Lond');
debounced('London');
assert.strictEqual(calls, 0, 'must not call synchronously — that would geocode every keystroke');

setTimeout(() => {
  assert.strictEqual(calls, 1, 'three rapid calls must collapse into exactly one trailing call');
  assert.strictEqual(lastArg, 'London', 'the trailing call must carry the LAST value typed, not an earlier one');

  /* Negative control: prove the assertions above are actually discriminating,
     not vacuously true — three calls with no debounce really do fire three
     times immediately. */
  calls = 0;
  record('a'); record('b'); record('c');
  assert.strictEqual(calls, 3, 'sanity check: undebounced calls fire once each (negative control for the debounce claim above)');

  /* A second burst after the first has settled must still collapse to one. */
  calls = 0;
  debounced('x'); debounced('y');
  setTimeout(() => {
    assert.strictEqual(calls, 1, 'debounce must keep collapsing bursts after firing once, not just the first time');
    console.log('settings weather debounce OK');
  }, 80);
}, 80);
