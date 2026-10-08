'use strict';
/* Modals: the tile editor, the pickers behind it, and a plain list. */

const { Modal, Setting, FuzzySuggestModal, Notice, Platform } = require('obsidian');
const { el, icon, button, clear } = require('./dom');
const { KINDS, GROUPS, ICONS, normalizeTile, validateTile } = require('./tiles');
const NU = require('./nudge');

/* Move focus into a modal once Obsidian has attached it. The `autofocus`
   attribute does nothing for a node added after page load, so without this
   focus stays on the element behind the modal (the row that was clicked) and
   Enter on it opens a second modal on top of the first. Deferred a tick
   because Obsidian places its own focus right after onOpen(); skipped if the
   modal closed in the meantime or the node left the DOM. */
function focusSoon(modal, node) {
  if (!node || typeof node.focus !== 'function') return;
  modal._vsClosed = false;
  setTimeout(() => { if (!modal._vsClosed) node.focus(); }, 0);
}

class NotePicker extends FuzzySuggestModal {
  constructor(app, onPick) { super(app); this.onPick = onPick; this.setPlaceholder('Pick a note or file'); }
  getItems() {
    const files = this.app.vault.getFiles().slice();
    files.sort((a, b) => (a.extension === 'md' ? 0 : 1) - (b.extension === 'md' ? 0 : 1) || a.path.localeCompare(b.path));
    return files;
  }
  getItemText(f) { return f.path; }
  onChooseItem(f) { this.onPick(f); }
}

class CommandPicker extends FuzzySuggestModal {
  constructor(app, onPick) { super(app); this.onPick = onPick; this.setPlaceholder('Pick a command'); }
  getItems() {
    let list = [];
    try { list = this.app.commands && this.app.commands.listCommands ? this.app.commands.listCommands() : []; } catch (e) { list = []; }
    return list.slice().sort((a, b) => a.name.localeCompare(b.name));
  }
  getItemText(c) { return c.name + '  (' + c.id + ')'; }
  onChooseItem(c) { this.onPick(c); }
}

class IconPicker extends FuzzySuggestModal {
  constructor(app, onPick) { super(app); this.onPick = onPick; this.setPlaceholder('Pick an icon'); }
  getItems() { return ICONS; }
  getItemText(name) { return name; }
  renderSuggestion(match, node) {
    const row = el(node, 'div', 'vs-icon-row');
    icon(row, match.item);
    el(row, 'span', null, match.item);
  }
  onChooseItem(name) { this.onPick(name); }
}

class TileModal extends Modal {
  /* tile: existing tile or null; onSave(tile) */
  constructor(app, tile, onSave) {
    super(app);
    this.draft = normalizeTile(tile || { kind: 'note', group: GROUPS[0], label: '', icon: '', target: '' });
    if (!tile) this.draft.label = '';
    this.isNew = !tile;
    this.onSave = onSave;
  }
  onOpen() {
    this.modalEl.classList.add('vs-modal');
    const c = this.contentEl;
    clear(c);
    el(c, 'h2', 'vs-modal-title', this.isNew ? 'New tile' : 'Edit tile');
    const d = this.draft;
    let targetSetting;

    new Setting(c).setName('Opens').addDropdown(dd => {
      for (const k of KINDS) dd.addOption(k.id, k.name);
      dd.setValue(d.kind).onChange(v => { d.kind = v; refreshTarget(); });
    });

    new Setting(c).setName('Label').addText(t => { t.setValue(d.label).onChange(v => { d.label = v; }); this._labelInput = t.inputEl; });

    const iconSetting = new Setting(c).setName('Icon');
    const preview = el(iconSetting.controlEl, 'span', 'vs-icon-preview');
    const drawPreview = () => { clear(preview); icon(preview, d.icon || 'file-text'); };
    drawPreview();
    iconSetting.addText(t => {
      t.setPlaceholder('lucide name').setValue(d.icon).onChange(v => { d.icon = v.trim(); drawPreview(); });
      this._iconText = t;
    });
    iconSetting.addExtraButton(b => b.setIcon('search').setTooltip('Browse icons').onClick(() => {
      new IconPicker(this.app, name => { d.icon = name; this._iconText.setValue(name); drawPreview(); }).open();
    }));

    targetSetting = new Setting(c).setName('Target');
    const refreshTarget = () => {
      const k = KINDS.find(x => x.id === d.kind) || KINDS[0];
      targetSetting.setDesc(k.hint);
      targetSetting.controlEl.toggleClass ? targetSetting.controlEl.toggleClass('vs-hidden', d.kind === 'daily') : (targetSetting.controlEl.style.display = d.kind === 'daily' ? 'none' : '');
      targetSetting.settingEl.classList.toggle('vs-hidden', d.kind === 'daily');
    };
    targetSetting.addText(t => {
      t.setValue(d.target).onChange(v => { d.target = v; });
      this._targetText = t;
      t.inputEl.classList.add('vs-target-input');
    });
    targetSetting.addExtraButton(b => b.setIcon('search').setTooltip('Pick').onClick(() => {
      if (d.kind === 'note') new NotePicker(this.app, f => { d.target = f.extension === 'md' ? f.basename : f.path; if (!d.label) d.label = f.basename; this._targetText.setValue(d.target); }).open();
      else if (d.kind === 'command') new CommandPicker(this.app, cmd => { d.target = cmd.id; if (!d.label) d.label = cmd.name.replace(/^[^:]+:\s*/, ''); this._targetText.setValue(cmd.id); }).open();
      else new Notice('Type the target for this kind of tile.');
    }));
    refreshTarget();

    new Setting(c).setName('Group').addDropdown(dd => {
      for (const g of GROUPS) dd.addOption(g, g);
      dd.setValue(d.group).onChange(v => { d.group = v; });
    });

    const row = el(c, 'div', 'vs-modal-actions');
    button(row, 'vs-btn', 'Cancel', () => this.close());
    const save = button(row, 'vs-btn vs-btn-primary', this.isNew ? 'Add tile' : 'Save', () => {
      const err = validateTile(d);
      if (err) { new Notice('Vista: ' + err); return; }
      this.onSave(normalizeTile(d));
      this.close();
    });
    /* Typing comes first on a keyboard; on a phone focusing a text box would
       raise the keyboard over the form, so there the Save button is it. */
    focusSoon(this, !(Platform && Platform.isMobile) && this._labelInput ? this._labelInput : save);
  }
  onClose() { this._vsClosed = true; clear(this.contentEl); }
}

