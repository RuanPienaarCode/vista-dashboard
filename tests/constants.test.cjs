'use strict';
/* The defaults ship in a public repo and apply to every new vault: they must
   not mirror the author's own vault (folders, templates, places). */
const assert = require('node:assert');
const { DEFAULT_SETTINGS: D } = require('../src/constants');

assert.strictEqual(D.weatherLocation, '', 'no place is assumed — weather stays off until one is set');
assert.strictEqual(D.budgetFolder, '', 'the Budget card needs a folder the user names');
assert.strictEqual(D.journalFolder, '', 'daily notes go where the user says (blank = vault root)');
assert.strictEqual(D.journalTemplate, '');
assert.strictEqual(D.gymFolder, 'Gym', 'Gym’s own default folder name, not a private path');
assert.ok(!('weatherGeo' in D) && !('weatherLast' in D), 'the weather cache is per-device, not a setting');
assert.strictEqual(D.tiles, null, 'null = the built-in starter tiles');
/* Every path-like default is blank or a plugin's own generic name — nothing
   that only exists in one person's vault. */
for (const k of ['weatherLocation', 'budgetFolder', 'journalFolder', 'journalTemplate']) assert.strictEqual(D[k], '', k + ' is blank by default');
console.log('constants OK');
