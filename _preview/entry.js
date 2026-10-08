/* Harness entry: mounts the REAL dashboard (src/dashboard.js) on a fake
   plugin host with an in-memory, entirely generic vault.
     ?theme=light  → is-plain preview in light colours (background=none)
     ?bg=gradient|none   ?effect=leaves|snow|…   ?mobile=1   ?narrow=1
     ?phone=1      → iPhone with the classic (in-flow) nav bar
     ?floatnav=1   → iPhone with the floating nav bar (safe-area insets faked) */
const { mountDashboard } = require('../src/dashboard');
const { DEFAULT_SETTINGS } = require('../src/constants');

(async () => {
const q = new URLSearchParams(location.search);
document.body.classList.add(q.get('theme') === 'light' ? 'theme-light' : 'theme-dark');
if (q.get('mobile') === '1') document.body.classList.add('is-mobile');
/* ?phone=1 / ?floatnav=1: body classes as Obsidian sets them on an iPhone
   (is-mobile is-phone is-ios), and a simulated mobile-navbar built from the
   real class names so app.css styles it. Classic nav: the bar is in the flow
   under the workspace. Floating nav: app.css sets
   --view-top-spacing/--view-bottom-spacing from the safe-area insets + navbar
   height, the bar is position: fixed (the .frame is its containing block),
   and the view-content margin-top rule needs the .mod-root ancestor from
   preview.html. Fixed insets stand in for a real notch/home indicator. */
const floatnav = q.get('floatnav') === '1';
if (q.get('phone') === '1' || floatnav) {
  document.body.classList.add('is-mobile', 'is-phone', 'is-ios');
  if (floatnav) document.body.classList.add('is-floating-nav');
  if (floatnav) {
    document.body.style.setProperty('--safe-area-inset-top', '47px');
    document.body.style.setProperty('--safe-area-inset-bottom', '34px');
    document.body.style.setProperty('--keyboard-height', '0px');
    document.body.style.setProperty('--navbar-height', '56px');
  }
  const bar = document.createElement('div');
  bar.className = 'mobile-navbar' + (floatnav ? ' mod-raised' : '');
  bar.id = 'sim-navbar';
  const acts = document.createElement('div');
  acts.className = 'mobile-navbar-actions';
  for (const t of ['Back', 'Fwd', 'New', 'Tabs', 'Menu']) { const a = document.createElement('div'); a.className = 'mobile-navbar-action'; a.textContent = t; a.style.cssText = 'display:flex;align-items:center;justify-content:center;font-size:11px;'; acts.appendChild(a); }
  bar.appendChild(acts);
  document.querySelector('.frame').appendChild(bar);
}

const now = Date.now(), day = 86400000;
const iso = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const PATHS = [
  'Home.md', 'Notes/Task Dashboard.md', 'Journal/Journal.md', `Journal/${iso(now)}.md`, `Journal/${iso(now - day)}.md`, `Journal/${iso(now - 2 * day)}.md`,
  'Notes/Home base.md', 'Notes/Reading list.md', 'Budget/Budget Home.md', 'Notes/Health.md', 'Notes/Projects overview.md',
  'Projects/Work Hub.md', 'Projects/Acme/Website relaunch.md', 'Notes/Travel.md', 'Notes/Hiking trails.md', 'Notes/Camping Spots.md', 'Notes/Hobbies.md', 'Notes/Movies.md',
  'Reminders.md',
  'Reference/Manuals.md', 'Reference/Tips & Tricks.md', 'Gym/Plans/Push day.md', 'Templates/Daily Note.md',
  'Notes/summit.jpg', 'Reference/guide.pdf',
  'Budget/Settings.md', 'Budget/Categories/Food.md', 'Budget/Categories/Rent.md', 'Budget/Categories/Coffee budget.md', 'Budget/Accounts/Transaction Account.md',
  'Projects/Errands.md', 'Gym/Plans/Foundations.md', 'Gym/Plans/Run Base.md', 'Gym/Workouts/2026-09-01 Easy Run.md',
  'Rhythm/Areas/Health.md', 'Rhythm/Areas/Work.md', 'Rhythm/Areas/Home.md', 'Rhythm/Areas/Learning.md',
  'Rhythm/Practices/Stretch.md', 'Rhythm/Practices/Read 20 pages.md', 'Rhythm/Practices/Walk.md', 'Rhythm/Practices/Inbox zero.md', 'Rhythm/Practices/Plan a weekend outing.md', 'Rhythm/Practices/Call a friend.md',
];
const RHYTHM_FM = {
  'Rhythm/Areas/Health.md': { rhythm: 'area', order: 1 }, 'Rhythm/Areas/Work.md': { rhythm: 'area', order: 2 }, 'Rhythm/Areas/Home.md': { rhythm: 'area', order: 3 }, 'Rhythm/Areas/Learning.md': { rhythm: 'area', order: 4 },
  'Rhythm/Practices/Stretch.md': { rhythm: 'practice', area: 'Health', cadence: 'daily', when: 'morning' },
  'Rhythm/Practices/Read 20 pages.md': { rhythm: 'practice', area: 'Learning', cadence: 'daily', when: 'morning' },
  'Rhythm/Practices/Walk.md': { rhythm: 'practice', area: 'Health', cadence: '3/week', when: 'day' },
  'Rhythm/Practices/Inbox zero.md': { rhythm: 'practice', area: 'Work', cadence: 'daily', when: 'evening' },
  'Rhythm/Practices/Plan a weekend outing.md': { rhythm: 'practice', area: 'Home', cadence: 'monthly', when: '' },
  'Rhythm/Practices/Call a friend.md': { rhythm: 'practice', area: 'Home', cadence: '2/week', when: 'day' },
};
let photos = [];
try { photos = await (await fetch('photos.json')).json(); } catch (e) { photos = []; }
for (const p of photos) PATHS.push('Dashboard/Backgrounds/' + p);

const fileOf = (p, i) => {
  const name = p.slice(p.lastIndexOf('/') + 1);
  const ext = name.slice(name.lastIndexOf('.') + 1);
  return { path: p, name, basename: name.replace(/\.[^.]+$/, ''), extension: ext, stat: { ctime: now - (i * 3 + 1) * day, mtime: now - i * 3.7 * 3600000, size: 900 + i * 137 } };
};
const files = PATHS.map(fileOf);
const byPath = new Map(files.map(f => [f.path, f]));
const TEXTS = new Map([[`Rhythm/Log/${iso(now)}.md`, '---\nrhythm: log\ndone: [Inbox zero]\n---\n']]);
const QUEUE = new Map();
TEXTS.set('Projects/Errands.md', '# Errands\n\n- [ ] Book the service 📅 2025-09-30\n- [ ] Renew the subscription 📅 ' + iso(now) + '\n- [x] Old 📅 2026-01-01 ✅ 2026-01-02\n- [ ] Wash the car\n');
TEXTS.set('Gym/Plans/Foundations.md', '---\nactive: true\n---\nIntro.\n\n## The Circuit (any)\n\n- Pull-ups | 3 x 5\n- Dips | 3 x 8\n- Rows | 3 x 8\n- Squats | 3 x 10\n');
TEXTS.set('Gym/Plans/Run Base.md', '---\nparallel: true\n---\n## Easy Run (tue)\n- Run | 30 min\n## Long Run (sat)\n- Run | 60 min\n');
TEXTS.set('Gym/Workouts/2026-09-01 Easy Run.md', '---\ndate: 2026-09-01\nplan: Run Base\nday: Easy Run\n---\n| x |\n');
{
  const B = 'Budget';
  const d = new Date(now); const y = d.getFullYear(), mo = d.getMonth() + 1, day = d.getDate();
  let py = y, pm = mo; if (day >= 22) { pm += 1; if (pm > 12) { pm = 1; py += 1; } }
  const key = `${py}-${String(pm).padStart(2, '0')}`;
  const t1 = iso(now - 3 * day * 0 - 2 * 86400000), t2 = iso(now - 5 * 86400000);
  TEXTS.set(`${B}/Settings.md`, '---\nmonth_start_day: 22\ncurrency: "R"\n---\n');
  TEXTS.set(`${B}/Categories/Food.md`, '---\ntype: food\n---\n'); TEXTS.set(`${B}/Categories/Rent.md`, '---\ntype: housing\n---\n'); TEXTS.set(`${B}/Categories/Coffee budget.md`, '---\ntype: treats\n---\n');
  TEXTS.set(`${B}/Accounts/Transaction Account.md`, '---\ntype: current\n---\n');
  TEXTS.set(`${B}/Budgets/${key}.md`, '| Category | Type | Amount | Notes |\n|---|---|--:|---|\n| Rent | housing | 12000.00 |  |\n| Food | food | 7000.00 |  |\n| Coffee budget | treats | 410.00 |  |\n');
  TEXTS.set(`${B}/Transactions/Transaction Account/${iso(now).slice(0, 7)}.md`, `| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|--:|---|---|\n| ${t2} | Rent | Rent | -12000.00 |  |  |\n| ${t2} | Grocer | Food | -2140.55 |  |  |\n| ${t1} | Coffee shop | Coffee budget | -612.00 |  |  |\n| ${t1} | Market | Food | -1890.20 |  |  |\n`);
  for (const p of [`${B}/Budgets/${key}.md`, `${B}/Transactions/Transaction Account/${iso(now).slice(0, 7)}.md`]) { const f = fileOf(p, 1); files.push(f); byPath.set(p, f); }
}
{
  /* The reminders note, shaped like the real one: sections, priorities, a
     time, a repeat, a done line and one with no date at all. */
  const d = n => iso(now + n * 86400000);
  TEXTS.set('Reminders.md', [
    '# Reminders', '', 'The things I must not forget.', '',
    '## Home',
    `- [ ] Sign the permission slip #home 📅 ${d(3)} ⏫`,
    `- [ ] Call the dentist 📅 ${d(0)} ⏰ 18:00`,
    '',
    '## Inbox',
    `- [ ] Pay the water bill 📅 ${d(-2)} ⏫`,
    `- [ ] Renew the library card 📅 ${d(-9)}`,
    `- [ ] Go to gym 📅 ${d(1)} 🔁 every day`,
    `- [ ] Send the quarterly report 📅 ${d(5)}`,
    '- [ ] Find a plumber',
    `- [x] Book the car service 📅 ${d(-4)} ✅ ${d(-4)}`,
    '',
  ].join('\n'));
}
{ const lp = `Rhythm/Log/${iso(now)}.md`; const lf = fileOf(lp, 0); files.push(lf); byPath.set(lp, lf); }
/* Flat frontmatter reader for the harness (inline lists only, like Rhythm's). */
const fmFromText = text => { const m = (text || '').match(/^---\n([\s\S]*?)\n---/); const fm = {}; if (!m) return fm; for (const line of m[1].split('\n')) { const i = line.indexOf(':'); if (i <= 0) continue; const k = line.slice(0, i).trim(); let v = line.slice(i + 1).trim(); if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map(x => x.trim()).filter(Boolean); fm[k] = v; } return fm; };
const TEXT = 'Part of [[Home]].\n\n- [ ] plan the week\n- [x] call the bank\n\nA few honest words about the day, and what mattered.';

const NUDGE_PATH = 'Reminders.md';
const PRIO = { '🔺': 'highest', '⏫': 'high', '🔼': 'medium', '🔽': 'low', '⏬': 'lowest' };
function makeNudgeStore() {
  const parse = text => {
    const out = [];
    let group = '';
    const lines = String(text || '').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const h = /^#{2,6}[ \t]+(.+?)[ \t]*$/.exec(raw);
      if (h) { group = h[1]; continue; }
      const m = /^(\s*)([-*+]|\d+\.)[ \t]+\[([ xX])\][ \t]*(.*)$/.exec(raw);
      if (!m) continue;
      const body = m[4];
      let priority = 'normal';
      for (const k of Object.keys(PRIO)) if (body.indexOf(k) !== -1) priority = PRIO[k];
      const due = (/📅\s*(\d{4}-\d{2}-\d{2})/.exec(body) || [])[1] || '';
      const time = (/⏰\s*(\d{1,2}:\d{2})/.exec(body) || [])[1] || '';
      const tags = (body.match(/(^|\s)#[^\s#]+/g) || []).map(t => t.trim());
      /* Alternation, not a character class: without the /u flag a class of
         astral emoji matches half a surrogate pair and eats the wrong text. */
      const title = body.replace(/🔁(?:(?!📅|⏰|✅|➕|🛫|⏳).)*/g, '').replace(/(?:📅|⏰|✅|➕|🛫|⏳)\s*\S+/g, '').replace(/(?:🔺|⏫|🔼|🔽|⏬)/g, '').replace(/#[^\s#]+/g, '').replace(/\s{2,}/g, ' ').trim();
      out.push({ raw, line: i, done: m[3].toLowerCase() === 'x', title, due, time, priority, repeat: /🔁/.test(body) ? 'every day' : '', tags, group });
    }
    return out;
  };
  return {
    path: () => NUDGE_PATH,
    load: async () => ({ text: TEXTS.get(NUDGE_PATH) || '', items: parse(TEXTS.get(NUDGE_PATH) || '') }),
    snooze: async (item, days, today) => {
      const lines = (TEXTS.get(NUDGE_PATH) || '').split('\n');
      const at = lines.indexOf(item.raw);
      if (at === -1) return { ok: false };
      const due = iso(Date.parse(today + 'T00:00:00Z') + days * 86400000);
      lines[at] = /📅\s*\d{4}-\d{2}-\d{2}/.test(lines[at])
        ? lines[at].replace(/(📅\s*)\d{4}-\d{2}-\d{2}/, '$1' + due)
        : lines[at].trimEnd() + ' 📅 ' + due;
      TEXTS.set(NUDGE_PATH, lines.join('\n'));
      console.log('[nudge snooze]', item.title, '→', due);
      return { ok: true };
    },
    toggle: async (item, today) => {
      const lines = (TEXTS.get(NUDGE_PATH) || '').split('\n');
      const at = lines.indexOf(item.raw);
      if (at === -1) return { ok: false, rolled: null };
      lines[at] = lines[at].replace(/\[ \]/, '[x]') + ' ✅ ' + today;
      TEXTS.set(NUDGE_PATH, lines.join('\n'));
      console.log('[nudge toggle]', item.title);
      return { ok: true, rolled: null };
    },
  };
}

const app = {
  vault: {
    getName: () => 'My Vault',
    getFiles: () => files.slice(),
    getMarkdownFiles: () => files.filter(f => f.extension === 'md'),
    getFileByPath: p => byPath.get(p) || null,
    getFolderByPath: p => (files.some(f => f.path.startsWith(p + '/')) ? { path: p, children: files.filter(f => f.path.slice(0, f.path.lastIndexOf('/')) === p) } : null),
    read: async f => TEXTS.get(f.path) || (f.extension === 'md' ? `# ${f.basename}\n\n${TEXT}` : ''),
    modify: async (f, text) => { TEXTS.set(f.path, text); if (f.stat) f.stat.mtime = Date.now(); console.log('[modify]', f.path, JSON.stringify(text)); },
    /* Like Obsidian's: one queued read-modify-write per file, so two quick
       writes never lose each other; a throwing callback writes nothing. */
    process: (f, fn) => { const prev = QUEUE.get(f.path) || Promise.resolve(); const next = prev.then(() => { const before = TEXTS.has(f.path) ? TEXTS.get(f.path) : ''; const after = fn(before); TEXTS.set(f.path, after); if (f.stat) f.stat.mtime = Date.now(); console.log('[process]', f.path, JSON.stringify(after)); return after; }); QUEUE.set(f.path, next.catch(() => {})); return next; },
    cachedRead: async f => (TEXTS.has(f.path) ? TEXTS.get(f.path) : f.extension === 'md' ? `# ${f.basename}\n\n${TEXT}` : ''),
    getResourcePath: f => 'photos/' + f.name,
    on: () => ({}),
    create: async (p, body) => { if (byPath.has(p)) throw new Error('File already exists.'); const f = fileOf(p, 0); files.push(f); byPath.set(p, f); TEXTS.set(p, body); return f; },
    createFolder: async () => {},
  },
  metadataCache: {
    getFileCache: f => ({ frontmatter: RHYTHM_FM[f.path] || (TEXTS.has(f.path) ? fmFromText(TEXTS.get(f.path)) : (f.basename === 'Home' ? { aliases: ['Dashboard', 'Start Here'] } : undefined)), tags: [{ tag: '#home' }, { tag: f.path.startsWith('Projects') ? '#work' : '#life' }] }),
    on: () => ({}),
    getFirstLinkpathDest: (t) => files.find(f => f.basename === t && f.extension === 'md') || null,
    resolvedLinks: { 'Home.md': { 'Notes/Task Dashboard.md': 1, 'Projects/Work Hub.md': 1, 'Notes/Travel.md': 1 }, 'Projects/Work Hub.md': { 'Projects/Acme/Website relaunch.md': 2 } },
    unresolvedLinks: { 'Notes/Hobbies.md': { 'Board games': 1 } },
  },
  workspace: {
    getLastOpenFiles: () => ['Projects/Acme/Website relaunch.md', 'Budget/Budget Home.md', `Journal/${iso(now)}.md`, 'Notes/Hiking trails.md', 'Gym/Plans/Push day.md'],
    getLeaf: () => ({ openFile: async f => { console.log('[openFile]', f.path); alert('Would open ' + f.path); } }),
    on: () => ({}),
  },
  commands: {
    executeCommandById: id => { console.log('[command]', id); alert('Would run command ' + id); return true; },
    listCommands: () => [{ id: 'rhythm:open', name: 'Rhythm: Open Rhythm' }, { id: 'budget-app:open-budget', name: 'Budget Vault: Open budget' }],
  },
  internalPlugins: { getEnabledPluginById: id => (id === 'global-search' ? { openGlobalSearch: q => alert('Would search everything for: ' + q) } : null) },
  /* A stand-in for the Nudge plugin's store: the same three calls Vista uses
     (path, load, toggle) over the in-memory note, so the card runs its real
     code here. Nudge's own parser is richer; this is a harness, not a spec. */
  plugins: { plugins: { 'nudge-reminders': { store: makeNudgeStore() } } },
};

const settings = Object.assign({}, DEFAULT_SETTINGS, { name: 'Alex', journalFolder: 'Journal', journalTemplate: 'Templates/Daily Note', budgetFolder: 'Budget', weatherLocation: 'London' });
if (q.get('bg')) settings.background = q.get('bg');
if (q.get('theme') === 'light') settings.background = 'none';
if (q.get('effect')) settings.effect = q.get('effect');
if (q.get('photo')) settings.photo = 'Dashboard/Backgrounds/' + q.get('photo'), settings.photoMode = 'fixed';
if (q.get('mode')) settings.photoMode = q.get('mode');

/* The weather cache lives outside data.json (plugin.loadWeatherCache & co); the harness keeps it in memory. */
let wxCache = { geo: null, last: null };
const plugin = { app, settings, loadWeatherCache: () => wxCache, saveWeatherCache(p) { wxCache = Object.assign({}, wxCache, p); return true; }, clearWeatherCache() { wxCache = { geo: null, last: null }; return true; }, async saveSettings() { console.log('[saveSettings]', JSON.stringify(settings).length, 'bytes'); }, refreshViews() { ctl.refresh(); } };
const view = { plugin, contentEl: document.getElementById('app'), registerEvent() {}, registerInterval() {} };
const ctl = mountDashboard(view);

/* Settings toggle: mounts the REAL PluginSettingTab so Settings is
   testable in the harness too, over the stub's Setting class (obsidian-stub.js). */
const { VistaSettingTab } = require('../src/settings-tab');
const settingsBtn = document.createElement('button');
settingsBtn.type = 'button';
settingsBtn.textContent = 'Settings';
settingsBtn.style.cssText = 'position:fixed; top:12px; left:12px; z-index:100;';
document.body.appendChild(settingsBtn);
const settingsPanel = document.createElement('div');
settingsPanel.className = 'vertical-tab-content-container';
settingsPanel.style.cssText = 'display:none; position:fixed; top:24px; right:24px; bottom:24px; left:24px; z-index:99; max-width:640px; margin:0 auto; overflow:auto; padding:20px 24px; border-radius:12px; background:var(--background-primary); color:var(--text-normal); box-shadow:0 8px 40px rgba(0,0,0,.3);';
document.body.appendChild(settingsPanel);
const settingsTab = new VistaSettingTab(app, plugin);
settingsTab.containerEl = settingsPanel;
let settingsOpen = false;
settingsBtn.addEventListener('click', () => {
  settingsOpen = !settingsOpen;
  settingsPanel.style.display = settingsOpen ? 'block' : 'none';
  settingsBtn.textContent = settingsOpen ? 'Close settings' : 'Settings';
  if (settingsOpen) settingsTab.display();
});

/* E: the effects module, so a leaf or a flake can be drawn large and looked at. */
window.__vs = { ctl, plugin, app, settingsTab, E: require('../src/effects'), modals: require('../src/modals') };
await ctl.start();
})();
