#!/usr/bin/env bash
# seed-app-security.sh — seed the APPLICATION / SECURITY state into nhdw_ops.
#
# This is NOT data-pipeline state: the RBAC/permission model (roles, dashboards,
# pages, widgets, filters, mart attrs, role grants, users) and the workshop
# groups are not derivable from source data, so they are ALWAYS seeded from
# files. The data pipeline is seeded separately by seed-realistic.sh.
#
# Order matters: the security loader (18) upserts ops_identity.user from
# users.yaml; 15_workshop_groups_seed then references those users in its group
# rosters. So: security loader FIRST, workshop groups SECOND.
#
# Prereqs (created at postgres DB-init): nhdw_ops + ops_identity/ops_artifact/
# ops_perm schemas (05_ops_schemas.sql, 17_perm_schemas.sql, 19_api_tokens.sql).
#
# Both steps are idempotent (ON CONFLICT). Safe to re-run.
#
# Usage:  bundle/scripts/seed-app-security.sh [--namespace nhdw]
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NS=nhdw
for a in "$@"; do case "$a" in --namespace=*) NS="${a#--namespace=}";; esac; done

OPS_DB=nhdw_ops
SEC_DIR="$REPO/bundle/seeds/security"
LOADER="$REPO/7_security/scripts/load_security_seed.py"
PGADMIN_PW=$(kubectl -n "$NS" get secret postgres-vault-secrets -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)

echo "== APP/SECURITY seeding (→ ${OPS_DB}) =="

# ── 0. reconcile the ops_perm / ops_identity SCHEMA before the RBAC loader ────
# restore-state (bootstrap) `pg_restore --clean`s an OLDER packed nhdw_ops dump
# over the fresh initdb schema, so post-dump column/table additions are silently
# dropped — notably ops_perm.widget.source + the §4.5 plugin columns from
# 17_perm_schemas.sql, which the RBAC loader below READS
# (`DELETE ... WHERE source='core'`). The step-4 migration re-apply runs too LATE
# (after the loader). initdb never re-fires on a non-virgin data dir, so re-apply
# the idempotent perm-schema DDL HERE, BEFORE the loader. All are
# CREATE/ALTER ... IF NOT EXISTS (best-effort; duplicate-object errors are skipped)
# → safe on a virgin boot too, where initdb already ran them.
echo "▸ [perm-schema-heal] re-apply ops_perm schema (survives restore-state --clean)"
for sql in 17_perm_schemas.sql 23_perm_admin_grants.sql 25_perm_scope_migration.sql; do
  f="$REPO/3_storage/postgres/init/${sql}"
  [ -f "$f" ] || { echo "  ! ${sql} missing — skipping"; continue; }
  kubectl -n "$NS" exec -i postgres-vault-0 -- \
    env PGPASSWORD="$PGADMIN_PW" psql -U vault_admin -d "$OPS_DB" -q \
    < "$f" >/dev/null 2>&1
  echo "  ✓ ${sql} reconciled"
done

# ── 1. RBAC / permission model + users (18) — in-cluster Job ─────────────────
# The host has no pip and the postgres pod has no python, so run the loader as a
# K8s Job: python:3.12-slim, the loader + security YAML mounted from a configMap,
# talking to the postgres-vault Service over cluster DNS. Idempotent (ON CONFLICT).
echo "▸ [security-rbac] load_security_seed.py over bundle/seeds/security/"
if [ ! -f "$LOADER" ] || [ ! -d "$SEC_DIR" ]; then
  echo "  ! loader or seed dir missing — skipping"
