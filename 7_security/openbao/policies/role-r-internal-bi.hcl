# OpenBao policy: internal-bi
#
# Attached to the long-lived token the Internal BI dashboard uses to mint
# short-TTL Postgres credentials for the bi_* marts.
#
# Scope is intentionally narrow:
#   - read on database/creds/postgres-vault-bi-reader
#
# The bi_reader role (set up in 01_schemas.sql) only has USAGE on bi_*
# schemas and SELECT on tables there — internal-bi cannot reach the
# vault tier even with the token. Phase 5 will switch to token-exchange
# so the cred audit lands under the *signed-in user* identity instead
# of the dashboard's hub identity.

path "database/creds/postgres-vault-bi-reader" {
  capabilities = ["read"]
}
