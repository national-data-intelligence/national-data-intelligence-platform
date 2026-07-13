#!/usr/bin/env bash
# seed-realistic.sh — REALISTIC seeding mode for the data-pipeline tiers.
#
# Pulls the data from the EXTERNAL source replicas via the REAL dlt ingestors,
# then runs the real dbt pipeline end to end so the marts are produced by the
# actual transformations:
#
#   minio-init → [7 source ingestors, parallel] → ch-raw-views → processed-zone
#              → dbt-staging → bridge-sync → dbt-vault → dbt-marts → (component views)
#
# The source replicas must already be up (bundle/scripts/sources-up.sh —
# bootstrap runs it in realistic mode); a preflight probes host.k3d.internal:<port>
# for every source from inside the cluster and fails loudly if one is unreachable.
#
# Each step is a K8s Job applied + waited-on in dependency order. The registry
# image names in base/dbt-jobs.yaml + base/ingestor-jobs.yaml are remapped to the
# locally-built nhdw/*:dev images, and imagePullPolicy is forced to IfNotPresent
# (images are pre-imported into the cluster — see cache-images.sh / build-images.sh).
#
# Usage:  bundle/scripts/seed-realistic.sh [--namespace=nhdw]
#           [--skip-ingest]    reuse the current lake; run only the dbt pipeline
#           [--full-refresh]   purge every source's lake prefix (data + dlt state,
#                              so incremental cursors restart) before ingesting —
#                              a guaranteed-clean, duplicate-free rebuild
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NS=nhdw
INGEST=1
FULL_REFRESH=0
for a in "$@"; do case "$a" in
  --namespace=*) NS="${a#--namespace=}";;
  --skip-ingest) INGEST=0;;
  --full-refresh) FULL_REFRESH=1;;
esac; done

# Ingestors run in parallel (independent sources → disjoint lake prefixes; hcmiswdm
# + mbrana share one SQL Server but are read-only). dbt stages are strictly ordered.
INGEST_JOBS=(dhis2-ingest-metadata dhis2-ingest-dvs climate-ingest ethioemr-ingest hcmiswdm-ingest mbrana-ingest mfr-ingest)
PIPELINE=(ch-raw-views processed-zone dbt-staging bridge-sync dbt-vault dbt-marts publish-datasets)

# Registry→local image remap via kustomize's BUILT-IN images transform
# (1_infrastructure/k8s/jobs/kustomization.yaml) — the system's own mechanism.
# Orchestration never rewrites manifests (the old sed pass is retired).
CORRECTED="$(kustomize build --load-restrictor=LoadRestrictionsNone "$REPO/1_infrastructure/k8s/jobs")"

extract_job() { # job-name → writes /tmp/nhdw-job-<name>.yaml
  printf '%s' "$CORRECTED" | python3 -c "
import sys,yaml
docs=[d for d in yaml.safe_load_all(sys.stdin) if isinstance(d,dict)]
j=[d for d in docs if d.get('kind')=='Job' and d['metadata']['name']=='$1']
if not j: sys.exit('  no Job named $1 in dbt-jobs.yaml/ingestor-jobs.yaml')
print(yaml.safe_dump(j[0]))
" > /tmp/nhdw-job-$1.yaml
}

# Wait for a Job to finish — return 0 on Complete, 1 on Failed-out or timeout.
# (A bare `kubectl wait --for=condition=complete` blocks the FULL timeout on a job
# that has already failed; this polls both terminal conditions and fails fast.)
wait_job() { # job-name timeout-seconds
  local job="$1" timeout="${2:-420}" waited=0
  while [ "$waited" -lt "$timeout" ]; do
    local st
    st=$(kubectl -n "$NS" get job "$job" \
      -o jsonpath='{range .status.conditions[*]}{.type}={.status} {end}' 2>/dev/null)
    case "$st" in
      *Complete=True*) return 0 ;;
      *Failed=True*)   return 1 ;;
    esac
    sleep 5; waited=$((waited+5))
  done
  return 1
}

