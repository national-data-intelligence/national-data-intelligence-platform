#!/usr/bin/env bash
# Phase 4 step 4 — the exit gate: the Phase 1 regression suite against the REAL endpoint.
# Expect the same result as the PoC: everything passes except Q6b (delete rides with write).
set -euo pipefail
NS="${NS:-nhdw}"; REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
kubectl -n "$NS" port-forward svc/seaweedfs-s3 18334:8333 >/dev/null 2>&1 & PF=$!; trap 'kill $PF 2>/dev/null' EXIT; sleep 3
export S3_ENDPOINT=http://127.0.0.1:18334
# the suite's fixed PoC identities do not exist on the real cluster — it uses the admin pair
export S3_ADMIN_ACCESS_KEY=$(kubectl -n "$NS" get secret seaweedfs-secrets -o jsonpath='{.data.ADMIN_ACCESS_KEY}' | base64 -d)
export S3_ADMIN_SECRET_KEY=$(kubectl -n "$NS" get secret seaweedfs-secrets -o jsonpath='{.data.ADMIN_SECRET_KEY}' | base64 -d)
python3 "$REPO/3_storage/seaweedfs/poc/compat_test.py" --admin-only
