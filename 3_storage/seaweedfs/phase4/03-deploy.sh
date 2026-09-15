#!/usr/bin/env bash
# Phase 4 step 3 — deploy SeaweedFS ALONGSIDE MinIO. Additive: no MinIO object is touched.
set -euo pipefail
NS="${NS:-nhdw}"; REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
kubectl -n "$NS" get secret seaweedfs-secrets >/dev/null 2>&1 || { echo "!! run 00-create-secrets.sh first" >&2; exit 1; }
kubectl apply -f "$REPO/1_infrastructure/k8s/base/seaweedfs.yaml"
for d in seaweedfs-master seaweedfs-filer; do kubectl -n "$NS" rollout status deploy/$d --timeout=180s; done
kubectl -n "$NS" rollout status statefulset/seaweedfs-volume --timeout=180s
kubectl -n "$NS" wait --for=condition=complete job/seaweedfs-init --timeout=300s
kubectl -n "$NS" logs job/seaweedfs-init | tail -14
echo; kubectl -n "$NS" get pods -l part-of=seaweedfs
echo; echo "MinIO still there and untouched:"; kubectl -n "$NS" get deploy minio-datalake
