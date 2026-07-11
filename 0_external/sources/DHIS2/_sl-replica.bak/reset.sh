#!/usr/bin/env bash
# Destroy + rebuild DHIS2 replica.
set -euo pipefail
cd "$(dirname "$0")/.."

read -p "This will DELETE the DHIS2 data volume. Continue? [y/N] " yn
case "$yn" in [Yy]*) ;; *) echo "Aborted."; exit 1 ;; esac

docker compose down -v || true
DATA_DIR=$(grep -E '^DHIS2_DATA_DIR=' .env 2>/dev/null | cut -d= -f2-)
DATA_DIR="${DATA_DIR:-./data}"
[ -d "$DATA_DIR" ] && sudo rm -rf "$DATA_DIR"
mkdir -p "$DATA_DIR"

docker compose up -d dhis2-db
for _ in $(seq 1 30); do
  if [ "$(docker inspect -f '{{.State.Health.Status}}' dhis2-db 2>/dev/null)" = "healthy" ]; then break; fi
  sleep 3
done

bash scripts/restore.sh
docker compose up -d dhis2
echo "DHIS2 web booting — Liquibase migrations take 5-15 min on first start."
echo "Tail logs: docker logs -f dhis2-web"
echo "Verify: bash scripts/verify.sh"
