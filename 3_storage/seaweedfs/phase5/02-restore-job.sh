#!/usr/bin/env bash
# Phase 5 step 2 — restore the latest backup INTO SeaweedFS from inside the cluster.
# hostPath mounts ~/nhdw-backups read-only into a Job on the gateway image (boto3); the
# admin credential comes from seaweedfs-secrets. MinIO is not involved.
set -euo pipefail
NS="${NS:-nhdw}"; HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; B=$(cat ~/nhdw-backups/.latest); BN=$(basename "$B")
kubectl delete job -n "$NS" seaweedfs-restore --ignore-not-found >/dev/null
kubectl create configmap -n "$NS" seaweedfs-migrate-tools --from-file=restore_from_backup.py="$HERE/../migrate/restore_from_backup.py" --from-file=verify_against_manifest.py="$HERE/../migrate/verify_against_manifest.py" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
cat <<Y | kubectl apply -f - >/dev/null
apiVersion: batch/v1
kind: Job
metadata: { name: seaweedfs-restore, namespace: $NS, labels: { part-of: seaweedfs } }
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 86400
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: restore
          image: nhdw/gateway:1.0.0
          imagePullPolicy: IfNotPresent
          command: ["python3","/tools/restore_from_backup.py","/backups/$BN"]
          env:
            - { name: S3_ENDPOINT, value: "http://seaweedfs-s3.$NS.svc.cluster.local:8333" }
            - { name: BOTO_EXPERIMENTAL__NO_EMPTY_CONTINUE, value: "true" }
            - { name: S3_ACCESS_KEY, valueFrom: { secretKeyRef: { name: seaweedfs-secrets, key: ADMIN_ACCESS_KEY } } }
            - { name: S3_SECRET_KEY, valueFrom: { secretKeyRef: { name: seaweedfs-secrets, key: ADMIN_SECRET_KEY } } }
          volumeMounts:
            - { name: tools,   mountPath: /tools,   readOnly: true }
            - { name: backups, mountPath: /backups, readOnly: true }
      volumes:
        - { name: tools,   configMap: { name: seaweedfs-migrate-tools } }
        - { name: backups, hostPath: { path: $HOME/nhdw-backups, type: Directory } }
Y
kubectl wait -n "$NS" --for=condition=complete job/seaweedfs-restore --timeout=1800s && kubectl logs -n "$NS" job/seaweedfs-restore | tail -12
