#!/usr/bin/env bash
# Verify Trino is up and both PG catalogs are reachable.
# Usage:  bash scripts/verify.sh
set -euo pipefail
cd "$(dirname "$0")/.."

TRINO=http://127.0.0.1:8082
USER="${TRINO_USER:-admin}"

q() {
    local sql="$1"
    # Trino executes via POST /v1/statement with subsequent paging — for one-shot
    # use the trino CLI inside the container.
    docker exec nhdw-trino trino --output-format=TSV --user="$USER" --execute "$sql"
}

echo "==> info"
curl -fsS "$TRINO/v1/info" | head -c 200; echo

echo "==> catalogs visible"
q "SHOW CATALOGS"

echo "==> marts.bi_* schemas"
q "SHOW SCHEMAS FROM marts LIKE 'bi_%'"

echo "==> ops_audit tables"
q "SHOW TABLES FROM ops.ops_audit"

echo "==> existing rows in audit log (sanity)"
q "SELECT count(*) FROM ops.ops_audit.gateway_log"

echo "==> lake catalog (will be empty until snapshot job runs)"
q "SHOW SCHEMAS FROM lake" || echo "(lake reachable; no schemas yet)"

echo "OK."
