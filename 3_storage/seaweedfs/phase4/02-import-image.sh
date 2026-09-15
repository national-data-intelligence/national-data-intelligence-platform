#!/usr/bin/env bash
# Phase 4 step 2 (OPTIONAL) — pre-import the image into k3s containerd (needs ROOT).
# Pre-flight 2026-09-07 showed k3s pulls chrislusf/seaweedfs:4.45 from Docker Hub by
# itself in ~5 s, so this is only for the OFFLINE bundle convention, not a blocker.
# Same root limitation as ci-redeploy.sh:45 — run it yourself if you want the pre-import.
# Skip if you are happy for k3s to pull chrislusf/seaweedfs:4.45 from Docker Hub;
# the offline-bundle convention (cache-images.sh) is to pre-import.
set -euo pipefail
IMG=chrislusf/seaweedfs:4.45
docker image inspect "$IMG" >/dev/null 2>&1 || docker pull "$IMG"
docker save "$IMG" | sudo k3s ctr images import - 
sudo k3s ctr images ls | grep -q seaweedfs && echo "✓ $IMG present in k3s containerd" || { echo "!! import failed"; exit 1; }
