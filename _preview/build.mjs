/* Build the browser harness: real src/ modules, the shipped stylesheet, a
   stubbed `obsidian` and an in-memory app. Outputs are gitignored.
   Serve the repo root:  python3 -m http.server 8821   then /_preview/preview.html */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
writeFileSync(join(here, 'vista.css'), readFileSync(join(root, 'styles.css'), 'utf8'));

/* Obsidian's OWN stylesheet, read out of obsidian.asar. Without it the harness
   is a nicer host than the real one: app.css's bare `button { display:
   inline-flex; justify-content: center }` and `border: 0` beat any plugin rule
   that is not `.vs-page`-scoped, and a card that looks right here comes out
   wrong in the vault. Two bugs on 13 Sep 2026 got through exactly that gap.
   Missing Obsidian is not fatal — the harness falls back to its own theme. */
const asar = join(process.env.OBSIDIAN_APP || '/Applications/Obsidian.app', 'Contents/Resources/obsidian.asar');
const appCss = join(here, 'app.css');
try {
  if (!existsSync(asar)) throw new Error('no obsidian.asar at ' + asar);
  const fresh = existsSync(appCss) && statSync(appCss).mtimeMs > statSync(asar).mtimeMs;
  if (!fresh) {
    execFileSync('npx', ['-y', '@electron/asar', 'extract-file', asar, 'app.css'], { cwd: here, stdio: 'ignore' });
    if (!existsSync(appCss) || statSync(appCss).size < 10000) throw new Error('extraction produced nothing usable');
  }
  console.log('app.css   ' + (statSync(appCss).size / 1024).toFixed(0) + 'kb  (Obsidian\u2019s own, so the host cascade is real)');
} catch (e) {
  writeFileSync(appCss, '/* Obsidian app.css could not be read: ' + String(e.message) + '\n   The harness is running on its own theme — host-cascade bugs will NOT show. */\n');
  console.warn('app.css   not extracted: ' + e.message);
}

/* Borrow a few real photos from a vault so the preview looks like the app.
   The vault is named by VISTA_VAULT_PATH or a gitignored .vault-path file at
   the repo root (one line: the vault's absolute path) — never hard-coded.
   Photos are cosmetic here: without a vault the harness runs on the
   gradient background, so a missing path is a note, not a failure. */
function vaultPath() {
  if (process.env.VISTA_VAULT_PATH) return process.env.VISTA_VAULT_PATH;
  const f = join(root, '.vault-path');
  return existsSync(f) ? readFileSync(f, 'utf8').trim() : '';
}
const vault = vaultPath();
if (!vault) console.warn('photos    skipped: set VISTA_VAULT_PATH or write the vault path into .vault-path to borrow background photos');
const vaultBg = vault ? join(vault, 'Dashboard/Backgrounds') : '';
const photosDir = join(here, 'photos');
mkdirSync(photosDir, { recursive: true });
let photos = [];
if (vaultBg && existsSync(vaultBg)) {
  photos = readdirSync(vaultBg).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort();
  for (const f of photos) if (!existsSync(join(photosDir, f))) copyFileSync(join(vaultBg, f), join(photosDir, f));
}
writeFileSync(join(here, 'photos.json'), JSON.stringify(photos));

await esbuild.build({
  entryPoints: [join(here, 'entry.js')],
  outfile: join(here, 'bundle.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'safari15',
  alias: { obsidian: join(here, 'obsidian-stub.js') },
  logLevel: 'info',
});
