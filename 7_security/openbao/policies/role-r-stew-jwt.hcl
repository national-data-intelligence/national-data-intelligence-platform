# OpenBao policy: r-stew-jwt
#
# Attached to per-user tokens issued via jwt-keycloak for R-STEW users.
# Stewards get the analyst reader plus governance read-only on the
# datasets-registry-related kv space (Phase-6 will expand to writes).

path "database/creds/postgres-vault-bi-reader" {
  capabilities = ["read"]
}

path "auth/token/lookup-self" {
  capabilities = ["read"]
}

# Stewards may inspect every Phase-3 / Phase-4 dataset registry-related
# secret entry. Read-only — writes go through the governance DAG.
path "secret/data/datasets/*" {
  capabilities = ["read", "list"]
}
