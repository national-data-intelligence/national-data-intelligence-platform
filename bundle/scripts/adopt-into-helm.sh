#!/usr/bin/env bash
# adopt-into-helm.sh — let the Helm chart take ownership of resources that are
# already on the cluster.
#
# WHY THIS EXISTS. The repo has two bring-up mechanisms: the kustomize overlay
# (what the laptop bootstrap and early hand-deploys used) and the Helm chart
# (what ansible `site.yml` deploys). A namespace brought up by the first cannot
# be upgraded by the second: Helm refuses to touch a resource it does not own —
#
#   Error: Unable to continue with install: ServiceAccount "airflow" in namespace
#   "nhdw" exists and cannot be imported into the current release: invalid
#   ownership metadata; label validation error: missing key
#   "app.kubernetes.io/managed-by": must be set to "Helm" ...
#
# — which is exactly where the first from-bare provision of palladium2 stopped.
#
# The alternative is deleting the namespace so Helm creates everything fresh.
# That is a true cold start, but it also destroys the Postgres PVC (rebuildable
# from the sources) AND hand-held state that is NOT reproducible — notably the
# OpenMetadata ingestion-bot token, which a human has to regenerate in the OM UI.
# Adopting is non-destructive and fixes the underlying split: afterwards the
# cluster really is Helm-managed and provisioning is repeatable.
#
# Adoption is just metadata: Helm identifies its resources by one label and two
# annotations. This stamps them on every resource the chart renders that already
# exists, and touches nothing else.
#
# Usage:
#   bundle/scripts/adopt-into-helm.sh [--dry-run]
# Env:
#   NS              namespace                (default nhdw)
#   RELEASE         helm release name        (default nhdw)
#   CHART           chart dir                (default 1_infrastructure/helm/nhdw)
#   VALUES          extra values file        (optional)
#   NHDW_HOSTBASE   hostBase passed to the render (default 127.0.0.1.nip.io)
#   HELM            helm binary              (default: first on PATH)
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NS="${NS:-nhdw}"
RELEASE="${RELEASE:-nhdw}"
CHART="${CHART:-$REPO/1_infrastructure/helm/nhdw}"
HELM="${HELM:-$(command -v helm || echo /usr/local/bin/helm)}"
HOSTBASE="${NHDW_HOSTBASE:-127.0.0.1.nip.io}"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

command -v kubectl >/dev/null || { echo "kubectl not found" >&2; exit 2; }
[ -x "$HELM" ] || { echo "helm not found at $HELM" >&2; exit 2; }

render="$(mktemp)"; trap 'rm -f "$render"' EXIT
args=(template "$RELEASE" "$CHART" -n "$NS" --set "hostBase=$HOSTBASE")
[ -n "${VALUES:-}" ] && args+=(-f "$VALUES")
if ! "$HELM" "${args[@]}" > "$render" 2>/tmp/adopt-render.err; then
  echo "✗ chart render failed:" >&2; tail -10 /tmp/adopt-render.err >&2; exit 1
fi

adopted=0; already=0; absent=0
while read -r kind name; do
  [ -z "$kind" ] && continue
  # cluster-scoped kinds are not namespaced; kubectl tolerates -n on them
  if ! kubectl -n "$NS" get "$kind" "$name" >/dev/null 2>&1; then
    absent=$((absent + 1)); continue
  fi
  mb="$(kubectl -n "$NS" get "$kind" "$name" \
        -o jsonpath='{.metadata.labels.app\.kubernetes\.io/managed-by}' 2>/dev/null)"
  rn="$(kubectl -n "$NS" get "$kind" "$name" \
        -o jsonpath='{.metadata.annotations.meta\.helm\.sh/release-name}' 2>/dev/null)"
  if [ "$mb" = "Helm" ] && [ "$rn" = "$RELEASE" ]; then
    already=$((already + 1)); continue
  fi
  echo "  adopt $kind/$name"
  if [ "$DRY" = 0 ]; then
    kubectl -n "$NS" label      "$kind" "$name" "app.kubernetes.io/managed-by=Helm" --overwrite >/dev/null
    kubectl -n "$NS" annotate   "$kind" "$name" "meta.helm.sh/release-name=$RELEASE" \
                                                "meta.helm.sh/release-namespace=$NS" --overwrite >/dev/null
  fi
  adopted=$((adopted + 1))
done < <(python3 -c '
import sys, yaml
for d in yaml.safe_load_all(open(sys.argv[1])):
    if d and d.get("kind") and d.get("metadata", {}).get("name"):
        print(d["kind"].lower(), d["metadata"]["name"])
' "$render" | sort -u)

echo
echo "== adopt: $adopted stamped · $already already owned · $absent not on the cluster =="
[ "$DRY" = 1 ] && echo "(dry run — nothing changed)"
exit 0
