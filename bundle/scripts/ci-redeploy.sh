#!/usr/bin/env bash
# ci-redeploy.sh — push-driven redeploy for the live k3s cluster (main + develop).
#
# Given a set of changed files (git diff of the push, or "all"), it deploys only
# what changed:
#   * APP TIER   — rebuild the affected SPA/gateway images, import into k3s,
#                  restart the workloads; reseed catalog/RBAC when those changed.
#   * DATA TIER  — apply new/changed Postgres init DDL (idempotent by contract),
#                  reload the nhdw_ref vocabulary when its seeds changed, rebuild
#                  the affected dbt/bridge images, and rerun the dbt job chain
#                  from the earliest affected stage THROUGH dbt-marts (a vault
#                  run drops the report views until marts rebuilds them — never
#                  end the chain early).
# Then runs the system verifier. This is the deterministic core the GitHub
# Actions `deploy.yml` calls on a self-hosted runner that lives ON the k3s host
# (so it has docker + kubectl + repo). Safe to run by hand:
#   bundle/scripts/ci-redeploy.sh all
#
# It is IDEMPOTENT and additive — it never provisions or wipes; the from-bare
# provisioning path is the ansible `site.yml` (workflow `provision.yml`).
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NS="${NS:-nhdw}"
DASH_CTX="$REPO/6_access-points/dashboards"
export PATH="$HOME/.local/bin:$PATH"   # kustomize on the runner

# component map:  <path-prefix> | <image> | <dockerfile (rel to context)> | <context> | <deploy>
COMPONENTS=(
  "6_access-points/dashboards/internal-bi|nhdw/internal-bi:1.0.0|internal-bi/Dockerfile|$DASH_CTX|internal-bi"
  "6_access-points/dashboards/public|nhdw/public-dashboard:1.0.0|Dockerfile|$DASH_CTX/public|public-dashboard"
  "6_access-points/dashboards/admin|nhdw/admin:1.0.0|admin/Dockerfile|$DASH_CTX|admin"
  "6_access-points/dashboards/workshop|nhdw/workshop:1.0.0|workshop/Dockerfile|$DASH_CTX|workshop"
  "6_access-points/api/nhdw-gateway|nhdw/gateway:1.0.0|Dockerfile|$REPO/6_access-points/api/nhdw-gateway|nhdw-gateway"
)
# paths whose change triggers a catalog/RBAC reseed (no image rebuild)
RESEED_GLOBS=("6_access-points/dashboards/internal-bi/catalog" "bundle/seed-pack/app/security" "6_access-points/dashboards/public/static/articles" "7_security/scripts/")

changed_input="${1:-all}"
if [ "$changed_input" = "all" ]; then
  CHANGED="$(git -C "$REPO" ls-files)"
else
  # One path per line, whatever the caller sent (deploy.yml passes a space-
  # separated string) — the DDL loop and the bridge/vault disambiguation use
  # line-anchored greps, which silently match NOTHING against a single line.
  CHANGED="$(printf '%s\n' $changed_input)"
fi

log(){ echo "▸ $*"; }
touched(){ echo "$CHANGED" | grep -q -- "$1"; }

# ── DATA TIER, part 1: schema + vocabulary FIRST ─────────────────────────────
# DDL and the vocabulary reload run BEFORE the app tier: the catalog/RBAC
# reseed loads column_classification.yaml (and future seeds) into tables this
# DDL may have just created — order is load-bearing.

# 1. New/changed Postgres init DDL — the .sql files are idempotent by repo
#    contract (IF NOT EXISTS everywhere), and Postgres only auto-runs init on a
#    fresh volume, so the CI applies changed ones to the live DB. (.sh init
#    files create databases/roles from env and stay boot-only — flagged, not run.)
DDL_APPLIED=(); DDL_VAULT=()
for f in $(echo "$CHANGED" | grep -E '^3_storage/postgres/init/.*\.sql$' | sort); do
  [ -f "$REPO/$f" ] || continue     # deleted file
  log "apply init DDL $f (idempotent)"
  if kubectl -n "$NS" exec -i postgres-vault-0 -- psql -q -U vault_admin -d nhdw_vault -v ON_ERROR_STOP=1 < "$REPO/$f" >/tmp/ci-ddl.log 2>&1; then
    DDL_APPLIED+=("$f")
    # ops-side files (\connect nhdw_ops) don't touch what dbt reads — only
    # vault-side DDL needs the vault→marts job cascade
    grep -q '^\\connect nhdw_ops' "$REPO/$f" || DDL_VAULT+=("$f")
  else
    echo "  ✗ DDL apply failed for $f"; tail -10 /tmp/ci-ddl.log; exit 1
  fi
