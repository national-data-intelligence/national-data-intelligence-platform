#!/usr/bin/env bash
# Phase 6 · Step 0 rollback rehearsal — prove the rollback path works, then roll FORWARD again.
#   NOTE (found in the first rehearsal): `kubectl apply` of a snapshot does NOT remove env
#   vars that were added with `kubectl set env` — apply only prunes fields it last applied
#   itself. Rollback must use `kubectl replace`, which restores the exact object.
#   1. REPLACE the Deployments with the pre-step0 snapshots (removes the two env additions; the
#      snapshot's image tag is the same, so the pod uses whatever image k3s holds for it —
#      the REBUILT one). This proves the k8s half. The image half (re-importing
#      images-pre-step0.tar) is root-only and is NOT exercised here; its artifact is present.
#   2. verify: env additions gone, pods Ready, endpoint still MinIO.
#   3. roll forward: re-apply the post-step0 snapshots; verify the env additions are back.
set -uo pipefail
NS=nhdw; S=~/nhdw-backups/phase6-snapshots; E=~/nhdw-backups/phase6-evidence/step0-rollback-$(date -u +%Y%m%dT%H%M%SZ); mkdir -p "$E"
fail=0; pass(){ echo "[PASS] $*"; }; failed(){ echo "[FAIL] $*"; fail=$((fail+1)); }; K(){ kubectl -n $NS "$@"; }
strip(){ python3 -c "
import sys,yaml
for d in yaml.safe_load_all(open(sys.argv[1])):
    if not d: continue
    for k in ('status',): d.pop(k,None)
    m=d['metadata']; [m.pop(k,None) for k in ('resourceVersion','uid','creationTimestamp','generation','managedFields')]
    m.get('annotations',{}).pop('deployment.kubernetes.io/revision',None)
    print('---'); print(yaml.safe_dump(d))" "$1"; }
echo "══ 1. ROLLBACK: re-apply pre-step0 snapshots ══"
PRE_A=$(K get pod -l app=airflow -o name | head -1); PRE_J=$(K get pods --no-headers | awk '/^jupyterhub-/{print $1}' | head -1)
for d in airflow jupyterhub; do strip "$S/deploy-$d.pre-step0.yaml" | K replace -f - 2>&1 | tail -1; sleep 3; done
K rollout status deploy/airflow --timeout=300s >/dev/null 2>&1 && K rollout status deploy/jupyterhub --timeout=300s >/dev/null 2>&1 && pass "rollback rollout Ready" || failed "rollback rollout"
a=$(K get deploy airflow -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="NHDW_S3_ENDPOINT")].value}'); b=$(K get deploy jupyterhub -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="BOTO_EXPERIMENTAL__NO_EMPTY_CONTINUE")].value}')
[ -z "$a" ] && [ -z "$b" ] && pass "env additions removed (NHDW_S3_ENDPOINT='', BOTO='')" || failed "env still present: '$a' '$b'"
POST_A=$(K get pod -l app=airflow -o name | head -1); POST_J=$(K get pods --no-headers | awk '/^jupyterhub-/{print $1}' | head -1)
[ "$PRE_A" != "$POST_A" ] && [ "$PRE_J" != "$POST_J" ] && pass "pods actually replaced on rollback ($POST_A, $POST_J)" || failed "pods NOT replaced — rollback was a no-op"
d=$(K exec deploy/airflow -c scheduler -- python3 -c "import sys; sys.path.insert(0,'/opt/airflow/dags'); import pipeline_refresh as p; print(p.MINIO_URL)" 2>/dev/null | tail -1)
[ "$d" = "http://minio-datalake.$NS.svc.cluster.local:9000" ] && pass "with the env removed the DAG default still resolves to MinIO ($d)" || failed "DAG default after rollback: '$d'"
echo "══ 2. ROLL FORWARD: re-apply post-step0 snapshot ══"
python3 -c "
import sys,yaml
for d in yaml.safe_load_all(open(sys.argv[1])):
    if d and d.get('kind')=='List':
        for i in d['items']: open('${TMPDIR:-/tmp}/nhdw-step0/post-'+i['metadata']['name']+'.yaml','w').write(yaml.safe_dump(i))
" "$S/deploy-airflow+jupyterhub.post-step0.yaml"
for d in airflow jupyterhub; do strip ${TMPDIR:-/tmp}/nhdw-step0/post-$d.yaml | K replace -f - 2>&1 | tail -1; sleep 3; done
K rollout status deploy/airflow --timeout=300s >/dev/null 2>&1 && K rollout status deploy/jupyterhub --timeout=300s >/dev/null 2>&1 && pass "forward rollout Ready" || failed "forward rollout"
a=$(K get deploy airflow -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="NHDW_S3_ENDPOINT")].value}'); b=$(K get deploy jupyterhub -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="BOTO_EXPERIMENTAL__NO_EMPTY_CONTINUE")].value}')
[ "$a" = "http://minio-datalake.$NS.svc.cluster.local:9000" ] && [ "$b" = "true" ] && pass "env additions restored" || failed "forward env: '$a' '$b'"
K get pods -l 'app in (airflow,jupyterhub)' --no-headers | awk '{print "  "$1, $2, $3, $5}' | tee "$E/pods.txt"
echo; [ "$fail" = 0 ] && echo "ROLLBACK REHEARSAL: PASSED (k8s half proven; image half = root re-import of images-pre-step0.tar, artifact present: $(du -h $S/images-pre-step0.tar | cut -f1))" || echo "ROLLBACK REHEARSAL: $fail FAILURE(S)"; exit $fail
