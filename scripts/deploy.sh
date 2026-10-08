#!/bin/bash
# Deploy the built artifacts into the vault and PROVE they landed.
set -euo pipefail
cd "$(dirname "$0")/.."
# The vault is named by VISTA_VAULT_PATH or a gitignored .vault-path file (one
# line: the vault's absolute path). It is never hard-coded: this repo is public.
VAULT="${VISTA_VAULT_PATH:-}"
if [ -z "$VAULT" ] && [ -f .vault-path ]; then VAULT="$(head -n 1 .vault-path)"; fi
if [ -z "$VAULT" ]; then
  echo "No vault named. Set VISTA_VAULT_PATH, or put the vault's absolute path in .vault-path (gitignored)." >&2
  exit 1
fi
[ -d "$VAULT/.obsidian" ] || { echo "'$VAULT' is not an Obsidian vault (no .obsidian folder)." >&2; exit 1; }
DEST="$VAULT/.obsidian/plugins/vista"
[ -f main.js ] || { echo "main.js missing — run ./build.sh first" >&2; exit 1; }
mkdir -p "$DEST"
for f in main.js styles.css manifest.json; do cp "$f" "$DEST/$f"; done
fail=0
for f in main.js styles.css manifest.json; do
  a=$(shasum -a 256 "$f" | cut -d' ' -f1)
  b=$(shasum -a 256 "$DEST/$f" | cut -d' ' -f1)
  if [ "$a" = "$b" ]; then echo "  ok   $f  $a"; else echo "  DRIFT $f" >&2; fail=1; fi
done
[ "$fail" = 0 ] || exit 1
echo "Deployed to $DEST"
echo "In Obsidian: Settings → Community plugins → enable 'Vista' (reload it if it was already on)."