done
echo "$CHANGED" | grep -qE '^3_storage/postgres/init/.*\.sh$' \
  && log "NOTE: changed init .sh (db/role bootstrap) — boot-only, apply by hand if a new database is needed"

# 2. Reference vocabulary reload when its seeds changed (idempotent upsert).
if touched "bundle/seeds/ref-vocab/"; then
  log "reload nhdw_ref vocabulary"
  bash "$REPO/bundle/scripts/seed-ref-vocab.sh" --no-build 2>&1 | tail -3 || { echo "  ✗ vocab reload failed"; exit 1; }
fi


BUILT=(); RESTART=()
for c in "${COMPONENTS[@]}"; do
  IFS='|' read -r prefix image dockerfile context deploy <<<"$c"
  hit=0
  if [ "$changed_input" = "all" ] || touched "$prefix"; then hit=1; fi
  # the gateway bakes in the validator harness from outside its context —
  # a change to the canonical source must rebuild it too
  if [ "$image" = "nhdw/gateway:1.0.0" ] && touched "2_pipelines/ml/registry/validators.py"; then hit=1; fi
  if [ "$hit" = 1 ]; then
    # nhdw/gateway bakes in the graduation validator harness — canonical home
    # 2_pipelines/ml/registry/validators.py; COPY can't reach outside the
    # build context, so stage it (transient, gitignored) exactly like
    # build-images.sh does. Fresh CI checkouts don't carry the staged copy.
    if [ "$image" = "nhdw/gateway:1.0.0" ]; then
      cp "$REPO/2_pipelines/ml/registry/validators.py" \
         "$REPO/6_access-points/api/nhdw-gateway/validators.py"
    fi
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
  # a failed seed must fail the deploy — never swallow the loader's exit code
  if ! bash "$REPO/bundle/scripts/seed-app-security.sh" >/tmp/ci-reseed.log 2>&1; then
    echo "  ✗ catalog/RBAC reseed FAILED"; tail -40 /tmp/ci-reseed.log; exit 1
  fi
  tail -5 /tmp/ci-reseed.log
  kubectl -n "$NS" rollout restart deploy/nhdw-gateway >/dev/null 2>&1 || true
  kubectl -n "$NS" rollout status deploy/nhdw-gateway --timeout=120s 2>&1 | tail -1
fi

# ── DATA TIER (images + job chain; DDL/vocab already applied above) ──────────

# 3. Pipeline images + the dbt job chain. Map: <path-prefix>|<image>|<job>|<stage#>
#    Stage order mirrors seed-realistic's PIPELINE; a change at stage N reruns
#    N..marts (downstream models read upstream schemas; marts always last so the
#    report views the vault run drops are restored).
PIPELINE=(
  "2_pipelines/staging|nhdw/staging-dbt:1.0.0|dbt-staging|1"
  "2_pipelines/vault/bridge|nhdw/vault-bridge:1.0.0|bridge-sync|2"
  "2_pipelines/vault|nhdw/vault-dbt:1.0.0|dbt-vault|3"
  "2_pipelines/marts|nhdw/marts-dbt:1.0.0|dbt-marts|4"
)
first_stage=99
PIPE_BUILT=()
for p in "${PIPELINE[@]}"; do
  IFS='|' read -r prefix image job stage <<<"$p"
  hit=0
  if [ "$changed_input" = "all" ] || touched "$prefix"; then hit=1; fi
  # bridge is a subpath of vault: a pure-bridge change must not also count as vault
  if [ "$hit" = 1 ] && [ "$changed_input" != "all" ] && [ "$prefix" = "2_pipelines/vault" ] \
     && ! echo "$CHANGED" | grep -E '^2_pipelines/vault' | grep -vq '^2_pipelines/vault/bridge'; then hit=0; fi
  if [ "$hit" = 1 ]; then
    log "build $image"
    if docker build -t "$image" -f "$REPO/$prefix/Dockerfile" "$REPO/$prefix" >/tmp/ci-build-$job.log 2>&1; then
      docker save "$image" | sudo k3s ctr images import - >/dev/null 2>&1 \
        || docker save "$image" | k3s ctr images import - >/dev/null 2>&1
      PIPE_BUILT+=("$image")
      [ "$stage" -lt "$first_stage" ] && first_stage=$stage
    else
      echo "  ✗ build failed for $image — see /tmp/ci-build-$job.log"; tail -20 /tmp/ci-build-$job.log; exit 1
    fi
  fi
