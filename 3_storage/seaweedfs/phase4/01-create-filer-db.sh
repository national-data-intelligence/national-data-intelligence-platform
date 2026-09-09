#!/usr/bin/env bash
# Phase 4 step 1 — create the filer metadata database on the LIVE postgres-vault.
# initdb scripts only run on a fresh volume, so on the live cluster this is by hand.
# Idempotent; refuses if the COLLATE "C" invariant is violated.
set -euo pipefail
NS="${NS:-nhdw}"; REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PW=$(kubectl -n "$NS" get secret seaweedfs-secrets -o jsonpath='{.data.FILER_DB_PASSWORD}' | base64 -d)
[ -n "$PW" ] || { echo "!! run 00-create-secrets.sh first" >&2; exit 1; }
kubectl -n "$NS" exec -i postgres-vault-0 -- env SEAWEEDFS_FILER_DB_PASSWORD="$PW" bash \
  < "$REPO/3_storage/postgres/init/23_seaweedfs_filer_db.sh"
