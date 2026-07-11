# OpenBao policy: public-dashboard
#
# Attached to the long-lived token the Public Dashboard uses to mint
# short-TTL read-only Postgres credentials for the bi_public.* marts.
#
# Scope is intentionally narrow:
#   - read on database/creds/postgres-vault-bi-reader
#
# The bi_reader role (set up in 01_schemas.sql) only has USAGE on bi_*
# schemas and SELECT on tables there — it CANNOT see PHI from the vault.
# Even if this token leaks, the blast radius is exactly the k-anonymised
# public marts that the dashboard is already publishing.
#
# Phase 5 will replace this hub-style token with token-exchange so the
# dashboard's per-request audit lands under "user=anonymous role=R-PUB-ANON"
# *inside the database*, not just in the app's Loki stream.

path "database/creds/postgres-vault-bi-reader" {
  capabilities = ["read"]
}
