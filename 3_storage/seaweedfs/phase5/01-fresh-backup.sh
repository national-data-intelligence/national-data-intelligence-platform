#!/usr/bin/env bash
# Phase 5 step 1 — fresh S3-layer backup of MinIO (same method as Phase 3; creds stay in the pod).
set -euo pipefail
NS="${NS:-nhdw}"; POD=$(kubectl get pod -n "$NS" -l app=minio-datalake -o name | head -1)
STAMP=$(date -u +%Y%m%dT%H%M%SZ); B=~/nhdw-backups/minio-s3-backup-$STAMP; mkdir -p "$B/manifest" "$B/objects"; echo "$B" > ~/nhdw-backups/.latest
BUCKETS="nhdw-raw nhdw-processed nhdw-archive nhdw-artifacts nhdw-static nhdw-docs nhdw-exports"
for kind in ls stat; do
  kubectl exec -n "$NS" "$POD" -- sh -c "mc alias set l http://localhost:9000 \"\$MINIO_ROOT_USER\" \"\$MINIO_ROOT_PASSWORD\" >/dev/null; for b in $BUCKETS; do echo \"===BUCKET=== \$b\"; mc $kind --recursive --json l/\$b 2>/dev/null; done; true" > "$B/manifest/$kind.jsonl"
done
kubectl exec -n "$NS" "$POD" -- sh -c "mc alias set l http://localhost:9000 \"\$MINIO_ROOT_USER\" \"\$MINIO_ROOT_PASSWORD\" >/dev/null; for b in $BUCKETS; do mc find l/\$b 2>/dev/null | while read -r p; do echo \"===OBJ=== \${p#l/}\"; mc cat \"\$p\" </dev/null | base64 -w0; echo; done; done; true" \
  | python3 "$(dirname "${BASH_SOURCE[0]}")/../migrate/decode_stream.py" "$B"
python3 - "$B" <<'PY'
import sys,json,os
B=sys.argv[1]; exp={}; bucket=None
for line in open(f"{B}/manifest/ls.jsonl"):
    if line.startswith("===BUCKET==="): bucket=line.split()[1]; continue
    try: d=json.loads(line)
    except ValueError: continue
    if d.get("type")=="file": exp[f"{bucket}/{d['key']}"]=d["size"]
missing=[k for k in exp if not os.path.exists(f"{B}/objects/{k}")]; wrong=[k for k in exp if k not in missing and os.path.getsize(f"{B}/objects/{k}")!=exp[k]]
print(f"manifest keys {len(exp)}  missing {len(missing)}  size-mismatch {len(wrong)}"); sys.exit(1 if missing or wrong else 0)
PY
tar czf "$B.tar.gz" -C "$(dirname "$B")" "$(basename "$B")"; echo "✓ fresh backup verified: $B (+ .tar.gz)"
