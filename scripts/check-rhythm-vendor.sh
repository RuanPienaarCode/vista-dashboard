#!/bin/bash
# Report whether the vendored Rhythm files still match Rhythm's source.
#   src/rhythm-dates.js     == src/dates.js     (byte for byte)
#   src/rhythm-markdown.js  == src/markdown.js  (byte for byte; it requires nothing)
#   src/rhythm-model.js     == src/model.js     except ONE line: its
#     require('./dates') is require('./rhythm-dates') here, marked VENDORED.
# Any other difference, including a changed require line, is drift.
#
# What it compares against:
#   scripts/check-rhythm-vendor.sh              the pinned commit below, read with `git show`
#   RHYTHM_REF=<commit|branch> scripts/...      that ref instead (also as the first argument)
#   RHYTHM_REF=working scripts/...              the checkout's working tree (it may be mid-edit
#                                               in another session - expect false drift)
#   RHYTHM_REPO=<path>                          the checkout (default ~/Github/rhythm-vault)
# To re-vendor: copy the three files over from the new ref, re-apply the one
# require line in rhythm-model.js, then move PINNED_REF to that ref.
set -euo pipefail
cd "$(dirname "$0")/.."
PINNED_REF="bdeae92"   # the Rhythm audit commit (branch fix/audit-2026-09-27) these files were vendored from
RHYTHM="${RHYTHM_REPO:-$HOME/Github/rhythm-vault}"
REF="${1:-${RHYTHM_REF:-$PINNED_REF}}"
[ -d "$RHYTHM/src" ] || { echo "No Rhythm checkout at $RHYTHM (set RHYTHM_REPO)"; exit 0; }
LOCAL_REQUIRE="const D = require('./rhythm-dates'); // VENDORED: upstream requires './dates' - the one edit; scripts/check-rhythm-vendor.sh"
UPSTREAM_REQUIRE="const D = require('./dates');"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# upstream NAME -> a file path holding that upstream source at the chosen ref
upstream() {
  if [ "$REF" = working ]; then echo "$RHYTHM/src/$1"; return; fi
  git -C "$RHYTHM" show "$REF:src/$1" > "$TMP/$1" 2>/dev/null || { echo "  MISSING  $REF:src/$1 (is $REF a commit in $RHYTHM?)" >&2; echo /dev/null; return; }
  echo "$TMP/$1"
}
drift=0
check() { # vendored-file upstream-name
  local up; up="$(upstream "$2")"
  if [ "$up" = /dev/null ]; then drift=1; return; fi
  local same
  if [ "$1" = src/rhythm-model.js ]; then
    grep -qxF "$LOCAL_REQUIRE" "$1" || { echo "  DRIFT  $1 (VENDORED require line missing or edited)"; drift=1; return; }
    same=$(awk -v l="$LOCAL_REQUIRE" -v u="$UPSTREAM_REQUIRE" '$0 == l { print u; next } { print }' "$1" | cmp -s - "$up" && echo y || echo n)
  else
    same=$(cmp -s "$1" "$up" && echo y || echo n)
  fi
  if [ "$same" = y ]; then echo "  same   $1"; else echo "  DRIFT  $1 (vs $2 at $REF)"; drift=1; fi
}
check src/rhythm-dates.js dates.js
check src/rhythm-markdown.js markdown.js
check src/rhythm-model.js model.js
if [ "$REF" = working ]; then echo "  (against the working tree of $RHYTHM, HEAD $(git -C "$RHYTHM" rev-parse --short HEAD 2>/dev/null || echo '?'))"
else echo "  (against $REF = $(git -C "$RHYTHM" rev-parse --short "$REF" 2>/dev/null || echo '?') in $RHYTHM)"; fi
exit $drift
