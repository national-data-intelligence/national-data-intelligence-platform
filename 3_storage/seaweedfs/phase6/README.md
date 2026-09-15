# Phase 6 — application and pipeline migration: PLAN and GO GATE

**Status: Step 0, G1 and G3 COMPLETE (2026-09-09). G3 PASSED WITH EXPLICIT RESIDUAL RISK
(ledger P6-2.G). G2 not started — awaiting explicit approval.**

### Authority per bucket (who is the source of truth right now)
| Bucket | Authoritative store | Other store is… | Since |
|---|---|---|---|
| `nhdw-static` | **SeaweedFS** | — (MinIO removed 2026-09-09 17:34Z; last copy in the final MinIO backup) | 2026-09-08 22:18 UTC |
| `nhdw-raw` | **SeaweedFS** | — (MinIO removed 2026-09-09 17:34Z; last copy in the final MinIO backup) | 2026-09-09 10:47 UTC |
| `nhdw-processed` | **SeaweedFS** | — (MinIO removed 2026-09-09 17:34Z; last copy in the final MinIO backup) | 2026-09-09 10:45 UTC |
| `nhdw-artifacts` | **SeaweedFS** | — (MinIO removed 2026-09-09 17:34Z; last MinIO copy in `~/nhdw-backups/minio-s3-backup-20260909T172858Z`) | 2026-09-09 11:51 UTC |
| `nhdw-exports`, `nhdw-docs` | **SeaweedFS** | — (MinIO removed 2026-09-09 17:34Z; last copy in the final MinIO backup) | 2026-09-09 11:51 UTC |
| `nhdw-archive` | **MinIO** | — (MinIO removed 2026-09-09 17:34Z; last copy in the final MinIO backup) | — |
**Phases 7–8 executed 2026-09-09 17:00–17:40 UTC (demo decision: no soak). MinIO decommissioned; see `../phase7-8/DECOMMISSION-RECORD.md` and ledger rows P8.*.**

Step 4 result (2026-09-09 13:00–13:40 UTC, ledger P6-4.0–4.9): the host-side scripts now reach the
store through one helper, `bundle/scripts/lib/objstore.sh` (SeaweedFS S3 via port-forward + the
bundled mc, offline fallback from the cached mc image). Repointed and exercised for real: docs seed
(re-published the updated docs into SeaweedFS; MinIO's copy untouched), `verify-system.sh` (lake
checks green on SeaweedFS; gateway host now `NHDW_HOSTBASE`), a new `3_storage/seaweedfs/ops/backup-objstore.sh`
(516 files across the 10 buckets, sha256 manifest — the pre-soak backup) and the restore primitive.
Repointed statically (syntax-checked, runner env proven by G2): pack/restore-state, seed-ml,
seed-graduation, seed-realistic (`seaweedfs-init` instead of `minio-init`). Left for Phase 7/8 by
design: code defaults, the DAG seam fallback, MinIO's own objects and console, credential entries.
**G3 and G2 are formally closed as PASSED WITH EXPLICIT RESIDUAL RISK** (rows P6-C.G3 / P6-C.G2);
the soak and decommission checklist is `../phase7-8/SOAK-AND-DECOMMISSION.md`.

G2 result (2026-09-09 11:51–12:43 UTC, ledger P6-3.1–3.7, P6-3.R): the gateway, the `minio.*` Ingress
(presigned URLs), MLflow (server-side proxied artifacts) and the JupyterHub hub were repointed together,
mirrored in base + chart + dev overlay. Validated from the real workloads — `g2_validate.py` 10/10 in-cluster
(docs read, real export + presigned download + tampered-signature 403, MLflow 256 KiB + EMPTY artifact round
trip, registered-model retrieval byte-identical to the MinIO copy, both identities' allow/deny matrix, MinIO
counts unchanged), `g2_sync_probe.py` 6/6 (the real `nhdw_project_sync.py` in the jupyterlab image), a
zero-byte PUT from inside the gateway pod, a presigned export fetched from the VM through Traefik
(`Server: SeaweedFS 30GB 4.45`), a real `ml_batch_predict` DAG run (6 runners, 23,320 rows each) and a
gateway-launched ad-hoc prediction. Both ML DAGs are unpaused. Test residue on SeaweedFS is listed in P6-3.R
for human review; nothing was deleted from either store.

