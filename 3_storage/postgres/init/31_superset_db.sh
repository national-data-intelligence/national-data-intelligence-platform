#!/bin/bash
# 31_superset_db.sh — creates the `nhdw_superset` database for Superset's
# metadata store (dashboards, charts, saved queries, users, DB connections).
# Superset owns it entirely; nothing else reads it.
#
# Same rationale as nhdw_airflow / nhdw_grafana / nhdw_mlflow: one Postgres to
# operate, schema isolation via DB boundary.
#
# SUPERSET_DB_PASSWORD comes from the `superset-secrets` k8s Secret (dev values
# in overlays/dev/secrets.yaml; templates keep changeme-* placeholders). It is
# embedded in Superset's SQLALCHEMY_DATABASE_URI, so keep it URL-safe (the hex
# convention across secrets.yaml is fine).
#
# Idempotent.
set -euo pipefail

required_vars=(SUPERSET_DB_PASSWORD)
for v in "${required_vars[@]}"; do
    if [ -z "${!v:-}" ]; then
        echo "[31_superset_db] FATAL: env var $v is empty" >&2
        exit 1
    fi
done

SS_DB="${SUPERSET_DB_NAME:-nhdw_superset}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
SELECT 'CREATE DATABASE $SS_DB OWNER $POSTGRES_USER'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$SS_DB')\gexec

COMMENT ON DATABASE $SS_DB IS
    'Superset metadata DB: dashboards, charts, saved queries, users, DB connections. Owned by superset_writer; nothing else reads it.';

DO \$\$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'superset_writer') THEN
        CREATE ROLE superset_writer LOGIN PASSWORD '$SUPERSET_DB_PASSWORD';
    ELSE
        ALTER ROLE superset_writer WITH PASSWORD '$SUPERSET_DB_PASSWORD';
    END IF;
END\$\$;

GRANT ALL PRIVILEGES ON DATABASE $SS_DB TO superset_writer;
SQL

# Inside the new DB, grant schema CREATE so Superset can run its migrations.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$SS_DB" <<SQL
GRANT ALL ON SCHEMA public TO superset_writer;
ALTER SCHEMA public OWNER TO superset_writer;
SQL

echo "[31_superset_db] $SS_DB provisioned · superset_writer role ready"
