#!/usr/bin/env bash
# Phase 4 step 0 — create `seaweedfs-secrets` on the LIVE cluster from the LIVE
# minio-secrets, so the cross-refs the design relies on (same root secret → ClickHouse
# named collection, DAGs, ingestors keep working; same project-sync secret → notebook
# pods keep working) are true on the cluster and not just in the template.
#
# Run this YOURSELF. Values are read with kubectl and written with kubectl inside this
# shell — they are never printed and never leave the machine.
#
#   bash 3_storage/seaweedfs/phase4/00-create-secrets.sh
set -euo pipefail
NS="${NS:-nhdw}"
get() { kubectl -n "$NS" get secret "$1" -o jsonpath="{.data.$2}" | base64 -d; }

ROOT_USER=$(get minio-secrets ROOT_USER)
ROOT_PW=$(get minio-secrets ROOT_PASSWORD)
PS_USER=$(get minio-secrets PROJECT_SYNC_ACCESS_KEY 2>/dev/null || echo "jupyter-sync")
PS_PW=$(get minio-secrets PROJECT_SYNC_SECRET_KEY 2>/dev/null || echo "")
ML_USER=$(get mlflow-secrets S3_ACCESS_KEY)
ML_PW=$(get mlflow-secrets S3_SECRET_KEY)
[ -n "$ROOT_USER" ] && [ -n "$ROOT_PW" ] || { echo "!! minio-secrets ROOT_* empty — refusing" >&2; exit 1; }

if kubectl -n "$NS" get secret seaweedfs-secrets >/dev/null 2>&1; then
  FILER_PW=$(get seaweedfs-secrets FILER_DB_PASSWORD); echo "seaweedfs-secrets exists — keeping its FILER_DB_PASSWORD"
else
  FILER_PW=$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 32)
fi

ps_block=""
if [ -n "$PS_PW" ]; then
ps_block=$(cat <<J
    ,{ "name": "$PS_USER",
       "credentials": [{ "accessKey": "$PS_USER", "secretKey": "$PS_PW" }],
       "actions": ["Read:nhdw-artifacts/projects/*", "Write:nhdw-artifacts/projects/*", "List:nhdw-artifacts/projects/*"] }
J
)
else echo "  (no PROJECT_SYNC_* in minio-secrets — jupyter-sync identity skipped)"; fi

# G3 (2026-09-09): the mlflow identity is ALSO the ML runner's credential — it reads nhdw-raw
# (probe-lake) and nhdw-processed (inference) and writes nhdw-exports (results). Grants below
# match that footprint; still far below MinIO's readwrite-everything for this user.
IDENTITIES=$(cat <<J
{ "identities": [
    { "name": "$ROOT_USER",
      "credentials": [{ "accessKey": "$ROOT_USER", "secretKey": "$ROOT_PW" }],
      "actions": ["Admin", "Read", "Write", "List", "Tagging"] },
    { "name": "$ML_USER",
      "credentials": [{ "accessKey": "$ML_USER", "secretKey": "$ML_PW" }],
      "actions": ["Read:nhdw-artifacts", "Write:nhdw-artifacts", "List:nhdw-artifacts", "Tagging:nhdw-artifacts",
                  "Read:nhdw-raw", "List:nhdw-raw", "Read:nhdw-processed", "List:nhdw-processed",
                  "Write:nhdw-exports", "List:nhdw-exports"] }
    $ps_block
    ,{ "name": "anonymous", "actions": ["Read:nhdw-static", "List:nhdw-static"] }
] }
J
)
printf '%s' "$IDENTITIES" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("  identities:", [i["name"] for i in d["identities"]])'

kubectl -n "$NS" create secret generic seaweedfs-secrets \
  --from-literal=ADMIN_ACCESS_KEY="$ROOT_USER" --from-literal=ADMIN_SECRET_KEY="$ROOT_PW" \
  --from-literal=FILER_DB_PASSWORD="$FILER_PW" --from-literal=identities.json="$IDENTITIES" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null
# the filer DB init script reads this key from postgres-vault-secrets
kubectl -n "$NS" patch secret postgres-vault-secrets --type merge \
  -p "{\"stringData\":{\"SEAWEEDFS_FILER_DB_PASSWORD\":\"$FILER_PW\"}}" >/dev/null
echo "✓ seaweedfs-secrets applied; postgres-vault-secrets gained SEAWEEDFS_FILER_DB_PASSWORD"
