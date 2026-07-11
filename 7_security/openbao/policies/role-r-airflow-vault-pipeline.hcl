# OpenBao policy: airflow-vault-pipeline
#
# Attached to the long-lived token Airflow uses to mint short-TTL Postgres
# credentials for the staging-bridge and vault dbt builds. The token is held
# by the Airflow scheduler ONLY, never exposed to the DAG runtime image
# until a task starts.
#
# Two DB engine roles are accessible:
#   postgres-vault-landing-writer  — INSERT/UPDATE on nhdw_landing (bridge)
#   postgres-vault-writer          — INSERT/UPDATE on nhdw_vault_* (dbt vault)
#
# Phase 2 will narrow this further with policy templates that key off
# the DAG identity, so a compromised DAG token can't pivot.

path "database/creds/postgres-vault-landing-writer" {
  capabilities = ["read"]
}

path "database/creds/postgres-vault-writer" {
  capabilities = ["read"]
}

# Phase 2 P2.5/P2.6: ClickHouse staging_writer credential lives in KV
# because OpenBao 2.4.3 has no clickhouse-database-plugin. Read-only is
# enough — rotation is done by the operator, not by the DAG.
path "secret/data/clickhouse/staging-writer" {
  capabilities = ["read"]
}