done
# vocab/vault-side-DDL changes re-derive the vault even with no image rebuilt
{ touched "bundle/seeds/ref-vocab/" || [ ${#DDL_VAULT[@]} -gt 0 ]; } && [ "$first_stage" -gt 3 ] && first_stage=3

run_job(){ # $1=job name  $2=timeout
  kustomize build --load-restrictor=LoadRestrictionsNone "$REPO/1_infrastructure/k8s/jobs" | \
    python3 -c "
import sys, yaml
for d in yaml.safe_load_all(sys.stdin):
    if d and d.get('kind')=='Job' and d['metadata']['name']=='$1':
        print(yaml.safe_dump(d)); break
" > /tmp/ci-job-$1.yaml
  [ -s /tmp/ci-job-$1.yaml ] || { echo "  ✗ job $1 not found in the jobs kustomization"; exit 1; }
  log "rerun job $1"
  kubectl -n "$NS" delete job "$1" --ignore-not-found >/dev/null 2>&1
  kubectl -n "$NS" apply -f /tmp/ci-job-$1.yaml >/dev/null
  kubectl -n "$NS" wait --for=condition=complete "job/$1" --timeout="$2s" \
    || { echo "  ✗ job $1 did not complete"; kubectl -n "$NS" logs "job/$1" --tail=25; exit 1; }
}

if [ "$first_stage" -le 4 ]; then
  [ "$first_stage" -le 1 ] && run_job dbt-staging 1200
  [ "$first_stage" -le 2 ] && run_job bridge-sync 1800
  [ "$first_stage" -le 3 ] && run_job dbt-vault 2400
  run_job dbt-marts 2400
fi

# 4. MDM side-lane. Rebuild on its own change; rerun the candidate generation
#    whenever its code changed OR the vault content moved (candidates derive
#    from the resolution view). Idempotent — decided candidates never touched.
MDM_RUN=0
if [ "$changed_input" = "all" ] || touched "2_pipelines/mdm/"; then
  log "build nhdw/mdm-matcher:1.0.0"
  if docker build -t nhdw/mdm-matcher:1.0.0 -f "$REPO/2_pipelines/mdm/Dockerfile" "$REPO/2_pipelines/mdm" >/tmp/ci-build-mdm-matcher.log 2>&1; then
    docker save nhdw/mdm-matcher:1.0.0 | sudo k3s ctr images import - >/dev/null 2>&1 \
      || docker save nhdw/mdm-matcher:1.0.0 | k3s ctr images import - >/dev/null 2>&1
    PIPE_BUILT+=("nhdw/mdm-matcher:1.0.0"); MDM_RUN=1
  else
    echo "  ✗ build failed for nhdw/mdm-matcher:1.0.0"; tail -20 /tmp/ci-build-mdm-matcher.log; exit 1
  fi
fi
[ "$first_stage" -le 3 ] && MDM_RUN=1
[ "$MDM_RUN" = 1 ] && run_job mdm-matcher 420

log "verify"
if [ -x "$REPO/bundle/scripts/verify-system.sh" ]; then
  bash "$REPO/bundle/scripts/verify-system.sh" 2>&1 | tail -20 || echo "  (verify reported issues — review above)"
fi
log "done. app built: ${BUILT[*]:-none}  pipeline built: ${PIPE_BUILT[*]:-none}  ddl: ${DDL_APPLIED[*]:-none}  reseed: $([ "$RESEED" = 1 ] || [ "$changed_input" = all ] && echo yes || echo no)"
