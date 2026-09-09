# Decommission record — MinIO → SeaweedFS (Phases 7 and 8, executed 2026-09-09)

**Decision.** The environment is a demo. The team chose to finish the migration in one
sequence instead of a 14-day soak. Phases 7 and 8 were executed on 2026-09-09 between
16:45 and 17:40 UTC, immediately after Phase 6 closed. Ledger: `../phase6/LEDGER.md`
(rows P7.* and P8.*). Evidence: `~/nhdw-backups/phase8-evidence/`. Snapshots of every
removed object: `~/nhdw-backups/phase8-snapshots/` (mode 600).

## Final architecture

- **Object store:** SeaweedFS 4.45, 9 Kubernetes objects in `nhdw` (`part-of: seaweedfs`): master
  (PVC), volume StatefulSet (PVC 20 Gi, `-max=200`), filer Deployment with the embedded S3 gateway
  (`Service seaweedfs-s3:8333`, filer metadata in `postgres-vault` db `seaweedfs_filer`), init Job,
  Secret `seaweedfs-secrets` (identities: `nhdw_root` admin, `mlflow`, `jupyter-sync`, anonymous
  read on `nhdw-static`).
- **Public S3 host:** `s3.20.84.70.78.nip.io` → `seaweedfs-s3:8333` (Ingress `ing-s3`), used only
  by gateway-presigned browser downloads (`MINIO_PUBLIC_ENDPOINT`).
- **Consumers on SeaweedFS:** public portal (`nhdw-static`), gateway (docs, exports, artifacts,
  presigned URLs, ad-hoc ML Jobs), MLflow (server-side proxied artifacts under
  `nhdw-artifacts/mlflow/`), JupyterHub project sync (`nhdw-artifacts/projects/*`), Airflow
  (endpoint seam `NHDW_S3_ENDPOINT`), the 7 dlt ingestors (`nhdw-raw`), ClickHouse (31 `raw_`
  views + processed-zone builder), dbt staging/vault/marts (+ manifest uploads), ML runner
  (DAG- and gateway-launched), publish-datasets, docs seed, backup/restore/pack/seed scripts
  (`bundle/scripts/lib/objstore.sh`).
- **Buckets:** `nhdw-static` 9 · `nhdw-raw` 195 · `nhdw-processed` 65 · `nhdw-artifacts` 241 ·
  `nhdw-exports` 4 · `nhdw-docs` 6 · `nhdw-archive`, `nhdw-backups`, `nhdw-lake`, `nhdw-logs` 0
  (counts at the final backup, 17:29 UTC).
- **Legacy names kept deliberately** (they hold SeaweedFS values; renaming would touch ~12
  manifests, three images and every consumer for no functional gain): credential Secret
  `minio-secrets` (ROOT_* = the `nhdw_root` identity, PROJECT_SYNC_* = `jupyter-sync`), env vars
  `MINIO_*` / `MLFLOW_S3_ENDPOINT_URL`, ClickHouse named collection `nhdw_minio`, bundle state path
  `state/minio/nhdw-artifacts`, gateway module `minio_client.py`, runner module `minio_io.py`,
  the `minio://` URI scheme for ML package refs.

## What was removed (17:12–17:34 UTC, in this order)

1. Stale notebook server `superadmin/03d7999c…` (spawned 2026-08-12 with the MinIO sync endpoint;
   verified it had pushed nothing newer to MinIO) — stopped via the hub API.
2. Final backups: MinIO `~/nhdw-backups/minio-s3-backup-20260909T172858Z` (486 objects, sha256
   manifest, verified, + `.tar.gz`); SeaweedFS `~/nhdw-backups/objstore-20260909T172911Z`
   (520 files, sha256 manifest).
3. Snapshots (`phase8-snapshots/`): Deployment, Service, PVC + PV, both Ingresses, Job `minio-init`,
   Secret `minio-oidc-secrets`, gateway Deployment pre-change.
4. Public host: Ingress `ing-s3` created, gateway `MINIO_PUBLIC_ENDPOINT` → `https://s3.…`,
   presigned export verified through the new host from the VM; Ingresses `ing-minio` and
   `ing-minio-console` deleted.
5. Keycloak: client `minio-console` deleted from realm `privileged-ops` (kcadm inside the pod).
6. Cluster objects: Jobs `minio-init`, `seaweedfs-reconcile`; Deployment `minio-datalake`;
   Service `minio-datalake`; Secret `minio-oidc-secrets`; PVC `minio-data` (PV reclaim=Delete →
   host directory removed). `minio-datalake.nhdw.svc.cluster.local` no longer resolves.
7. Repository: `k8s/base/minio.yaml`, chart `templates/minio.yaml`, the `minio-init` Job in
   `dbt-jobs.yaml`, `ing-minio-console` (overlay + chart), `ing-minio` → `ing-s3` (host `s3.*`),
   `minio-oidc-secrets` (secrets template, keycloak-seed Job base + chart, `setup-keycloak.py`),
   the MinIO console OIDC guard (`bootstrap.sh`, Ansible `roles/deploy`), the MinIO tar step in
   `7_security/scripts/backup.sh`, `minio/minio` in `cache-images.sh`, `3_storage/minio/`,
   the openbao `services/minio` entries, `cutover/service-alias.yaml` + `cutover/ingress-s3.yaml`
   (superseded), code defaults `minio-datalake:9000` → `seaweedfs-s3:8333` (3 DAGs,
   `build_processed_zone.py`, gateway `settings.py`, runner `minio_io.py`, `jupyterhub_config.py`,
   public dashboard, Climate ingestor), the admin topology map node `minio-datalake` →
   `seaweedfs-filer` (gateway + admin UI), docs wording.

## Rollback material (historical)

- Restore MinIO's last content into any S3 store: `3_storage/seaweedfs/migrate/restore_from_backup.py`
  against `minio-s3-backup-20260909T172858Z` (this is the same tool that seeded SeaweedFS in Phase 5).
- Re-create MinIO itself: `git show bb6769a:1_infrastructure/k8s/base/minio.yaml` plus the object
  snapshots in `phase8-snapshots/`. Not expected to be needed; kept because it costs nothing.
- Everything on SeaweedFS is also in `objstore-20260909T172911Z` and reproducible with
  `3_storage/seaweedfs/ops/backup-objstore.sh`.

## Post-removal verification

See the ledger row **P8.V** (filled from `phase8-evidence/`): the 4A gate, `verify-system.sh`,
the G2 validation suite and the project-sync probe (both without a second store), Airflow
`probe_lake`, a real `ml_batch_predict` run, the public portal, and a live scan of every pod for
any remaining `minio-datalake` reference.

## Still pending after the cluster work (needs root on the VM)

The rebuilt images with the flipped defaults and the wired `processed_zone` DAG task are in the
local docker daemon and have to be imported into k3s by the operator (the running pods use env
overrides, so behaviour is unchanged until then):

```
docker save nhdw/airflow:1.0.0 nhdw/gateway:1.0.0 nhdw/ml-runner:1.0.0 nhdw/staging-dbt:1.0.0 \
            nhdw/jupyterhub:1.0.0 nhdw/public-dashboard:1.0.0 nhdw/admin:1.0.0 | sudo k3s ctr images import -
kubectl -n nhdw rollout restart deploy/nhdw-gateway deploy/jupyterhub deploy/public-dashboard deploy/admin
bash 3_storage/seaweedfs/phase6/g3-residual-a-close.sh     # restarts Airflow + proves the DAG-driven processed zone
```
