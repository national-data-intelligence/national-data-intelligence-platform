#!/usr/bin/env bash
# objstore.sh — the ONE place the host-side bundle scripts learn how to reach the
# object store (SeaweedFS S3 gateway since Phase 6, 2026-09-09). Source it:
#
#     . "$REPO/bundle/scripts/lib/objstore.sh"
#     objstore_mc            # → $MC (bundled mc → cached minio/mc image → network)
#     objstore_creds         # → $OS_USER $OS_PASS (never printed)
#     objstore_pf 19000      # → port-forward svc/seaweedfs-s3 → 127.0.0.1:19000, $OS_URL
#     ... "$MC" --config-dir "$OS_MC_CFG" alias set L "$OS_URL" "$OS_USER" "$OS_PASS"
#     objstore_pf_stop
#
# Why a port-forward + host-side mc: on Docker Desktop/WSL2 a container (even
# --network=host) lives in the Desktop VM and cannot reach a port-forward bound
# on the host — only the host can. Same pattern pack.sh always used.
#
# Rollback to MinIO for any one script: OBJSTORE_SVC=minio-datalake OBJSTORE_PORT=9000
# OBJSTORE_SECRET=minio-secrets OBJSTORE_USER_KEY=ROOT_USER OBJSTORE_PASS_KEY=ROOT_PASSWORD
# (the credential VALUES are identical on both stores until the Phase 8 rotation).

OBJSTORE_NS="${OBJSTORE_NS:-${NS:-nhdw}}"
OBJSTORE_SVC="${OBJSTORE_SVC:-seaweedfs-s3}"
OBJSTORE_PORT="${OBJSTORE_PORT:-8333}"
OBJSTORE_SECRET="${OBJSTORE_SECRET:-seaweedfs-secrets}"
OBJSTORE_USER_KEY="${OBJSTORE_USER_KEY:-ADMIN_ACCESS_KEY}"
OBJSTORE_PASS_KEY="${OBJSTORE_PASS_KEY:-ADMIN_SECRET_KEY}"
OBJSTORE_INTERNAL="http://${OBJSTORE_SVC}.${OBJSTORE_NS}.svc.cluster.local:${OBJSTORE_PORT}"
OBJSTORE_MC_IMAGE="${OBJSTORE_MC_IMAGE:-minio/mc:RELEASE.2025-04-08T15-39-49Z}"   # same tag cache-images.sh ships

objstore_mc() {  # sets MC; returns 1 if no client can be obtained
  local repo="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
  MC="$repo/bundle/bin/mc"
  [ -x "$MC" ] && return 0
  mkdir -p "$repo/bundle/bin"
  # Offline fallback: the bundle caches the mc image for the in-cluster init Jobs —
  # lift the static binary out of it (no network needed).
  if command -v docker >/dev/null 2>&1 && docker image inspect "$OBJSTORE_MC_IMAGE" >/dev/null 2>&1; then
    local cid; cid=$(docker create "$OBJSTORE_MC_IMAGE" 2>/dev/null) \
      && docker cp "$cid:/usr/bin/mc" "$MC" >/dev/null 2>&1 && docker rm "$cid" >/dev/null 2>&1 && chmod +x "$MC" \
      && { echo "  mc extracted from cached image $OBJSTORE_MC_IMAGE → bundle/bin/mc" >&2; return 0; }
  fi
  echo "  ! bundle/bin/mc missing — falling back to NETWORK download (FIX THE BUNDLE)" >&2
  curl -fsSL --max-time 120 -o "$MC" https://dl.min.io/client/mc/release/linux-amd64/mc && chmod +x "$MC" && return 0
  MC=""; return 1
}

objstore_creds() {  # sets OS_USER / OS_PASS from the cluster Secret (values never echoed)
  OS_USER=$(kubectl -n "$OBJSTORE_NS" get secret "$OBJSTORE_SECRET" -o jsonpath="{.data.$OBJSTORE_USER_KEY}" 2>/dev/null | base64 -d)
  OS_PASS=$(kubectl -n "$OBJSTORE_NS" get secret "$OBJSTORE_SECRET" -o jsonpath="{.data.$OBJSTORE_PASS_KEY}" 2>/dev/null | base64 -d)
  [ -n "$OS_USER" ] && [ -n "$OS_PASS" ]
}

objstore_pf() {  # <local-port> → background port-forward, waits for ANY HTTP answer; sets OS_URL OS_PF OS_MC_CFG
  local lp="${1:-19000}" i
  for i in $(seq 1 24); do
    kubectl -n "$OBJSTORE_NS" get pods -l "app=${OBJSTORE_SVC/seaweedfs-s3/seaweedfs-filer}" -o jsonpath='{.items[0].status.phase}' 2>/dev/null | grep -q Running && break
    sleep 5
  done
  kubectl -n "$OBJSTORE_NS" port-forward "svc/$OBJSTORE_SVC" "$lp:$OBJSTORE_PORT" >/dev/null 2>&1 &
  OS_PF=$!
  OS_URL="http://127.0.0.1:$lp"
  for i in $(seq 1 15); do
    # any HTTP status (403 without auth is fine) proves the S3 endpoint answers
    curl -s -o /dev/null --max-time 2 "$OS_URL/" && break
    sleep 2
  done
  OS_MC_CFG=$(mktemp -d)
}

objstore_pf_stop() {
  [ -n "${OS_MC_CFG:-}" ] && rm -rf "$OS_MC_CFG"
  [ -n "${OS_PF:-}" ] && kill "$OS_PF" 2>/dev/null
  OS_PF=""; OS_MC_CFG=""
}

objstore_alias() {  # after objstore_pf + objstore_creds: mc alias "L"
  "$MC" --config-dir "$OS_MC_CFG" alias set L "$OS_URL" "$OS_USER" "$OS_PASS" >/dev/null
}
