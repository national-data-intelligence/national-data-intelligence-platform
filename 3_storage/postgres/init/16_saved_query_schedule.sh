#!/bin/bash
# 16_saved_query_schedule.sh — adds scheduling columns to
# ops_workspace.saved_query so a scheduled runner can pick up scheduled
# rows, run them through /api/exports, and mark them as run.
#
# NOTE: the compose-era saved_query_runner DAG was archived 2026-07-03
# (_archive/2026-07-03/airflow-compose-era/); the columns stay as the
# declarative surface until a k8s-native runner replaces it.
#
# Pause-safe by design: the DAG starts paused (is_paused_upon_creation=True).
# Operators flip it on per-query by setting schedule_cron AND turning the
# DAG on in the Airflow UI. The dashboard surfaces schedule_cron in the
# Exports page.
#
# Idempotent.
set -euo pipefail
OPS_DB="${OPS_DB_NAME:-nhdw_ops}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$OPS_DB" <<'SQL'
ALTER TABLE ops_workspace.saved_query
    ADD COLUMN IF NOT EXISTS schedule_cron          text,
    ADD COLUMN IF NOT EXISTS last_scheduled_run_at  timestamptz,
    ADD COLUMN IF NOT EXISTS last_scheduled_status  text,
    ADD COLUMN IF NOT EXISTS notify_email           text;

CREATE INDEX IF NOT EXISTS idx_saved_query_schedule
    ON ops_workspace.saved_query (schedule_cron)
    WHERE schedule_cron IS NOT NULL;

COMMENT ON COLUMN ops_workspace.saved_query.schedule_cron IS
    'Standard 5-field cron expression (UTC). NULL means run-on-demand only. '
    'Declarative: a scheduled runner (pending — the compose-era '
    'saved_query_runner DAG was archived 2026-07-03) re-runs the export.';
COMMENT ON COLUMN ops_workspace.saved_query.last_scheduled_status IS
    'Result of the most recent scheduled run: ok | error | skipped (e.g. '
    'gateway 5xx). On-demand runs do NOT touch this column.';
SQL
echo "[16_saved_query_schedule] schedule columns ready"