run_job() {
  local job="$1" timeout="${2:-420}"
  echo "▸ [$job]"
  extract_job "$job" || return 1
  kubectl -n "$NS" delete job "$job" --ignore-not-found --wait=true >/dev/null 2>&1
  kubectl -n "$NS" apply -f /tmp/nhdw-job-$job.yaml >/dev/null || return 1
  if wait_job "$job" "$timeout"; then
    echo "  ✓ $job complete"
    return 0
  fi
  echo "  ✗ $job did not complete — logs:"
  kubectl -n "$NS" logs "job/$job" --tail=25 2>/dev/null | sed 's/^/    /'
  return 1
}

echo "== REALISTIC seeding (source replicas → ingestors → lake → dbt pipeline → marts) =="
command -v kustomize >/dev/null || export PATH="$HOME/.local/bin:$PATH"

MINIO_POD=$(kubectl -n "$NS" get pods -l app=minio-datalake -o jsonpath='{.items[0].metadata.name}')

# ── stage 1: the lake bucket must exist before the ingestors write to it ──────
run_job minio-init || { echo "FAILED at minio-init"; exit 1; }

# ── stage 2: source → lake via the real dlt ingestors ────────────────────────
if [ "$INGEST" = 1 ]; then
  # Preflight: every ingestor reaches its source over host.k3d.internal:<published
  # port>. Probe from INSIDE the cluster (an imported ingestor image has python3),
  # so a broken host route fails loudly here instead of as 0-row marts later.
  echo "▸ [preflight] source reachability from inside the cluster (host.k3d.internal)"
  if kubectl -n "$NS" run src-preflight --rm -i --restart=Never \
      --image=nhdw/dhis2-ingestor:dev --image-pull-policy=IfNotPresent --quiet \
      --command -- python3 -c '
import socket, sys
ports = {"dhis2": 8080, "climate": 8095, "mfr": 8093,
         "sqlserver(hcmiswdm+mbrana)": 1433, "ethioemr-mysql": 33306}
bad = []
for name, p in ports.items():
    s = socket.socket(); s.settimeout(4)
    try:
        s.connect(("host.k3d.internal", p)); print(f"    ok   {name} :{p}")
    except Exception as exc:
        print(f"    FAIL {name} :{p} ({exc})"); bad.append(name)
    finally:
        s.close()
