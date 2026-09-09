# SeaweedFS — object storage for the lake

**Status: Phases 2–5 complete (2026-09-08). SeaweedFS is RUNNING in `nhdw` alongside MinIO,
passed the 4A gate (35/35), and now holds a verified copy of the entire lake — 486 objects,
every bucket matched by count, size and sha256. MinIO is untouched and still serves every
consumer. Phase 6: Step 0 and G1 (public static) DONE and verified — the portal and the publish Job use SeaweedFS for `nhdw-static`; all other consumers still on MinIO. `nhdw-static` is SeaweedFS-authoritative since 2026-09-08 (MinIO = rollback copy). G3 (lake pipeline) DONE 2026-09-09 with explicit residuals: `nhdw-raw` and `nhdw-processed` are SeaweedFS-authoritative; the Airflow image with the DAG fixes was imported and is live. G2 (artifacts & access) DONE 2026-09-09 11:51Z: gateway, `minio.*` Ingress, MLflow and JupyterHub hub on SeaweedFS; `nhdw-artifacts`, `nhdw-exports`, `nhdw-docs` SeaweedFS-authoritative; ML DAGs unpaused. Step 4 (ops scripts, backup, seeds, Ansible, docs) DONE 2026-09-09 13:40Z — every host-side script reaches the store through `bundle/scripts/lib/objstore.sh`; `3_storage/seaweedfs/ops/backup-objstore.sh` is the backup. **G3 and G2 formally closed: PASSED WITH EXPLICIT RESIDUAL RISK** (ledger P6-C.*). Open residual (a): root import of the Airflow image with the wired `processed_zone` task, then `phase6/g3-residual-a-close.sh`. Now in SOAK — `phase7-8/SOAK-AND-DECOMMISSION.md`; MinIO stays until the soak completes.** MinIO is
untouched and still serves every consumer. Everything in this directory and the
manifests it points at are files in a git checkout, validated offline only.

Why we are doing this, the full impact analysis, and the phase plan live in the
migration assessment (2026-09-04/07). Phase 1 evidence is in
[`poc/`](poc/README.md). This file is the *operator's* view: what gets deployed,
where, and how cutover and rollback work.

## The four components

```
consumers ──S3──▶ seaweedfs-s3 :8333 ──▶ seaweedfs-filer :8888 ──▶ postgres-vault  (metadata)
                                              │
                                              └──▶ seaweedfs-volume-0 :8080 ──▶ PVC  (bytes)
                                                          ▲
                                        seaweedfs-master :9333  (placement)
```

| Component | Kind | State | If it dies |
|---|---|---|---|
| `seaweedfs-master` | Deployment | tiny PVC (`seaweedfs-master-data`) | no new writes; reads continue |
| `seaweedfs-volume` | StatefulSet | **the bytes** — PVC `data-seaweedfs-volume-0`, 20 Gi | everything stops |
| `seaweedfs-filer` | Deployment | **stateless** — metadata is in `postgres-vault` db `seaweedfs_filer` | S3 API down until it returns |
| `seaweedfs-s3` | Service only | the S3 API is served **by the filer process** (`-s3`), identities from Secret `seaweedfs-secrets` | S3 API down with the filer |
| `seaweedfs-init` | Job | — | buckets / versioning / lifecycle not provisioned |

Unlike MinIO, these fail **separately**. A healthy S3 gateway in front of a dead filer
returns errors that look like bad credentials. Probe all four, not just `:8333`.

## Where every piece lives

