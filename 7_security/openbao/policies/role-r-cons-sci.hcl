# R-CONS-SCI — Data Scientist / ML Engineer.
#
# Inherits R-CONS-ANA + write access to MinIO scratch bucket + the MLflow
# Model Registry Staging stage. Cannot promote to Production (that's a
# Steward + domain-owner action via a separate path).

path "database/creds/postgres-vault-bi-reader" {
  capabilities = ["read"]
}
path "database/creds/clickhouse-marts-reader" {
  capabilities = ["read"]
}
path "database/creds/clickhouse-staging-reader" {
  capabilities = ["read"]
}

# MinIO scratch bucket — per-user prefix is enforced by MinIO policy, not
# here. The kv path returns the AWS-shape access key + secret.
path "secret/data/minio-scratch/{{identity.entity.name}}" {
  capabilities = ["read"]
}

# MLflow + serving endpoints.
path "secret/data/services/mlflow" {
  capabilities = ["read"]
}

# Self-token introspection + renew.
path "auth/token/lookup-self" {
  capabilities = ["read"]
}
path "auth/token/renew-self" {
  capabilities = ["update"]
}
