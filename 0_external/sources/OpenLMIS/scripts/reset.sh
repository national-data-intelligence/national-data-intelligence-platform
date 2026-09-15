#!/usr/bin/env bash
# OpenLMIS replica — destructive reset: remove containers, restart clean
# (demo data re-seeds itself on boot). Pass -y to skip confirmation.
# NO `-v`: the v3 database lives in-container (removed with it anyway), and
# dropping volumes would ALSO wipe hist-db-data — forcing a needless 15-min
# re-restore of the 7.5M-row dump (learned 2026-09-02).
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DISTRO_DIR="$SRC_DIR/openlmis-ref-distro"

if [ "${1:-}" != "-y" ]; then
  read -r -p "This recreates all OpenLMIS containers and re-seeds demo data (hist-db data survives). Continue? [y/N] " a
  [ "$a" = "y" ] || [ "$a" = "Y" ] || { echo "aborted"; exit 1; }
fi

docker compose -p openlmis \
  --project-directory "$DISTRO_DIR" \
  -f "$DISTRO_DIR/docker-compose.yml" \
  -f "$SRC_DIR/docker-compose.override.yml" down

exec "$SRC_DIR/scripts/restore.sh"
