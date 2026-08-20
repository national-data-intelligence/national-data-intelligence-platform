#!/usr/bin/env bash
# Fetch the k3s SYSTEM images the k3d node needs but does NOT embed, so a TRULY OFFLINE boot
# never reaches out to docker.io / registry.k8s.io for them. Without this, a fresh cluster on a
# machine that can't reach those registries hangs at the pause/coredns sandbox image (observed
# 2026-08-04 during a docker.io outage). Maintainer-run (needs internet); ships the tars in the
# bundle under bundle/images/system/. The provision step (Ansible + bootstrap.sh) imports them
# right after cluster-create, before anything schedules.
#
# Versions are PINNED to the k3s node image (K3S_IMAGE below, which provision + bootstrap pin to
# the SAME value). Re-run after bumping k3s, then re-derive the list from a running node:
#   docker exec k3d-<cluster>-server-0 crictl images | grep -E 'rancher/(mirrored|klipper|local-path)'
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$REPO/bundle/images/system"
mkdir -p "$OUT"

# k3s node image these system images belong to (keep in sync with provision/bootstrap).
K3S_IMAGE="${K3S_IMAGE:-rancher/k3s:v1.35.5-k3s1}"
echo "System images for $K3S_IMAGE -> $OUT"

# Strip the attestation-manifest + foreign-platform refs that modern `docker save` writes into
# index.json — they reference blobs the tar omits, so the in-node `ctr import` fatals with
# "content digest not found". Mirrors bundle/scripts/cache-images.sh's sanitize_tar.
sanitize_tar() { python3 - "$1" <<'PYEOF'
import json, sys, tarfile, io, os, shutil
path = sys.argv[1]
try:
    with tarfile.open(path) as t:
        if "index.json" not in t.getnames():
            sys.exit(0)
        idx = json.load(t.extractfile("index.json"))
        keep = []
        for m in idx.get("manifests", []):
            ann = m.get("annotations") or {}
            if ann.get("vnd.docker.reference.type") == "attestation-manifest":
                continue
            plat = m.get("platform") or {}
            if plat and plat.get("architecture") not in (None, "amd64", "unknown"):
                continue
            keep.append(m)
        if len(keep) == len(idx.get("manifests", [])):
            sys.exit(0)
        idx["manifests"] = keep
        tmp = path + ".sanitized"
        with tarfile.open(tmp, "w") as out:
            for member in t.getmembers():
                if member.name == "index.json":
                    data = json.dumps(idx).encode(); member.size = len(data)
                    out.addfile(member, io.BytesIO(data))
                else:
                    out.addfile(member, t.extractfile(member) if member.isfile() else None)
    shutil.move(tmp, path)
    print(f"  sanitized {os.path.basename(path)}")
except Exception as exc:
    print(f"  ! sanitize skipped for {os.path.basename(path)}: {exc}")
PYEOF
}

save_img() { # image  outfile
  docker pull -q "$1" >/dev/null
  docker save --platform linux/amd64 "$1" -o "$2" 2>/dev/null || docker save "$1" -o "$2"
  sanitize_tar "$2"
}

IMAGES=(
  rancher/mirrored-pause:3.6
  rancher/mirrored-coredns-coredns:1.14.3
  rancher/mirrored-library-traefik:3.6.13
  rancher/klipper-helm:v0.10.0-build20260513
  rancher/klipper-lb:v0.4.17
  rancher/local-path-provisioner:v0.0.36
  rancher/mirrored-library-busybox:1.37.0
)

for img in "${IMAGES[@]}"; do
  fn="$(echo "$img" | tr '/:' '__').tar"
  if [ -f "$OUT/$fn" ]; then echo "  ✓ have $fn"; continue; fi
  echo "  ▸ pull + save $img"
  save_img "$img" "$OUT/$fn"
done

# The k3s NODE image itself (docker-level, not imported into the cluster) — so `k3d cluster
# create --image $K3S_IMAGE` works offline. Distinct "node-" prefix; provision docker-loads it.
node_fn="node-$(echo "$K3S_IMAGE" | tr '/:' '__').tar"
if [ ! -f "$OUT/$node_fn" ]; then
  echo "  ▸ pull + save node image $K3S_IMAGE"
  save_img "$K3S_IMAGE" "$OUT/$node_fn"
fi
echo "✓ $(ls "$OUT"/*.tar | wc -l) tars in $OUT (7 in-cluster system + 1 node image)"
