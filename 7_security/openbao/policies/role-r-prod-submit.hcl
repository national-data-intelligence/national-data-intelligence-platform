# R-PROD-SUBMIT — Data Submitter / HMIS Clerk.
#
# Read-only access to the submission portal's quarantine bucket creds
# (write happens through the submission API, not direct MinIO).
# Read-only access to their submission audit history.

path "secret/data/services/submission-portal" {
  capabilities = ["read"]
}

path "auth/token/lookup-self" {
  capabilities = ["read"]
}
path "auth/token/renew-self" {
  capabilities = ["update"]
}
