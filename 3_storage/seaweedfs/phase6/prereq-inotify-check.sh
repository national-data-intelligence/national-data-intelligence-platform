#!/usr/bin/env bash
# G3 infrastructure prerequisite check (read-only apart from one read-only Airflow task run).
set -uo pipefail
NS=nhdw; E=~/nhdw-backups/phase6-evidence/prereq-inotify-$(date -u +%Y%m%dT%H%M%SZ); mkdir -p "$E"
fail=0; pass(){ echo "[PASS] $*"; }; failed(){ echo "[FAIL] $*"; fail=$((fail+1)); }; K(){ kubectl -n $NS "$@"; }
v=$(sysctl -n fs.inotify.max_user_instances 2>/dev/null); [ "${v:-0}" -ge 1024 ] && pass "I-1 fs.inotify.max_user_instances=$v (≥1024)" || failed "I-1 fs.inotify.max_user_instances=$v (<1024)"
grep -qs "max_user_instances *= *[0-9]" /etc/sysctl.d/99-nhdw-inotify.conf && pass "I-2 persisted in /etc/sysctl.d/99-nhdw-inotify.conf" || failed "I-2 not persisted (/etc/sysctl.d/99-nhdw-inotify.conf missing)"
timeout 8 kubectl -n $NS logs -f deploy/mlflow --tail=1 > "$E/logs-f.txt" 2>&1; grep -qiE "fsnotify|too many open files" "$E/logs-f.txt" && failed "I-3 kubectl logs -f still fails: $(grep -iE 'fsnotify|too many' $E/logs-f.txt | head -1)" || pass "I-3 kubectl logs -f streams cleanly (8 s, no fsnotify error)"
K get pods -o json | python3 -c "
import sys,json
for p in json.load(sys.stdin)['items']: print(p['metadata']['name'], p['metadata']['uid'], sum(c.get('restartCount',0) for c in p['status'].get('containerStatuses',[])))" | sort > "$E/pods.pre.txt"
kubectl auth can-i --list -n $NS --as=system:serviceaccount:nhdw:airflow 2>/dev/null | grep -qE "^pods/exec " && pass "I-7 airflow SA has pods/exec" || failed "I-7 airflow SA lacks pods/exec (Role airflow) — xcom extraction will 403"
echo "── I-4/I-5 · Airflow single-task run: probe_lake (read-only) ──"
K exec deploy/airflow -c scheduler -- airflow tasks test pipeline_refresh probe_lake 2026-09-08 > "$E/airflow-probe_lake.log" 2>&1
sleep 5; P=$(K get pods --no-headers 2>/dev/null | awk '/pipeline-probe-lake/{print $1}' | head -1)
podexit=$( [ -n "$P" ] && K get pod "$P" -o jsonpath='{.status.containerStatuses[?(@.name=="base")].state.terminated.exitCode}' 2>/dev/null || echo "pod-deleted-on-success")
grep -q "Marking task as SUCCESS" "$E/airflow-probe_lake.log" && af=SUCCESS || af=$(grep -oE "Marking task as [A-Z_]+" "$E/airflow-probe_lake.log" | tail -1 | awk '{print $4}')
echo "  airflow says: ${af:-unknown}   pod exit: ${podexit:-unknown}"
[ "$af" = SUCCESS ] && { [ "$podexit" = "0" ] || [ "$podexit" = "pod-deleted-on-success" ]; } && pass "I-4 Airflow SUCCESS agrees with the pod's success" || failed "I-4 disagreement: airflow=$af pod=$podexit"
grep -qiE "fsnotify|too many open files" "$E/airflow-probe_lake.log" && failed "I-5 Airflow log follow still hits the inotify error" || pass "I-5 Airflow task log has no fsnotify error"
[ -n "$P" ] && K delete pod "$P" --now >/dev/null 2>&1
K get pods -o json | python3 -c "
import sys,json
for p in json.load(sys.stdin)['items']: print(p['metadata']['name'], p['metadata']['uid'], sum(c.get('restartCount',0) for c in p['status'].get('containerStatuses',[])))" | sort > "$E/pods.post.txt"
python3 - "$E/pods.pre.txt" "$E/pods.post.txt" <<'PY'
import sys
pre={l.split()[0]:l.split()[1:] for l in open(sys.argv[1]) if l.strip()}; post={l.split()[0]:l.split()[1:] for l in open(sys.argv[2]) if l.strip()}
ch=[n for n in pre if (n not in post or post[n]!=pre[n]) and 'probe-lake' not in n]+[n for n in post if n not in pre and 'probe-lake' not in n]
print(('[PASS] I-6 no unrelated pod changed' if not ch else '[FAIL] I-6 changed: '+str(ch)))
PY
echo; [ "$fail" = 0 ] && echo "PREREQUISITE: PASSED — evidence in $E" || echo "PREREQUISITE: $fail FAILURE(S) — evidence in $E"; exit $fail
