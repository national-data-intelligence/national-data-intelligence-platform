#!/bin/sh
# create-buckets.sh — provision NHDW data-lake buckets, policies, and service
# accounts on a fresh MinIO instance. Idempotent: safe to re-run after editing.
#
# Run via:
#   docker compose up minio-init
#
# What it does:
#   1. Aliases the local MinIO with mc.
#   2. Creates three buckets if they don't exist: nhdw-raw, nhdw-processed, nhdw-archive.
#   3. Enables object versioning on nhdw-raw and nhdw-archive (not nhdw-processed
#      — that one is rebuildable from raw by dbt, so versioning would just bloat
#      storage with intermediate dbt runs).
#   4. Defines four least-privilege policies and attaches each to a service user:
#        nhdw_ingestor    rw nhdw-raw
#        nhdw_transformer ro nhdw-raw, rw nhdw-processed
#        nhdw_archiver    ro nhdw-processed, rw nhdw-archive
#        nhdw_reader      ro nhdw-processed
#   5. Writes a per-bucket "_README" object so anyone landing in the console
#      knows what the bucket is for and what conventions apply.

set -eu

ALIAS=local

echo "==> Aliasing MinIO server"
mc alias set "$ALIAS" http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null

# ─── Buckets ────────────────────────────────────────────────────────────────

for bucket in nhdw-raw nhdw-processed nhdw-archive; do
  if mc ls "$ALIAS/$bucket" >/dev/null 2>&1; then
    echo "==> Bucket exists: $bucket"
  else
    echo "==> Creating bucket: $bucket"
    mc mb "$ALIAS/$bucket"
  fi
done

# ─── Versioning ─────────────────────────────────────────────────────────────

echo "==> Enabling versioning on nhdw-raw and nhdw-archive"
mc version enable "$ALIAS/nhdw-raw"     >/dev/null
mc version enable "$ALIAS/nhdw-archive" >/dev/null
# Processed is regenerable; versioning suspended (default).

# ─── Policies ───────────────────────────────────────────────────────────────
#
# We write each policy to /tmp, register it with `mc admin policy create`, then
# attach to its service user. `policy create` is idempotent in modern mc — it
# updates if the name exists.

write_policy() {
  policy_name="$1"
  policy_json="$2"
  policy_file="/tmp/${policy_name}.json"
  printf '%s\n' "$policy_json" > "$policy_file"
  echo "==> Registering policy: $policy_name"
  mc admin policy create "$ALIAS" "$policy_name" "$policy_file" >/dev/null
}

# ingestor: full RW on nhdw-raw only.
write_policy "nhdw-ingestor-policy" '{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation", "s3:GetBucketVersioning"],
      "Resource": ["arn:aws:s3:::nhdw-raw"]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject", "s3:GetObjectVersion",
        "s3:PutObject", "s3:DeleteObject",
        "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"
      ],
      "Resource": ["arn:aws:s3:::nhdw-raw/*"]
    }
  ]
}'

# transformer: read raw, write processed.
write_policy "nhdw-transformer-policy" '{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": ["arn:aws:s3:::nhdw-raw", "arn:aws:s3:::nhdw-processed"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:GetObjectVersion"],
      "Resource": ["arn:aws:s3:::nhdw-raw/*"]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject", "s3:PutObject", "s3:DeleteObject",
        "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"
      ],
      "Resource": ["arn:aws:s3:::nhdw-processed/*"]
    }
  ]
}'

# archiver: read processed, write archive.
write_policy "nhdw-archiver-policy" '{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": ["arn:aws:s3:::nhdw-processed", "arn:aws:s3:::nhdw-archive"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::nhdw-processed/*"]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject", "s3:PutObject",
        "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"
      ],
      "Resource": ["arn:aws:s3:::nhdw-archive/*"]
    }
  ]
}'

# reader: read-only on processed (for dashboards / access points).
write_policy "nhdw-reader-policy" '{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": ["arn:aws:s3:::nhdw-processed"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::nhdw-processed/*"]
    }
  ]
}'

# ─── Service users + policy attachment ──────────────────────────────────────

upsert_user() {
  access_key="$1"
  secret_key="$2"
  policy_name="$3"
  if mc admin user info "$ALIAS" "$access_key" >/dev/null 2>&1; then
    echo "==> User exists: $access_key (rotating secret + reattaching policy)"
    # Recreating a user replaces the secret. Safe + idempotent.
    mc admin user add "$ALIAS" "$access_key" "$secret_key" >/dev/null
  else
    echo "==> Creating user: $access_key"
    mc admin user add "$ALIAS" "$access_key" "$secret_key" >/dev/null
  fi
  mc admin policy attach "$ALIAS" "$policy_name" --user "$access_key" >/dev/null 2>&1 || true
}