G1 result: the public portal reads `nhdw-static` from SeaweedFS and the publish Job writes it there; every other consumer is still on MinIO. `nhdw-static` is now the first bucket where SeaweedFS is the live copy (MinIO's copy is the previous publish).
Step 0 evidence: `~/nhdw-backups/phase6-evidence/step0-*/`; ledger rows P6-0.1–0.10.
Every consumer still uses MinIO. Two lessons from Step 0 are now rules for later steps:
(1) never `kubectl apply` a raw base manifest to a live Deployment — the overlay patches
(local image names, pull policy) would be reverted; change env with `kubectl set env` and
mirror it in the base file. (2) `kubectl apply` of a snapshot does NOT undo `set env`;
rollback uses `kubectl replace` (rehearsed). Pre-existing G3 blocker: node inotify limit
(ledger P6-0.10).

Phase 5 left SeaweedFS holding a verified copy of the lake (486/486 objects). MinIO is still
the authoritative system and every consumer still talks to it. Phase 6 is the first phase
in which production consumers use SeaweedFS, so it is run as a controlled migration of
*data paths*, not as an endpoint find-and-replace.

Everything below was traced from Kubernetes objects → environment → code, and the
botocore version of every consumer image was read at runtime. Nothing is inferred.

---

## 1. The consumers, as they actually are today

| # | Consumer | Runs as | Endpoint today (source) | Credential (Secret/key) | Buckets · R/W | Client | botocore |
|---|---|---|---|---|---|---|---|
| C1 | **dlt ingestors** ×7 (dhis2 ×2, climate, ethioemr, hcmiswdm, mbrana, mfr) | pods spawned by Airflow `pipeline_refresh` (env from DAG constants) and one-shot `ingestor-jobs.yaml` | `minio-datalake…:9000` — **baked into the Airflow image** as a DAG constant | `minio-secrets/ROOT_*` | `nhdw-raw` **W** | dlt → s3fs/aiobotocore (file uploads carry `Expect`) | 1.43.0 |
| C2 | **ClickHouse raw views** (`ch-raw-views` Job → 31 views in `nhdw_staging`) | ClickHouse server-side `s3(nhdw_minio, url=…)` | URL **literal inside each of the 31 view definitions** (from `raw_views.sql`) | `clickhouse-named-collections` (= ROOT creds) | `nhdw-raw` **R** | ClickHouse | n/a |
| C3 | **processed-zone** Job | initContainer `mc` wipe + ClickHouse `INSERT INTO s3()` | `mc alias` literal in `dbt-jobs.yaml` + `LAKE_BASE` env (`build_processed_zone.py`) | `minio-secrets/ROOT_*`, named collection | `nhdw-raw` R → `nhdw-processed` **W** (wipe+rewrite) | mc + ClickHouse | n/a |
| C4 | **dbt staging / vault / marts** entrypoints | Jobs (`dbt-jobs.yaml`) and DAG-spawned | `MINIO_ENDPOINT` env | `minio-secrets/ROOT_*` | `nhdw-artifacts/dbt/<project>/` **W** (manifests for the gateway DQ page) | boto3 | 1.35.99 |
| C5 | **publish_public_datasets** (marts image) | ad hoc / seed script | `MINIO_ENDPOINT` + `MINIO_PUBLIC_ENDPOINT` env | `minio-secrets/ROOT_*` | `nhdw-static` **W** (CSVs + `catalogue.json` with *absolute public URLs*) | boto3 | 1.35.99 |
| C6 | **public-dashboard** | Deployment | `NHDW_MINIO_INTERNAL` env, **defaults to minio-datalake** (unset live) | none — anonymous | `nhdw-static` **R** | httpx GET | n/a |
| C7 | **nhdw-gateway** (FastAPI) | Deployment | `MINIO_ENDPOINT` env; presigned URLs signed against `MINIO_PUBLIC_ENDPOINT` = `https://minio.20.84.70.78.nip.io` → Ingress `ing-minio` → `minio-datalake:9000` | `minio-secrets/ROOT_*` | `nhdw-exports` W+R, `nhdw-artifacts` R/W/copy/delete (datasets, projects, ML), `nhdw-docs` R, **`nhdw-raw` R** (DQ route reads `_manifest.json`) | boto3 (`app/minio_client.py`, `routes/dq.py`) | 1.35.99 |
| C8 | **MLflow** server | Deployment | `MLFLOW_S3_ENDPOINT_URL` env | `mlflow-secrets/S3_*` (= identity `mlflow`) | `nhdw-artifacts/mlflow/` **R/W** (file uploads) | boto3 | 1.35.99 |
| C9 | **ML runner** | Jobs spawned by DAGs `ml_batch_predict`/`ml_drift_check` (DAG constants) **and** by the gateway (`ml_integration._runner_env` → gateway settings) | DAG constant / gateway env | `mlflow-secrets` + `minio-secrets` envFrom | `nhdw-processed` R, `nhdw-artifacts` R/W, `nhdw-exports` W | boto3 (`minio_io.py`) | 1.35.99 |
| C10 | **JupyterHub project sync** | inside every user notebook pod (env passed by the hub) | hub `MINIO_ENDPOINT` env → `NHDW_SYNC_ENDPOINT` | `minio-secrets/PROJECT_SYNC_*` (= identity `jupyter-sync`) | `nhdw-artifacts/projects/*` **R/W** | boto3 | 1.35.99 |
| C11 | **Ingress `ing-minio`** | Traefik | host `minio.20.84.70.78.nip.io` → `minio-datalake:9000` | — | serves presigned GET/PUT (C7) and the public portal's download links (C5's catalogue URLs) | — | — |
| C12 | **Ops scripts** (`backup.sh`, `verify-system.sh`, `seed-*.sh`, `restore-state.sh`, `pack.sh`, `bootstrap.sh`, Ansible deploy) | run by hand / CI | literal `minio-datalake` | various | mixed | mc / kubectl | — |