/* A plain list of paths, each opening the note. */
class ListModal extends Modal {
  constructor(app, title, items, onPick) { super(app); this.title = title; this.items = items; this.onPick = onPick; }
  onOpen() {
    this.modalEl.classList.add('vs-modal');
    const c = this.contentEl;
    clear(c);
    el(c, 'h2', 'vs-modal-title', this.title);
    /* The dialog itself, not the first row: Enter then does nothing rather
       than opening the first note, and Tab walks into the list. */
    this.modalEl.setAttribute('tabindex', '-1');
    focusSoon(this, this.modalEl);
    if (!this.items.length) { el(c, 'p', 'vs-modal-empty', 'Nothing here.'); return; }
    const list = el(c, 'div', 'vs-modal-list');
    for (const item of this.items.slice(0, 400)) {
      const b = button(list, 'vs-modal-item', item, () => { this.close(); this.onPick && this.onPick(item); });
      b.title = item;
    }
    if (this.items.length > 400) el(c, 'p', 'vs-modal-empty', `…and ${this.items.length - 400} more.`);
  }
  onClose() { this._vsClosed = true; clear(this.contentEl); }
}

/* One reminder, opened from the Reminders card: what the line actually says,
   and the few things worth doing about it without leaving the dashboard.
   The modal knows nothing about Nudge — every action is a callback the card
   hands in, so all writing still goes through Nudge's own store. */
class ReminderModal extends Modal {
  /* item: a parsed reminder; o: { today, note, canSnooze, onDone, onSnooze,
     onOpenNote, onOpenNudge } */
  constructor(app, item, o) {
    super(app);
    this.item = item || {};
    this.o = o || {};
  }
  onOpen() {
    this.modalEl.classList.add('vs-modal', 'vs-reminder-modal');
    const c = this.contentEl;
    const it = this.item, o = this.o;
    clear(c);

    const head = el(c, 'div', 'vs-reminder-head');
    if (NU.isUrgent(it)) {
      const flag = el(head, 'span', 'vs-reminder-flag');
      icon(flag, 'flag');
      flag.title = (NU.PRIORITY_LABEL[it.priority] || 'High') + ' priority';
    }
    el(head, 'h2', 'vs-modal-title', it.title || 'Reminder');

    const dl = el(c, 'div', 'vs-reminder-meta');
    for (const row of NU.detailRows(it, o.today)) {
      const r = el(dl, 'div', 'vs-reminder-row');
      el(r, 'span', 'vs-reminder-key', row.label);
      el(r, 'span', 'vs-reminder-val', row.value);
    }

    /* The line itself, because this plugin's whole promise is that a
       reminder is a line you can read. */
    if (it.raw) el(c, 'div', 'vs-reminder-raw', String(it.raw).trim());

    if (!it.done && o.canSnooze && o.onSnooze) {
      const snooze = el(c, 'div', 'vs-reminder-snooze');
      el(snooze, 'span', 'vs-reminder-key', 'Snooze');
      for (const s of NU.SNOOZE) {
        button(snooze, 'vs-chip', s.label, () => { this.close(); o.onSnooze(s.days); });
      }
    }

    const actions = el(c, 'div', 'vs-modal-actions');
    let primary = null;
    if (o.onOpenNudge) button(actions, 'vs-btn', 'Open in Nudge', () => { this.close(); o.onOpenNudge(); });
    if (o.onOpenNote) button(actions, 'vs-btn', 'Open the note', () => { this.close(); o.onOpenNote(); });
    if (o.onDone) {
      primary = button(actions, 'vs-btn vs-btn-primary', it.done ? 'Mark not done' : 'Mark done', () => { this.close(); o.onDone(); });
    }
    focusSoon(this, primary || actions.querySelector && actions.querySelector('button'));
  }
  onClose() { this._vsClosed = true; clear(this.contentEl); }
}

module.exports = { TileModal, NotePicker, CommandPicker, IconPicker, ListModal, ReminderModal };
