#!/usr/bin/env bash
# build-images.sh — build every locally-built NHDW image with plain `docker build`
# (NO docker compose, build or runtime) and optionally import them into the k3d
# cluster so the Kubernetes deploy can pull them with imagePullPolicy: IfNotPresent.
#
# Usage:
#   build-images.sh                 # build all images
#   build-images.sh --import        # build, then `k3d image import` into cluster
#   build-images.sh --cluster=nhdw  # target a specific k3d cluster (default: nhdw)
#   build-images.sh --only=gateway,admin,demo,workshop   # build a subset
#
# This is the build half of the one-script bootstrap. The compose files are NOT
# used; the image->context->dockerfile mapping is encoded directly below so the
# delivered artifact has zero docker-compose dependency in any path.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"

CLUSTER=nhdw
DO_IMPORT=0
ONLY=""
for arg in "$@"; do
  case "$arg" in
    --import)     DO_IMPORT=1 ;;
    --cluster=*)  CLUSTER="${arg#--cluster=}" ;;
    --only=*)     ONLY="${arg#--only=}" ;;
    -h|--help)    sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# image | context (relative to repo root) | dockerfile (relative to context)
# Order: base-dashboard before sibling dashboards (FROM dependency); platform
# images first, then pipeline (dbt/ingestor/ml) images.
IMAGES=(
  # --- platform / access ---
  "nhdw/keycloak:1.0.0|7_security/keycloak|Dockerfile"
  "nhdw/mlflow:1.0.0|2_pipelines/ml/registry|Dockerfile"
  # NOTE: the LLM is an EXTERNAL component now (0_external/llm/) — the default path
  # runs stock ollama/ollama:0.6.8 (a bundled public image) with the weights in
  # 0_external/llm/models mounted directly, so there is NO custom LLM image to build
  # here. The baked-weights nhdw/ollama-model image is for the BARE-METAL in-cluster
  # recipe ONLY; build it by hand when using that recipe:
  #   docker build -t nhdw/ollama-model:1.0.0 -f 0_external/llm/image/Dockerfile 0_external/llm/models
  "nhdw/airflow:1.0.0|5_orchestrator|Dockerfile"
  "nhdw/fayda-replica:1.0.0|0_external/fayda|Dockerfile"
  "nhdw/gateway:1.0.0|6_access-points/api/nhdw-gateway|Dockerfile"
  "nhdw/fhir-mediator:1.0.0|6_access-points/api/openhim/mediator|Dockerfile"
  "nhdw/jupyterhub:1.0.0|6_access-points/jupyterhub|Dockerfile"
  "nhdw/jupyterlab:1.0.0|6_access-points/jupyterhub/singleuser|Dockerfile"
  "nhdw/public-dashboard:1.0.0|6_access-points/dashboards/public|Dockerfile"
  "nhdw/dbt-docs:1.0.0|6_access-points/dashboards/dbt-docs|Dockerfile"
  "nhdw/superset:1.0.0|6_access-points/dashboards/superset|Dockerfile"
  "nhdw/tool-gate:1.0.0|6_access-points/api/tool-gate|Dockerfile"
  "nhdw/admin:1.0.0|6_access-points/dashboards|admin/Dockerfile"
  "nhdw/workshop:1.0.0|6_access-points/dashboards|workshop/Dockerfile"
  "nhdw/internal-bi:1.0.0|6_access-points/dashboards|internal-bi/Dockerfile"
  # --- pipeline: lake seed, dbt, bridge ---
  "nhdw/staging-dbt:1.0.0|2_pipelines/staging|Dockerfile"
  "nhdw/vault-dbt:1.0.0|2_pipelines/vault|Dockerfile"
  "nhdw/vault-bridge:1.0.0|2_pipelines/vault/bridge|Dockerfile"
  "nhdw/marts-dbt:1.0.0|2_pipelines/marts|Dockerfile"
  "nhdw/ml-runner:1.0.0|2_pipelines/ml/runner|Dockerfile"
  # --- pipeline: source ingestors ---
  "nhdw/dhis2-ingestor:1.0.0|2_pipelines/ingestor/DHIS2|Dockerfile"
  "nhdw/ethioemr-ingestor:1.0.0|2_pipelines/ingestor/EthioEMR|Dockerfile"
  "nhdw/hcmiswdm-ingestor:1.0.0|2_pipelines/ingestor/HCMISWDM|Dockerfile"
  "nhdw/mbrana-ingestor:1.0.0|2_pipelines/ingestor/mBrana|Dockerfile"
  "nhdw/mfr-ingestor:1.0.0|2_pipelines/ingestor/MFR|Dockerfile"
  "nhdw/climate-ingestor:1.0.0|2_pipelines/ingestor/Climate|Dockerfile"
)

BUILT=()
FAILED=()
for entry in "${IMAGES[@]}"; do
  IFS='|' read -r img ctx df <<< "$entry"
  short="${img#nhdw/}"; short="${short%:dev}"
  if [ -n "$ONLY" ] && [[ ",$ONLY," != *",$short,"* ]]; then continue; fi
  if [ ! -f "$REPO/$ctx/$df" ]; then
    echo "✗ $img — Dockerfile not found at $ctx/$df" >&2
    FAILED+=("$img(no-dockerfile)"); continue
  fi
  # nhdw/gateway bakes in the model-graduation validator harness, whose
  # canonical home is 2_pipelines/ml/registry/validators.py (single source of
  # truth). Docker COPY can't reach outside the build context, so stage it
  # into the context here (transient, gitignored) right before the build.
  if [ "$img" = "nhdw/gateway:1.0.0" ]; then
    cp "$REPO/2_pipelines/ml/registry/validators.py" \
       "$REPO/6_access-points/api/nhdw-gateway/validators.py"
  fi
  echo "==> building $img  (ctx=$ctx df=$df)"
  if docker build -t "$img" -f "$REPO/$ctx/$df" "$REPO/$ctx" >/tmp/build-"$short".log 2>&1; then
    BUILT+=("$img")
    echo "    ok"
  else
    echo "✗ build failed: $img (see /tmp/build-$short.log)" >&2
    tail -5 /tmp/build-"$short".log | sed 's/^/    /'
    FAILED+=("$img(build)")
  fi
done

echo
echo "==> built ${#BUILT[@]}: ${BUILT[*]:-none}"
[ ${#FAILED[@]} -gt 0 ] && echo "==> FAILED ${#FAILED[@]}: ${FAILED[*]}" >&2

if [ "$DO_IMPORT" = 1 ] && [ ${#BUILT[@]} -gt 0 ]; then
  echo "==> importing ${#BUILT[@]} images into k3d cluster '$CLUSTER'..."
  k3d image import "${BUILT[@]}" --cluster "$CLUSTER" 2>&1 | tail -5
fi

[ ${#FAILED[@]} -eq 0 ]