Not consumers: Loki (local PVC), Trino lake catalog (disabled), Superset (Trino), OPA, Keycloak.

---

## 2. Dependency graph — what must move together

Data flows through shared buckets. A writer and every reader of the same bucket must move
in the same step, or readers silently see stale data.

```
                 C1 dlt ingestors ──W──▶ nhdw-raw ──R──▶ C2 CH raw views ──▶ dbt staging/vault/marts (ClickHouse + Postgres, no S3)
                                             │                 │                       │
                                             │                 └──R──▶ C3 processed-zone ──W──▶ nhdw-processed ──R──▶ C9 ML runner
                                             │
                                             └──R──▶ C7 gateway DQ route (reads _manifest.json)

   C4 dbt entrypoints ──W──▶ nhdw-artifacts/dbt/* ──R──▶ C7 gateway DQ route
   C8 MLflow ──R/W──▶ nhdw-artifacts/mlflow/* ◀──R/W── C9 ML runner ──W──▶ nhdw-exports ◀──W/R── C7 gateway
   C10 jupyter sync ──R/W──▶ nhdw-artifacts/projects/* ◀──R/W/copy── C7 gateway (projects, graduation)
   C7 gateway ──R──▶ nhdw-docs

   C5 publish ──W──▶ nhdw-static ──R──▶ C6 public-dashboard          (browser downloads via C11 ingress)
   C7 presigned URLs ─────────────────────────────────────────────────▶ C11 ingress ──▶ storage
```

Three connected groups fall out, plus two cross-links that fix the order:

| Group | Members | Shared buckets | Why it is one unit |
|---|---|---|---|
| **G1 · public static** | C5, C6 | `nhdw-static` | self-contained; anonymous reads; lowest risk |
| **G3 · lake pipeline** | C1, C2, C3, and the DAG env that launches C1/C4 | `nhdw-raw`, `nhdw-processed` | dlt writes what the views read; processed is rebuilt from raw |
| **G2 · artifacts & access** | C4, C7, C8, C9, C10, C11 | `nhdw-artifacts`, `nhdw-exports`, `nhdw-docs` | six writers/readers of one bucket |

Cross-links: **C7 reads `nhdw-raw`** (DQ manifests) and **C9 reads `nhdw-processed`** → G3 must
move **before** G2, otherwise the gateway's DQ page and the runner would read a copy of raw/
processed frozen at Phase 5 while ingestors still write to MinIO.

**Migration order: prerequisites → G1 → G3 → G2 → ops scripts → soak → Phase 7.**

---

## 3. The Service alias question, answered

`cutover/service-alias.yaml` (a Service *named* `minio-datalake` that selects the SeaweedFS
filer) is still the Phase 7 mechanism and the one-command rollback lever. It is **not** used
during Phase 6, deliberately:

* The alias can only flip **every** consumer at once. That destroys the per-group validation
  this phase exists for, and it would move G2 and G3 simultaneously.
* Each consumer therefore moves **explicitly** to the honest name, `seaweedfs-s3:8333`, one
  group at a time, and is validated on its own.
* After Phase 6 the alias's job shrinks to: catch anything that was missed (C12 scripts, any
  forgotten literal), and provide the single-object rollback for those.

