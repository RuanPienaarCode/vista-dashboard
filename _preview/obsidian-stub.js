/* Minimal `obsidian` stand-in for the browser harness. setIcon draws a plain
   24x24 stroke path per name (a ring for names it doesn't know) so layout
   matches what lucide occupies. */
const PATHS = {
  search: 'M11 11m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M21 21l-4.3-4.3',
  x: 'M18 6L6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  check: 'M20 6L9 17l-5-5',
  pencil: 'M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z',
  'chevron-down': 'M6 9l6 6 6-6',
  'file-text': 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  'file-image': 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M10 13m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M20 17l-3-3-7 7',
  shuffle: 'M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
  sparkles: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z',
  settings: 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  'refresh-cw': 'M21 12a9 9 0 0 1-15.5 6.3L3 16M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M3 21v-5h5',
  wallet: 'M20 12V8H6a2 2 0 0 1 0-4h12v4M4 6v12a2 2 0 0 0 2 2h14v-4M18 12a2 2 0 0 0 0 4h4v-4z',
  compass: 'M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0-20 0M16.2 7.8l-2.1 6.3-6.3 2.1 2.1-6.3z',
  dumbbell: 'M6.5 6.5l11 11M21 21l-1-1M3 3l1 1M18 22l4-4M2 6l4-4M3 10l7-7M14 21l7-7',
  'git-fork': 'M12 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M6 6m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M18 6m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9M12 12v3',
  'list-todo': 'M3 5h4v4H3zM3 17l1.5 1.5L7 16M13 6h8M13 12h8M13 18h8',
  'notebook-pen': 'M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4M2 6h4M2 10h4M2 14h4M2 18h4M21.4 2.6a2 2 0 0 1 0 2.8L13 13.8l-4 1 1-4 8.4-8.4a2 2 0 0 1 3 0z',
  home: 'M3 10l9-7 9 7v10a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  cross: 'M11 2a2 2 0 0 0-2 2v5H4a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h5v5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-5h5a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-5V4a2 2 0 0 0-2-2z',
  briefcase: 'M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16M2 9a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z',
  map: 'M14.1 6L9.9 4 3.9 7v13l6-3 4.2 2 6-3V3zM9.9 4v13M14.1 6v13',
  'gamepad-2': 'M6 11h4M8 9v4M15 12h.01M18 10h.01M17.3 5H6.7a4 4 0 0 0-4 3.6L2 17a2.7 2.7 0 0 0 4.6 2.2L9 17h6l2.4 2.2A2.7 2.7 0 0 0 22 17l-.7-8.4a4 4 0 0 0-4-3.6z',
  'book-open': 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  database: 'M12 5m-9 0a9 3 0 1 0 18 0a9 3 0 1 0-18 0M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5M3 12c0 1.7 4 3 9 3s9-1.3 9-3',
  files: 'M15.5 2H12a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8.5zM15 2v5h5M6 6H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-2',
  'pie-chart': 'M21.2 15.9A10 10 0 1 1 8 2.8M22 12A10 10 0 0 0 12 2v10z',
  'heart-pulse': 'M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 12 5a5.5 5.5 0 0 0-10 3.5c0 2.3 1.5 4 3 5.5l7 7zM3.2 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.3',
  car: 'M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2M7 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M17 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M9 17h6',
  'external-link': 'M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  'layout-grid': 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  'chevron-right': 'M9 18l6-6-6-6',
};
export function setIcon(node, name) {
  const d = PATHS[name] || 'M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 8v4l3 2';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  svg.append(p);
  node.append(svg);
}
export class Notice {
  constructor(msg) {
    const n = document.createElement('div');
    n.className = 'stub-notice';
    n.textContent = msg;
    document.body.append(n);
    setTimeout(() => n.remove(), 4000);
    console.log('[Notice]', msg);
  }
}
/* Obsidian's own modal DOM, so app.css dresses it the way the real host
   does — a hand-rolled white box would have hidden how the modal actually
   reads in the user's theme. */
