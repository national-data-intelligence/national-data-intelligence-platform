#!/usr/bin/env bash
# Phase 4A — prove the deployed platform BEFORE any production data is copied.
# 20 checks with explicit PASS/FAIL. Exit non-zero on ANY failure, printing
# "DO NOT MIGRATE". Safe to re-run. Touches only the new SeaweedFS stack (+ a scratch
# bucket it deletes) — never MinIO, never existing lake data.
set -uo pipefail
NS="${NS:-nhdw}"; HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../../.." && pwd)"
fail=0; pass(){ echo "[PASS] $*"; }; failed(){ echo "[FAIL] $*"; fail=$((fail+1)); }
K(){ kubectl -n "$NS" "$@"; }

echo "══ Phase 4A · 1–4 Kubernetes readiness ══"
for d in seaweedfs-master seaweedfs-filer; do   # the S3 gateway is embedded in the filer
  r=$(K get deploy $d -o jsonpath='{.status.readyReplicas}' 2>/dev/null); [ "${r:-0}" -ge 1 ] && pass "$d ready ($r/1)" || failed "$d not ready"; done
r=$(K get statefulset seaweedfs-volume -o jsonpath='{.status.readyReplicas}' 2>/dev/null); [ "${r:-0}" -ge 1 ] && pass "seaweedfs-volume ready ($r/1)" || failed "seaweedfs-volume not ready"
for p in seaweedfs-master-data data-seaweedfs-volume-0; do
  s=$(K get pvc $p -o jsonpath='{.status.phase}' 2>/dev/null); [ "$s" = Bound ] && pass "PVC $p Bound" || failed "PVC $p: ${s:-missing}"; done
K get job seaweedfs-init -o jsonpath='{.status.succeeded}' 2>/dev/null | grep -q 1 && pass "seaweedfs-init Job succeeded" || failed "seaweedfs-init Job not succeeded"

echo "══ 5 · PostgreSQL filer connection ══"
if K logs deploy/seaweedfs-filer 2>/dev/null | grep -qi "leveldb"; then failed "filer mentions leveldb — Postgres store NOT active"; else pass "filer log has no leveldb store"; fi
n=$(K exec postgres-vault-0 -- sh -c 'psql -U "$POSTGRES_USER" -d seaweedfs_filer -Atc "select count(*) from filemeta"' 2>/dev/null | tr -dc 0-9)
[ -n "$n" ] && pass "filemeta reachable in postgres-vault (rows=$n)" || failed "cannot query seaweedfs_filer.filemeta in postgres-vault"
c=$(K exec postgres-vault-0 -- sh -c 'psql -U "$POSTGRES_USER" -d seaweedfs_filer -Atc "select count(*) from information_schema.columns where table_name='"'"'filemeta'"'"' and column_name in ('"'"'name'"'"','"'"'directory'"'"') and collation_name='"'"'C'"'"'"' 2>/dev/null | tr -dc 0-9)
[ "${c:-0}" = 2 ] && pass "filemeta name/directory COLLATE \"C\"" || failed "filemeta collation is not C (got $c/2)"

echo "══ 7–18 · in-cluster checks with the real identities (Job seaweedfs-verify, MODE=all) ══"
run_job(){ # $1 = MODE
  K delete job seaweedfs-verify --ignore-not-found >/dev/null 2>&1
  K create configmap seaweedfs-verify-script --from-file=verify_cluster.py="$HERE/verify_cluster.py" --dry-run=client -o yaml | K apply -f - >/dev/null
  sed "s/__MODE__/$1/" "$HERE/verify-job.yaml" | K apply -f - >/dev/null
  K wait --for=condition=complete job/seaweedfs-verify --timeout=600s >/dev/null 2>&1; ok=$?
  K logs job/seaweedfs-verify 2>/dev/null | sed 's/^/   /'
  return $ok
}
run_job all || failed "in-cluster verification (MODE=all) reported failures"

echo "══ 6 · PVC persistence: restart the volume AND filer pods, then read the marker ══"
K delete pod seaweedfs-volume-0 --now >/dev/null 2>&1; K rollout restart deploy/seaweedfs-filer >/dev/null 2>&1   # filer restart == gateway restart now
K rollout status statefulset/seaweedfs-volume --timeout=180s >/dev/null 2>&1 && K rollout status deploy/seaweedfs-filer --timeout=180s >/dev/null 2>&1 \
  && pass "volume + filer pods restarted and Ready" || failed "pods did not return Ready after restart"
run_job persist || failed "marker not readable after restart — PVC/filer-store persistence broken"

echo "══ 19 · ClickHouse read (and write) through the named collection, no creds in SQL ══"
# Unique key per run: ClickHouse refuses to INSERT over an existing S3 key (a leftover
# from an aborted run failed this check once). Count is read from the exact file; the
# recursive glob — the pattern raw_views.sql uses — must merely include it.
CHQ(){ K exec deploy/clickhouse -- sh -c 'clickhouse-client -u "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" -q "$0"' "$1" 2>&1; }
STAMP=$(date +%s); BASE="http://seaweedfs-s3.$NS.svc.cluster.local:8333/nhdw-4a-scratch/ch"
URL="$BASE/year=2026/month=09/day=07/probe-$STAMP.parquet"
unset r; ins=$(CHQ "INSERT INTO FUNCTION s3(nhdw_minio, url='$URL', format='Parquet') SELECT number AS id, number*3 AS v FROM numbers(5000)")
if [ -n "$ins" ]; then failed "ClickHouse INSERT via s3(nhdw_minio,…) failed: $(echo "$ins" | head -2 | tr '\n' ' ')"; else
  r=$(CHQ "SELECT count(), sum(v) FROM s3(nhdw_minio, url='$URL', format='Parquet')")
  g=$(CHQ "SELECT count() FROM s3(nhdw_minio, url='$BASE/**/*.parquet', format='Parquet')")
  if [ "$(echo "$r" | tr -s '\t' ' ')" = "5000 37492500" ] && [ "${g:-0}" -ge 5000 ] 2>/dev/null; then pass "ClickHouse wrote + read Parquet via s3(nhdw_minio,…): exact=$r glob_rows=$g"
  else failed "ClickHouse s3() readback: exact='$r' glob='$g' (expected 5000 37492500 / ≥5000)"; fi
