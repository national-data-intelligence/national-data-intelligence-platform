#!/usr/bin/env bash
# Phase 6 rollback / Phase 7 pre-cutover tool — reconcile a delta between the two stores.
# WRITTEN FOR THE PLAN; NOT YET RUN. Dry-run by default; never deletes.
#
#   reconcile.sh --from seaweedfs --to minio     --buckets nhdw-raw,nhdw-processed [--apply]
#   reconcile.sh --from minio     --to seaweedfs --buckets all                     [--apply]
#
# Runs in-cluster as a Job on the gateway image with BOTH credential sets mounted, so no
# secret leaves the cluster. Delta = keys on FROM absent on TO, or same key with a
# different size (same-size keys compared by sha256 of the body). Copies preserve
# Content-Type and user metadata. Keys deleted on FROM but present on TO are REPORTED,
# never removed. The delta report is written to ~/nhdw-backups/reconcile-<stamp>.json.
set -euo pipefail
NS="${NS:-nhdw}"; FROM=""; TO=""; BUCKETS="all"; APPLY="0"
while [ $# -gt 0 ]; do case "$1" in --from) FROM=$2; shift 2;; --to) TO=$2; shift 2;; --buckets) BUCKETS=$2; shift 2;; --apply) APPLY=1; shift;; *) echo "unknown arg $1" >&2; exit 2;; esac; done
[ -n "$FROM" ] && [ -n "$TO" ] && [ "$FROM" != "$TO" ] || { echo "need --from X --to Y (minio|seaweedfs)" >&2; exit 2; }
ep(){ case "$1" in minio) echo "http://minio-datalake.$NS.svc.cluster.local:9000";; seaweedfs) echo "http://seaweedfs-s3.$NS.svc.cluster.local:8333";; esac; }
sec(){ case "$1" in minio) echo "minio-secrets ROOT_USER ROOT_PASSWORD";; seaweedfs) echo "seaweedfs-secrets ADMIN_ACCESS_KEY ADMIN_SECRET_KEY";; esac; }
read -r FS FAK FSK <<<"$(sec $FROM)"; read -r TS TAK TSK <<<"$(sec $TO)"
STAMP=$(date -u +%Y%m%dT%H%M%SZ); mkdir -p ~/nhdw-backups
kubectl delete job -n "$NS" seaweedfs-reconcile --ignore-not-found >/dev/null
kubectl create configmap -n "$NS" seaweedfs-reconcile-tool --from-file=reconcile.py="$(dirname "${BASH_SOURCE[0]}")/reconcile.py" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
cat <<Y | kubectl apply -f - >/dev/null
apiVersion: batch/v1
kind: Job
metadata: { name: seaweedfs-reconcile, namespace: $NS, labels: { part-of: seaweedfs } }
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 86400
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: reconcile
          image: nhdw/gateway:1.0.0
          imagePullPolicy: IfNotPresent
          command: ["python3","/tool/reconcile.py"]
          env:
            - { name: FROM_ENDPOINT, value: "$(ep $FROM)" }
            - { name: TO_ENDPOINT,   value: "$(ep $TO)" }
            - { name: BUCKETS,       value: "$BUCKETS" }
            - { name: APPLY,         value: "$APPLY" }
            - { name: BOTO_EXPERIMENTAL__NO_EMPTY_CONTINUE, value: "true" }
            - { name: FROM_AK, valueFrom: { secretKeyRef: { name: $FS, key: $FAK } } }
            - { name: FROM_SK, valueFrom: { secretKeyRef: { name: $FS, key: $FSK } } }
            - { name: TO_AK,   valueFrom: { secretKeyRef: { name: $TS, key: $TAK } } }
            - { name: TO_SK,   valueFrom: { secretKeyRef: { name: $TS, key: $TSK } } }
          volumeMounts: [ { name: tool, mountPath: /tool, readOnly: true } ]
      volumes: [ { name: tool, configMap: { name: seaweedfs-reconcile-tool } } ]
Y
kubectl wait -n "$NS" --for=condition=complete job/seaweedfs-reconcile --timeout=1800s >/dev/null 2>&1 || true
kubectl logs -n "$NS" job/seaweedfs-reconcile > ~/nhdw-backups/reconcile-$STAMP.log 2>&1; grep -E "^\{" ~/nhdw-backups/reconcile-$STAMP.log > ~/nhdw-backups/reconcile-$STAMP.json || true
grep -vE "^\{" ~/nhdw-backups/reconcile-$STAMP.log | tail -20; echo "report: ~/nhdw-backups/reconcile-$STAMP.json"
