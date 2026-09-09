#!/usr/bin/env bash
# seed-ml.sh — boot step 7.5: seed the ML tier from bundle/seed-pack/app/ml/.
#
# The SINGLE ingestion path (plan Part B): seed packages take the SAME road a
# community upload takes — package → MinIO ml-packages/<name>/current/ →
# runner train Job (registers pyfunc + @champion in MLflow, logs the reference
# feature profile) → runner predict-batch Job (fills ops_ml.ml_predictions so
# forecast widgets have data on day one) → runner drift-check + score-performance
# Jobs (seed the ops_ml.model_drift / model_performance baselines the nightly
# ml_drift_check DAG then maintains, so the monitoring charts are non-empty on
# boot). model_deployment rows come from bundle/seed-pack/app/ml/deployments.yaml
# (upsert — provenance-friendly, re-runnable).
#
# CONVERGENT (like every other seed): a model whose registry entry already has
# an @champion alias is SKIPPED (state-restored or previously seeded boots
# don't retrain); pass --retrain to force.
#
# Runner Jobs mirror the gateway's job builder (routes/ml.py _runner_env) —
# same env contract, same image seam (nhdw/ml-runner:1.0.0 locally; prod remaps).
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NS=nhdw
SEEDS="$REPO/bundle/seed-pack/app/ml"
RUNNER_IMAGE="${ML_RUNNER_IMAGE:-nhdw/ml-runner:1.0.0}"
FORCE_RETRAIN=false
[ "${1:-}" = "--retrain" ] && FORCE_RETRAIN=true
export PATH="$HOME/.local/bin:$PATH"

step() { echo; echo "▸ $*"; }
ok()   { echo "  ✓ $*"; }
warn() { echo "  ! $*" >&2; }

echo "== ML seed (packages → object store → train → predict-batch) =="

# ── 1. packages → object store ml-packages/<name>/current/ (bundled host-side mc) ──
. "$REPO/bundle/scripts/lib/objstore.sh"
objstore_mc    || { warn "no mc client — see lib/objstore.sh"; exit 1; }
objstore_creds || { warn "object-store credentials not readable"; exit 1; }
objstore_pf 19000
objstore_alias