fi

echo "══ 20 · dlt write with the ingestor wiring (Job, python:3.12-slim + dlt 1.4.0) ══"
K delete job seaweedfs-dlt-probe --ignore-not-found >/dev/null 2>&1
K create configmap seaweedfs-dlt-probe --from-file=dlt_probe.py="$REPO/3_storage/seaweedfs/poc/dlt_probe.py" --dry-run=client -o yaml | K apply -f - >/dev/null
cat <<Y | K apply -f - >/dev/null
apiVersion: batch/v1
kind: Job
metadata: { name: seaweedfs-dlt-probe, namespace: $NS, labels: { part-of: seaweedfs } }
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 3600
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: dlt
          image: python:3.12-slim
          command: ["bash","-c","pip install -q --disable-pip-version-check --root-user-action=ignore 'setuptools<81' 'dlt[filesystem,parquet]==1.4.0' 'pyarrow==17.0.0' >/dev/null 2>&1 && python /probe/dlt_probe.py"]
          env:
            - { name: MINIO_ENDPOINT, value: "http://seaweedfs-s3.$NS.svc.cluster.local:8333" }
            - { name: MINIO_REGION,   value: "et-addis-1" }
            - { name: MINIO_ACCESS_KEY, valueFrom: { secretKeyRef: { name: seaweedfs-secrets, key: ADMIN_ACCESS_KEY } } }
            - { name: MINIO_SECRET_KEY, valueFrom: { secretKeyRef: { name: seaweedfs-secrets, key: ADMIN_SECRET_KEY } } }
            - { name: DLT_BUCKET, value: "nhdw-4a-scratch" }
            # Phase 4A finding: dlt IS affected by botocore#3755 (Expect: 100-continue on a
            # zero-byte PUT poisons the pooled connection). Test the SHIPPABLE mitigation on
            # its own: botocore's documented env var, present in botocore >= 1.35.x.
            - { name: BOTO_EXPERIMENTAL__NO_EMPTY_CONTINUE, value: "true" }
            - { name: DLT_STRIP_EXPECT, value: "0" }
          volumeMounts: [ { name: probe, mountPath: /probe, readOnly: true } ]
      volumes: [ { name: probe, configMap: { name: seaweedfs-dlt-probe } } ]
Y
if K wait --for=condition=complete job/seaweedfs-dlt-probe --timeout=600s >/dev/null 2>&1; then
  K logs job/seaweedfs-dlt-probe 2>/dev/null | grep -E "LOADED|completed jobs|parquet" | sed 's/^/   /'; pass "dlt pipeline wrote Parquet to SeaweedFS with the ingestor wiring"
else failed "dlt probe Job failed:"; K logs job/seaweedfs-dlt-probe 2>/dev/null | tail -5 | sed 's/^/   /'; fi

echo "══ cleanup ══"
K delete job seaweedfs-verify seaweedfs-dlt-probe --ignore-not-found >/dev/null 2>&1
K delete configmap seaweedfs-verify-script seaweedfs-dlt-probe --ignore-not-found >/dev/null 2>&1
# scratch bucket removal (recursive) via the init image's mc, creds from the Secret inside the pod
K delete job seaweedfs-4a-cleanup --ignore-not-found >/dev/null 2>&1
cat <<Y | K apply -f - >/dev/null
apiVersion: batch/v1
kind: Job
metadata: { name: seaweedfs-4a-cleanup, namespace: $NS, labels: { part-of: seaweedfs } }
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 600
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: mc
          image: minio/mc:RELEASE.2025-04-08T15-39-49Z
          command: ["/bin/sh","-c","mc alias set sw http://seaweedfs-s3.$NS.svc.cluster.local:8333 \"\$AK\" \"\$SK\" >/dev/null && mc rb --force sw/nhdw-4a-scratch >/dev/null 2>&1; echo scratch-removed"]
          env:
            - { name: AK, valueFrom: { secretKeyRef: { name: seaweedfs-secrets, key: ADMIN_ACCESS_KEY } } }
            - { name: SK, valueFrom: { secretKeyRef: { name: seaweedfs-secrets, key: ADMIN_SECRET_KEY } } }
Y
# `mc rb --force` walks 1,100+ keys + a multipart object; give it time, then judge by
# the RESULT (bucket gone?) rather than by the Job's exit, via the filer's own listing.
K wait --for=condition=complete job/seaweedfs-4a-cleanup --timeout=300s >/dev/null 2>&1 || true
if K exec deploy/seaweedfs-filer -- wget -qO- "http://localhost:8888/buckets/?pretty=y" 2>/dev/null | grep -qE '/buckets/nhdw-4a-scratch("|$)'; then failed "scratch bucket nhdw-4a-scratch still present"; else pass "scratch bucket removed"; fi
K delete job seaweedfs-4a-cleanup --ignore-not-found >/dev/null 2>&1

echo; if [ "$fail" = 0 ]; then echo "PHASE 4A: ALL CHECKS PASSED — Phase 5 (data migration) may proceed."; exit 0
else echo "PHASE 4A: $fail FAILURE(S) — DO NOT MIGRATE PRODUCTION DATA."; exit 1; fi
