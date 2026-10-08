'use strict';
/* The animation loop must resume when the page comes back to the foreground.
   Backgrounding a phone fires visibilitychange(hidden) and, on return,
   visibilitychange(visible) — but no IntersectionObserver callback, because
   the canvas never moved. The old handler recomputed `visible = !io || visible`,
   which left it false whenever an observer existed, so the leaves/stars canvas
   stayed frozen until the app was restarted. Page visibility and on-screen
   intersection are two facts; a frame runs only while BOTH hold. */
const assert = require('node:assert');

const handlers = {};
let hidden = false, rafQ = [], rafCalls = 0, ioCb = null;
global.document = { get hidden() { return hidden; }, addEventListener: (n, f) => { handlers[n] = f; }, removeEventListener: n => { delete handlers[n]; } };
global.window = { devicePixelRatio: 2, addEventListener() {}, removeEventListener() {} };
global.requestAnimationFrame = f => { rafCalls++; rafQ.push(f); return rafQ.length; };
global.cancelAnimationFrame = () => {};
global.IntersectionObserver = class { constructor(cb) { ioCb = cb; } observe() {} disconnect() {} };
global.ResizeObserver = class { observe() {} disconnect() {} };
const grad = { addColorStop() {} };
const ctx = new Proxy({}, { get: (_, k) => (/Gradient/.test(String(k)) ? () => grad : () => {}), set: () => true });
const canvas = { getContext: () => ctx, parentElement: { getBoundingClientRect: () => ({ width: 390, height: 800 }) }, style: {} };

const E = require('../src/effects');
const fx = E.startEffect(canvas, { type: 'leaves', intensity: 1, reduced: false, mobile: true, hour: 12, leafPalette: 'autumn' });
const run = () => { const q = rafQ; rafQ = []; q.forEach(f => f(1000 + rafCalls * 16)); };
const framesAfter = fn => { const before = rafCalls; fn(); run(); run(); return rafCalls - before; };

ioCb([{ isIntersecting: true }]);
run(); run();
assert.ok(rafQ.length > 0, 'animating while visible and on screen');

/* app backgrounded: the pending frame is allowed to fire and must not reschedule */
hidden = true; handlers.visibilitychange(); run(); run();
assert.strictEqual(rafQ.length, 0, 'no frames are queued while the page is hidden');
const idle = framesAfter(() => {});
assert.strictEqual(idle, 0, 'and none are requested while it stays hidden');

/* app foregrounded: no IntersectionObserver callback fires, yet drawing resumes */
hidden = false;
assert.ok(framesAfter(() => handlers.visibilitychange()) > 0, 'frames resume after the page returns (the frozen-canvas bug)');
assert.ok(rafQ.length > 0, 'and keep going');

/* scrolled off screen: the observer says so, drawing stops */
ioCb([{ isIntersecting: false }]); run(); run();
assert.strictEqual(rafQ.length, 0, 'off screen -> stops');
/* a hide/show cycle while the canvas is still off screen must NOT restart it */
hidden = true; handlers.visibilitychange(); hidden = false;
assert.strictEqual(framesAfter(() => handlers.visibilitychange()), 0, 'resuming the page does not animate a canvas that is off screen');
/* scrolled back on screen */
assert.ok(framesAfter(() => ioCb([{ isIntersecting: true }])) > 0, 'back on screen -> animates again');

fx.stop();
assert.strictEqual(handlers.visibilitychange, undefined, 'stop() removes the listener');
console.log('effects-visibility OK');
