'use strict';
/* Settings tab. */

const { PluginSettingTab, Setting, normalizePath } = require('obsidian');
const { el, icon } = require('./dom');
const { GRADIENTS, listPhotos, photoTitle } = require('./background');
const { TYPES, LEAF_PALETTES, leafPalette } = require('./effects');
const T = require('./tiles');
const { TileModal } = require('./modals');

/* Collapses rapid-fire calls (typing) into one trailing call `ms` after the
   last one — used so a half-typed weather place isn't saved (and geocoded)
   on every keystroke. Exported for its own test; has no DOM/Obsidian
   dependency so it is tested directly rather than through the settings UI. */
function debounce(fn, ms) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
  wrapped.cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  return wrapped;
}

/* A vault path typed into a text box: Obsidian's own normaliser (slashes, stray
   whitespace, leading/trailing separators) instead of a hand-rolled strip.
   Blank stays blank — normalizePath('') is '/', and "no folder" must remain
   falsy for the settings that treat blank as "off" or "vault root". */
function pathValue(v) {
  const t = String(v || '').trim();
  if (!t) return '';
  const n = normalizePath(t);
  return n === '/' ? '' : n;
}

class VistaSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /* Obsidian calls hide() when the tab is closed; display() when it is shown.
     Tracked so an edit that arrived from another device (the plugin's
     onExternalSettingsChange) can redraw an OPEN tab with the new values and
     leave a closed one alone. */
  hide() { this._shown = false; if (super.hide) super.hide(); }
  onExternalSettingsChange() { if (this._shown) this.display(); }

  display() {
    this._shown = true;
    const { containerEl } = this;
    containerEl.empty();
    containerEl.classList.add('vs-settings');
    const s = this.plugin.settings;
    const save = async () => { await this.plugin.saveSettings(); this.plugin.refreshViews(); };

    new Setting(containerEl).setName('Your name').setDesc('For the greeting. Leave blank to skip it.')
      .addText(t => t.setPlaceholder('Your name').setValue(s.name || '').onChange(async v => { s.name = v.trim(); await save(); }));

    new Setting(containerEl).setName('Open on startup')
      .addDropdown(d => d.addOption('always', 'Always').addOption('empty', 'Only when nothing else is open').addOption('never', 'Never')
        .setValue(s.openOnStartup || 'always').onChange(async v => { s.openOnStartup = v; await save(); }));

    new Setting(containerEl).setName('Open notes in').setDesc('Where a tile, search result or recent note opens.')
      .addDropdown(d => d.addOption('tab', 'A new tab (the dashboard stays)').addOption('same', 'This tab')
        .setValue(s.openIn || 'tab').onChange(async v => { s.openIn = v; await save(); }));

    new Setting(containerEl).setName('24-hour clock')
      .addToggle(t => t.setValue(s.clock24 !== false).onChange(async v => { s.clock24 = v; await save(); }));

    new Setting(containerEl).setName('Background').setHeading();

    new Setting(containerEl).setName('Background')
      .addDropdown(d => d.addOption('photos', 'Photos from a folder').addOption('gradient', 'A gradient').addOption('none', 'Plain (theme colours)')
        .setValue(s.background || 'photos').onChange(async v => { s.background = v; await save(); this.display(); }));

    if (s.background === 'photos') {
      new Setting(containerEl).setName('Photo folder').setDesc('Any jpg, png, webp, gif or avif in this folder (and below) is a candidate.')
        .addText(t => t.setPlaceholder('Dashboard/Backgrounds').setValue(s.photoFolder || '').onChange(async v => { s.photoFolder = pathValue(v); await save(); }));
      new Setting(containerEl).setName('Which photo')
        .addDropdown(d => d.addOption('daily', 'A different one each day').addOption('open', 'A random one each time it opens').addOption('fixed', 'Always the same one')
          .setValue(s.photoMode || 'daily').onChange(async v => { s.photoMode = v; await save(); this.display(); }));
      if (s.photoMode === 'fixed') {
        const photos = listPhotos(this.app.vault.getFiles().map(f => f.path), s.photoFolder);
        new Setting(containerEl).setName('Photo').addDropdown(d => {
          if (!photos.length) d.addOption('', 'No photos found in that folder');
          for (const p of photos) d.addOption(p, photoTitle(p));
          d.setValue(photos.includes(s.photo) ? s.photo : (photos[0] || '')).onChange(async v => { s.photo = v; await save(); });
        });
      }
      new Setting(containerEl).setName('Blur the photo').setDesc('Pixels. Zero keeps it sharp.')
        .addSlider(sl => sl.setLimits(0, 24, 1).setValue(Number(s.blur) || 0).setDynamicTooltip().onChange(async v => { s.blur = v; await save(); }));
    }
    if (s.background !== 'none') {
      if (s.background === 'gradient' || s.background === 'photos') {
        new Setting(containerEl).setName(s.background === 'photos' ? 'Gradient when no photo is found' : 'Gradient')
          .addDropdown(d => { for (const g of GRADIENTS) d.addOption(g.id, g.name); d.setValue(s.gradient || 'aurora').onChange(async v => { s.gradient = v; await save(); }); });
      }
      new Setting(containerEl).setName('Darken').setDesc('How much the background is dimmed so the glass reads clearly.')
        .addSlider(sl => sl.setLimits(0, 80, 5).setValue(Math.round((Number(s.dim) || 0) * 100)).setDynamicTooltip().onChange(async v => { s.dim = v / 100; await save(); }));
    }

    new Setting(containerEl).setName('Effect').setHeading();

    new Setting(containerEl).setName('Particles').setDesc('Drawn on a canvas over the background. Honours "reduce motion" by showing a single still frame.')
      .addDropdown(d => { for (const t of TYPES) d.addOption(t.id, t.name); d.setValue(s.effect || 'auto').onChange(async v => { s.effect = v; await save(); }); });
    new Setting(containerEl).setName('Leaf colours').setDesc('For the falling-leaves effect: autumn\u2019s oranges, reds and browns, or summer\u2019s greens.')
      .addDropdown(d => { for (const p of LEAF_PALETTES) d.addOption(p.id, p.name); d.setValue(leafPalette(s.leafPalette)).onChange(async v => { s.leafPalette = v; await save(); }); });
    new Setting(containerEl).setName('Intensity')
      .addSlider(sl => sl.setLimits(10, 150, 10).setValue(Math.round((Number(s.intensity) || 0.6) * 100)).setDynamicTooltip().onChange(async v => { s.intensity = v / 100; await save(); }));

    new Setting(containerEl).setName('Panels').setHeading();

    new Setting(containerEl).setName('Budget left to spend').setDesc('This period\'s spending budget against what has left the accounts so far. Uses the Budget plugin\'s own figure (read-only, respects its privacy lock) when it is installed and enabled. Hidden when there is no Budget folder.')
      .addToggle(t => t.setValue(s.showBudget !== false).onChange(async v => { s.showBudget = v; await save(); }));
    new Setting(containerEl).setName('Budget folder').setDesc('Leave blank to hide the card, or enter the folder your Budget plugin keeps its files in.')
      .addText(t => t.setPlaceholder('Budget').setValue(s.budgetFolder || '').onChange(async v => { s.budgetFolder = pathValue(v); await save(); }));
    new Setting(containerEl).setName('Tasks due today and overdue').setDesc('Open tasks with a 📅 due date, in the Tasks plugin\'s format. Ticking one goes through the Tasks plugin when it is installed, so recurring tasks roll over correctly.')
      .addToggle(t => t.setValue(s.showTasks !== false).onChange(async v => { s.showTasks = v; await save(); }));
    new Setting(containerEl).setName('Tasks global filter').setDesc('If the Tasks plugin uses a global filter (like #task), put the same text here so only those lines count.')
      .addText(t => t.setPlaceholder('').setValue(s.tasksGlobalFilter || '').onChange(async v => { s.tasksGlobalFilter = v.trim(); await save(); }));
    new Setting(containerEl).setName('Reminders').setDesc('What is due from the Nudge plugin, with what is coming next when nothing is. Reading and ticking both go through Nudge, so a repeating reminder rolls forward correctly. Shown only once Nudge is enabled and its note exists.')
      .addToggle(t => t.setValue(s.showNudge !== false).onChange(async v => { s.showNudge = v; await save(); }));
    new Setting(containerEl).setName('Next gym session').setDesc('From the Gym plugin\'s plans: the active plan\'s day for today (or the next day that has one), plus parallel plans.')
      .addToggle(t => t.setValue(s.showGym !== false).onChange(async v => { s.showGym = v; await save(); }));
    new Setting(containerEl).setName('Gym folder')
      .addText(t => t.setPlaceholder('Gym').setValue(s.gymFolder || '').onChange(async v => { s.gymFolder = pathValue(v) || 'Gym'; await save(); }));
    new Setting(containerEl).setName('Quick capture').setDesc('A one-line box under the search that appends to today\'s journal note.')
      .addToggle(t => t.setValue(s.showCapture !== false).onChange(async v => { s.showCapture = v; await save(); }));
    new Setting(containerEl).setName('Capture under heading').setDesc('The section the line is added to (created at the end of the note if the heading is missing).')
      .addText(t => t.setPlaceholder('Notes').setValue(s.captureHeading || '').onChange(async v => { s.captureHeading = v.trim(); await save(); }));
    new Setting(containerEl).setName('Timestamp captured lines')
      .addToggle(t => t.setValue(s.captureTimestamp !== false).onChange(async v => { s.captureTimestamp = v; await save(); }));

    new Setting(containerEl).setName('Weather').setHeading();
    el(containerEl, 'p', 'vs-settings-note', 'Weather is fetched from open-meteo.com, a free service with no account. This is the only thing in Vista that uses the network: it sends the place name once to find coordinates, then the coordinates every half hour. Nothing from your vault is sent.');
    new Setting(containerEl).setName('Show weather').addToggle(t => t.setValue(s.showWeather !== false).onChange(async v => { s.showWeather = v; await save(); }));
    /* Saved on a 600ms debounce, not every keystroke: a raw onChange here
       would geocode (and re-fetch weather for) every half-typed place name
       as the user types it. */
    const saveWeatherLocation = debounce(save, 600);
    new Setting(containerEl).setName('Place').setDesc('Set a place to show weather. Leave blank to turn it off. A town or city, like "London" or "Paris, FR".')
      .addText(t => t.setPlaceholder('London').setValue(s.weatherLocation || '').onChange(v => { s.weatherLocation = v.trim(); this.plugin.clearWeatherCache(); saveWeatherLocation(); }));
    new Setting(containerEl).setName('Units').addDropdown(d => d.addOption('c', 'Celsius').addOption('f', 'Fahrenheit').setValue(s.weatherUnit || 'c').onChange(async v => { s.weatherUnit = v; await save(); }));

    new Setting(containerEl).setName('Today, from Rhythm').setDesc('The practices the Rhythm plugin would put in front of you today, tickable from here. Hidden when there is no Rhythm folder.')
      .addToggle(t => t.setValue(s.showRhythm !== false).onChange(async v => { s.showRhythm = v; await save(); }));
    new Setting(containerEl).setName('Recent notes')
      .addToggle(t => t.setValue(s.showRecent !== false).onChange(async v => { s.showRecent = v; await save(); }));
    new Setting(containerEl).setName('How many recent notes')
      .addSlider(sl => sl.setLimits(3, 12, 1).setValue(s.recentCount || 6).setDynamicTooltip().onChange(async v => { s.recentCount = v; await save(); }));
    new Setting(containerEl).setName('Vault stats').setDesc('Counts notes, words, tasks, links, tags, orphans and your journal streak. Recounted a few seconds after the vault changes.')
      .addToggle(t => t.setValue(s.showStats !== false).onChange(async v => { s.showStats = v; await save(); }));
    new Setting(containerEl).setName('Journal folder').setDesc('Where the "Today" tile creates YYYY-MM-DD notes, and where the streak is counted. Leave blank to keep daily notes in the vault root.')
      .addText(t => t.setPlaceholder('Journal').setValue(s.journalFolder || '').onChange(async v => { s.journalFolder = pathValue(v); await save(); }));
    new Setting(containerEl).setName('Journal template').setDesc('A note whose body seeds a new daily note. Supports {{date}}, {{date:dddd, D MMMM YYYY}}, {{time}} and {{title}}. Optional.')
      .addText(t => t.setPlaceholder('Templates/Daily note').setValue(s.journalTemplate || '').onChange(async v => { s.journalTemplate = pathValue(v); await save(); }));

    new Setting(containerEl).setName('Tiles').setHeading();
    const tiles = T.resolveTiles(s);
    const list = el(containerEl, 'div', 'vs-settings-tiles');
    const saveTiles = async arr => { s.tiles = arr.map(T.normalizeTile); await save(); this.display(); };
    tiles.forEach((t, i) => {
      const row = new Setting(list).setName(t.label).setDesc(`${t.group} · ${T.KINDS.find(k => k.id === t.kind).name}${t.target ? ' · ' + t.target : ''}`);
      const ic = el(row.nameEl, 'span', 'vs-settings-tile-icon');
      icon(ic, t.icon);
      row.nameEl.insertBefore(ic, row.nameEl.firstChild);
      row.addExtraButton(b => b.setIcon('arrow-up').setTooltip('Move up').setDisabled(i === 0).onClick(async () => { const a = tiles.slice(); [a[i - 1], a[i]] = [a[i], a[i - 1]]; await saveTiles(a); }));
      row.addExtraButton(b => b.setIcon('arrow-down').setTooltip('Move down').setDisabled(i === tiles.length - 1).onClick(async () => { const a = tiles.slice(); [a[i + 1], a[i]] = [a[i], a[i + 1]]; await saveTiles(a); }));
      row.addExtraButton(b => b.setIcon('pencil').setTooltip('Edit').onClick(() => new TileModal(this.app, t, async nt => { const a = tiles.slice(); a[i] = nt; await saveTiles(a); }).open()));
      row.addExtraButton(b => b.setIcon('trash-2').setTooltip('Remove').onClick(async () => { const a = tiles.slice(); a.splice(i, 1); await saveTiles(a); }));
    });
    new Setting(containerEl)
      .addButton(b => b.setButtonText('Add tile').setCta().onClick(() => new TileModal(this.app, null, async nt => { await saveTiles([...tiles, nt]); }).open()))
      .addButton(b => b.setButtonText('Reset to defaults').onClick(async () => { s.tiles = null; await save(); this.display(); }));
  }
}

module.exports = { VistaSettingTab, debounce };
