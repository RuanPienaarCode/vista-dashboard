'use strict';
/* Guards audit 2026-10-07 item 5: a Vista modal must pull focus into itself.
   `done.autofocus = true` on a node inserted after page load is a no-op, so
   focus stayed on the row behind the modal and Enter stacked a second modal.
   Runs the REAL src/modals.js over a tiny in-process DOM whose focus()
   moves document.activeElement, like a browser's. */
const assert = require('node:assert');
const stub = require('./_stub.cjs');

class FakeNode {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this._classes = new Set(); this.attrs = {}; this.style = {}; this._text = ''; this.parent = null; }
  set className(v) { this._classes = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  get className() { return [...this._classes].join(' '); }
  get classList() { const s = this; return { add: (...c) => c.forEach(x => s._classes.add(x)), remove: c => s._classes.delete(c), contains: c => s._classes.has(c), toggle: () => {} }; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text; }
  appendChild(c) { this.children.push(c); c.parent = this; return c; }
  append(...cs) { cs.forEach(c => this.appendChild(c)); }
  removeChild(c) { this.children = this.children.filter(x => x !== c); return c; }
  get firstChild() { return this.children[0] || null; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener() {}
  querySelector(sel) { const hit = n => (sel === 'button' ? n.tagName === 'BUTTON' : false); const walk = n => { for (const c of n.children) { if (hit(c)) return c; const r = walk(c); if (r) return r; } return null; }; return walk(this); }
  focus() { global.document.activeElement = this; }
}
global.document = { createElement: t => new FakeNode(t), activeElement: null };

class FakeModal {
  constructor(app) { this.app = app; this.modalEl = new FakeNode('div'); this.contentEl = new FakeNode('div'); }
  open() { this.onOpen(); }
  close() { this.onClose(); }
}
stub.Modal = FakeModal;
stub.Setting = class { constructor(p) { this.controlEl = new FakeNode('div'); this.settingEl = new FakeNode('div'); this.nameEl = new FakeNode('div'); if (p) p.appendChild(this.settingEl); }
  setName() { return this; } setDesc() { return this; } addText(fn) { fn({ setValue() { return this; }, setPlaceholder() { return this; }, onChange() { return this; }, inputEl: new FakeNode('input') }); return this; }
  addDropdown(fn) { fn({ addOption() { return this; }, setValue() { return this; }, onChange() { return this; } }); return this; } addExtraButton(fn) { fn({ setIcon() { return this; }, setTooltip() { return this; }, onClick() { return this; } }); return this; } };

const { ReminderModal, ListModal, TileModal } = require('../src/modals');
const tick = () => new Promise(r => setTimeout(r, 5));

(async () => {
  const behind = new FakeNode('button');
  document.activeElement = behind;

  /* Premise (negative control): the attribute the old code relied on does not
     move focus on its own. */
  const probe = new FakeNode('button'); probe.autofocus = true;
  assert.strictEqual(document.activeElement, behind, 'sanity: setting .autofocus after insertion must not move focus');

  /* ReminderModal: the primary action takes focus, after open. */
  const item = { title: 'Pay the rates', raw: '- [ ] Pay the rates', done: false, priority: 'normal', due: '2026-10-01' };
  const rm = new ReminderModal({}, item, { today: '2026-10-07', onDone() {}, onOpenNote() {} });
  rm.open();
  assert.strictEqual(document.activeElement, behind, 'focus is moved after onOpen returns (Obsidian places its own first), not synchronously');
  await tick();
  assert.ok(document.activeElement && document.activeElement.classList.contains('vs-btn-primary'), 'ReminderModal must focus its primary button');

  /* Closed before the tick: no focus is stolen back from whatever came next. */
  document.activeElement = behind;
  const rm2 = new ReminderModal({}, item, { today: '2026-10-07', onDone() {} });
  rm2.open(); rm2.close();
  await tick();
  assert.strictEqual(document.activeElement, behind, 'a modal closed before the deferred focus must not take focus');

  /* ListModal: focus goes to the dialog, not the first row (Enter must not open note #1). */
  document.activeElement = behind;
  const lm = new ListModal({}, 'Orphans', ['a.md', 'b.md'], () => {});
  lm.open();
  await tick();
  assert.strictEqual(document.activeElement, lm.modalEl, 'ListModal must focus its dialog');
  assert.strictEqual(lm.modalEl.attrs.tabindex, '-1', 'the dialog must be programmatically focusable');

  /* TileModal: a keyboard user lands in the Label box. */
  document.activeElement = behind;
  stub.Platform.isMobile = false;
  const tm = new TileModal({}, null, () => {});
  tm.open();
  await tick();
  assert.ok(document.activeElement && document.activeElement.tagName === 'INPUT', 'TileModal must focus the Label input on desktop');
  document.activeElement = behind;
  stub.Platform.isMobile = true;
  const tm2 = new TileModal({}, null, () => {});
  tm2.open();
  await tick();
  assert.ok(document.activeElement.classList.contains('vs-btn-primary'), 'on mobile the keyboard must not be raised: focus the Save button');

  console.log('modals focus OK');
})().catch(e => { console.error(e); process.exit(1); });