else
  # #47 — collect the DISTRIBUTED per-dashboard catalog files (dashboard.yaml /
  # pages / sections / per-widget widget.yaml) into catalog.json; the loader
  # treats it as authoritative for the 7 catalog tables. Fails LOUDLY (a broken
  # authored catalog must not silently fall back to stale flat seeds).
  CATTMP=$(mktemp -d)
  if python3 "$REPO/bundle/scripts/collect-catalog.py" --repo "$REPO" \
       --out "$CATTMP/catalog.json"; then
    CATFILE="$CATTMP/catalog.json"
    echo "  ✓ catalog.json collected from the distributed dashboard catalogs"
  else
    echo "  ✗ collect-catalog.py FAILED — fix the authored catalog files" >&2
    exit 1
  fi
  kubectl -n "$NS" create configmap security-seed-files \
    --from-file="$LOADER" --from-file="$CATFILE" \
    $(for y in "$SEC_DIR"/*.yaml; do echo "--from-file=$y"; done) \
    --dry-run=client -o yaml | kubectl -n "$NS" apply -f - >/dev/null
  rm -rf "$CATTMP"

  kubectl -n "$NS" delete job security-seed --ignore-not-found --wait=true >/dev/null 2>&1
  cat <<EOF | kubectl -n "$NS" apply -f - >/dev/null
apiVersion: batch/v1
kind: Job
metadata:
  name: security-seed
spec:
  backoffLimit: 3
  ttlSecondsAfterFinished: 600
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: security-seed
          image: python:3.12-slim
          command: ["sh","-c"]
          args:
            - >
              pip install --quiet --no-cache-dir --retries 5 --timeout 60 'psycopg[binary]' PyYAML &&
              python /opt/seed/load_security_seed.py --seed-dir /opt/seed --pg-db ${OPS_DB}
          env:
            - { name: POSTGRES_HOST, value: postgres-vault }
            - { name: POSTGRES_PORT, value: "5432" }
            - { name: POSTGRES_USER, value: vault_admin }
            - { name: OPS_DB_NAME,   value: ${OPS_DB} }
            - name: PGPASSWORD
              valueFrom:
                secretKeyRef: { name: postgres-vault-secrets, key: POSTGRES_PASSWORD }
            # P1.1 — the platform service-account PAT; the loader registers its
            # hash as an R-SERVICE api_token (act-as-owner). Optional so an older
            # secrets.yaml without it degrades gracefully (no service token).
            - name: SERVICE_PAT
              valueFrom:
                secretKeyRef: { name: nhdw-service-token, key: SERVICE_PAT, optional: true }
          volumeMounts:
            - { name: seed, mountPath: /opt/seed }
      volumes:
        - name: seed
          configMap: { name: security-seed-files }
EOF
  if kubectl -n "$NS" wait --for=condition=complete job/security-seed --timeout=300s >/dev/null 2>&1; then
    kubectl -n "$NS" logs job/security-seed 2>/dev/null | grep -iE 'roles:|dashboards:|users|role_dashboard|✓|seeded' | tail -8 | sed 's/^/    /'
    echo "  ✓ security/RBAC model seeded"
  else
    echo "  ✗ security seed Job failed — logs:"
    kubectl -n "$NS" logs job/security-seed 2>/dev/null | tail -12 | sed 's/^/    /'
    FAILED=1
  fi
fi

# ── 1b. public-dashboard articles CMS (ops_governance.public_article) ─────────
ART_LOADER="$REPO/7_security/scripts/load_public_articles.py"
ART_DIR="$REPO/bundle/seeds/articles"
echo "▸ [public-articles] load_public_articles.py over bundle/seeds/articles/"
if [ ! -f "$ART_LOADER" ] || [ ! -f "$ART_DIR/articles.yaml" ]; then
  echo "  ! articles loader or seed missing — skipping"
else
  kubectl -n "$NS" create configmap public-articles-files \
    --from-file="$ART_LOADER" \
    --from-file="$ART_DIR/articles.yaml" \
    --dry-run=client -o yaml | kubectl -n "$NS" apply -f - >/dev/null
  kubectl -n "$NS" delete job public-articles-seed --ignore-not-found --wait=true >/dev/null 2>&1
  cat <<EOF | kubectl -n "$NS" apply -f - >/dev/null
apiVersion: batch/v1
kind: Job
metadata:
  name: public-articles-seed
spec:
  backoffLimit: 3
  ttlSecondsAfterFinished: 600
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: public-articles-seed
          image: python:3.12-slim
          command: ["sh","-c"]
          args:
            - >
              pip install --quiet --no-cache-dir --retries 5 --timeout 60 'psycopg[binary]' PyYAML &&
              python /opt/seed/load_public_articles.py --seed-dir /opt/seed --pg-db ${OPS_DB}
          env:
            - { name: POSTGRES_HOST, value: postgres-vault }
            - { name: POSTGRES_PORT, value: "5432" }
            - { name: POSTGRES_USER, value: vault_admin }
            - { name: OPS_DB_NAME,   value: ${OPS_DB} }
            - name: PGPASSWORD
              valueFrom:
                secretKeyRef: { name: postgres-vault-secrets, key: POSTGRES_PASSWORD }
          volumeMounts:
            - { name: seed, mountPath: /opt/seed }
      volumes:
        - name: seed
          configMap: { name: public-articles-files }
EOF
  if kubectl -n "$NS" wait --for=condition=complete job/public-articles-seed --timeout=300s >/dev/null 2>&1; then
    kubectl -n "$NS" logs job/public-articles-seed 2>/dev/null | grep -iE 'articles|✓' | tail -4 | sed 's/^/    /'
    echo "  ✓ public articles seeded"
  else
    echo "  ✗ public-articles seed Job failed — logs:"
    kubectl -n "$NS" logs job/public-articles-seed 2>/dev/null | tail -12 | sed 's/^/    /'
    FAILED=1
  fi
fi

# ── 2. workshop groups (15) — pure SQL, in the postgres pod (after users exist) ─
echo "▸ [workshop-groups] 15_workshop_groups_seed.sh"
if kubectl -n "$NS" exec -i postgres-vault-0 -- \
      env POSTGRES_USER=vault_admin OPS_DB_NAME="$OPS_DB" PGPASSWORD="$PGADMIN_PW" \
      bash -s < "$REPO/3_storage/postgres/init/15_workshop_groups_seed.sh" >/dev/null 2>&1; then
  n=$(kubectl -n "$NS" exec postgres-vault-0 -- env PGPASSWORD="$PGADMIN_PW" \
        psql -U vault_admin -d "$OPS_DB" -At -c "SELECT count(*) FROM ops_artifact.workshop_group" 2>/dev/null)
  m=$(kubectl -n "$NS" exec postgres-vault-0 -- env PGPASSWORD="$PGADMIN_PW" \
        psql -U vault_admin -d "$OPS_DB" -At -c "SELECT count(*) FROM ops_artifact.workshop_group_member" 2>/dev/null)
  echo "  ✓ workshop groups seeded (${n} groups, ${m} members)"
else
  echo "  ✗ workshop-groups seed failed"
  FAILED=1
fi

# ── 3. program-demo tables (03) — directly-seeded APP data, NOT pipeline-derivable ─
# programme_metrics / submission_funnel / stock_status back the facility-detail BI
# components. 03_program_demo.sql lives in the initdb configMap too, but initdb only
# fires on a VIRGIN data dir — re-running it here (TRUNCATE + INSERT, idempotent)
# guarantees the tables are populated on every boot in BOTH modes.
echo "▸ [program-demo] 03_program_demo.sql (facility-detail demo tables)"
if kubectl -n "$NS" exec -i postgres-vault-0 -- \
      env PGPASSWORD="$PGADMIN_PW" psql -U vault_admin -d nhdw_vault -v ON_ERROR_STOP=1 -q \
      < "$REPO/3_storage/postgres/init/03_program_demo.sql" >/dev/null 2>&1; then
  pm=$(kubectl -n "$NS" exec postgres-vault-0 -- env PGPASSWORD="$PGADMIN_PW" \
        psql -U vault_admin -d nhdw_vault -At -c "SELECT count(*) FROM bi_facility.programme_metrics" 2>/dev/null)
  echo "  ✓ program-demo tables seeded (programme_metrics=${pm})"
else
  echo "  ✗ program-demo seed failed"
  FAILED=1
fi

# ── 4. ops numbered migrations that must survive restore-state (22,26,28,29) ──
# restore-state (bootstrap step 5.5) runs `pg_restore --clean` on nhdw_ops from
# the packed dump. If that dump predates a column/table these migrations add,
# --clean DROPS + recreates the old shape, silently losing the addition. initdb
# never re-fires on a non-virgin data dir, so the ONLY place these get re-applied
# after a packed rebuild is HERE. Both are idempotent (CREATE/ALTER ... IF NOT
# EXISTS) so they are safe on a virgin boot too (initdb already ran them).
#
#   22_project.sh          — ops_workspace.project (the project entity). Was NOT
#                            re-exec'd here before; a restore of an older dump
#                            without ops_workspace.project would leave 26's FK
#                            target missing. Re-apply first.
#   26_artifact_project.sh — ops_artifact.artifact.project_id + mlflow_model_name
#                            (the project-scoping columns). Depends on 22 having
#                            run (cross-schema FK → ops_workspace.project).
#   28_dataset_project_link.sh — ops_artifact.project_dataset (datasets became an
#                            independent M:N entity). Depends on 22 + 26 (backfills
#                            from artifact.project_id then clears it for datasets).
#   29_project_review.sh   — project.review_status + ops_workspace.project_review
#                            (PROJECT-centric graduation, 2026-07-08). Depends on
#                            22 (ALTERs ops_workspace.project). Idempotent.
#   27_ml_monitoring.sh    — ops_ml.model_drift(+kind,psi_threshold,note) +
#                            model_performance(+run_id,sample_size). model_drift is
#                            base-created by 11 then ALTERed by 27; the ALTER did
#                            NOT take at initdb on a fresh boot (11/27 split), so
#                            the runner's write_drift hit UndefinedColumn 'kind'.
#                            Runs BEFORE seed-ml (7.5), so drift/score work. Idempotent.
for mig in 22_project.sh 26_artifact_project.sh 28_dataset_project_link.sh 29_project_review.sh 27_ml_monitoring.sh; do
  echo "▸ [ops-migration] ${mig}"
  if kubectl -n "$NS" exec -i postgres-vault-0 -- \
        env POSTGRES_USER=vault_admin OPS_DB_NAME="$OPS_DB" PGPASSWORD="$PGADMIN_PW" \
        bash -s < "$REPO/3_storage/postgres/init/${mig}" >/dev/null 2>&1; then
    echo "  ✓ ${mig} applied"
  else
    echo "  ✗ ${mig} failed"
    FAILED=1
  fi
done

if [ "${FAILED:-0}" -ne 0 ]; then
  echo "== app/security seeding FAILED (see ✗ above) =="
  exit 1
fi
echo "== app/security seeding complete =="