sys.exit(1 if bad else 0)' 2>/dev/null; then
    echo "  ✓ all sources reachable"
  else
    echo "  ✗ one or more sources unreachable — run bundle/scripts/sources-up.sh up"
    exit 1
  fi

  # Optional guaranteed-clean rebuild: purge each source's whole lake prefix —
  # data AND _dlt state, so append+incremental cursors restart from the floor and
  # nothing can double-count. (A normal run without this flag is incremental:
  # append sources pull only their delta; replace sources rewrite their prefix.)
  if [ "$FULL_REFRESH" = 1 ]; then
    echo "▸ [ingest] FULL REFRESH — purging lake prefixes (data + dlt state)"
    for src in dhis2 climate ethioemr hcmiswdm mbrana mfr; do
      kubectl -n "$NS" exec "$MINIO_POD" -- sh -c \
        'mc alias set L http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; mc rm --recursive --force L/nhdw-raw/'"$src"'/ >/dev/null 2>&1; true' \
        && echo "  purged nhdw-raw/$src/"
    done
  fi

  # Bounded-concurrency launch (INGEST_BATCH, default 3): run the memory-heavy
  # ingestors a few at a time instead of firing all N at once, so the parallel
  # fan-out can't OOM-kill one (e.g. EthioEMR's observation scan) on a RAM-tight
  # host. Wall clock ≈ the sum over batches of each batch's slowest source; the
  # serial-retry pass below still catches any straggler. Set INGEST_BATCH=99 to
  # restore the old all-at-once behaviour on a host with ample RAM.
  BATCH="${INGEST_BATCH:-3}"
  echo "▸ [ingest] launching ${#INGEST_JOBS[@]} source ingestors, ${BATCH} at a time"
  retry=()
  i=0
  while [ "$i" -lt "${#INGEST_JOBS[@]}" ]; do
    batch=("${INGEST_JOBS[@]:i:BATCH}")
    for job in "${batch[@]}"; do
      extract_job "$job" || { echo "FAILED extracting $job"; exit 1; }
      kubectl -n "$NS" delete job "$job" --ignore-not-found --wait=true >/dev/null 2>&1
      kubectl -n "$NS" apply -f /tmp/nhdw-job-$job.yaml >/dev/null || { echo "FAILED applying $job"; exit 1; }
    done
    echo "  ▸ batch launched: ${batch[*]}"
    for job in "${batch[@]}"; do
      if wait_job "$job" 1500; then
        echo "  ✓ $job"
      else
        echo "  ! $job did not complete in its batch — queuing solo retry"
        retry+=("$job")
      fi
    done
    i=$((i + BATCH))
  done
  # Serial-retry pass: launching all N memory-heavy ingestors at once can OOM-kill
  # one (e.g. EthioEMR's observation scan) on a RAM-constrained host, yet the same
  # ingestor succeeds in seconds when run ALONE (no contention). Re-run each failed
  # ingestor one at a time before declaring the stage dead — resilience to a host
  # that can't fit the whole parallel fan-out in memory at once.
  if [ "${#retry[@]}" -gt 0 ]; then
    echo "▸ [ingest] serial-retry pass for ${#retry[@]} ingestor(s) that lost the parallel race: ${retry[*]}"
    ingest_failed=0
    for job in "${retry[@]}"; do
      kubectl -n "$NS" delete job "$job" --ignore-not-found --wait=true >/dev/null 2>&1
      kubectl -n "$NS" apply -f /tmp/nhdw-job-$job.yaml >/dev/null || { echo "FAILED re-applying $job"; exit 1; }
      if wait_job "$job" 1500; then
        echo "  ✓ $job (solo retry)"
      else
        echo "  ✗ $job FAILED even on a solo retry — logs:"
        kubectl -n "$NS" logs "job/$job" --tail=20 2>/dev/null | sed 's/^/    /'
        ingest_failed=1
      fi
    done
    [ "$ingest_failed" = 0 ] || { echo "FAILED at ingest stage (after solo retry)"; exit 1; }
  fi
else
  echo "▸ [ingest] SKIPPED (--skip-ingest) — reusing the current lake"
fi

# ── stage 3: MFR landing (the ONE explicitly-typed, direct-loaded source) ────
# Everything else that used to be host-side prep now lives where it belongs:
#   · resilient raw views + stale-view drop + lake probe → apply_raw_views.py
#     inside the ch-raw-views Job (creds via the server-side nhdw_minio
#     named collection — nothing is injected from here);
#   · nhdw_landing reset → the bridge itself (DROP+CREATE per sync — it owns
#     its tables).
# MFR is NOT a bridge-managed source: its landing tables carry an explicit,
# typed schema (boolean/double/numeric/JSON-as-text columns from FHIR) that the
# all-string lake→ClickHouse→bridge path can't reproduce. So MFR lands directly
# from its seed CSVs (which are a faithful \copy dump of these same tables).
# Recreate the schema (the reset above dropped it) and load the CSVs.
PGADMIN_PW=$(kubectl -n "$NS" get secret postgres-vault-secrets -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)
echo "▸ [prep] restoring MFR landing (explicit typed schema + direct CSV load)"
kubectl -n "$NS" exec postgres-vault-0 -i -- \
  env PGPASSWORD="$PGADMIN_PW" psql -U vault_admin -d nhdw_vault -v ON_ERROR_STOP=1 -q \
  < "$REPO/3_storage/postgres/init/10_mfr_landing.sql" >/dev/null 2>&1 \
  && echo "  ✓ MFR landing schema recreated" || echo "  ! MFR schema recreate failed"
