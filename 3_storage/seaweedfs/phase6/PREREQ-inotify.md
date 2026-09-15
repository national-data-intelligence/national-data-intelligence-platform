# Infrastructure prerequisites for G3 (separate from the migration)

Two independent conditions were found; both must pass. Neither is a storage change.

# Prerequisite 1 — node inotify limit

**Status: OPEN. No G3 work starts until `prereq-inotify-check.sh` exits 0.**

## The condition
`fs.inotify.max_user_instances = 128` on the k3s node. The kubelet streams container logs
with an inotify watcher per follow; root's instances are exhausted, so **every**
`kubectl logs -f` on the node fails with `failed to create fsnotify watcher: too many open
files`. Airflow's KubernetesPodOperator follows pod logs the same way, so a task whose pod
exits 0 is still **marked failed** by Airflow (observed: `probe_lake` pod exit 0, task
UP_FOR_RETRY, baseline `phase6-baseline-*/airflow-probe_lake*.txt`). Airflow task status
therefore cannot be trusted, and G3's pipeline validation depends on it.

## The change (root — operator runs it in a real terminal)
```bash
# apply now
sudo sysctl -w fs.inotify.max_user_instances=1024
# persist across reboots
echo 'fs.inotify.max_user_instances=1024' | sudo tee /etc/sysctl.d/99-nhdw-inotify.conf
sudo sysctl --system >/dev/null && sysctl fs.inotify.max_user_instances
```
No restart of k3s or any pod is required; the limit is read per new watcher.
Rollback: `sudo rm /etc/sysctl.d/99-nhdw-inotify.conf && sudo sysctl -w fs.inotify.max_user_instances=128`.

## What must be true afterwards (the checklist; each is a line in the check script)
| # | Check | Pass criterion |
|---|---|---|
| I-1 | `sysctl fs.inotify.max_user_instances` | ≥ 1024 |
| I-2 | persisted | `/etc/sysctl.d/99-nhdw-inotify.conf` contains the value (survives reboot) |
| I-3 | log following works node-wide | `kubectl logs -f` on a long-running pod streams for 8 s with **no** `fsnotify`/`too many open files` line |
| I-4 | **Airflow agrees with Kubernetes** | `airflow tasks test pipeline_refresh probe_lake <date>`: the spawned runner pod exits 0 **and** Airflow logs `Marking task as SUCCESS` — both, in the same run |
| I-5 | Airflow's log follow is clean | the same task log contains no `fsnotify` / `too many open files` |
| I-6 | nothing else changed | no pod other than the probe pod restarted (identity diff) |

`probe_lake` is read-only (the ML runner lists the bucket and prints a fingerprint), so the
proving test writes nothing. It runs against MinIO — the endpoint is unchanged in Step 0.

# Prerequisite 2 — Airflow ServiceAccount lacks `pods/exec` (found once P1 was fixed)

## The condition
With log-following repaired, `probe_lake` still ended `UP_FOR_RETRY` while its pod exited 0.
The task log shows `WebSocketBadStatusException: Handshake status 403 Forbidden` from
`extract_xcom_json` → `connect_get_namespaced_pod_exec`: the KubernetesPodOperator reads a
task's return value by **exec-ing into the xcom sidecar**, and the `airflow` Role grants
`pods` and `pods/log` but **no `pods/exec`** (`kubectl auth can-i --list` as the SA; a direct
`kubectl exec --as=system:serviceaccount:nhdw:airflow <pod>` is Forbidden). So every task
with `do_xcom_push=True` — `probe_lake`, whose output gates the whole `pipeline_refresh`
DAG — is marked failed after succeeding. Pre-existing; explains why the DAG has never run.

## The change (Kubernetes RBAC — NOT root; needs the operator's approval because it edits a
live shared object)
Add to Role `airflow` (drafted in `base/airflow.yaml` and the chart template, dry-run OK):
```yaml
- apiGroups: [ "" ]
  resources: [ pods/exec ]
  verbs: [ get, create ]
```
Apply: `kubectl apply -f <rendered Role>` (only the Role object). Snapshot for rollback:
`phase6-snapshots/role-airflow.pre-prereq.yaml` → `kubectl replace -f` it.
Least privilege is preserved: exec is namespace-scoped to `nhdw` and is exactly the verb the
operator needs; nothing cluster-wide.

## What must be true afterwards
| # | Check | Pass criterion |
|---|---|---|
| I-7 | effective rules | `kubectl auth can-i --list --as=system:serviceaccount:nhdw:airflow -n nhdw` lists `pods/exec` |
| I-4 | (repeat) Airflow agrees with Kubernetes | `probe_lake`: pod exit 0 **and** `Marking task as SUCCESS` |

## Not in scope here
No migration change of any kind is made while this is open. G3 begins only after this passes
**and** an explicit go.
