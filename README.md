# Vista

A glass dashboard for your Obsidian vault. Search everything, reach what matters in one tap, see the vault's shape at a glance, and do it over a living background of your own photographs with stars, falling leaves, snow, fireflies, rain, dust or a constellation drifting behind the glass.

Desktop and mobile (iOS and Android). Vista reads and writes your notes through Obsidian's Vault API, and talks to other plugins only through their own APIs, only when they are installed and enabled:

- **Budget** (`budget-app`) — asks its `api` for this period's figure. Read-only; it respects that plugin's privacy lock.
- **Rhythm** — reads its notes and settings, and writes ticks in Rhythm's own log format.
- **Tasks** — ticks a task through its `apiV1` toggle, so recurring tasks roll over.
- **Nudge Reminders** (`nudge-reminders`) — reads reminders from its store and ticks or snoozes them there.
- **Omnisearch** — in-text search results.

No vault content leaves your device. The network is used by the optional weather (below), and by links you click: "More on yr.no" in the weather panel and any Web-link tile open your browser.

## What's on it

- **Search** — file names and aliases as you type (Obsidian's own fuzzy matcher), plus in-text hits when [Omnisearch](https://github.com/scambier/obsidian-omnisearch) is installed. `↑` `↓` `↩` to open, `⇧↩` to hand the query to global search, `⌘↩` to open in a new tab.
- **Quick access** — tiles in three groups (Apps, Areas, Important). A tile opens a note, runs a command (any plugin's), opens today's journal note, runs a vault search, or opens a web link in your browser. Add, edit, reorder and remove them from the dashboard (pencil, plus, right-click) or from Settings.
- **Today, from Rhythm** — the practices the [Rhythm](https://github.com/RuanPienaarCode/life-rhythm) plugin would put in front of you today, computed by Rhythm's own model from the same notes. Tick them here; the day's log is written in Rhythm's format.
- **Budget** — left to spend this period (or how far over), a meter, and the categories that are over. Uses the Budget plugin's own figure when it is installed and enabled; counts from its files (the same rule as its Dashboard hero, labelled as Vista's own count) only when it is not installed. Set the Budget folder in Settings; blank hides the card.
- **Tasks** — open tasks due today and overdue, in the Tasks plugin's `📅` format. Tick one and it goes through the Tasks plugin's API when installed (so recurring tasks roll over); the text opens the note at that line.
- **Reminders** — what's due, and what's next when nothing is. Reads and ticks/snoozes through the [Nudge Reminders](https://github.com/RuanPienaarCode/nudge-reminders) plugin's own store, so a repeating reminder rolls forward correctly. Shown only once that plugin (id `nudge-reminders`) is enabled.
- **Gym** — the next session from the Gym plugin's plans: the active plan's day for today or the next day that has one, plus parallel plans, and when you last trained.
- **Quick capture** — a one-line box under the search that appends a timestamped bullet under a heading in today's journal note, creating the note from your template if needed.
- **Calendar** — click the date under the greeting: a month with a weekday row, dots on days with a journal note and on Rhythm events. Tap a day to open its note.
- **Weather** — current conditions, high/low and rain chance under the clock, from [open-meteo.com](https://open-meteo.com) (free, no account). This is the only network use in the plugin: it sends the place name once to find coordinates, then the coordinates every half hour. Nothing from the vault is sent. Off until you set a place in Settings; clear the place to turn it off again. The panel's "More on yr.no" link opens yr.no in your browser.
- **Recent** — what you last opened, with when it last changed.
- **Vault** — notes, words, open tasks, links, tags, orphans (click to list them), journal streak, notes edited today; attachments, folders, size and unresolved links underneath. Recounted a few seconds after the vault changes; text is cached per note so the recount is cheap.
- **Background** — a photo from a folder in the vault (a different one each day, a random one per open, or a fixed one), a gradient, or plain theme colours. Darken and blur are sliders. Shuffle from the footer.
- **Effect** — stars (with the odd shooting star), leaves, snow, fireflies, rain, dust and light, constellation, or none. *Auto* picks stars at night and dust by day. Honours *reduce motion* with a single still frame; pauses when the view is hidden; lighter particle counts on phones.

## Photos

Put jpg, png, webp, gif or avif files in the folder named in Settings (default `Dashboard/Backgrounds`). Resize them to about 2500px on the long side first — the vault syncs them and the phone has to decode them.

## Building

```bash
./build.sh          # bundle src/ → main.js, copy src/styles.css → styles.css, run the guard suite
./scripts/deploy.sh # copy the three artifacts into the vault and prove them byte-identical
npm run preview     # build the browser harness; serve the repo root and open /_preview/preview.html
```

`scripts/deploy.sh` needs to know which vault to install into: set `VISTA_VAULT_PATH`, or write the vault's absolute path on one line in a `.vault-path` file at the repo root (gitignored). It stops with a message if neither is set. The preview uses the same setting only to borrow a few background photos; without it the harness runs on the gradient.

`main.js` and `styles.css` at the root are build output — edit `src/` only. The bundle targets Safari 15, the real engine floor on mobile.

Preview URL parameters: `?photo=<file>` `?effect=leaves` `?bg=gradient|none` `?theme=light` `?mobile=1&narrow=1` `?phone=1` (an iPhone with the classic nav bar) `?floatnav=1` (an iPhone with the floating nav bar). The harness mirrors Obsidian's own leaf structure and loads Obsidian's real `app.css`, so host-cascade bugs show up in it. A "Settings" button in the top-left corner opens the real settings tab.

## Licence

AGPL-3.0-only. `src/rhythm-model.js` and `src/rhythm-dates.js` are vendored verbatim from the [Rhythm](https://github.com/RuanPienaarCode/life-rhythm) plugin's source so the "Today" card agrees with Rhythm exactly; update them together. The one edit is `rhythm-model.js`'s `require('./rhythm-dates')` (upstream `'./dates'`), marked `VENDORED` on that line. `scripts/check-rhythm-vendor.sh` reports any other drift against a local Rhythm checkout (`RHYTHM_REPO`, default `~/Github/rhythm-vault`).
