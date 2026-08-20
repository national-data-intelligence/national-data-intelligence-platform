#!/usr/bin/env bash
# ci-redeploy.sh — push-to-main redeploy for the live k3s cluster.
#
# Given a set of changed files (git diff of the push, or "all"), it rebuilds only
# the affected images, imports them into k3s' containerd, restarts the affected
# workloads, reseeds catalog/RBAC when the catalog or security seeds changed, and
# runs the system verifier. This is the deterministic core the GitHub Actions
# `deploy.yml` calls on a self-hosted runner that lives ON the k3s host (so it has
# docker + kubectl + repo). Safe to run by hand: bundle/scripts/ci-redeploy.sh all
#
# It is IDEMPOTENT and additive — it never provisions or wipes; the from-bare
# provisioning path is the ansible `site.yml` (workflow `provision.yml`).
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NS="${NS:-nhdw}"
DASH_CTX="$REPO/6_access-points/dashboards"

# component map:  <path-prefix> | <image> | <dockerfile (rel to context)> | <context> | <deploy>
COMPONENTS=(
  "6_access-points/dashboards/internal-bi|nhdw/internal-bi:1.0.0|internal-bi/Dockerfile|$DASH_CTX|internal-bi"
  "6_access-points/dashboards/public|nhdw/public-dashboard:1.0.0|public/Dockerfile|$DASH_CTX|public-dashboard"
  "6_access-points/dashboards/admin|nhdw/admin:1.0.0|admin/Dockerfile|$DASH_CTX|admin"
  "6_access-points/dashboards/workshop|nhdw/workshop:1.0.0|workshop/Dockerfile|$DASH_CTX|workshop"
  "6_access-points/api/nhdw-gateway|nhdw/nhdw-gateway:1.0.0|Dockerfile|$REPO/6_access-points/api/nhdw-gateway|nhdw-gateway"
)
# paths whose change triggers a catalog/RBAC reseed (no image rebuild)
RESEED_GLOBS=("6_access-points/dashboards/internal-bi/catalog" "bundle/seed-pack/app/security" "6_access-points/dashboards/public/static/articles")

changed_input="${1:-all}"
if [ "$changed_input" = "all" ]; then
  CHANGED="$(git -C "$REPO" ls-files)"
else
  CHANGED="$changed_input"   # newline/space separated list of paths
fi

log(){ echo "▸ $*"; }
touched(){ echo "$CHANGED" | grep -q -- "$1"; }

BUILT=(); RESTART=()
for c in "${COMPONENTS[@]}"; do
  IFS='|' read -r prefix image dockerfile context deploy <<<"$c"
  if [ "$changed_input" = "all" ] || touched "$prefix"; then
    log "build $image  (context $context)"
    if docker build -t "$image" -f "$context/$dockerfile" "$context" >/tmp/ci-build-$deploy.log 2>&1; then
      docker save "$image" | sudo k3s ctr images import - >/dev/null 2>&1 || docker save "$image" | k3s ctr images import - >/dev/null 2>&1
      BUILT+=("$image"); RESTART+=("$deploy")
    else
      echo "  ✗ build failed for $image — see /tmp/ci-build-$deploy.log"; tail -20 /tmp/ci-build-$deploy.log; exit 1
    fi
  fi
done

for d in "${RESTART[@]}"; do
  log "rollout restart deploy/$d"
  kubectl -n "$NS" rollout restart "deploy/$d" >/dev/null 2>&1 || true
done
for d in "${RESTART[@]}"; do
  kubectl -n "$NS" rollout status "deploy/$d" --timeout=180s 2>&1 | tail -1
done

RESEED=0
for g in "${RESEED_GLOBS[@]}"; do touched "$g" && RESEED=1; done
if [ "$changed_input" = "all" ] || [ "$RESEED" = 1 ]; then
  log "reseed catalog + app/security (idempotent)"
  bash "$REPO/bundle/scripts/seed-app-security.sh" 2>&1 | tail -5
  kubectl -n "$NS" rollout restart deploy/nhdw-gateway >/dev/null 2>&1 || true
  kubectl -n "$NS" rollout status deploy/nhdw-gateway --timeout=120s 2>&1 | tail -1
fi

log "verify"
if [ -x "$REPO/bundle/scripts/verify-system.sh" ]; then
  bash "$REPO/bundle/scripts/verify-system.sh" 2>&1 | tail -20 || echo "  (verify reported issues — review above)"
fi
log "done. built: ${BUILT[*]:-none}  reseed: $([ "$RESEED" = 1 ] || [ "$changed_input" = all ] && echo yes || echo no)"
