#!/usr/bin/env bash
# run.sh — start the NHDW Demo Console (host-run; python3 stdlib only).
#   ./run.sh            → http://localhost:8500/  (demo catalog + System · Console)
# Env: CONSOLE_PORT (default 8500), GATEWAY_URL, DEMO_SCENARIOS_PATH.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v python3 >/dev/null || { echo "✗ python3 is required"; exit 1; }
[ -d "$HERE/dist" ] || bash "$HERE/build-spa.sh"
exec python3 "$HERE/console.py" "$@"
