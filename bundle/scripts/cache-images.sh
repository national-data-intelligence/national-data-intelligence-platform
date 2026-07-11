#!/usr/bin/env bash
# cache-images.sh — make the NHDW demo OFFLINE-deployable.
#
# Pulls every third-party (public) image the k8s deploy needs, plus collects the
# locally-built nhdw/*:dev images, `docker save`s them all into bundle/images/
# as tarballs that ship inside the zip, and imports them into the k3d cluster.
#
# After this runs once, a deploy needs NO registry access at all:
#   - bootstrap does `docker load` from bundle/images/*.tar
#   - then `k3d image import` into the cluster
#
# Usage:
#   cache-images.sh                 # pull(if needed)+save+import everything
#   cache-images.sh --save-only     # pull+save to bundle/images, no cluster import
#   cache-images.sh --load-only     # OFFLINE: docker load from bundle/images + import
#   cache-images.sh --cluster=nhdw
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMGDIR="$REPO/bundle/images"
CLUSTER=nhdw
MODE=full
for arg in "$@"; do
  case "$arg" in
    --save-only) MODE=save ;;
    --load-only) MODE=load ;;
    --cluster=*) CLUSTER="${arg#--cluster=}" ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
  esac
done
mkdir -p "$IMGDIR"

# Every third-party image the deploy needs. ALL are required and cached.
# Ordered smallest-first only so the storage/security core lands while the
# larger layers (ollama LLM runtime) are still downloading — none are skipped.
PUBLIC=(
  "postgres:16-alpine"
  "openpolicyagent/opa:1.5.0"
  "python:3.12-alpine"
  "curlimages/curl:8.10.1"
  "minio/minio:RELEASE.2025-02-28T09-55-16Z"
  "clickhouse/clickhouse-server:24.3"
  "trinodb/trino:476"                         # federated SQL engine (marts + ops + lake)
  "minio/mc:RELEASE.2025-04-08T15-39-49Z"    # dbt-jobs minio-init / seed steps
  "python:3.12-slim"                          # security-seed loader Job (glibc; psycopg wheels)
  "quay.io/keycloak/keycloak:26.0.7"
  "ghcr.io/headlamp-k8s/headlamp:v0.31.1"   # ops console (Headlamp)
  "ollama/ollama:0.6.8"                      # LLM runtime for the chatbot
  "registry.k8s.io/metrics-server/metrics-server:v0.7.2"  # HPA / kubectl top (scalability demo)
  # (oauth2-proxy image RETIRED 2026-07-11, #80 — replaced by nhdw/tool-gate.)
  # observability stack (#81) — Prometheus + Loki + Alertmanager + Promtail.
  "prom/prometheus:v2.53.2"                   # metrics server (topology RED, alerts.py, health widget)
  "grafana/loki:2.9.10"                       # log store (filesystem/boltdb-shipper), gateway LOKI_URL
  "grafana/promtail:2.9.10"                   # log shipper DaemonSet → Loki (per-node log tail)
  "prom/alertmanager:v0.27.0"                 # alert routing → external Google SMTP relay
)
# Every locally-built nhdw image currently in docker, EXCEPT archived dashboards
# (base-dashboard, submission-portal) that are no longer referenced by any manifest.
mapfile -t NHDW < <(docker images --format '{{.Repository}}:{{.Tag}}' \
  | grep '^nhdw/' | grep -vE '^nhdw/(base-dashboard|submission-portal|demo):' | sort)
# nhdw/demo is BUILD-ONLY now: the Demo Control Room moved out of k8s into
# bundle/demo-console (its SPA build is extracted from the image by
# extract-spa.sh); the image itself no longer ships in the bundle.

tarname(){ echo "$IMGDIR/$(echo "$1" | tr '/:' '__').tar"; }

# docker's containerd image store writes OCI-archive tars whose index.json can
# reference buildkit ATTESTATION manifests (and other platforms) that `docker save`
# does NOT include as blobs. `ctr images import` (what k3d runs in-node) then dies
# with `content digest sha256:... not found` — and a bulk `k3d image import` aborts
# EVERY image in the stream (observed cold-boot: 0/37 imported, all pods
# ImagePullBackOff). Strip the index down to the linux/amd64 manifest entries so
# the tar imports cleanly offline.
sanitize_tar(){ # tarfile
  python3 - "$1" <<'PYEOF'
import json, sys, tarfile, io, os, shutil
path = sys.argv[1]
try:
    with tarfile.open(path) as t:
        names = t.getnames()
        if "index.json" not in names:      # classic docker-archive — fine as-is
            sys.exit(0)
        idx = json.load(t.extractfile("index.json"))
        keep = []
        for m in idx.get("manifests", []):
            ann = m.get("annotations") or {}
            if ann.get("vnd.docker.reference.type") == "attestation-manifest":
                continue                    # not shipped by docker save → ctr fatal
            plat = m.get("platform") or {}
            if plat and plat.get("architecture") not in (None, "amd64", "unknown"):
                continue                    # non-amd64 platform we didn't save
            keep.append(m)
        if len(keep) == len(idx.get("manifests", [])):
            sys.exit(0)                     # nothing to strip
        idx["manifests"] = keep
        tmp = path + ".sanitized"
        with tarfile.open(tmp, "w") as out:
            for member in t.getmembers():
                if member.name == "index.json":
                    data = json.dumps(idx).encode()
                    member.size = len(data)
                    out.addfile(member, io.BytesIO(data))
                else:
                    out.addfile(member, t.extractfile(member) if member.isfile() else None)
    shutil.move(tmp, path)
    print(f"  sanitized {os.path.basename(path)} (stripped attestation/foreign-platform refs)")
except Exception as exc:
    print(f"  ! sanitize skipped for {os.path.basename(path)}: {exc}")
PYEOF
}

