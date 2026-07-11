#!/bin/bash
# 08_grafana_db.sh — creates the `nhdw_grafana` database for the Grafana
# service (state: dashboards, folders, users, datasource definitions,
# alerts). Replaces the default SQLite Grafana ships with.
#
# Why a separate DB on the same cluster: one Postgres to operate, one
# backup tool. Schema isolation via DB boundary; Grafana owns it
# entirely.
#
# Idempotent.
set -euo pipefail

required_vars=(GRAFANA_DB_PASSWORD)
for v in "${required_vars[@]}"; do
    if [ -z "${!v:-}" ]; then
        echo "[08_grafana_db] FATAL: env var $v is empty" >&2
        exit 1
    fi
done

OPS_DB="${GRAFANA_DB_NAME:-nhdw_grafana}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
SELECT 'CREATE DATABASE $OPS_DB OWNER $POSTGRES_USER'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$OPS_DB')\gexec

COMMENT ON DATABASE $OPS_DB IS
    'Grafana state DB: dashboards, folders, users, datasource definitions, alerts. Replaces SQLite.';

DO \$\$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grafana_writer') THEN
        CREATE ROLE grafana_writer LOGIN PASSWORD '$GRAFANA_DB_PASSWORD';
    ELSE
        ALTER ROLE grafana_writer WITH PASSWORD '$GRAFANA_DB_PASSWORD';
    END IF;
END\$\$;

GRANT ALL PRIVILEGES ON DATABASE $OPS_DB TO grafana_writer;
SQL

# Inside the new DB grant schema CREATE so Grafana can build its schema.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$OPS_DB" <<SQL
GRANT ALL ON SCHEMA public TO grafana_writer;
ALTER SCHEMA public OWNER TO grafana_writer;
SQL

echo "[08_grafana_db] $OPS_DB provisioned · grafana_writer role ready"
