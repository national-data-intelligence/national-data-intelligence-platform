#!/usr/bin/env bash
# build-spa.sh — build the demo-console SPA (ui/ → dist/) via a throwaway docker
# node image, so the demo machine never needs node/npm. Re-run after editing ui/.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
docker build -t nhdw-console-spa-build "$HERE" >/dev/null
CID=$(docker create nhdw-console-spa-build)
trap 'docker rm -f "$CID" >/dev/null' EXIT
rm -rf "$HERE/dist"
docker cp "$CID:/dist" "$HERE/dist"
echo "✓ SPA built → $HERE/dist ($(du -sh "$HERE/dist" | cut -f1))"
