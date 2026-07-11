# OpenBao policy: r-cons-ana-jwt
#
# Attached to per-user tokens issued via the jwt-keycloak auth method
# when the signed-in user carries the R-CONS-ANA realm role. Lets the
# user mint short-TTL Postgres bi_reader credentials for their own
# session — DB cred audit lands under the user identity (entity alias),
# not under a hub service identity.
#
# Phase 5.1 surface area is intentionally read-only — analyst users
# never need to write to vault objects. Phase 6 widens to add
# sandbox-writer creds for R-CONS-SCI under a separate policy.

path "database/creds/postgres-vault-bi-reader" {
  capabilities = ["read"]
}

# Allow the user to self-introspect their token (debugging + UI display).
path "auth/token/lookup-self" {
  capabilities = ["read"]
}
