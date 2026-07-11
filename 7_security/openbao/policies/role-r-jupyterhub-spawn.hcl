# OpenBao policy: jupyterhub-spawn
#
# Attached to the long-lived token the Hub uses to mint short-TTL Postgres
# credentials for each notebook container at spawn time. The Hub is NOT a
# user — this policy is intentionally narrow:
#
#   - read database/creds/postgres-vault-bi-reader  (Phase 1 default)
#   - read database/creds/postgres-vault-writer     (Phase 2 — R-CONS-SCI)
#
# Phase 2 will graduate this to token-exchange (Keycloak access token →
# OpenBao identity entity → its own minted credential under the *user*
# identity), removing this hub-scoped token from the path entirely.

path "database/creds/postgres-vault-bi-reader" {
  capabilities = ["read"]
}

path "database/creds/postgres-vault-writer" {
  capabilities = ["read"]
}
