#!/usr/bin/env bash
# Phase 6 · Step 0 verification. Proves, at RUNTIME, that after the rebuilds:
#   V-ENDPOINT  the affected workloads still resolve to MinIO (env + a spawned pod)
#   V-SEAM      the env-based endpoint is CONSUMED by the DAG code (override in a subshell
#               changes the value; default equals the MinIO URL) — no repoint happens
#   V-LAB       a real notebook pod spawned through the hub API carries the workaround
#               var and the MinIO sync endpoint
#   V-ZERO      zero-byte-then-data PUT against MinIO with EACH affected image + the var,
#               and a normal write/readback/delete — nothing broken
#   V-UNRELATED no pod other than airflow/jupyterhub (and test pods) restarted
#   digests     new running digests recorded next to the pre-step0 ones
set -uo pipefail
NS=nhdw; S=~/nhdw-backups/phase6-snapshots; E=~/nhdw-backups/phase6-evidence/step0-$(date -u +%Y%m%dT%H%M%SZ); mkdir -p "$E"
MINIO="http://minio-datalake.$NS.svc.cluster.local:9000"; BOTO=BOTO_EXPERIMENTAL__NO_EMPTY_CONTINUE
fail=0; pass(){ echo "[PASS] $*"; }; failed(){ echo "[FAIL] $*"; fail=$((fail+1)); }; K(){ kubectl -n $NS "$@"; }

echo "══ digests after ══"
K get pods -o json | python3 -c "
import sys,json; seen={}
for p in json.load(sys.stdin)['items']:
    for c in p['status'].get('containerStatuses',[]):
        if any(k in c['image'] for k in ('nhdw/airflow','nhdw/jupyterhub','nhdw/ml-runner')): seen[c['image']]=c['imageID']
for k,v in sorted(seen.items()): print(f'  {k:<32} {v}')" | tee "$E/image-digests.post-step0.txt"
cp "$E/image-digests.post-step0.txt" "$S/"; diff <(sort "$S/image-digests.pre-step0.txt") <(sort "$S/image-digests.post-step0.txt") >/dev/null && failed "digests unchanged — new images NOT running" || pass "airflow/jupyterhub digests changed (rebuilt images running)"