# Is this a Docker Hub image (so a mirror.gcr.io fallback exists)?
is_hub(){ local f="${1%%/*}"; [[ "$1" != */* ]] && return 0; [[ "$f" != *.* && "$f" != *:* ]] && return 0; return 1; }
mirror_name(){ if [[ "$1" != */* ]]; then echo "mirror.gcr.io/library/$1"; else echo "mirror.gcr.io/$1"; fi; }

# Pull with: timeout-wrapped attempts (a hung pull is killed and retried,
# resuming already-cached layers), then a mirror.gcr.io fallback for Docker
# Hub images (different CDN) retagged back to the canonical name.
pull_image(){
  local img="$1" a m
  docker image inspect "$img" >/dev/null 2>&1 && return 0
  for a in 1 2 3 4 5; do
    timeout 200 docker pull -q "$img" >/dev/null 2>&1 && return 0
    echo "  direct retry $a/5 for $img"; sleep 4
  done
  if is_hub "$img"; then
    m="$(mirror_name "$img")"; echo "  falling back to mirror: $m"
    for a in 1 2 3 4; do
      if timeout 200 docker pull -q "$m" >/dev/null 2>&1; then docker tag "$m" "$img" && return 0; fi
      echo "  mirror retry $a/4 for $m"; sleep 4
    done
  fi
  return 1
}

ALL=( "${PUBLIC[@]}" "${NHDW[@]}" )
IMPORT=()
for img in "${ALL[@]}"; do
  tar="$(tarname "$img")"
  if [ "$MODE" = load ]; then
    # OFFLINE-FIRST: the bundle tars are the PRIMARY image source. Precedence:
    #   1. image already in the daemon (never let a stale tar overwrite it)
    #   2. docker load from the bundle tar          ← the normal offline path
    #   3. remote pull, LOUDLY, only as a last resort (tar missing/corrupt) —
    #      a complete bundle never reaches this branch.
    if docker image inspect "$img" >/dev/null 2>&1; then
      echo "have $img (daemon)"
    elif [ -f "$tar" ] && docker load -i "$tar" >/dev/null 2>&1 \
         && docker image inspect "$img" >/dev/null 2>&1; then
      echo "load $img"
    else
      [ -f "$tar" ] && echo "  ! tar for $img failed to load (corrupt?) — falling back to remote pull" \
                    || echo "  ! no tarball for $img — falling back to remote pull (bundle incomplete)"
      pull_image "$img" && echo "  pulled $img (FIX THE BUNDLE: re-run cache-images.sh --save-only)" \
        || echo "  ✗ $img unavailable (no tar, no network) — dependent pods will not start"
    fi
  else
    if ! docker image inspect "$img" >/dev/null 2>&1; then
      echo "pull $img"
      pull_image "$img" || { echo "  ! pull FAILED (direct+mirror): $img"; continue; }
      echo "  pulled $img"
    fi
    # --platform linux/amd64: multi-arch (manifest-list) images like trinodb/trino
    # otherwise save as an index that k3d/ctr import as index-only → ErrImageNeverPull.
    if [ ! -f "$tar" ]; then echo "save $img"
      docker save --platform linux/amd64 "$img" -o "$tar" 2>/dev/null \
        || docker save "$img" -o "$tar" 2>/dev/null
      sanitize_tar "$tar"; fi
  fi
  docker image inspect "$img" >/dev/null 2>&1 && IMPORT+=("$img")
done

echo "==> cached $(ls "$IMGDIR"/*.tar 2>/dev/null | wc -l) tarballs in $IMGDIR ($(du -sh "$IMGDIR" 2>/dev/null | cut -f1))"

if [ "$MODE" != save ] && [ ${#IMPORT[@]} -gt 0 ]; then
  echo "==> importing ${#IMPORT[@]} images into k3d cluster '$CLUSTER'..."
  # Import FROM THE SANITIZED TAR whenever one exists. Importing by NAME makes
  # k3d `docker save` from the daemon on the fly — and the daemon's containerd
  # store emits attestation-manifest refs that in-node `ctr` fatals on
  # ("content digest ... not found"). Observed: every multi-arch public image
  # failed a name-based import while its sanitized tar imported cleanly — and
  # the pods then silently pulled from the network (offline-first violation).
  # --mode direct loads straight into each node's containerd (the tools-node
  # mode can report success without the images actually landing).
  BULK=()
  for img in "${IMPORT[@]}"; do
    tar="$(tarname "$img")"
    if [ -f "$tar" ]; then BULK+=("$tar"); else BULK+=("$img"); fi
  done
  if ! k3d image import "${BULK[@]}" --cluster "$CLUSTER" --mode direct >/dev/null 2>&1; then
    # Bulk is ALL-OR-NOTHING per stream — fall back per image, loudly.
    echo "  ! bulk import failed — retrying per image to isolate the bad one(s)"
    for img in "${IMPORT[@]}"; do
      tar="$(tarname "$img")"
      src="$img"; [ -f "$tar" ] && src="$tar"
      if k3d image import "$src" --cluster "$CLUSTER" --mode direct >/dev/null 2>&1; then
        echo "    ✓ $img"
      else
        echo "    ✗ IMPORT FAILED: $img (corrupt tar? regenerate: rm the tar + cache-images.sh --save-only)"
      fi
    done
  fi
fi
echo "==> done"
