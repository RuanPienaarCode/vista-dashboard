#!/bin/bash
# Build the plugin and run the guard suite. BOTH root main.js and root
# styles.css are BUILD OUTPUT — edit src/ only.
# A green build installs NOTHING. Deploy with ./scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  if [ -f package-lock.json ]; then npm ci; else npm install; fi
fi
npm run build
node --check main.js
npm test
echo "Built main.js + styles.css OK — run ./scripts/deploy.sh to install into the vault."