export class Modal {
  constructor(app) {
    this.app = app;
    this.containerEl = document.createElement('div');
    this.containerEl.className = 'modal-container mod-dim';
    this.bg = document.createElement('div');
    this.bg.className = 'modal-bg';
    this.bg.style.opacity = '0.85';
    this.bg.addEventListener('click', () => this.close());
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'modal';
    const close = document.createElement('div');
    close.className = 'modal-close-button';
    close.addEventListener('click', () => this.close());
    this.contentEl = document.createElement('div');
    this.contentEl.className = 'modal-content';
    this.modalEl.append(close, this.contentEl);
    this.containerEl.append(this.bg, this.modalEl);
  }
  open() { document.body.append(this.containerEl); this.onOpen && this.onOpen(); }
  close() { this.onClose && this.onClose(); this.containerEl.remove(); }
}
export class FuzzySuggestModal extends Modal {
  setPlaceholder() {}
  open() { const items = this.getItems(); const pick = items[0]; console.log('[FuzzySuggestModal] would list', items.length, 'items; picking first'); if (pick !== undefined) this.onChooseItem(pick); }
}
/* Setting: enough of the real API for the tile modal to render. */
export class Setting {
  constructor(parent) {
    this.settingEl = document.createElement('div'); this.settingEl.className = 'setting-item';
    this.infoEl = document.createElement('div'); this.infoEl.className = 'setting-item-info';
    this.nameEl = document.createElement('div'); this.nameEl.className = 'setting-item-name';
    this.descEl = document.createElement('div'); this.descEl.className = 'setting-item-description';
    this.controlEl = document.createElement('div'); this.controlEl.className = 'setting-item-control';
    this.infoEl.append(this.nameEl, this.descEl); this.settingEl.append(this.infoEl, this.controlEl); parent.append(this.settingEl);
  }
  setName(t) { this.nameEl.textContent = t; return this; }
  setDesc(t) { this.descEl.textContent = t; return this; }
  addText(fn) { const i = document.createElement('input'); i.type = 'text'; this.controlEl.append(i); const api = { inputEl: i, setValue(v) { i.value = v || ''; return api; }, setPlaceholder(p) { i.placeholder = p; return api; }, onChange(cb) { i.addEventListener('input', () => cb(i.value)); return api; } }; fn(api); return this; }
  addDropdown(fn) { const s = document.createElement('select'); this.controlEl.append(s); const api = { addOption(v, l) { const o = document.createElement('option'); o.value = v; o.textContent = l; s.append(o); return api; }, setValue(v) { s.value = v; return api; }, onChange(cb) { s.addEventListener('change', () => cb(s.value)); return api; } }; fn(api); return this; }
  addToggle(fn) { const i = document.createElement('input'); i.type = 'checkbox'; this.controlEl.append(i); const api = { setValue(v) { i.checked = !!v; return api; }, onChange(cb) { i.addEventListener('change', () => cb(i.checked)); return api; } }; fn(api); return this; }
  addSlider(fn) { const i = document.createElement('input'); i.type = 'range'; this.controlEl.append(i); const api = { setLimits(a, b, s) { i.min = a; i.max = b; i.step = s; return api; }, setValue(v) { i.value = v; return api; }, setDynamicTooltip() { return api; }, onChange(cb) { i.addEventListener('input', () => cb(Number(i.value))); return api; } }; fn(api); return this; }
  addExtraButton(fn) { const b = document.createElement('button'); b.type = 'button'; b.className = 'clickable-icon'; this.controlEl.append(b); const api = { setIcon(n) { setIcon(b, n); return api; }, setTooltip(t) { b.title = t; return api; }, setDisabled(d) { b.disabled = d; return api; }, onClick(cb) { b.addEventListener('click', cb); return api; } }; fn(api); return this; }
  addButton(fn) { const b = document.createElement('button'); b.type = 'button'; this.controlEl.append(b); const api = { setButtonText(t) { b.textContent = t; return api; }, setCta() { b.classList.add('mod-cta'); return api; }, onClick(cb) { b.addEventListener('click', cb); return api; } }; fn(api); return this; }
  /* Section heading, per Obsidian's own guidelines (a Setting, not a raw
     h3) — mirrors the real API's class so app.css's own heading rule dresses it. */
  setHeading() { this.settingEl.classList.add('setting-item-heading'); return this; }
}
export class Menu {
  constructor() { this.items = []; }
  addItem(fn) {
    const item = { title: '', icon: '', checked: false, cb: null,
      setTitle(t) { this.title = t; return this; }, setIcon(i) { this.icon = i; return this; }, setChecked(c) { this.checked = c; return this; }, onClick(f) { this.cb = f; return this; } };
    fn(item); this.items.push(item); return this;
  }
  showAtPosition(pos) {
    const m = document.createElement('div');
    m.className = 'stub-menu';
    m.style.left = pos.x + 'px'; m.style.top = pos.y + 'px';
    for (const it of this.items) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = (it.checked ? '● ' : '') + it.title;
      b.addEventListener('click', () => { close(); it.cb && it.cb(); }); m.append(b);
    }
    const close = () => { m.remove(); document.removeEventListener('mousedown', outside, true); };
    const outside = e => { if (!m.contains(e.target)) close(); };
    document.body.append(m);
    setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
  }
  showAtMouseEvent(e) { this.showAtPosition({ x: e.clientX, y: e.clientY }); }
}
export class Plugin {}
export class ItemView {}
/* Real Obsidian builds containerEl for a settings tab when it renders it;
   the harness has no such host, so this stands in with a plain div. */