MODELS=()
for dir in "$SEEDS"/*/; do
  name=$(basename "$dir")
  [ "$name" = "_template" ] && continue
  [ -f "$dir/manifest.yaml" ] || continue
  MODELS+=("$name")
  "$MC" --config-dir "$OS_MC_CFG" mirror --quiet --overwrite "$dir" "L/nhdw-artifacts/ml-packages/$name/current" \
    && ok "package $name → ml-packages/$name/current/" \
    || warn "package upload FAILED: $name"
done
objstore_pf_stop

# ── 2. model_deployment rows (upsert from deployments.yaml) ──────────────────
step "model_deployment seed rows"
PGPW=$(kubectl -n "$NS" get secret postgres-vault-secrets -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)
python3 - "$SEEDS/deployments.yaml" << 'EOF' | kubectl -n "$NS" exec -i postgres-vault-0 -- env PGPASSWORD="$PGPW" psql -U vault_admin -d nhdw_ops -v ON_ERROR_STOP=1 -q \
  && ok "deployments upserted" || warn "deployment seed failed"
import sys, yaml, json
rows = yaml.safe_load(open(sys.argv[1]))
for r in rows:
    params = json.dumps(r.get('params', {})).replace("'", "''")
    print(f"""INSERT INTO ops_ml.model_deployment (model_name, model_alias, deployment_kind, schedule, enabled, params)
VALUES ('{r['model_name']}', '{r.get('model_alias','champion')}', '{r['deployment_kind']}',
        {'NULL' if not r.get('schedule') else "'" + r['schedule'] + "'"}, {str(r.get('enabled', True)).lower()}, '{params}'::jsonb)
ON CONFLICT (model_name) DO UPDATE SET model_alias=EXCLUDED.model_alias,
  deployment_kind=EXCLUDED.deployment_kind, schedule=EXCLUDED.schedule,
  enabled=EXCLUDED.enabled, params=EXCLUDED.params, updated_at=now();""")
EOF

# ── 3. runner Jobs: train (skip if @champion exists) then predict-batch ──────
run_runner_job() { # name mode args...
  local job="$1"; shift
  kubectl -n "$NS" delete job "$job" --ignore-not-found --wait=true >/dev/null 2>&1
  kubectl -n "$NS" apply -f - >/dev/null << EOF
apiVersion: batch/v1
kind: Job
metadata: { name: $job, namespace: $NS, labels: { app: ml-runner, tier: ml } }
spec:
  backoffLimit: 1
  ttlSecondsAfterFinished: 3600
  template:
    metadata: { labels: { app: ml-runner, tier: ml } }
    spec:
      restartPolicy: Never
      containers:
        - name: runner
          image: $RUNNER_IMAGE
          imagePullPolicy: IfNotPresent
          args: [$(printf '"%s",' "$@" | sed 's/,$//')]
          env:
            - { name: MLFLOW_TRACKING_URI, value: "http://mlflow.nhdw.svc.cluster.local:5000" }
            - { name: MLFLOW_S3_ENDPOINT_URL, value: "http://seaweedfs-s3.nhdw.svc.cluster.local:8333" }   # Phase 6: SeaweedFS
            - { name: MINIO_ENDPOINT,        value: "http://seaweedfs-s3.nhdw.svc.cluster.local:8333" }
            - { name: BOTO_EXPERIMENTAL__NO_EMPTY_CONTINUE, value: "true" }
            - { name: AWS_DEFAULT_REGION, value: "et-addis-1" }
            - { name: AWS_ACCESS_KEY_ID,     valueFrom: { secretKeyRef: { name: mlflow-secrets, key: S3_ACCESS_KEY } } }
            - { name: AWS_SECRET_ACCESS_KEY, valueFrom: { secretKeyRef: { name: mlflow-secrets, key: S3_SECRET_KEY } } }
            - { name: MINIO_ACCESS_KEY,      valueFrom: { secretKeyRef: { name: minio-secrets, key: ROOT_USER } } }
            - { name: MINIO_SECRET_KEY,      valueFrom: { secretKeyRef: { name: minio-secrets, key: ROOT_PASSWORD } } }
            - { name: OPS_PG_HOST, value: "postgres-vault.nhdw.svc.cluster.local" }
            - { name: VAULT_ADMIN_PASSWORD,  valueFrom: { secretKeyRef: { name: postgres-vault-secrets, key: POSTGRES_PASSWORD } } }
EOF
  kubectl -n "$NS" wait --for=condition=complete "job/$job" --timeout=600s >/dev/null 2>&1
}

has_champion() { # model
  kubectl -n "$NS" exec deploy/nhdw-gateway -- python3 -c "
import urllib.request, sys
try:
    urllib.request.urlopen('http://mlflow.nhdw.svc.cluster.local:5000/api/2.0/mlflow/registered-models/alias?name=$1&alias=champion')
    print('yes')
except Exception:
    print('no')" 2>/dev/null | grep -q yes
}

FAILED=0
for m in "${MODELS[@]}"; do
  step "model $m"
  # k8s Job names are RFC-1123 (no underscores) — model keys may carry them.
  k="${m//_/-}"
  if ! $FORCE_RETRAIN && has_champion "$m"; then
    ok "@champion already registered — skipping train (convergent seed)"
  else
    if run_runner_job "ml-train-$k" train "minio://nhdw-artifacts/ml-packages/$m/current/"; then
      ok "trained + registered @champion"
    else
      warn "TRAIN FAILED for $m — logs:"; kubectl -n "$NS" logs "job/ml-train-$k" --tail=12 2>&1 | sed 's/^/    /'
      FAILED=1; continue
    fi
  fi
  if run_runner_job "ml-predict-$k" predict-batch "$m"; then
    n=$(kubectl -n "$NS" exec postgres-vault-0 -- env PGPASSWORD="$PGPW" psql -U vault_admin -d nhdw_ops -At -c \
      "SELECT count(*) FROM ops_ml.ml_predictions p JOIN ops_ml.ml_run r ON r.id=p.run_id WHERE r.model_name='$m' AND r.status='success'" 2>/dev/null)
    ok "predict-batch complete (${n:-?} prediction rows)"

    # ── day-one monitoring baselines ────────────────────────────────────────
    # The generic drift + performance runner verbs the ml_drift_check DAG runs
    # nightly, run ONCE here so model_drift/model_performance have REAL rows on
    # boot (workshop drift/perf charts + admin model-health need non-empty
    # data). --no-retrain-on-drift keeps the seed convergent: the first batch
    # IS the training frame, so PSI≈0 and no surprise retrain fires.
    if run_runner_job "ml-drift-$k" drift-check "$m" --no-retrain-on-drift; then
      dn=$(kubectl -n "$NS" exec postgres-vault-0 -- env PGPASSWORD="$PGPW" psql -U vault_admin -d nhdw_ops -At -c \
        "SELECT count(*) FROM ops_ml.model_drift WHERE model_name='$m'" 2>/dev/null)
      ok "drift baseline computed (${dn:-?} feature rows)"
    else
      warn "DRIFT baseline FAILED for $m — logs:"; kubectl -n "$NS" logs "job/ml-drift-$k" --tail=12 2>&1 | sed 's/^/    /'
      FAILED=1
    fi
    # Performance scoring is a no-op (0 rows, exit 0) for models with no
    # manifest actuals: block (e.g. stockout_forecast) — not a failure.
    if run_runner_job "ml-perf-$k" score-performance "$m"; then
      pn=$(kubectl -n "$NS" exec postgres-vault-0 -- env PGPASSWORD="$PGPW" psql -U vault_admin -d nhdw_ops -At -c \
        "SELECT count(*) FROM ops_ml.model_performance WHERE model_name='$m'" 2>/dev/null)
      ok "performance scored (${pn:-0} metric rows)"
    else
      warn "PERFORMANCE scoring FAILED for $m — logs:"; kubectl -n "$NS" logs "job/ml-perf-$k" --tail=12 2>&1 | sed 's/^/    /'
      FAILED=1
    fi
  else
    warn "PREDICT FAILED for $m — logs:"; kubectl -n "$NS" logs "job/ml-predict-$k" --tail=12 2>&1 | sed 's/^/    /'
    FAILED=1
  fi
done

if [ "$FAILED" -ne 0 ]; then echo; echo "== ML seed FAILED (see ✗/! above) =="; exit 1; fi
echo; echo "== ML seed complete =="
