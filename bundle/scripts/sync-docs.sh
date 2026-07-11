#!/usr/bin/env bash
# sync-docs.sh — copy the curated SERVED docs from the developer docs/ tree into
# bundle/docs/ so the bundle stays SELF-CONTAINED (the boot's seed-docs.sh reads
# only bundle/docs/, never docs/). Developers author in docs/; run this (pack.sh
# runs it automatically) so the operator-served copies match. Idempotent.
#
# The SERVED set must match seed-docs.sh's DOC_ROWS.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$REPO/docs"
DST="$REPO/bundle/docs"
mkdir -p "$DST"

SERVED=(
  architecture.md deployment.md security.md data-and-ml.md data-dictionary.md
)

# Drop any stale served copies first (keep the README that explains this folder).
find "$DST" -maxdepth 1 -name '*.md' ! -name 'README.md' -delete 2>/dev/null || true

n=0
for f in "${SERVED[@]}"; do
  if [ -f "$SRC/$f" ]; then
    cp -f "$SRC/$f" "$DST/$f"; n=$((n + 1))
  else
    echo "  ! docs/$f missing — not synced to bundle" >&2
  fi
done
echo "✓ sync-docs: $n served docs synced docs/ → bundle/docs/"
