# Soak and decommission checklist — MinIO → SeaweedFS (Phases 7 and 8)

**State on 2026-09-09 13:40 UTC.** Every consumer except `nhdw-archive` (no writer) talks to
SeaweedFS. MinIO still runs, untouched, holding the rollback copies frozen at:
`nhdw-static` 2026-09-08 22:18Z · `nhdw-raw`/`nhdw-processed` 2026-09-09 10:45–10:47Z ·
`nhdw-artifacts`/`nhdw-exports`/`nhdw-docs` 2026-09-09 11:51Z.
Ledger: `../phase6/LEDGER.md` (closure rows P6-C.G3 / P6-C.G2). Backup of the SeaweedFS
state: `~/nhdw-backups/objstore-20260909T133837Z/` (516 files, sha256 manifest).

**Rule: MinIO is not removed, scaled down, or emptied until the agreed soak period has
completed and every box in section 1 is ticked.** Nothing in this file deletes data.

---

## 0 · Open residuals (carry into the soak, close as they are resolved)

| # | Residual | Blocker for | Owner | How it closes |
|---|---|---|---|---|
| a | DAG-driven `processed_zone` proof: rebuilt Airflow image (docker `9187221c5555`) not yet imported | Phase 7 | operator (root) | `docker save nhdw/airflow:1.0.0 \| sudo k3s ctr images import -` then `bash 3_storage/seaweedfs/phase6/g3-residual-a-close.sh` → PASS = task SUCCESS, pod env `LAKE_BASE=seaweedfs`, 65/65 processed keys rewritten on SeaweedFS, MinIO 0 |
| b | Placeholder DAG rows `ch_raw_views`, `dbt_vault`, `dbt_marts`, `publish_datasets` (no command → `dbt --help`, exit 0) | nothing in the migration (Jobs are the working path) | Biniyam | wire like `processed_zone` (`_CMDS`), rebuild the image |
| c | Pod `bridge-sync-4uhxg2li` in Error (first G3 attempt) | nothing | Biniyam / operator | `kubectl -n nhdw delete pod bridge-sync-4uhxg2li` when convenient |
| d | Validation residue on SeaweedFS: 25 keys under `nhdw-artifacts/mlflow/18…24/` and `ml-adhoc/ml-adhoc-ears-{7704b4d1,38deaebf}/`, 4 exports by the demo superadmin, 7 soft-deleted MLflow experiments `_phase6_g2_*` | nothing | operator | delete with root creds on SeaweedFS if unwanted (ledger P6-3.K lists every key); never automatic |
| — | eLMIS (Zambian data) decision | not a migration item | team | see `0_external/sources/OpenLMIS/README.md` |

## 1 · Soak period (proposed 14 days from 2026-09-09; the team sets the length)

Daily, or at least three times spread over the period, from the VM:

- [ ] `kubectl -n nhdw get pods | grep -vE 'Running|Completed'` shows nothing new (baseline: `hubble-relay` leftovers in kube-system, `bridge-sync-4uhxg2li`).
- [ ] `bash 3_storage/seaweedfs/phase4/04a-verify.sh` — the 20-check gate still passes (health, identities, restart-write, ClickHouse read/write, dlt write).
- [ ] `NHDW_HOSTBASE=20.84.70.78.nip.io bash bundle/scripts/verify-system.sh` — ALL GREEN.
- [ ] Reconcile dry-runs, **never `--apply`**, both directions, all buckets:
      `bash 3_storage/seaweedfs/phase6/reconcile.sh --from seaweedfs --to minio --buckets nhdw-static,nhdw-raw,nhdw-processed,nhdw-artifacts,nhdw-exports,nhdw-docs`
      and `--from minio --to seaweedfs …`. Expected: `only-on-target = 0` in the seaweedfs→minio direction (nothing on MinIO that SeaweedFS lacks). Any non-zero there is a **stop-and-investigate** (something wrote to MinIO).
- [ ] MinIO object counts unchanged from the frozen numbers (static 9 / raw 193 / processed 65 / artifacts 213 / exports 0 / docs 6): a change means a consumer still writes to MinIO.
- [ ] Nightly Airflow runs green: `pipeline_refresh` (until residual (a) closes, `processed_zone` is a no-op there — the Job path builds the zone), `ml_batch_predict` (04:00 UTC), `ml_drift_check`.
- [ ] Gateway presigned downloads work from a browser (export → download link) — answered by `Server: SeaweedFS`.
- [ ] Notebook project sync works for a real user (open a project lab, save a file, see it under `projects/<id>/files/` on SeaweedFS).
- [ ] SeaweedFS volume headroom: master `Max=200`, free volumes > 20 (`04a-verify.sh` check 5b); PVC `data-seaweedfs-volume-0` usage.
- [ ] Filer Postgres store size (`seaweedfs_filer.filemeta` row count grows with objects; no errors in `kubectl -n nhdw logs deploy/seaweedfs-filer`).
- [ ] One `backup-objstore.sh` run per week: `bash 3_storage/seaweedfs/ops/backup-objstore.sh` → manifest counts match the reconcile counts.
- [ ] Zero-byte regression spot check: any consumer log showing ~8 s stalls on small PUTs → that consumer lacks `BOTO_EXPERIMENTAL__NO_EMPTY_CONTINUE=true`.