Consumers whose endpoint is *baked into an image* (C1/C4/C9 via Airflow DAG constants) are
the one place where "change the endpoint underneath" would be tempting. Instead, step 0
makes those DAGs read the endpoint from an environment variable on the Airflow Deployment,
with the current MinIO URL as the default — after which the endpoint is a `kubectl set env`
away in both directions, with no rebuild.

---

## 4. Rollback, including after a writer has produced data in SeaweedFS

Every step's rollback has two halves. **Half A** always exists; **half B** exists once a
writer has moved.

**A — repoint back.** Revert the exact change: `kubectl set env` to the MinIO URL (or
`kubectl apply` of the pre-change manifest snapshot the ledger records), re-apply the old
`raw_views.sql` for C2. Seconds; no data movement.

**B — reconcile the delta SeaweedFS → MinIO.** Objects the migrated writer created or
overwrote in SeaweedFS since the step began do not exist on MinIO. `reconcile.sh` (this
directory; **written, not yet run**) runs in-cluster with *both* credential sets mounted:

1. lists both endpoints for the affected buckets;
2. delta = keys on the source that are absent on the target, or present with a different
   size (same-size keys are then compared by sha256 of the body);
3. **dry-run by default**: prints the delta and writes it to `~/nhdw-backups/reconcile-<stamp>.json`
   (that file is the ledger evidence);
4. with `--apply`, copies each delta object with its Content-Type and user metadata preserved,
   then re-verifies by sha256;
5. **never deletes.** Keys that were deleted on the source but still exist on the target are
   *reported* for a human decision (e.g. a dataset version the gateway removed).

The same tool with `--from minio --to seaweedfs` is what Phase 7 runs just before cutover to
pick up anything that slipped to MinIO during the window. **Step 0 dry-runs it in both
directions and requires a delta of exactly 0** — that is the tool's own validation.

Rollback trigger, agreed in advance: any V-DATA or V-TARGET failure, or any security test
(V-NEG) failure, rolls the step back immediately. Latency and cosmetic differences do not.

---

## 5. Migration sequence, with every change and its verification

Verification test IDs are defined in §6. **Every row here becomes a ledger row (§7) before it
is executed, and gets its evidence path after.**

### Step 0 — prerequisites (no consumer moves; MinIO stays the endpoint throughout)

