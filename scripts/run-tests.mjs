/* Run every tests/*.test.cjs in its own node process; non-zero exit on any
   failure. Plain node — no test framework to drift. */
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'tests');
const files = readdirSync(dir).filter(f => f.endsWith('.test.cjs')).sort();
let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, [join(dir, f)], { stdio: 'inherit' });
    console.log(`  ok   ${f}`);
  } catch {
    failed++;
    console.error(`  FAIL ${f}`);
  }
}
if (failed) { console.error(`${failed} test file(s) failed`); process.exit(1); }
console.log(`All ${files.length} test files passed.`);