echo "══ V-ENDPOINT · workloads still resolve to MinIO ══"
for d in airflow jupyterhub nhdw-gateway mlflow; do
  v=$(K get deploy $d -o json | python3 -c "
import sys,json; d=json.load(sys.stdin); out=[]
for c in d['spec']['template']['spec']['containers']:
    for e in c.get('env',[]):
        if e['name'] in ('NHDW_S3_ENDPOINT','MINIO_ENDPOINT','MLFLOW_S3_ENDPOINT_URL'): out.append(e['name']+'='+e.get('value',''))
print(' '.join(sorted(set(out))))")
  echo "  $d: $v" | tee -a "$E/endpoints.txt"; echo "$v" | grep -q "seaweedfs" && failed "$d references SeaweedFS" || true
done
K exec deploy/airflow -c scheduler -- printenv NHDW_S3_ENDPOINT | grep -q "^$MINIO$" && pass "scheduler runtime env NHDW_S3_ENDPOINT = MinIO" || failed "scheduler NHDW_S3_ENDPOINT wrong/missing"

echo "══ V-SEAM · env-based endpoint is CONSUMED by the DAG code (in the running scheduler) ══"
d=$(K exec deploy/airflow -c scheduler -- python3 -c "import sys; sys.path.insert(0,'/opt/airflow/dags'); import pipeline_refresh as p; print(p.MINIO_URL)" 2>/dev/null | tail -1)
o=$(K exec deploy/airflow -c scheduler -- sh -c "NHDW_S3_ENDPOINT=http://seam-probe.invalid:1 python3 -c \"import sys; sys.path.insert(0,'/opt/airflow/dags'); import pipeline_refresh as p; print(p.MINIO_URL)\"" 2>/dev/null | tail -1)
echo "  default → $d" | tee "$E/seam.txt"; echo "  override → $o" | tee -a "$E/seam.txt"
[ "$d" = "$MINIO" ] && pass "V-SEAM default resolves to MinIO" || failed "V-SEAM default is '$d'"
[ "$o" = "http://seam-probe.invalid:1" ] && pass "V-SEAM override is honoured (seam is live, nothing repointed)" || failed "V-SEAM override ignored ('$o')"
for f in ml_batch_predict ml_drift_check; do x=$(K exec deploy/airflow -c scheduler -- sh -c "NHDW_S3_ENDPOINT=http://x:1 python3 -c \"import sys; sys.path.insert(0,'/opt/airflow/dags'); import $f as p; print(p.MINIO_URL)\"" 2>/dev/null | tail -1); [ "$x" = "http://x:1" ] && pass "V-SEAM $f honours env" || failed "V-SEAM $f: '$x'"; done

echo "══ V-SPAWN · a DAG-spawned pod gets MinIO + the workaround var (probe_lake, read-only) ══"
K exec deploy/airflow -c scheduler -- airflow tasks test pipeline_refresh probe_lake 2026-09-08 > "$E/airflow-probe_lake.log" 2>&1 &
for i in $(seq 1 40); do P=$(K get pods --no-headers 2>/dev/null | awk '/pipeline-probe-lake/{print $1}' | head -1); [ -n "$P" ] && break; sleep 3; done
wait
if [ -n "${P:-}" ]; then
  K get pod "$P" -o json 2>/dev/null | python3 -c "
import sys,json; d=json.load(sys.stdin); c=d['spec']['containers'][0]; env={e['name']:e.get('value','') for e in c.get('env',[])}
print('  spawned pod env: MLFLOW_S3_ENDPOINT_URL=',env.get('MLFLOW_S3_ENDPOINT_URL'),' $BOTO=',env.get('$BOTO')); print('  image:',c['image'],'| imageID:',[s['imageID'] for s in d['status'].get('containerStatuses',[]) if s['name']==c['name']])
print('  runner exit:',[s['state'].get('terminated',{}).get('exitCode') for s in d['status'].get('containerStatuses',[]) if s['name']==c['name']])" | tee "$E/spawned-pod.txt"
  grep -q "MLFLOW_S3_ENDPOINT_URL= $MINIO " "$E/spawned-pod.txt" && pass "V-SPAWN spawned pod endpoint = MinIO" || failed "V-SPAWN endpoint not MinIO"
  grep -q "$BOTO= true" "$E/spawned-pod.txt" && pass "V-SPAWN spawned pod carries $BOTO" || failed "V-SPAWN var missing"
  grep -q "runner exit: \[0\]" "$E/spawned-pod.txt" && pass "V-SPAWN runner container exited 0 (probe-lake)" || failed "V-SPAWN runner did not exit 0"
  grep -q "too many open files" "$E/airflow-probe_lake.log" && echo "  [NOTE] Airflow log-follow still fails (pre-existing inotify limit — recorded blocker, untouched)"
  K delete pod "$P" --now >/dev/null 2>&1
else failed "V-SPAWN no probe pod appeared"; fi

echo "══ V-LAB · real notebook pod via the hub API (test user step0-probe, removed after) ══"
HUB=$(K get pods --no-headers | awk '/^jupyterhub-/{print $1}' | head -1)
K exec "$HUB" -c hub -- sh -c '
H=http://localhost:8081/hub/api; A="Authorization: token $GATEWAY_API_TOKEN"
curl -s -o /dev/null -w "create user: %{http_code}\n" -X POST -H "$A" $H/users/step0-probe
curl -s -o /dev/null -w "spawn: %{http_code}\n" -X POST -H "$A" $H/users/step0-probe/server' 2>&1 | sed 's/^/  /' | tee "$E/lab-spawn.txt"
for i in $(seq 1 40); do LP=$(K get pods --no-headers 2>/dev/null | awk '/jupyter-step0-probe|step0-probe/{print $1}' | head -1); [ -n "$LP" ] && [ "$(K get pod $LP -o jsonpath='{.status.phase}' 2>/dev/null)" != "Pending" ] && break; sleep 3; done
if [ -n "${LP:-}" ]; then
  K get pod "$LP" -o json | python3 -c "
import sys,json; d=json.load(sys.stdin); c=d['spec']['containers'][0]; env={e['name']:e.get('value','') for e in c.get('env',[])}
print('  lab pod:',d['metadata']['name'],'| $BOTO=',env.get('$BOTO'),'| NHDW_SYNC_ENDPOINT=',env.get('NHDW_SYNC_ENDPOINT','(unset: non-project lab)'))" | tee -a "$E/lab-spawn.txt"
  grep -q "$BOTO= true" "$E/lab-spawn.txt" && pass "V-LAB notebook pod carries $BOTO" || failed "V-LAB var missing in lab pod"
  grep -q "seaweedfs" "$E/lab-spawn.txt" && failed "V-LAB lab points at SeaweedFS" || pass "V-LAB lab does not reference SeaweedFS"
else failed "V-LAB no lab pod appeared (see lab-spawn.txt)"; fi
K exec "$HUB" -c hub -- sh -c 'H=http://localhost:8081/hub/api; A="Authorization: token $GATEWAY_API_TOKEN"; curl -s -o /dev/null -w "stop: %{http_code} " -X DELETE -H "$A" $H/users/step0-probe/server; sleep 5; curl -s -o /dev/null -w "delete user: %{http_code}\n" -X DELETE -H "$A" $H/users/step0-probe' 2>&1 | sed 's/^/  cleanup /'

echo "══ V-ZERO · each affected image, against MinIO, with the workaround var ══"
zero_job(){ # name image creds-secret ak sk bucket prefix
  local n=$1 img=$2 sec=$3 ak=$4 sk=$5 b=$6 pre=$7
  K delete job "step0-zero-$n" --ignore-not-found >/dev/null 2>&1
  cat <<Y | K apply -f - >/dev/null
apiVersion: batch/v1
kind: Job
metadata: { name: step0-zero-$n, namespace: $NS, labels: { part-of: seaweedfs-phase6 } }
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 3600
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: t
          image: $img
          imagePullPolicy: Never
          command: ["python3","-c","import os,time,boto3,sys\nfrom botocore.client import Config\ns=boto3.client('s3',endpoint_url=os.environ['EP'],region_name='us-east-1',aws_access_key_id=os.environ['AK'],aws_secret_access_key=os.environ['SK'],config=Config(signature_version='s3v4',s3={'addressing_style':'path'},connect_timeout=5,read_timeout=15,retries={'max_attempts':1}))\nB=os.environ['B'];P=os.environ['P']\nt=time.time();s.put_object(Bucket=B,Key=P+'d1',Body=b'x'*200);s.put_object(Bucket=B,Key=P+'zero',Body=b'');t2=time.time();s.put_object(Bucket=B,Key=P+'d2',Body=b'y'*300);dt=(time.time()-t2)*1000\nback=s.get_object(Bucket=B,Key=P+'d2')['Body'].read();ok=back==b'y'*300\nif os.environ.get('NODELETE')!='1':\n  for k in ('d1','zero','d2'): s.delete_object(Bucket=B,Key=P+k)\nprint(f'put-after-empty={dt:.0f}ms readback_ok={ok} var={os.environ.get(\"$BOTO\")}')\nsys.exit(0 if ok and dt<1000 else 1)"]
          env:
            - { name: EP, value: "$MINIO" }
            - { name: B, value: "$b" }
            - { name: P, value: "$pre" }
            - { name: $BOTO, value: "true" }
            - { name: NODELETE, value: "${NODELETE:-0}" }
            - { name: AK, valueFrom: { secretKeyRef: { name: $sec, key: $ak } } }
            - { name: SK, valueFrom: { secretKeyRef: { name: $sec, key: $sk } } }
Y
  if K wait --for=condition=complete "job/step0-zero-$n" --timeout=180s >/dev/null 2>&1; then r=$(K logs "job/step0-zero-$n" 2>/dev/null | tail -1); echo "  $n ($img): $r" | tee -a "$E/zero.txt"; pass "V-ZERO $n"; else echo "  $n: $(K logs job/step0-zero-$n 2>/dev/null | tail -2 | tr '\n' ' ')" | tee -a "$E/zero.txt"; failed "V-ZERO $n"; fi
  K delete job "step0-zero-$n" --ignore-not-found >/dev/null 2>&1
}
zero_job runner     nhdw/ml-runner:1.0.0    minio-secrets ROOT_USER ROOT_PASSWORD nhdw-exports   _step0/runner/
zero_job stagingdbt nhdw/staging-dbt:1.0.0  minio-secrets ROOT_USER ROOT_PASSWORD nhdw-exports   _step0/dbt/
NODELETE=1 zero_job jupyterlab nhdw/jupyterlab:1.0.0   minio-secrets PROJECT_SYNC_ACCESS_KEY PROJECT_SYNC_SECRET_KEY nhdw-artifacts projects/_step0/   # identity has no DeleteObject on MinIO by design
# the dlt path (ingestor image, aiobotocore): real dlt load into an EMPTY bucket prefix, then cleanup
K delete job step0-zero-dlt --ignore-not-found >/dev/null 2>&1
K create configmap step0-dlt-probe --from-file=dlt_probe.py="$(dirname "${BASH_SOURCE[0]}")/../poc/dlt_probe.py" --dry-run=client -o yaml | K apply -f - >/dev/null
cat <<Y | K apply -f - >/dev/null
apiVersion: batch/v1
kind: Job
metadata: { name: step0-zero-dlt, namespace: $NS, labels: { part-of: seaweedfs-phase6 } }
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 3600
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: dlt
          image: nhdw/dhis2-ingestor:1.0.0
          imagePullPolicy: Never
          command: ["python3","/probe/dlt_probe.py"]
          env:
            - { name: MINIO_ENDPOINT, value: "$MINIO" }
            - { name: MINIO_REGION, value: "et-addis-1" }
            - { name: DLT_BUCKET, value: "nhdw-exports" }
            - { name: $BOTO, value: "true" }
            - { name: MINIO_ACCESS_KEY, valueFrom: { secretKeyRef: { name: minio-secrets, key: ROOT_USER } } }
            - { name: MINIO_SECRET_KEY, valueFrom: { secretKeyRef: { name: minio-secrets, key: ROOT_PASSWORD } } }
          volumeMounts: [ { name: probe, mountPath: /probe, readOnly: true } ]
      volumes: [ { name: probe, configMap: { name: step0-dlt-probe } } ]
Y
if K wait --for=condition=complete job/step0-zero-dlt --timeout=600s >/dev/null 2>&1; then K logs job/step0-zero-dlt 2>/dev/null | grep -E "LOADED|completed jobs" | sed 's/^/  dlt: /' | tee -a "$E/zero.txt"; pass "V-ZERO dlt (ingestor image, aiobotocore) load to MinIO with the var"; else failed "V-ZERO dlt: $(K logs job/step0-zero-dlt 2>/dev/null | tail -2 | tr '\n' ' ')"; fi
K delete job step0-zero-dlt --ignore-not-found >/dev/null 2>&1; K delete configmap step0-dlt-probe --ignore-not-found >/dev/null 2>&1
# cleanup of the dlt probe's keys in nhdw-exports (inside the MinIO pod; creds stay there)
MP=$(K get pod -l app=minio-datalake -o name | head -1)
K exec "$MP" -- sh -c 'mc alias set l http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; mc rm --recursive --force l/nhdw-exports/dhis2 >/dev/null 2>&1; mc rm --recursive --force l/nhdw-exports/_step0 >/dev/null 2>&1; mc rm --recursive --force l/nhdw-artifacts/projects/_step0 >/dev/null 2>&1; echo "  nhdw-artifacts/projects/_step0 after cleanup: $(mc ls --recursive l/nhdw-artifacts/projects/_step0 2>/dev/null | wc -l)"; echo "  nhdw-exports objects after cleanup: $(mc ls --recursive l/nhdw-exports 2>/dev/null | wc -l)"' | tee -a "$E/zero.txt"

echo "══ V-UNRELATED · did anything other than airflow/jupyterhub restart? ══"
K get pods -o json | python3 -c "
import sys,json
for p in json.load(sys.stdin)['items']:
    rs=sum(c.get('restartCount',0) for c in p['status'].get('containerStatuses',[]))
    print(p['metadata']['name'], p['metadata']['uid'], p['status'].get('startTime'), rs)" | sort > "$E/pods.post-step0.txt"
python3 - "$S/pods.pre-step0.txt" "$E/pods.post-step0.txt" <<'PY'
import sys,re
pre={l.split()[0]:l.split()[1:] for l in open(sys.argv[1]) if l.strip()}; post={l.split()[0]:l.split()[1:] for l in open(sys.argv[2]) if l.strip()}
def base(n): return re.sub(r'-[a-z0-9]{5,10}(-[a-z0-9]{5})?$','',n)
expected=('airflow','jupyterhub'); ignore=('step0-','pipeline-probe','jupyter-step0','seaweedfs-verify','seaweedfs-reconcile','seaweedfs-dlt','seaweedfs-4a')
changed=[]
for n,v in pre.items():
    if any(n.startswith(i) for i in ignore): continue
    if n not in post: changed.append((n,'gone'))
    elif post[n][2]!=v[2]: changed.append((n,f'restarts {v[2]}→{post[n][2]}'))
new=[n for n in post if n not in pre and not any(n.startswith(i) for i in ignore)]
unexpected=[c for c in changed if not any(base(c[0]).startswith(e) for e in expected)]+[(n,'new') for n in new if not any(base(n).startswith(e) for e in expected)]
print('  expected restarts:',[c for c in changed if any(base(c[0]).startswith(e) for e in expected)]+[n for n in new if any(base(n).startswith(e) for e in expected)])
print('  UNEXPECTED:',unexpected or 'none')
sys.exit(1 if unexpected else 0)
PY
[ $? = 0 ] && pass "V-UNRELATED no unrelated pod restarted or changed" || failed "V-UNRELATED see above"

echo; [ "$fail" = 0 ] && echo "STEP 0 VERIFICATION: ALL PASSED — evidence in $E" || echo "STEP 0 VERIFICATION: $fail FAILURE(S) — evidence in $E"; exit $fail