export class PluginSettingTab {
  constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = document.createElement('div'); }
}
/* Obsidian's own HTMLElement.empty() extension, not native DOM — settings-
   tab.js calls it directly (real API), so the harness needs it too. */
if (typeof Element !== 'undefined' && !Element.prototype.empty) {
  Element.prototype.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
}
export class TFile {}
export class TFolder {}
export const Platform = { isMobile: new URLSearchParams(location.search).get('mobile') === '1' };
/* Obsidian's own: runs of / and \\ collapse, edge slashes go, '' is the root. */
export const normalizePath = p => { p = String(p).replace(/([\\/])+/g, '/').replace(/(^\/+|\/+$)/g, ''); if (p === '') p = '/'; return p.replace(/[\u00A0\u202F]/g, ' ').normalize('NFC'); };
export function getAllTags(fc) { return fc && fc.tags ? fc.tags.map(t => t.tag) : []; }
export function renderMatches(node, text, matches) {
  let i = 0;
  for (const [a, b] of matches || []) {
    if (a > i) node.append(document.createTextNode(text.slice(i, a)));
    const s = document.createElement('span'); s.className = 'suggestion-highlight'; s.textContent = text.slice(a, b); node.append(s);
    i = b;
  }
  if (i < text.length) node.append(document.createTextNode(text.slice(i)));
}

/* Canned Open-Meteo answers so the weather chip renders offline. */
export async function requestUrl({ url }) {
  if (url.includes('geocoding-api')) return { status: 200, json: { results: [{ name: 'London', admin1: 'England', country_code: 'GB', latitude: 51.51, longitude: -0.13 }] } };
  if (url.includes('api.open-meteo.com')) {
    /* A realistic week from today, shaped like the live API. */
    const iso = n => { const d = new Date(Date.now() + n * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const time = [0, 1, 2, 3, 4, 5, 6].map(iso);
    return { status: 200, json: { current: { temperature_2m: 17.4, apparent_temperature: 19.2, weather_code: 2, is_day: 0, wind_speed_10m: 3.7 },
      daily: {
        time,
        temperature_2m_max: [16.3, 16.8, 19.2, 22.2, 25.4, 30.0, 21.1],
        temperature_2m_min: [12.1, 12.0, 12.3, 13.3, 14.0, 14.4, 14.3],
        precipitation_probability_max: [100, 2, 0, 2, 2, 2, 13],
        precipitation_sum: [6.2, 0, 0, 0, 0, 0, 0.4],
        weather_code: [81, 1, 1, 1, 1, 2, 53],
        sunrise: time.map((t, i) => `${t}T06:${String(52 - i).padStart(2, '0')}`),
        sunset: time.map((t, i) => `${t}T18:${String(38 + i).padStart(2, '0')}`),
        wind_speed_10m_max: [31.6, 12.2, 8.0, 14.5, 22.1, 9.4, 27.8],
        wind_direction_10m_dominant: [315, 170, 44, 160, 200, 30, 300],
      } } };
  }
  return { status: 404, json: null, text: '' };
}