upsert_user "$INGESTOR_ACCESS_KEY"    "$INGESTOR_SECRET_KEY"    "nhdw-ingestor-policy"
upsert_user "$TRANSFORMER_ACCESS_KEY" "$TRANSFORMER_SECRET_KEY" "nhdw-transformer-policy"
upsert_user "$ARCHIVER_ACCESS_KEY"    "$ARCHIVER_SECRET_KEY"    "nhdw-archiver-policy"
upsert_user "$READER_ACCESS_KEY"      "$READER_SECRET_KEY"      "nhdw-reader-policy"

# ─── Legacy accounts (carried over from the pre-migration MinIO) ─────────────
#
# Recreated so external partners (OpenFn) and team members keep the EXACT same
# credentials they used before the migration. The old flat buckets (test, mfr,
# ihris, dagu, …) now live as PREFIXES inside nhdw-raw/, so:
#   - openfn-ingestion gets the same rw-on-raw policy as nhdw_ingestor; its
#     writes land at nhdw-raw/<source>/… exactly as the old per-bucket layout,
#     just one level down.
#   - aisha + ndwh-team are read-only console users (browse, no writes).
#
# Each block is skipped when its access key is unset/empty, so the legacy
# accounts are optional and the script stays valid on a clean install.

# console read-only: list + read across all three lake buckets (for browsing).
write_policy "nhdw-console-readonly-policy" '{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListAllMyBuckets"],
      "Resource": ["arn:aws:s3:::*"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": [
        "arn:aws:s3:::nhdw-raw",
        "arn:aws:s3:::nhdw-processed",
        "arn:aws:s3:::nhdw-archive"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:GetObjectVersion"],
      "Resource": [
        "arn:aws:s3:::nhdw-raw/*",
        "arn:aws:s3:::nhdw-processed/*",
        "arn:aws:s3:::nhdw-archive/*"
      ]
    }
  ]
}'

# openfn-ingestion: same as nhdw_ingestor (rw on nhdw-raw).
if [ -n "${OPENFN_ACCESS_KEY:-}" ]; then
  upsert_user "$OPENFN_ACCESS_KEY" "$OPENFN_SECRET_KEY" "nhdw-ingestor-policy"
fi
# aisha: read-only console.
if [ -n "${AISHA_ACCESS_KEY:-}" ]; then
  upsert_user "$AISHA_ACCESS_KEY" "$AISHA_SECRET_KEY" "nhdw-console-readonly-policy"
fi
# ndwh-team: shared read-only console.
if [ -n "${TEAM_ACCESS_KEY:-}" ]; then
  upsert_user "$TEAM_ACCESS_KEY" "$TEAM_SECRET_KEY" "nhdw-console-readonly-policy"
fi

# ─── Self-describing READMEs in each bucket ─────────────────────────────────
#
# A tiny object at the root of each bucket so anyone clicking into MinIO console
# knows what they're looking at and where to find the contract docs.

write_bucket_readme() {
  bucket="$1"
  body="$2"
  tmp=$(mktemp)
  printf '%s\n' "$body" > "$tmp"
  mc cp --quiet "$tmp" "$ALIAS/$bucket/_README.txt" >/dev/null
  rm -f "$tmp"
}

write_bucket_readme "nhdw-raw" "NHDW data lake — RAW zone

