/* The build, as one reproducible Node script (same layout as gym-vault and
   budget-vault). BOTH root main.js and root styles.css are BUILD OUTPUT:
     main.js    <- bundled from src/*.js
     styles.css <- copied from src/styles.css
   An edit made directly to a root artifact is lost on the next build. */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as esbuild from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const rel = p => join(root, p);

writeFileSync(rel('styles.css'), readFileSync(rel('src/styles.css'), 'utf8'));

/* target safari15 = the engine floor this plugin must parse on (Obsidian
   mobile runs the OS WebView; minAppVersion is not the floor). format cjs +
   external obsidian: Obsidian loads main.js as CommonJS and provides the
   `obsidian` module itself. */
await esbuild.build({
  entryPoints: [rel('src/main.js')],
  outfile: rel('main.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'safari15',
  external: ['obsidian'],
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
});
