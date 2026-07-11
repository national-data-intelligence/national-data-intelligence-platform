#!/bin/bash
# 04_ops_db.sh — creates the `nhdw_ops` operational/control-plane database
# alongside `nhdw_vault` on the same Postgres cluster.
#
# Why a separate database (not a schema in nhdw_vault):
#   - different access pattern (transactional read-write vs read-only batch)
#   - different backup cadence (ops needs PITR; vault/marts can be rebuilt)
#   - different blast radius if compromised
#   - role isolation: vault_writer never touches ops; ops_writer never reads vault
#
# Six schemas, see comments in 05_ops_schemas.sql for the design rationale.
#
# Idempotent: re-running on a populated cluster updates schemas/tables in place.
set -euo pipefail

required_vars=(OPS_WRITER_PASSWORD OPS_READER_PASSWORD OPS_GATEWAY_PASSWORD)
for v in "${required_vars[@]}"; do
    if [ -z "${!v:-}" ]; then
        echo "[04_ops_db] FATAL: env var $v is empty" >&2
        exit 1
    fi
done

OPS_DB="${OPS_DB_NAME:-nhdw_ops}"

# Create the database if it doesn't exist. Note: CREATE DATABASE cannot run
# inside a transaction, so we use a DO block on the postgres maintenance db.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
SELECT 'CREATE DATABASE $OPS_DB OWNER $POSTGRES_USER'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$OPS_DB')\gexec

COMMENT ON DATABASE $OPS_DB IS
    'Control-plane DB. Holds the application-level state Keycloak does not: '
    'user JIT cache, saved queries, alert subscriptions, access requests, '
    'export registry (every dashboard-generated dataset), workshop artifacts, '
    'gateway audit log, data-quality flags. Distinct from nhdw_vault on purpose.';
SQL

# Now run schema + table DDL inside the new database.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$OPS_DB" \
     -f /docker-entrypoint-initdb.d/05_ops_schemas.sql

# Render and run user DDL (with env-substituted passwords).
TEMPLATE=/docker-entrypoint-initdb.d/06_ops_users.sql.template
RENDERED=/tmp/06_ops_users.sql
cp "$TEMPLATE" "$RENDERED"
for v in "${required_vars[@]}"; do
    val="${!v}"
    esc=$(printf '%s' "$val" | sed -e 's/[\\&|]/\\&/g')
    sed -i "s|\${$v}|$esc|g" "$RENDERED"
done
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$OPS_DB" -f "$RENDERED"

echo "[04_ops_db] $OPS_DB provisioned · 6 schemas · ops_writer/ops_reader/ops_gateway ready"