Contains raw extracts from upstream sources, written by 2_pipelines/ingestor/* pipelines.

Path scheme:    <source>/<object>/year=YYYY/month=MM/day=DD/<filename>.parquet
Format:         Apache Parquet, Snappy compression
Mutability:     Append-only. Re-runs write new files with new run_ids.
Versioning:     Enabled.

Full contract: ./3_storage/minio/README.md"

write_bucket_readme "nhdw-processed" "NHDW data lake — PROCESSED zone

Contains dbt-transformed data: staging, hubs/satellites/links (Data Vault 2.0),
marts. Written by 2_pipelines/, read by 6_access-points/.

Path scheme:    <layer>/<schema>/<table>/year=YYYY/month=MM/day=DD/<filename>.parquet
Format:         Apache Parquet, Snappy compression
Mutability:     Regenerable from nhdw-raw at any time.
Versioning:     Suspended.

Full contract: ./3_storage/minio/README.md"

write_bucket_readme "nhdw-archive" "NHDW data lake — ARCHIVE zone

Cold tier. Long-term retention copies of processed marts and any raw data
exceeding the retention window in nhdw-raw.

Path scheme:    <source-or-mart>/<object>/year=YYYY/<filename>.parquet
Format:         Apache Parquet, Snappy compression
Versioning:     Enabled.

Full contract: ./3_storage/minio/README.md"

# ════════════════════════════════════════════════════════════════════════════
# Phase 2 buckets — added when the platform grew beyond ingestion/dbt to
# cover federated query (Trino over a lake), per-user dashboard exports,
# workshop user uploads, DR backups, and a public static-assets origin.
# Buckets are idempotent (skipped if present); policies + lifecycle rules
# are upserted on every run.
# ════════════════════════════════════════════════════════════════════════════

# nhdw-docs: operator system documentation (docs/*.md), uploaded at boot by
# seed-docs.sh and served through the gateway under R-OPS-* auth. NOT anonymous
# (unlike nhdw-static) — the docs are an operator reference, not public content.
for bucket in nhdw-lake nhdw-exports nhdw-artifacts nhdw-backups nhdw-static nhdw-logs nhdw-docs; do
  if mc ls "$ALIAS/$bucket" >/dev/null 2>&1; then
    echo "==> Bucket exists: $bucket"
  else
    echo "==> Creating bucket: $bucket"
    mc mb "$ALIAS/$bucket"
  fi
done

# ─── Versioning + lifecycle ─────────────────────────────────────────────────
#
# nhdw-lake     : versioning OFF (rebuildable from vault); lifecycle: delete
#                 partitions older than 90d in dt=YYYY-MM-DD layouts via the
#                 marts snapshot job.
# nhdw-exports  : versioning OFF (every export is a fresh immutable object
#                 with sha256 in the registry). Lifecycle: expire at 90d
#                 unless the registry marks the row "pinned".
# nhdw-artifacts: versioning ON (workshop uploads are mutable; users need
#                 history); no auto-expire.
# nhdw-backups  : versioning ON + object lock could be enabled in prod
#                 (MinIO requires the bucket to be created with --with-lock,
#                 which we skip in dev — the existing buckets are also unlocked).
#                 Lifecycle: keep 30 daily / 12 weekly / 12 monthly via the
#                 backup cron metadata (here we just delete after 365d).
# nhdw-static   : versioning OFF; lifecycle: none. Anonymous read enabled.

mc version suspend "$ALIAS/nhdw-lake"      >/dev/null
mc version suspend "$ALIAS/nhdw-exports"   >/dev/null
mc version enable  "$ALIAS/nhdw-artifacts" >/dev/null
mc version enable  "$ALIAS/nhdw-backups"   >/dev/null
mc version suspend "$ALIAS/nhdw-static"    >/dev/null
# Loki manages its own object lifecycle via its chunk store retention. No
# bucket-level versioning, no MinIO lifecycle rule — Loki decides when
# chunks expire based on `retention_period` in loki.yml.
mc version suspend "$ALIAS/nhdw-logs"       >/dev/null

# Lifecycle: expire-after-N-days. mc ilm add is idempotent on identical IDs.
mc ilm add --expiry-days 90  --id "exports-ttl-90d"   "$ALIAS/nhdw-exports"  >/dev/null 2>&1 || true
mc ilm add --expiry-days 365 --id "backups-ttl-365d"  "$ALIAS/nhdw-backups"  >/dev/null 2>&1 || true

# Anonymous read on nhdw-static (the public dashboard pulls dataset catalogue
# files directly without a presigned URL).
mc anonymous set download "$ALIAS/nhdw-static" >/dev/null 2>&1 || true

# ─── Policies for the new service accounts ──────────────────────────────────

# lake-writer: rw nhdw-lake (used by the marts→parquet snapshot job).
write_policy "nhdw-lake-writer-policy" '{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect": "Allow",
     "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
     "Resource": ["arn:aws:s3:::nhdw-lake"]},
    {"Effect": "Allow",
     "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject",
                "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"],
     "Resource": ["arn:aws:s3:::nhdw-lake/*"]}
  ]
}'

# lake-reader: ro nhdw-lake (used by Trino + analyst notebooks).
write_policy "nhdw-lake-reader-policy" '{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect": "Allow",
     "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
     "Resource": ["arn:aws:s3:::nhdw-lake"]},
    {"Effect": "Allow",
     "Action": ["s3:GetObject"],
     "Resource": ["arn:aws:s3:::nhdw-lake/*"]}
  ]
}'

# gateway: rw nhdw-exports + rw nhdw-artifacts/submissions/* + ro nhdw-lake.
# The data gateway writes every dashboard-generated export, accepts community
# model submissions (under submissions/<artifact_id>/v<n>/), and reads
# nhdw-lake for federated query through Trino.
write_policy "nhdw-gateway-policy" '{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect": "Allow",
     "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
     "Resource": ["arn:aws:s3:::nhdw-exports", "arn:aws:s3:::nhdw-lake",
                  "arn:aws:s3:::nhdw-artifacts", "arn:aws:s3:::nhdw-backups"]},
    {"Effect": "Allow",
     "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject",
                "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"],
     "Resource": ["arn:aws:s3:::nhdw-exports/*",
                  "arn:aws:s3:::nhdw-artifacts/submissions/*"]},
    {"Effect": "Allow",
     "Action": ["s3:GetObject"],
     "Resource": ["arn:aws:s3:::nhdw-lake/*",
                  "arn:aws:s3:::nhdw-artifacts/*",
                  "arn:aws:s3:::nhdw-backups/*"]}
  ]
}'

# workshop: rw nhdw-artifacts (notebook/model/dataset uploads).
write_policy "nhdw-workshop-policy" '{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect": "Allow",
     "Action": ["s3:ListBucket", "s3:GetBucketLocation", "s3:GetBucketVersioning"],
     "Resource": ["arn:aws:s3:::nhdw-artifacts"]},
    {"Effect": "Allow",
     "Action": ["s3:GetObject", "s3:GetObjectVersion",
                "s3:PutObject", "s3:DeleteObject",
                "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"],
     "Resource": ["arn:aws:s3:::nhdw-artifacts/*"]}
  ]
}'

# backup: rw nhdw-backups (DR cron job; should be the only writer here).
write_policy "nhdw-backup-policy" '{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect": "Allow",
     "Action": ["s3:ListBucket", "s3:GetBucketLocation", "s3:GetBucketVersioning"],
     "Resource": ["arn:aws:s3:::nhdw-backups"]},
    {"Effect": "Allow",
     "Action": ["s3:GetObject", "s3:GetObjectVersion",
                "s3:PutObject", "s3:DeleteObject",
                "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"],
     "Resource": ["arn:aws:s3:::nhdw-backups/*"]}
  ]
}'

# static-publisher: rw nhdw-static (publishing pipeline for dataset
# catalogues, articles, dataset license PDFs).
write_policy "nhdw-static-publisher-policy" '{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect": "Allow",
     "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
     "Resource": ["arn:aws:s3:::nhdw-static"]},
    {"Effect": "Allow",
     "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject",
                "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"],
     "Resource": ["arn:aws:s3:::nhdw-static/*"]}
  ]
}'

# loki: rw nhdw-logs (chunks + indexes). Loki manages its own retention
# so only Loki should write here.
write_policy "nhdw-loki-policy" '{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect": "Allow",
     "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
     "Resource": ["arn:aws:s3:::nhdw-logs"]},
    {"Effect": "Allow",
     "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject",
                "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"],
     "Resource": ["arn:aws:s3:::nhdw-logs/*"]}
  ]
}'

# mlflow: rw nhdw-artifacts/mlflow/* (model files, plots, run artifacts).
# Reuses the existing nhdw-artifacts bucket with a dedicated prefix.
# The nhdw/ml-runner Jobs use the same credentials (contract: no new secret
# material), so the policy also covers the two runner prefixes:
#   ml-packages/*  ro — model packages (train mode fetches these)
#   ml-adhoc/*     rw — gateway-staged predict-adhoc input/output CSVs
write_policy "nhdw-mlflow-policy" '{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect": "Allow",
     "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
     "Resource": ["arn:aws:s3:::nhdw-artifacts"],
     "Condition": {"StringLike": {"s3:prefix": ["mlflow/*", "mlflow",
                                                 "ml-packages/*", "ml-packages",
                                                 "ml-adhoc/*", "ml-adhoc"]}}},
    {"Effect": "Allow",
     "Action": ["s3:GetObject", "s3:GetObjectVersion",
                "s3:PutObject", "s3:DeleteObject",
                "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"],
     "Resource": ["arn:aws:s3:::nhdw-artifacts/mlflow/*",
                  "arn:aws:s3:::nhdw-artifacts/ml-adhoc/*"]},
    {"Effect": "Allow",
     "Action": ["s3:GetObject", "s3:GetObjectVersion"],
     "Resource": ["arn:aws:s3:::nhdw-artifacts/ml-packages/*"]}
  ]
}'

# ─── New service users (env vars may be unset on first run — skip then) ─────

[ -n "${LAKE_WRITER_ACCESS_KEY:-}" ]      && upsert_user "$LAKE_WRITER_ACCESS_KEY"      "$LAKE_WRITER_SECRET_KEY"      "nhdw-lake-writer-policy"
[ -n "${LAKE_READER_ACCESS_KEY:-}" ]      && upsert_user "$LAKE_READER_ACCESS_KEY"      "$LAKE_READER_SECRET_KEY"      "nhdw-lake-reader-policy"
[ -n "${GATEWAY_ACCESS_KEY:-}" ]          && upsert_user "$GATEWAY_ACCESS_KEY"          "$GATEWAY_SECRET_KEY"          "nhdw-gateway-policy"
[ -n "${WORKSHOP_ACCESS_KEY:-}" ]         && upsert_user "$WORKSHOP_ACCESS_KEY"         "$WORKSHOP_SECRET_KEY"         "nhdw-workshop-policy"
[ -n "${BACKUP_ACCESS_KEY:-}" ]           && upsert_user "$BACKUP_ACCESS_KEY"           "$BACKUP_SECRET_KEY"           "nhdw-backup-policy"
[ -n "${STATIC_PUBLISHER_ACCESS_KEY:-}" ] && upsert_user "$STATIC_PUBLISHER_ACCESS_KEY" "$STATIC_PUBLISHER_SECRET_KEY" "nhdw-static-publisher-policy"
[ -n "${LOKI_ACCESS_KEY:-}" ]             && upsert_user "$LOKI_ACCESS_KEY"             "$LOKI_SECRET_KEY"             "nhdw-loki-policy"
[ -n "${MLFLOW_ACCESS_KEY:-}" ]           && upsert_user "$MLFLOW_ACCESS_KEY"           "$MLFLOW_SECRET_KEY"           "nhdw-mlflow-policy"

# ─── READMEs in new buckets ─────────────────────────────────────────────────

write_bucket_readme "nhdw-lake" "NHDW data lake — LAKE zone (Trino-readable)

Materialised parquet snapshots of vault sats and dbt marts, partitioned by
date. Trino + DuckDB read this; nothing here is mutated by hand.

Path scheme:    marts/<mart_name>/dt=YYYY-MM-DD/part-*.parquet
                vault/<schema>/<table>/dt=YYYY-MM-DD/part-*.parquet
Lifecycle:      partitions older than 90d removed by the snapshot job.
Versioning:     OFF (regenerable from PG vault)."

write_bucket_readme "nhdw-exports" "NHDW data lake — EXPORTS zone

Every dataset a dashboard or gateway query generated lands here. THE source
of truth for the question 'what data left the warehouse?' lives in the
nhdw_ops.export_registry table on the postgres-vault server, which has a
1:1 row for every object in this bucket.

Path scheme:    user=<kc_sub>/<yyyy>/<mm>/<dd>/<export_id>.<fmt>
Lifecycle:      90d TTL unless registry marks 'pinned_until'.
Versioning:     OFF (objects are immutable; sha256 in registry)."

write_bucket_readme "nhdw-artifacts" "NHDW data lake — ARTIFACTS zone

Workshop dashboard catalogue: notebooks, models, datasets, reports
uploaded by partner / researcher users. Catalogue metadata lives in
nhdw_ops.ops_artifact.* with full peer-review + provenance tracking.

Path scheme:    <artifact_id>/v<n>/<filename>
Versioning:     ON (mutability + history)."

write_bucket_readme "nhdw-backups" "NHDW data lake — BACKUPS zone

DR snapshots: pg dumps (nhdw_vault, nhdw_ops), source-DB dumps,
configuration tarballs. Written by the backup cron; readable only by ops.

Path scheme:    <db_or_target>/<yyyy-mm-dd>/<filename>.<ext>
Lifecycle:      365d TTL.
Versioning:     ON."

write_bucket_readme "nhdw-logs" "NHDW data lake — LOGS zone (Loki backend)

Loki writes its chunks + indexes here as its primary backend (no local
cache). Schema is Loki-internal; do not touch by hand. Querying happens
through Loki's API or the gateway's /api/observability/logs route.

Versioning: OFF (Loki manages its own retention)."

write_bucket_readme "nhdw-static" "NHDW data lake — STATIC zone (publicly readable)

Public-facing files: dataset catalogue download bundles for the Public
Dashboard, published articles, license PDFs.

Path scheme:    catalogue/<slug>.zip · articles/<id>.html · licenses/<id>.pdf
Versioning:     OFF.
Access:         anonymous read (s3 GetObject) enabled by 'mc anonymous set'."

# ─── Done ───────────────────────────────────────────────────────────────────

echo ""
echo "==> Data lake provisioned successfully."
echo ""
mc admin user list "$ALIAS"
echo ""
mc ls "$ALIAS"
