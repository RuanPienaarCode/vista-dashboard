'use strict';
/* Shared constants. */

const VIEW_TYPE = 'vista-view';

const DEFAULT_SETTINGS = {
  /* Greeting name; blank greets without one. */
  name: '',
  /* always | empty | never — whether the dashboard opens when Obsidian starts. */
  openOnStartup: 'always',
  /* tab | same — where a tile or search result opens. */
  openIn: 'tab',
  clock24: true,
  /* photos | gradient | none */
  background: 'photos',
  photoFolder: 'Dashboard/Backgrounds',
  /* daily | open | fixed — which photo, and when it changes. */
  photoMode: 'daily',
  photo: '',
  gradient: 'aurora',
  /* How much the photo is darkened under the glass (0–0.8). */
  dim: 0.4,
  /* Blur on the photo itself, px. */
  blur: 0,
  /* auto | stars | leaves | snow | fireflies | rain | dust | constellation | none */
  effect: 'auto',
  intensity: 0.6,
  /* autumn | summer — only the falling-leaves effect reads it. */
  leafPalette: 'autumn',
  showStats: true,
  /* The three things Rhythm would put in front of you today. */
  showRhythm: true,
  /* Left to spend this period, read from the Budget plugin's files. */
  showBudget: true,
  /* Blank until the user names the folder their Budget plugin keeps its files
     in — the card stays off the page until then. */
  budgetFolder: '',
  showRecent: true,
  recentCount: 6,
  /* Where daily notes live, for the "Today" tile and the journal streak.
     Blank keeps them in the vault root; the template is optional. */
  journalFolder: '',
  journalTemplate: '',
  /* Tasks due today and overdue (Tasks plugin emoji dates). */
  showTasks: true,
  tasksGlobalFilter: '',
  /* Reminders due, read through the Nudge plugin's own store. */
  showNudge: true,
  /* The next session from the Gym plugin's plans. The card appears only when
     <gymFolder>/Plans exists; 'Gym' is that plugin's own default folder. */
  showGym: true,
  gymFolder: 'Gym',
  /* One-line capture into today's journal note. */
  showCapture: true,
  captureHeading: 'Notes',
  captureTimestamp: true,
  /* Weather from open-meteo.com — the only network use in the plugin. Nothing
     is requested until a place is set. The geocoded coordinates and the last
     forecast are per-device and live in localStorage (main.js), not here. */
  showWeather: true,
  weatherLocation: '',
  weatherUnit: 'c',
  /* null = the built-in defaults from tiles.js */
  tiles: null,
  /* Tile groups collapsed by the user. */
  collapsed: [],
  /* Tile groups hidden from the page (still editable in Settings). */
  hiddenGroups: [],
  /* Widget sizes: small (a quarter row), normal (half), wide (the full row). */
  widgetSizes: {},
  /* Widget order on the page; keys missing here follow in the default order. */
  widgetOrder: [],
};

module.exports = { VIEW_TYPE, DEFAULT_SETTINGS };
