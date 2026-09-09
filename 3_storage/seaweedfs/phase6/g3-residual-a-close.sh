#!/usr/bin/env bash
# Phase 6 · close G3 residual (a): prove a DAG-driven processed_zone writes to SeaweedFS.
#
# Run AFTER the operator has imported the rebuilt Airflow image as root:
#     docker save nhdw/airflow:1.0.0 | sudo k3s ctr images import -
# (the image built on 2026-09-09 carries the wired processed_zone task, see
#  5_orchestrator/dags/pipeline_refresh.py `_CMDS`).
#
# What it does (nothing here needs root):
#   1. restarts Airflow so the pods pick up the imported image; records the kubelet image id
#   2. runs the DAG task `processed_zone` through Airflow (tasks test), captures the spawned
#      pod's LAKE_BASE while it runs
#   3. runs an in-cluster verifier: every nhdw-processed key on SeaweedFS rewritten after T0,
#      MinIO's copy untouched, key sets identical
# Evidence lands in $EVIDENCE (default: the G2 evidence dir recorded in ~/nhdw-backups/.phase6-g2).
set -euo pipefail
NS=${NS:-nhdw}
EVIDENCE=${EVIDENCE:-$(cat ~/nhdw-backups/.phase6-g2)}
SNAP=~/nhdw-backups/phase6-snapshots
HERE=$(cd "$(dirname "$0")" && pwd)
SW="http://seaweedfs-s3.$NS.svc.cluster.local:8333"
MN="http://minio-datalake.$NS.svc.cluster.local:9000"

echo "== 1. restart Airflow onto the imported image"
kubectl -n "$NS" rollout restart deploy/airflow >/dev/null
kubectl -n "$NS" rollout status deploy/airflow --timeout=300s | tail -1
kubectl -n "$NS" get pods -l app=airflow -o jsonpath='{range .items[0].status.containerStatuses[*]}  {.name} {.imageID}{"\n"}{end}' | tee "$SNAP/airflow-digest.post-residual-a.txt"
POD=$(kubectl -n "$NS" get pod -l app=airflow -o jsonpath='{.items[0].metadata.name}')
kubectl -n "$NS" exec "$POD" -c scheduler -- python3 -c "import sys; sys.path.insert(0,'/opt/airflow/dags'); import pipeline_refresh as p; print('  running DAG _CMDS:', p._CMDS)"

echo "== 2. DAG-driven processed_zone"
T0=$(date -u +%Y-%m-%dT%H:%M:%S)
( kubectl -n "$NS" exec "$POD" -c scheduler -- airflow tasks test pipeline_refresh processed_zone 2026-09-09 > "$EVIDENCE/airflow-processed_zone-wired.log" 2>&1 ) &
for _ in $(seq 1 60); do P=$(kubectl -n "$NS" get pod -l task_id=processed_zone -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true); [ -n "$P" ] && break; sleep 2; done
echo "  spawned pod: ${P:-<none>}"
[ -n "${P:-}" ] && kubectl -n "$NS" get pod "$P" -o jsonpath='{.spec.containers[0].command}{"\n"}{range .spec.containers[0].env[*]}{.name}={.value}{"\n"}{end}' 2>/dev/null | grep -E "^\[|LAKE_BASE|BOTO" | tee "$EVIDENCE/processed-dag-pod-env.txt" | sed 's/^/  /'
wait
echo "  airflow: $(grep -oE 'Marking task as [A-Z_]+' "$EVIDENCE/airflow-processed_zone-wired.log" | tail -1)"
grep -E "populated tables|rows · kept" "$EVIDENCE/airflow-processed_zone-wired.log" | sed 's/.*\[base\] //' | head -3 | sed 's/^/  /'

echo "== 3. object-level proof (SeaweedFS rewritten after $T0, MinIO untouched)"
kubectl -n "$NS" create configmap g2-proc-verify --from-file=processed_verify.py="$HERE/processed_verify.py" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "$NS" delete job g2-proc-verify --ignore-not-found >/dev/null 2>&1
cat <<Y | kubectl apply -f - >/dev/null
apiVersion: batch/v1
kind: Job
metadata: { name: g2-proc-verify, namespace: $NS, labels: { part-of: seaweedfs-phase6 } }
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 600
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: v
          image: nhdw/gateway:1.0.0
          imagePullPolicy: Never
          command: ["python3","/v/processed_verify.py"]
          env:
            - { name: T0, value: "$T0" }
            - { name: SW, value: "$SW" }
            - { name: MN, value: "$MN" }
            - { name: AK, valueFrom: { secretKeyRef: { name: seaweedfs-secrets, key: ADMIN_ACCESS_KEY } } }
            - { name: SK, valueFrom: { secretKeyRef: { name: seaweedfs-secrets, key: ADMIN_SECRET_KEY } } }
          volumeMounts: [ { name: v, mountPath: /v, readOnly: true } ]
      volumes: [ { name: v, configMap: { name: g2-proc-verify } } ]
Y
kubectl -n "$NS" wait --for=condition=complete job/g2-proc-verify --timeout=300s >/dev/null 2>&1 || true
kubectl -n "$NS" logs job/g2-proc-verify 2>&1 | grep -v "^KEYS" | tee "$EVIDENCE/processed-dag-run.txt" | sed 's/^/  /'
kubectl -n "$NS" delete job g2-proc-verify configmap/g2-proc-verify --ignore-not-found >/dev/null 2>&1
echo "== done. PASS = task SUCCESS + LAKE_BASE=seaweedfs in the pod env + 'SeaweedFS keys rewritten … 65/65' + 'MinIO keys modified today: 0'"
