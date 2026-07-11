#!/bin/bash
# 21_airflow_db.sh — creates the `nhdw_airflow` database for the Airflow
# metadata store (DAG runs, task instances, connections, users). Airflow
# owns it entirely; nothing else reads it.
#
# Why a separate DB on the same cluster: one Postgres to operate, one
# backup tool (same rationale as nhdw_grafana / nhdw_mlflow). Schema
# isolation via DB boundary.
#
# AIRFLOW_DB_PASSWORD comes from the `airflow-secrets` k8s Secret (dev values
# in overlays/dev/secrets.yaml — templates keep changeme-* placeholders).
# NOTE: the password is embedded in Airflow's SQL_ALCHEMY_CONN URL, so keep
# it URL-safe (the hex convention used across secrets.yaml is fine).
#
# Idempotent.
set -euo pipefail

required_vars=(AIRFLOW_DB_PASSWORD)
for v in "${required_vars[@]}"; do
    if [ -z "${!v:-}" ]; then
        echo "[21_airflow_db] FATAL: env var $v is empty" >&2
        exit 1
    fi
done

AF_DB="${AIRFLOW_DB_NAME:-nhdw_airflow}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
SELECT 'CREATE DATABASE $AF_DB OWNER $POSTGRES_USER'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$AF_DB')\gexec

COMMENT ON DATABASE $AF_DB IS
    'Airflow metadata DB: DAG runs, task instances, users. Owned by airflow_writer; nothing else reads it.';

DO \$\$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'airflow_writer') THEN
        CREATE ROLE airflow_writer LOGIN PASSWORD '$AIRFLOW_DB_PASSWORD';
    ELSE
        ALTER ROLE airflow_writer WITH PASSWORD '$AIRFLOW_DB_PASSWORD';
    END IF;
END\$\$;

GRANT ALL PRIVILEGES ON DATABASE $AF_DB TO airflow_writer;
SQL

# Inside the new DB grant schema CREATE so Airflow can run its migrations.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$AF_DB" <<SQL
GRANT ALL ON SCHEMA public TO airflow_writer;
ALTER SCHEMA public OWNER TO airflow_writer;
SQL

echo "[21_airflow_db] $AF_DB provisioned · airflow_writer role ready"
