# R-CONS-ANA — Internal Data Analyst.
#
# JupyterHub kernel + ad-hoc CLI access. Read-only DB creds for the
# business vault + marts. No PHI raw — vault_business is deidentified by
# construction.

path "database/creds/postgres-vault-bi-reader" {
  capabilities = ["read"]
}
path "database/creds/clickhouse-marts-reader" {
  capabilities = ["read"]
}

# Service-side MLflow tracking URL + token.
path "secret/data/services/mlflow" {
  capabilities = ["read"]
}

# Self-token introspection.
path "auth/token/lookup-self" {
  capabilities = ["read"]
}
path "auth/token/renew-self" {
  capabilities = ["update"]
}
