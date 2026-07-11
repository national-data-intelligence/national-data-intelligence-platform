#!/bin/bash
# NHDW backup — produces a timestamped, integrity-checked archive of
# every stateful component. Intended to run daily at 02:00 (cron in
# Phase 5.4.1). Output goes under $BACKUP_ROOT (default /mnt/backups).
#
# Components covered:
#   - postgres-vault                          pg_dump --format=custom
#   - clickhouse                              clickhouse-backup-style snapshot
#   - minio                                   mc mirror of every nhdw-* bucket
#   - openhim mongo                           mongodump
#   - keycloak realm exports                  kcadm export for each realm
#   - openbao file backend                    tar of /var/lib/openbao + sealed unseal-keys
#
# Each artifact lands in $BACKUP_ROOT/<UTC-date>/ with a sha256
# manifest so the restore drill can validate every file.
# Be tolerant per-step — a partial backup is more useful than an early
# abort. Individual failures print a warning; the final manifest covers
# whatever artifacts made it to disk.
set -uo pipefail

REPO=$(cd "$(dirname "$0")/../.." && pwd)
BACKUP_ROOT="${BACKUP_ROOT:-/mnt/backups}"
DATE=$(date -u +%Y-%m-%dT%H%M%SZ)
OUT="$BACKUP_ROOT/$DATE"
mkdir -p "$OUT"
echo "▸ backup target: $OUT"

manifest() {
    # chown anything that the sudo'd tar steps left as root, so the
    # manifest can read them.
    echo "${BACKUP_SUDO_PASS:?set BACKUP_SUDO_PASS (or configure passwordless sudo for the backup paths)}" | sudo -S chown -R bini:nhdw "$OUT" 2>/dev/null || true
    (cd "$OUT" && find . -maxdepth 2 -type f ! -name 'manifest.sha256' -print0 \
        | xargs -0 sha256sum) > "$OUT/manifest.sha256"
}

# 1. postgres-vault
echo "▸ postgres-vault: pg_dump"
PG_ADMIN_PW=$(grep ^POSTGRES_ADMIN_PASSWORD "$REPO/3_storage/postgres/.env" | cut -d= -f2)
docker exec -e PGPASSWORD="$PG_ADMIN_PW" postgres-vault \
    pg_dump -U vault_admin -d nhdw_vault \
            --format=custom --compress=6 --no-owner --no-privileges \
    > "$OUT/postgres-vault.dump"
echo "  -> $(du -h "$OUT/postgres-vault.dump" | cut -f1)"

# 2. clickhouse — staging holds only views over MinIO Parquet, so a
# dbt rebuild restores it for free. Snapshot the DDL so a clean host
# can rebuild without re-running the full staging DAG.
echo "▸ clickhouse: DDL snapshot (views over MinIO; data lives in the lake)"
docker exec clickhouse clickhouse-client --multiquery --query "
SELECT 'DROP DATABASE IF EXISTS nhdw_staging;'
UNION ALL
SELECT 'CREATE DATABASE nhdw_staging;'
UNION ALL
SELECT create_table_query FROM system.tables WHERE database='nhdw_staging' AND engine='View'
" > "$OUT/clickhouse-staging.ddl.sql" 2>/dev/null || echo "  ! clickhouse query failed (acceptable in dev)"

# 3. minio — tar the on-disk bucket layout. Faster + simpler than mc
# mirror; works as long as MinIO uses a host-bind mount (it does in
# the dev compose). Production swaps for object-store cross-region
# replication and this step becomes a no-op.
echo "▸ minio: snapshot data dir"
MINIO_SRC=$(docker inspect minio-datalake --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' 2>/dev/null)
if [ -n "$MINIO_SRC" ]; then
    echo "${BACKUP_SUDO_PASS:?set BACKUP_SUDO_PASS (or configure passwordless sudo for the backup paths)}" | sudo -S tar czf "$OUT/minio-buckets.tar.gz" -C "$MINIO_SRC" . 2>/dev/null \
        && echo "  -> $(du -h "$OUT/minio-buckets.tar.gz" | cut -f1)" \
        || echo "  ! minio snapshot failed"
else
    echo "  ! minio data dir not bind-mounted; skipping"
fi

# 4. openhim mongo
echo "▸ openhim mongo: dump"
docker exec nhdw-openhim-mongo mongodump --quiet --archive --gzip --db=openhim \
    > "$OUT/openhim-mongo.archive.gz"
echo "  -> $(du -h "$OUT/openhim-mongo.archive.gz" | cut -f1)"

# 5. keycloak realm exports
echo "▸ keycloak: realm exports"
KC_PW=$(grep ^KC_BOOTSTRAP_ADMIN_PASSWORD "$REPO/7_security/keycloak/.env" | cut -d= -f2)
docker exec keycloak /opt/keycloak/bin/kcadm.sh config credentials \
    --server http://localhost:8080 --realm master \
    --user keycloak_admin --password "$KC_PW" > /dev/null 2>&1
for realm in moh-staff privileged-ops; do
    docker exec keycloak /opt/keycloak/bin/kcadm.sh get "realms/$realm" \
        > "$OUT/keycloak-realm-$realm.json" 2>/dev/null
done

# 6. openbao file backend
echo "▸ openbao: file backend snapshot"
echo "${BACKUP_SUDO_PASS:?set BACKUP_SUDO_PASS (or configure passwordless sudo for the backup paths)}" | sudo -S tar czf "$OUT/openbao-file.tar.gz" -C /data/security openbao 2>/dev/null
echo "  -> $(du -h "$OUT/openbao-file.tar.gz" | cut -f1)"

# 7. dataset registry + role YAMLs + dbt manifests (configuration as
# data — recoverable from git but cheap to snapshot)
tar czf "$OUT/registry.tar.gz" -C "$REPO" bundle docs

# Manifest
manifest
echo "▸ manifest: $(wc -l < "$OUT/manifest.sha256") files"
echo "▸ total: $(du -sh "$OUT" | cut -f1)"
echo "▸ done."