| Change | Objects / files | Why | Verification |
|---|---|---|---|
| 0.1 DAG endpoint seam | `5_orchestrator/dags/{pipeline_refresh,ml_batch_predict,ml_drift_check}.py`: `MINIO_URL = os.environ.get("NHDW_S3_ENDPOINT", "http://minio-datalake…:9000")`; add `BOTO_EXPERIMENTAL__NO_EMPTY_CONTINUE=true` to every spawned-pod env list | endpoint becomes switchable without a rebuild | V-BASE-DAG: one full `pipeline_refresh` run on MinIO produces the same raw/processed/marts counts as the pre-change baseline |
| 0.2 Hub env pass-through | `6_access-points/jupyterhub/config/jupyterhub_config.py`: pass `BOTO_EXPERIMENTAL__NO_EMPTY_CONTINUE` into notebook pods | notebook sync uploads files (Expect header) | V-BASE-LAB: a lab pod's env carries the var; sync to MinIO unchanged |
| 0.3 Rebuild + import `nhdw/airflow:1.0.0`, `nhdw/jupyterhub:1.0.0` | `bundle/scripts/build-images.sh` entries; **import needs root → Abenezer runs it** | ships 0.1/0.2 | pods restart on the new image, endpoints unchanged |
| 0.4 Baselines | ClickHouse row count per raw view and per mart; `nhdw-processed` object count; MLflow artifact list; one gateway export | the "same as before" reference for every V-DATA | stored under `~/nhdw-backups/phase6-baseline-<stamp>/` |
| 0.5 Reconcile tool dry-run | `reconcile.sh` both directions, all buckets | proves the rollback tool | delta must be **0** |
| 0.6 ML runner image env | `2_pipelines/ml/runner/Dockerfile`: `ENV BOTO_EXPERIMENTAL__NO_EMPTY_CONTINUE=true`; rebuild + import `nhdw/ml-runner:1.0.0` | the runner is launched by **two** launchers (DAGs and the gateway's `routes/ml.py::_runner_env`, which passes only `settings.MINIO_ENDPOINT` + `mlflow-secrets`); one image-level default covers both without touching gateway code | V-ZERO with the runner image after rebuild |

### Step 1 — G1 · public static

| Change | Object | Verification |
|---|---|---|
| 1.1 `NHDW_MINIO_INTERNAL=http://seaweedfs-s3.nhdw.svc.cluster.local:8333` | Deployment `public-dashboard` (base `dashboards.yaml`) | V-AUTH n/a (anonymous) · V-READ: portal's catalogue endpoint returns the catalogue and a dataset body identical (sha256) to MinIO's · V-TARGET: pod `printenv`; SeaweedFS access confirmed by writing a probe object to `nhdw-static` on SeaweedFS only and fetching it through the portal · V-RESTART |
| 1.2 `MINIO_ENDPOINT` for `publish_public_datasets.py` runs | script env (documented in `seed-realistic.sh`) | V-WRITE+V-META: one publish run lands CSVs with `text/csv` on SeaweedFS · V-TARGET asymmetry (new key absent on MinIO) · V-ZERO with the marts image |
| Rollback | revert env; reconcile `nhdw-static` SeaweedFS→MinIO if 1.2 ran | |

### Step 2 — G3 · lake pipeline (atomic)

| Change | Object | Verification |
|---|---|---|
| 2.1 `NHDW_S3_ENDPOINT` → SeaweedFS on Deployment `airflow` (scheduler + webserver) | covers every DAG-spawned ingestor, dbt job, runner probe | V-AUTH/V-WRITE/V-DATA: trigger `pipeline_refresh` for **climate** (smallest) → new Parquet under `nhdw-raw/climate/…` on SeaweedFS · V-ZERO: the `init` markers dlt writes are the zero-byte case, with the real ingestor image · V-TARGET asymmetry |
| 2.2 `raw_views.sql` host → `seaweedfs-s3.nhdw.svc.cluster.local:8333` (31 literals) + re-run `ch-raw-views` | 31 views in `nhdw_staging` | V-DATA: every view's `count()` equals the baseline (same data both sides) **and** the climate view shows the new rows written in 2.1 · V-TARGET: `system.tables.create_table_query` contains no `minio-datalake` |
| 2.3 `dbt-jobs.yaml`: processed-zone `mc alias` literal + `LAKE_BASE`; dbt-* `MINIO_ENDPOINT`; `ingestor-jobs.yaml` `MINIO_ENDPOINT` | base manifests (one-shot Jobs) | V-DATA: run `processed-zone` → per-table counts equal baseline; V-TARGET asymmetry on `nhdw-processed` |
| 2.4 dbt chain via DAG | staging → vault → marts | V-DATA: mart row counts equal baseline; V-WRITE: `nhdw-artifacts/dbt/<project>/manifest.json` refreshed on SeaweedFS (C4) |
| Rollback | revert 2.1 env, re-apply old `raw_views.sql`, revert manifests; **reconcile `nhdw-raw` + `nhdw-processed` SeaweedFS→MinIO**; re-verify counts on MinIO | |

### Step 3 — G2 · artifacts & access

| Change | Object | Verification |
|---|---|---|
| 3.1 gateway: `MINIO_ENDPOINT` → SeaweedFS + `BOTO_EXPERIMENTAL__NO_EMPTY_CONTINUE=true` | Deployment `nhdw-gateway` | V-AUTH · V-READ docs route · V-WRITE export route · V-LIST projects · V-META (export Content-Type) · V-NEG (root identity — negative test is the *anonymous* GET on `nhdw-exports` → 403) · V-ZERO (gateway image) · V-RESTART · V-TARGET asymmetry on the new export key |
| 3.2 Ingress `ing-minio` → `seaweedfs-s3:8333` (`cutover/ingress-s3.yaml`, applied now rather than at Phase 7 because presigned URLs must resolve to where new exports live) | Ingress | V-PRESIGN: a fresh export's presigned URL fetched from outside the cluster (SSH tunnel) returns the bytes; a public-portal download link still works |
| 3.3 MLflow: `MLFLOW_S3_ENDPOINT_URL` → SeaweedFS + BOTO var | Deployment `mlflow` | V-WRITE/V-META: log a run with an artifact (incl. an empty file) via a Job using the mlflow image; artifact downloads back byte-identical · V-NEG: `mlflow` identity cannot write `nhdw-raw` · V-TARGET asymmetry under `nhdw-artifacts/mlflow/` · V-RESTART |
| 3.4 JupyterHub: `MINIO_ENDPOINT` → SeaweedFS (hub) | Deployment `jupyterhub` | V-WRITE/V-READ: a Job on the `jupyterlab` image runs `nhdw_project_sync.py` once with the `jupyter-sync` credential · V-NEG: same identity denied on `nhdw-artifacts/mlflow/*` and `nhdw-raw` · V-ZERO with an empty notebook file · V-TARGET |
| 3.5 ML runner | no object of its own: env comes from 2.1 (DAGs) and 3.1 (gateway) | V-DATA: one `ml_batch_predict` run → result CSV in `nhdw-exports` on SeaweedFS, row count sane; the gateway's ML route returns a working presigned link |
| Rollback | revert 3.1–3.4 env + ingress; **reconcile `nhdw-artifacts`, `nhdw-exports`, `nhdw-docs` SeaweedFS→MinIO**; deleted keys reported, decided by hand | |

### Step 4 — ops scripts (C12)
Repoint the literal in `backup.sh`, `verify-system.sh`, `seed-*.sh`, `restore-state.sh`,
`pack.sh`, `bootstrap.sh`, Ansible deploy role. Verification: `verify-system.sh` passes
against SeaweedFS with the same result as the Phase 3 baseline (25 pass / 3 pre-existing fails).

### Step 5 — soak, then Phase 7
MinIO keeps running, idle. `reconcile.sh --from minio --to seaweedfs` dry-run daily; the
alias + Phase 7 gate follow the assessment. Anything still writing to MinIO during the soak
shows up as a non-zero delta and is a missed consumer.

---

## 6. Verification tests and pass/fail criteria

Every migrated consumer runs the applicable subset. **Static inspection never counts.**

| ID | Test | Pass criterion |
|---|---|---|
| V-AUTH | the consumer's own credential authenticates to `seaweedfs-s3` | `ListBuckets`/`HeadBucket` succeeds; a wrong secret → `SignatureDoesNotMatch` |
| V-READ | the consumer's intended read | body sha256 equals MinIO's for the same key |
| V-WRITE | the consumer's intended write, unique key | readback identical; key listed |
| V-LIST | listing the consumer's prefix | count and order match MinIO for the same prefix |
| V-META | Content-Type and user metadata the consumer sets | `head_object` returns them unchanged |
| V-NEG | a write/read the consumer's identity must NOT be able to do | `AccessDenied` (or 403 anonymous) |
| V-RESTART | `kubectl rollout restart` the consumer, then repeat V-WRITE | passes after Ready |
| V-ZERO | zero-byte PUT then data PUT with the consumer's **own image** and the env var | data PUT < 1 s |
| V-TARGET | proof it talks to SeaweedFS, not MinIO | (a) pod `printenv` shows the SeaweedFS endpoint; (b) **asymmetry**: the key written in V-WRITE exists on SeaweedFS and does **not** exist on MinIO |
| V-DATA | pipeline output validated by content | row counts / per-table counts / mart counts equal the step-0 baseline, plus the new rows the test wrote are visible downstream |
| V-PRESIGN | presigned URL from outside the cluster | HTTP 200, bytes identical |

A step passes only when every applicable test passes for every consumer in the group.
One failure = rollback the step (§4), record, fix, re-run.

---

## 7. Ledger structure

`LEDGER.md` in this directory; one row per change, created **before** the change is made,
completed after. Columns:

| Col | Meaning |
|---|---|
| ID | `P6-<step>.<n>` |
| Kind | file · k8s object · env var · secret · endpoint · credential · pipeline · API route · script · image |
| Target | exact path / `kind/name` / `DEPLOY.container.ENV` |
| Before → After | literal values |
| Applied by | the exact command or commit |
| Snapshot | path of the pre-change manifest/file copy (`~/nhdw-backups/phase6-snapshots/`) — this *is* the rollback input |
| Tests | V-ids that verify this row |
| Evidence | log path under `~/nhdw-backups/phase6-evidence/` |
| Result | PASS / FAIL / ROLLED BACK |
| Rollback | the exact reverse command |

No row without a test. No PASS without an evidence path.

---

## 8. Go gate for Phase 6

Approve when:
1. the order **prereqs → G1 → G3 → G2 → scripts → soak** is agreed;
2. steps 0.3/0.6 are acceptable (three image rebuilds: Airflow, JupyterHub, ML runner; Abenezer imports them — root);
3. the rollback trigger in §4 is agreed;
4. Bini knows a DAG run and an ML run will be triggered for validation.

On "go", step 0 is executed and reported before any consumer moves.