mfr_ok=1
for t in organizations facilities devices; do
  csv="$REPO/bundle/seeds/sources/mfr/${t}.csv"
  [ -f "$csv" ] || { echo "  ! missing $csv"; mfr_ok=0; continue; }
  kubectl -n "$NS" exec postgres-vault-0 -i -- \
    env PGPASSWORD="$PGADMIN_PW" psql -U vault_admin -d nhdw_vault -v ON_ERROR_STOP=1 -q \
    -c "TRUNCATE nhdw_landing.stg_mfr__${t}" \
    -c "\copy nhdw_landing.stg_mfr__${t} FROM STDIN WITH (FORMAT csv, HEADER true)" \
    < "$csv" >/dev/null 2>&1 || { echo "  ! MFR load failed: $t"; mfr_ok=0; }
done
[ "$mfr_ok" = 1 ] && echo "  ✓ MFR landing loaded (organizations + facilities + devices)"

# NOTE: IDSR + Climate are NOT direct-loaded here. IDSR is modelled as DHIS2 data
# (disease data elements + weekly data values in the dhis2 seed) and Climate is a
# bridge-managed source (lake → ClickHouse → bridge). Both ride the standard
# pipeline (ingestors → ch-raw-views → dbt-staging → bridge-sync → dbt-vault
# → dbt-marts) and reach the marts via nhdw_vault_raw.

# Drop STALE raw_*/stg_* views before the pipeline recreates the current set. Neither
# `CREATE OR REPLACE` (ch-raw-views) nor dbt drops a view whose model was REMOVED from
# the project — so a retired source (e.g. dhis2 indicators) leaves a raw_/stg_ view in
# nhdw_staging pointing at an empty s3 path. The bridge lists EVERY stg_* view, reads it,
# and aborts with `CANNOT_EXTRACT_TABLE_STRUCTURE` (636). nhdw_staging is pure staging
# (only raw_/stg_ views, no data), so a clean rebuild each run is safe and correct.
if [ -n "${CHPOD:-}" ]; then
  echo "▸ [prep] dropping stale raw_*/stg_* views (removed models must not linger)"
  DROPS=$(kubectl -n "$NS" exec "$CHPOD" -- clickhouse-client -q \
    "SELECT 'DROP VIEW IF EXISTS nhdw_staging.\`' || name || '\`;' FROM system.tables \
     WHERE database='nhdw_staging' AND (name LIKE 'raw_%' OR name LIKE 'stg_%')" 2>/dev/null)
  if [ -n "$DROPS" ]; then
    printf '%s\n' "$DROPS" | kubectl -n "$NS" exec -i "$CHPOD" -- clickhouse-client -n >/dev/null 2>&1 \
      && echo "  ✓ stale views dropped ($(printf '%s\n' "$DROPS" | grep -c DROP))" \
      || echo "  ! stale-view drop skipped"
  else
    echo "  ✓ no stale views"
  fi
fi

# ── stage 4: the dbt pipeline (strictly ordered) ─────────────────────────────
# The dbt build stages need a generous wait: a COLD boot builds them
# --full-refresh (see each Job's cold/warm FLAG logic), and a full-refresh of the
# vault + all marts (incl. the BV-spine-heavy mart_hmis_indicator_coverage, ~8min
# alone) legitimately runs 10-16 min. The default 420s wait_job timeout is too
# short → the bootstrap would abort a stage that is still succeeding in-cluster.
for job in "${PIPELINE[@]}"; do
  case "$job" in
    dbt-vault|dbt-marts) to=2400 ;;   # cold full-refresh: up to 40 min (marts can be
                                      # slow, esp. under any concurrent Job contention)
    *)                   to=420  ;;
  esac
  run_job "$job" "$to" || { echo "FAILED at $job"; exit 1; }
done

echo "== realistic seeding complete =="
echo "Mart row counts:"
kubectl -n "$NS" exec postgres-vault-0 -- \
  env PGPASSWORD="$(kubectl -n "$NS" get secret postgres-vault-secrets -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)" \
  psql -U vault_admin -d nhdw_vault -At -c \
  "SELECT schemaname||'.'||relname||'='||n_live_tup FROM pg_stat_user_tables WHERE schemaname LIKE 'bi_%' AND n_live_tup>0 ORDER BY 1;" 2>/dev/null | sed 's/^/  /'
