#!/usr/bin/env bash
# Phase 5 step 3 — the exit gate: counts, sizes, sha256 per bucket, in-cluster.
set -euo pipefail
NS="${NS:-nhdw}"; B=$(cat ~/nhdw-backups/.latest); BN=$(basename "$B")
kubectl delete job -n "$NS" seaweedfs-verify-data --ignore-not-found >/dev/null
cat <<Y | kubectl apply -f - >/dev/null
apiVersion: batch/v1
kind: Job
metadata: { name: seaweedfs-verify-data, namespace: $NS, labels: { part-of: seaweedfs } }
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 86400
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: verify
          image: nhdw/gateway:1.0.0
          imagePullPolicy: IfNotPresent
          command: ["python3","/tools/verify_against_manifest.py","/backups/$BN"]
          env:
            - { name: S3_ENDPOINT, value: "http://seaweedfs-s3.$NS.svc.cluster.local:8333" }
            - { name: S3_ACCESS_KEY, valueFrom: { secretKeyRef: { name: seaweedfs-secrets, key: ADMIN_ACCESS_KEY } } }
            - { name: S3_SECRET_KEY, valueFrom: { secretKeyRef: { name: seaweedfs-secrets, key: ADMIN_SECRET_KEY } } }
          volumeMounts:
            - { name: tools,   mountPath: /tools,   readOnly: true }
            - { name: backups, mountPath: /backups, readOnly: true }
      volumes:
        - { name: tools,   configMap: { name: seaweedfs-migrate-tools } }
        - { name: backups, hostPath: { path: $HOME/nhdw-backups, type: Directory } }
Y
kubectl wait -n "$NS" --for=condition=complete job/seaweedfs-verify-data --timeout=900s; kubectl logs -n "$NS" job/seaweedfs-verify-data | tail -10