Rollback trigger during the soak (unchanged from Phase 6): data-integrity failure, unexplained
discrepancy, security regression, or inability to demonstrate the storage target. Rollback =
`kubectl replace -f ~/nhdw-backups/phase6-snapshots/<object>.pre-<gate>.yaml` per consumer, then
reconcile `--from seaweedfs --to minio` **reviewed and applied by a human** (deletions on MinIO
are only ever reported, never executed by the tool).

## 2 · Phase 7 — cutover alias (after the soak passes)

Purpose: every remaining literal `minio-datalake:9000` (code defaults, DAG seam fallback,
`nhdw_minio` named collection URLs in old scripts) resolves to SeaweedFS without editing them.

- [ ] Fresh `backup-objstore.sh` run.
- [ ] Snapshot: `kubectl -n nhdw get svc minio-datalake -o yaml > ~/nhdw-backups/phase6-snapshots/svc-minio-datalake.pre-phase7.yaml`.
- [ ] Scale MinIO to zero **but keep it**: `kubectl -n nhdw scale deploy/minio-datalake --replicas=0` (its PVC and data stay; this is the first moment MinIO stops answering).
- [ ] Apply the alias: `kubectl apply -f 3_storage/seaweedfs/cutover/service-alias.yaml` (Service named `minio-datalake`, port 9000 → `seaweedfs-filer` 8333). Rollback = `kubectl replace -f` the snapshot + scale MinIO back to 1.
- [ ] Prove: from a throwaway pod, `curl http://minio-datalake.nhdw.svc.cluster.local:9000/` answers with `Server: SeaweedFS`.
- [ ] Flip the defaults in code to SeaweedFS (`NHDW_S3_ENDPOINT` fallback in the three DAGs, `build_processed_zone.py`, `apply_raw_views.py`, gateway `settings.MINIO_ENDPOINT`, `minio_io.py`), rebuild + import images, `kubectl set env` stays as is.
- [ ] Re-run `04a-verify.sh`, `verify-system.sh`, one `pipeline_refresh` and one `ml_batch_predict` run.
- [ ] Soak the alias for at least 3 days.

## 3 · Phase 8 — decommission MinIO

Only after Phase 7's soak. Order matters: the rollback copy is destroyed in the last step.

- [ ] Final `backup-objstore.sh` of SeaweedFS **and** a final MinIO backup (`phase5/01-fresh-backup.sh` with MinIO scaled back to 1 for the duration, or the tar of its PVC) → keep both off-VM.
- [ ] Credential rotation (deferred since Phase 4): new `identities.json` via `phase4/00-create-secrets.sh` with fresh keys, restart the filer (no hot reload), update `minio-secrets`/`mlflow-secrets`-derived values everywhere they are consumed, roll the consumers, re-run `04a-verify.sh` check 8 (wrong secret rejected). Record in the ledger.
- [ ] Remove the MinIO objects from the manifests and chart: `k8s/base/minio.yaml` (+ `kustomization.yaml` entry), chart `templates/minio.yaml`, the `minio-init` Job in `dbt-jobs.yaml`, `ing-minio-console` (dev overlay + chart `ingress.yaml`), `minio-oidc-secrets`, the Keycloak `minio-console` client (`keycloak-seed-job.yaml`, `setup-keycloak.py`), the MinIO OIDC guards in `bootstrap.sh` and Ansible `roles/deploy`, `3_storage/minio/`, the openbao `services/minio` entries, `minio/minio` in `cache-images.sh` (keep `minio/mc` — the init Job and the bundle scripts use it as a plain S3 client).
- [ ] Rename the `MINIO_*` env-var names and `nhdw_minio` named collection only if the team wants to (pure rename, touches gateway, dashboards, ingestors, DAGs, ClickHouse views) — otherwise document that the names are historical.
- [ ] `kubectl -n nhdw delete deploy/minio-datalake` then, after a last confirmation, the PVC. **This is the irreversible step.**
- [ ] Update docs: operator README status, `docs/architecture.md`, `docs/security.md` (MinIO console gone), the assessment page; close the ledger.

## 4 · Commit / release hygiene

- [ ] Migration commit on `feat/elmis-external-source` (done 2026-09-09, see `git log`) — push needs GitHub credentials on this VM (`gh` is not installed).
- [ ] Open the PR against `main` with the ledger and this checklist linked; Biniyam reviews residual (b).