| What | File |
|---|---|
| Chart template (source of truth) | `1_infrastructure/helm/nhdw/templates/seaweedfs.yaml` |
| Rendered base manifest (regenerate, don't edit) | `1_infrastructure/k8s/base/seaweedfs.yaml` |
| Tunables (image tag, PVC size, `-max`) | `1_infrastructure/helm/nhdw/values.yaml` → `seaweedfs:` |
| Identities + filer DB password | `1_infrastructure/k8s/overlays/dev/secrets.yaml.template` → `seaweedfs-secrets` |
| Filer database + `filemeta` table | `3_storage/postgres/init/23_seaweedfs_filer_db.sh` |
| Cutover / rollback objects | `cutover/service-alias.yaml`, `cutover/ingress-s3.yaml` |
| Regression suite | `poc/compat_test.py` (set `S3_ENDPOINT`) |
| Backup + migration tools | `migrate/restore_from_backup.py`, `migrate/verify_against_manifest.py` |
| Phase 4 runbook (operator-run; secret values stay in the cluster) | `phase4/*.sh` |

Both the chart and the base manifest carry the same objects because the live cluster
was `kubectl apply`'d from `k8s/base/` while the Ansible deploy role renders the chart.
The template is canonical; the base file is rendered from it (header says how).

## Decisions made in Phase 2, and why

**Filer metadata in `postgres-vault`, not embedded LevelDB.** The bytes are useless
without the map. Putting the map in the database we already back up means a restore
of `postgres-vault` restores the lake's index. Two hard prerequisites, both learned in
Phase 1: the table is not auto-created, and `name`/`directory` must be `COLLATE "C"`.
The init script enforces both and refuses to run if the collation is wrong.

**No console.** MinIO's community edition already dropped it upstream; SeaweedFS has
none. The `minio-console` Ingress is not recreated. If operators need a browser
view, it is a small gateway feature behind existing OPA rules — Phase 8, if ever.

**Identities are static config, not runtime provisioning.** `seaweedfs-secrets` holds
`identities.json`; that file *is* the IAM system. Three accounts survive from the
live cluster (root, `mlflow`, `jupyter-sync`) plus anonymous read on `nhdw-static`.
`mlflow` is *tighter* than before (`nhdw-artifacts` only, was `readwrite` everywhere).
`jupyter-sync` keeps its prefix scope but **gains delete within `projects/*`** —
SeaweedFS `Write` includes delete (Phase 1, Q6b). Accepted, bounded, versioning on.

**Credentials are REUSED at cutover, not rotated.** The assessment said "rotate at
migration". Reversed, deliberately: with one production cluster, no staging, and a
shared operator, the priority is *one change at a time*. Reusing the existing
generated tokens (`__G_MINIO_ROOT__`, `__G_PROJECT_SYNC__`) means cutover day changes
an endpoint and nothing else — no consumer Secret is touched. Rotation is its own
step after the soak period (Phase 8).

**Cutover is a Service alias.** 53 places name `minio-datalake…:9000`. Instead of
editing them under pressure, `cutover/service-alias.yaml` creates a Service *named*
`minio-datalake` on port 9000 that selects `seaweedfs-s3`. Consumers land on
SeaweedFS at their next connection with zero edits; rollback is re-applying the
original Service from `base/minio.yaml`. Both take seconds. Renaming consumers to
`seaweedfs-s3:8333` then happens at leisure. **This only stays cheap while the MinIO
pod is still running**, which is why decommissioning is the last phase.

**`mc` stays as the init client.** It is already in the offline image bundle and
every command it now runs is standard S3 (verified against SeaweedFS in Phase 2:
`mb`, `version enable`, `ilm`). Every `mc admin …` call is gone. Replacing `mc` with
a boto3 script so the last MinIO binary leaves the bundle is Phase 8 housekeeping.

## Phase 3 — the backup, and what it taught us (DONE 2026-09-07)

`~/nhdw-backups/minio-s3-backup-<stamp>/` (+ `.tar.gz`, 35 MB): every object from
every bucket, pulled through the S3 API from inside the MinIO pod so the root
credential never left it. `manifest/` holds per-object key/size/etag (`ls.jsonl`),
content-type + user metadata (`stat.jsonl`, 84 objects carry `x-amz-meta-*`), and
`SHA256SUMS`. This is the engine-neutral archive the assessment said was missing —
the existing `backup.sh` tarballs are MinIO-format and cannot feed SeaweedFS.

Restoring it into an empty SeaweedFS with `migrate/restore_from_backup.py` and checking
with `migrate/verify_against_manifest.py` (counts, sizes, sha256 per bucket) is the
Phase 5 procedure, rehearsed on the PoC: **486 objects, 6.1 s, all buckets verified**.

Two things the rehearsal found that Phase 1 could not:

* **Zero-byte objects + botocore stall for ~8.5 s each — and dlt IS affected.** It is
  [botocore#3755](https://github.com/boto/botocore/issues/3755): `Expect: 100-continue` on
  an empty PUT poisons the pooled connection, then a silent retry writes the object twice.
  dlt writes zero-byte `init` markers first, so an unmitigated ingestor run fails on the
  live cluster (Phase 4A caught it). **Rule for Phase 6: every boto3 and dlt consumer gets
  `BOTO_EXPERIMENTAL__NO_EMPTY_CONTINUE=true` in its environment** (botocore ≥ 1.35; the
  gateway has 1.35.99). Older botocore strips the header in code instead.
* **7 volumes per bucket, pre-allocated.** `-max` must exceed 7 × (buckets + 1); the
  chart sets 200. Below that, writes back off silently and then hang.

## Phase 4 — the exact topology that `03-deploy.sh` creates

Generated from the rendered manifest, so it cannot drift from what is applied. **Nine**
objects (was ten: the standalone gateway Deployment was retired by 4A finding #3), all
labelled `part-of: seaweedfs`, all additive. **No MinIO object is touched.**

| Kind | Name | Ports / size | Notes |
|---|---|---|---|
| PersistentVolumeClaim | `seaweedfs-master-data` | 1 Gi | local-path, RWO — topology state |
| Deployment | `seaweedfs-master` | 9333 http, 19333 grpc | 1 replica, `Recreate` (RWO PVC) |
| Service | `seaweedfs-master` | 9333, 19333 | ClusterIP |
| StatefulSet | `seaweedfs-volume` | 8080 http, 18080 grpc | 1 replica; **PVC `data-seaweedfs-volume-0`, 20 Gi — the bytes** |
| Service | `seaweedfs-volume` | 8080, 18080 | **headless** — stable pod DNS the volume registers with the master |
| Deployment | `seaweedfs-filer` | 8888 http, 18888 grpc, **8333 s3** | `Recreate`; **registers as its pod IP**; **serves S3 in-process** (`filer -s3`); mounts `identities.json`; reads `FILER_DB_PASSWORD` — both 4A findings |
| Service | `seaweedfs-filer` | 8888, 18888 | ClusterIP |
| Service | `seaweedfs-s3` | 8333 → filer pod | ClusterIP — **the endpoint consumers use**; unchanged name and port |
| Job | `seaweedfs-init` | — | `minio/mc` image; buckets, versioning, lifecycle |

**Secrets** (created by `00-create-secrets.sh`, *not* by the manifest): `seaweedfs-secrets`
with `ADMIN_ACCESS_KEY`, `ADMIN_SECRET_KEY`, `FILER_DB_PASSWORD`, `identities.json`;
plus one new key `SEAWEEDFS_FILER_DB_PASSWORD` on the existing `postgres-vault-secrets`.
**ConfigMaps:** none. **NetworkPolicies:** none — none exist in `nhdw` today for any
workload, MinIO included; parity is deliberate, hardening is Phase 8.
**PostgreSQL dependency:** `postgres-vault.nhdw.svc.cluster.local:5432`, database
`seaweedfs_filer`, role `seaweedfs_filer` (created by `01-create-filer-db.sh`).
**Image:** `chrislusf/seaweedfs:4.45`; pre-flight showed k3s pulls it unaided in ~5 s.
**The `minio-datalake` Service alias** (`cutover/service-alias.yaml`) is **not part of
Phase 4**. It is applied at Phase 7 only, and until then every consumer still talks to
the real MinIO Service of that name.

### Runbook (operator-run; secret values stay in the cluster)

| Step | Script | Who | What |
|---|---|---|---|
| 0 | `phase4/00-create-secrets.sh` | **you** | reads live `minio-secrets` with kubectl, writes `seaweedfs-secrets` in the same shell |
| 1 | `phase4/01-create-filer-db.sh` | either | filer database + `filemeta` (COLLATE "C") on the live `postgres-vault` |
| 2 | `phase4/02-import-image.sh` | you, optional | root-only pre-import; k3s pulls the image by itself otherwise |
| 3 | `phase4/03-deploy.sh` | either | `kubectl apply` the ten objects, wait, show MinIO untouched |
| 4A | `phase4/04a-verify.sh` | either | **the gate** — 20 checks below; exits non-zero on any failure |

## Phase 4A — prove the platform before any data moves

`04a-verify.sh` is the gate. It prints one `[PASS]`/`[FAIL]` line per check and ends with
either *"Phase 5 may proceed"* or *"DO NOT MIGRATE PRODUCTION DATA"*. It touches only
the new stack and a scratch bucket it deletes afterwards. Checks 7–18 run **inside the
cluster** (Job `seaweedfs-verify`, gateway image, real identities mounted from the Secret).

| # | Check | Pass criterion |
|---|---|---|
| 1 | Master health | Deployment 1/1 Ready **and** `GET /cluster/status` → 200 |
| 2 | Volume server health | StatefulSet 1/1 Ready **and** `GET /status` → 200 |
| 3 | Filer health | Deployment 1/1 Ready **and** `GET /` answers |
| 4 | S3 gateway health | Deployment 1/1 Ready **and** authenticated `ListBuckets` succeeds |
| 5 | PostgreSQL filer connection | filer log has no `leveldb`; `select count(*) from filemeta` answers; `name`/`directory` collation = `C` |
| 6 | PVC persistence | marker object written → volume pod deleted **and** filer restarted → both Ready → marker reads back byte-identical |
| 6b | **Writes after restart** | a new object can be written and read back after the restart in check 6 — added after the first live run, where reads passed and every write failed |
| 7 | Bucket creation | all 10 buckets listed; init Job succeeded |
| 8 | Credential authentication | wrong secret → rejected; right secret → accepted |
| 9 | Positive permissions | admin writes anywhere; `mlflow` writes `nhdw-artifacts`; `jupyter-sync` reads+writes `projects/*` |
| 10 | Negative permissions | `mlflow` denied on `nhdw-raw`; `jupyter-sync` denied on `mlflow/*` and on `nhdw-raw` |
| 11 | Anonymous static access | unauthenticated `GET nhdw-static/<obj>` → 200 |
| 12 | Every private bucket | unauthenticated `GET` on all 9 other buckets → not 200; anonymous LIST → not 200 |
| 13 | Presigned GET | fetch via signed URL → 200, bytes identical |
| 14 | Presigned PUT | upload via signed URL → 200, readback identical |
| 15 | Multipart upload | 24 MB in 8 MB parts, sha256 identical |
| 16 | Delete behaviour | admin delete works; `mlflow` cannot delete in `nhdw-raw`; `jupyter-sync` delete in `projects/*` is **reported as a NOTE** (known, accepted regression) |
| 17 | Zero-byte regression | data PUT after empty PUT < 1 s with the Expect hook (default timing reported alongside) |
| 18 | Listing + pagination | 1,100 keys → 1,100 unique across 2 pages, byte-ordered; delimiter listing returns `CommonPrefixes` |
| 19 | ClickHouse read | `INSERT INTO FUNCTION s3(nhdw_minio, …)` then glob read → exactly 5000 rows, checksum 37492500 |
| 20 | dlt write | real dlt 1.4.0 Job with the ingestor wiring loads a package into the scratch bucket, no failed jobs |

Only when this exits 0 does Phase 5 start.

**Result 2026-09-08: PASSED** — 35 PASS, 0 FAIL, 2 NOTE (16b: the accepted delete
regression; 6: the persistence marker), on the fourth run, after the three findings below
were fixed. Log: `~/nhdw-backups/phase4a-PASSED-<stamp>.log`.

### What the first live 4A runs found (2026-09-08)

The gate failed twice before it passed, and both failures were real defects that the
PoC could not have shown:

1. **dlt is affected by botocore#3755** (see Phase 3 above) — the dlt Job timed out on its
   zero-byte `init` marker. Mitigation confirmed in-cluster:
   `BOTO_EXPERIMENTAL__NO_EMPTY_CONTINUE=true`.
2. **A filer restart silently broke every write.** The filer registered with the master
   under the Service name, `seaweedfs-filer:8888`. The master only notices a departed
   pod ~15 s later, by heartbeat timeout, and that late "leave" removed the *new* pod's
   entry of the same name from the distributed lock ring. Ring → `[]`; reads fine;
   every S3 write → `no lock server found`. `Recreate` alone did not fix it — the
   leave still arrives after the join. **Fix: the filer registers as its pod IP**
   (`-ip=$(POD_IP)`), so a departure only ever removes itself. The gateway already did
   this. Check 6 only read after the restart and would have passed regardless, which
   is why 6b now writes too.

3. **A standalone gateway kept a stale filer address for up to five minutes.** After
   the filer restart in check 6, reads passed (they resolve the filer through the
   Service name) but writes failed with `InternalError` until the gateway's next
   master-refresh tick — which runs every five minutes and is not configurable. Writes
   recovered at 62 s in a controlled run and after 3 min in another. Health stayed green
   throughout. **Fix: run the S3 gateway inside the filer process** (`weed filer -s3`,
   SeaweedFS's own supported mode). The gateway can then never hold a stale address for
   its own filer, and the two restart as one. The `seaweedfs-s3` Service keeps its name
   and port and now selects the filer pod. Validated on the PoC with the full identity
   suite before being applied.

All three fixes are in the chart template and the rendered base manifest.

## Phase 5 — data migration (DONE 2026-09-08)

Runbook in `phase5/`. A fresh S3-layer backup was taken first (`~/nhdw-backups/
minio-s3-backup-20260908T104454Z`; identical to the 2026-09-07 archive — MinIO had not
changed a single object), restored from inside the cluster by a Job on the gateway image
with the admin credential mounted from the Secret, then verified in-cluster:

| bucket | expected | listed | size ok | sha ok |
|---|---|---|---|---|
| nhdw-artifacts | 213 | 213 | 213 | 213 |
| nhdw-docs | 6 | 6 | 6 | 6 |
| nhdw-processed | 65 | 65 | 65 | 65 |
| nhdw-raw | 193 | 193 | 193 | 193 |
| nhdw-static | 9 | 9 | 9 | 9 |

84 objects carried user metadata across. `nhdw-archive` and `nhdw-exports` are empty on
both sides. **MinIO remains the source of truth until cutover** — anything written to it
from now on must be re-copied (re-run `phase5/` — every step is idempotent and resumes).

## Phase 6–7 in one paragraph

Repoint read-only consumers first, writers second, MLflow last — each with
`BOTO_EXPERIMENTAL__NO_EMPTY_CONTINUE=true` — re-run `phase5/` for any delta, then apply
`cutover/` and soak. Detail is in the assessment.

## Operations

```bash
kubectl -n nhdw get pods -l part-of=seaweedfs                 # all four + init
kubectl -n nhdw logs deploy/seaweedfs-filer | grep -i "store\|postgres\|collat"   # store + collation sanity
kubectl -n nhdw port-forward svc/seaweedfs-master 9333:9333   # then http://localhost:9333/cluster/status
kubectl -n nhdw exec deploy/seaweedfs-filer -- weed shell -master=seaweedfs-master:9333 <<< "volume.list"
```

**Backup** = `postgres-vault` (filer metadata, already covered) **+** the volume PVC
(`data-seaweedfs-volume-0`). Neither alone restores the lake. An S3-layer export
(`mc mirror` to a bucket elsewhere) remains the engine-neutral safety net, exactly as
the assessment recommends for MinIO today.
