# Phase 1 — SeaweedFS compatibility proof of concept

**Status: COMPLETE.** 16 of 17 checks pass, against both filer stores, plus a real
dlt → SeaweedFS → ClickHouse chain verified end to end. Q16 was added after Phase 3's
restore rehearsal found a stall Phase 1 had no way to see.
Run 2026-09-07 against `chrislusf/seaweedfs:latest` (version 4.45).

This stack is throwaway and deliberately isolated: its own bridge network, high
ports, no cluster attachment. It exists to answer the migration assessment's
unverified assumptions with evidence. Nothing here is the target deployment.

## Run it

```bash
# Stage A — default (leveldb2) filer store
docker compose up -d
python3 compat_test.py

# Stage B — PostgreSQL filer store (the recommended architecture)
docker compose down -v
docker compose -f docker-compose.yml -f docker-compose.pgfiler.yml up -d
docker exec -i swpoc-filerdb psql -U seaweedfs -d seaweedfs_filer < filer-schema.sql
docker compose -f docker-compose.yml -f docker-compose.pgfiler.yml restart filer
python3 compat_test.py

# teardown
docker compose -f docker-compose.yml -f docker-compose.pgfiler.yml down -v
```

`compat_test.py` honours `S3_ENDPOINT`, so the same suite becomes the regression
test for Phase 4 (deployment) and Phase 7 (cutover) against the real endpoint.

## Results

| # | Question | Result |
|---|---|---|
| Q1 | boto3 SigV4 + path-style, unmodified | **PASS** — the gateway's exact client config works as-is |
| Q2 | Presigned GET and PUT URLs | **PASS** — both; HTTP 200, bytes identical |
| Q3 | Server-side `copy_object` across buckets | **PASS** |
| Q4 | dlt partitioned key layout, prefix + delimiter listing | **PASS** — deep keys preserved verbatim, `CommonPrefixes` correct |
| Q5 | ETag format and stability | **PASS** — ETag is the content MD5 and is stable across re-upload |
| Q6 | **Prefix-scoped credentials** | **PASS** — works, with the glob syntax. See below. |
| Q6b | Withhold Delete while granting Write | **FAIL** — the only real gap |
| Q7 | Bucket-level isolation between service accounts | **PASS** |
| Q8 | Versioning: enable, list versions, recover an overwrite | **PASS** — prior version recovered byte-exact |
| Q9 | Anonymous read on `nhdw-static`, denied elsewhere | **PASS** — 200 on static, 403 on artifacts |

## The three findings that change the plan

### 1. Prefix scoping works — the assessment's highest-risk assumption was wrong

The migration assessment flagged the `project-sync` credential as the single
largest security risk, on the assumption that SeaweedFS could only grant
bucket-wide access. It can do better, but **only with the right syntax**:

| Syntax | Result |
|---|---|
| `Read:nhdw-artifacts` | bucket-wide (control) |
| `Read:nhdw-artifacts/projects` | **denied everything** |
| `Read:nhdw-artifacts/projects/` | **denied everything** |
| `Read:nhdw-artifacts/projects/*` | **correctly scoped** |

The two middle rows are the trap: an unrecognised grant fails *closed*, denying
even the intended access. That is the safe direction to fail, but it means a
misconfigured identity looks like a broken deployment rather than a security
hole — worth knowing when debugging Phase 4.

`prefix_probe.py` reproduces this table.

### 2. Delete cannot be withheld from Write

SeaweedFS's `Write` action includes delete. MinIO's `nhdw-project-sync` policy
deliberately grants `GetObject` + `PutObject` and omits `DeleteObject`, so the
notebook push loop is non-destructive by construction.

That property cannot be reproduced. The residual exposure is small and bounded —
a notebook user could delete files **within `nhdw-artifacts/projects/*` only**,
not across the bucket and not in `mlflow/` — but it is a real regression and
should be accepted explicitly rather than discovered later. Versioning on
`nhdw-artifacts` (Q8) is a partial compensation.

### 3. SeaweedFS allocates a volume collection per bucket — 7 volumes, immediately

**Measured in Phase 3, not inferred:** the moment a bucket receives its first write,
SeaweedFS creates **7 volumes** for its collection regardless of how much data follows
(five buckets holding 49 MB occupied 47 volumes). The default collection takes 7 more.
When the cap is exhausted the failure is not an error: each put backs off ~5 s inside
the gateway and the client eventually hangs. The PoC hit this at `-max=8` and again at
`-max=40`; the chart now sets **200** (`values.yaml`), against a floor of
7 × (10 buckets + 1) = 77. Watch `Free` on the master's `/dir/status`.

### 4. `Expect: 100-continue` on a zero-byte PUT poisons the connection — a **botocore** bug (Q16)

Discovered restoring the real lake: a **non-empty PUT on the same keep-alive
connection right after a zero-byte PUT stalls ~8.5 s**. On a fresh connection it takes
6 ms. Only botocore sends `Expect: 100-continue` unconditionally; curl and s3fs (what
dlt uses) never do and never stall. dlt writes 35 zero-byte `init` markers into
`nhdw-raw`, 23 of them immediately followed by data, which turned a one-minute restore
into seventeen.

| client | put-after-empty |
|---|---|
| boto3 default | **8,478 ms** |
| boto3 with `Expect` stripped | 6 ms |
| curl | 5 ms |
| s3fs / dlt | 8 ms |

**Correction after Phase 4A (2026-09-08).** Two things above were wrong:

* It is **botocore's bug, not SeaweedFS's** — [boto/botocore#3755](https://github.com/boto/botocore/issues/3755).
  Go's `net/http` (SeaweedFS, MinIO) correctly omits the interim `100 Continue` when
  `Content-Length: 0`; botocore then parses the *next* response against a stale status
  tuple. The stall is followed by a **silent retry on a fresh connection, so the object
  is written twice**.
* **dlt IS affected.** The PoC's s3fs test used in-memory bytes, which never get the
  header. dlt uploads *files*, which do. On the live cluster the dlt Job timed out on
  `dhis2/init`, the zero-byte marker dlt writes first.

Two mitigations, both validated by botocore upstream:

1. `BOTO_EXPERIMENTAL__NO_EMPTY_CONTINUE=true` in the environment — skips the header for
   empty bodies. Present in botocore ≥ 1.35 (the gateway image has 1.35.99; the host's
   1.34.46 does not). **This is the Phase 6 rule: set it on every boto3/dlt consumer.**
2. Strip the header in code, for old botocore (`migrate/restore_from_backup.py` shows it):

```python
s3.meta.events.register("before-send.s3.PutObject", lambda request, **kw: request.headers.pop("Expect", None) and None)
```

Consequence for Phase 6: every boto3 **and dlt** consumer gets
`BOTO_EXPERIMENTAL__NO_EMPTY_CONTINUE=true` when it is repointed (ingestors, gateway,
ML runner, project sync, dbt entrypoints). Nothing to report to SeaweedFS.

_(was "3. SeaweedFS allocates a volume collection per bucket")_

The first PoC run failed with `InternalError` on writes to the fourth bucket.
The cause was not compatibility: SeaweedFS creates a **separate volume collection
per S3 bucket**, and the volume server's `-max` cap was exhausted.

MinIO has no equivalent constraint. Volume capacity must therefore be planned
against *bucket count × volumes per bucket*, not just total data size — a sizing
input that does not exist in the current architecture. `-max=40` is ample for
seven buckets at this scale.

## PostgreSQL filer store — validated, with two prerequisites

Stage B passed identically to Stage A, with metadata confirmed in `filemeta`.
The recommendation stands. Two things must be in the Kubernetes deployment:

1. **The schema is not auto-created.** A fresh filer against a fresh database
   crashes with `relation "filemeta" does not exist`. `filer-schema.sql` must run
   as an init step.
2. **`COLLATE "C"` is required on `name`, not cosmetic.** Under a locale
   collation the filer warns that S3 list order is not byte-lexicographic and
   falls back to a slower sort. Clients that merge sorted listings can then report
   spurious differences — a fault that would surface as phantom data drift in a
   pipeline rather than as an error.

## Extension run — the four deferred questions, plus the end-to-end chain

`extended_test.py` (Q10–Q13), `dlt_probe.py` (Q15) and the ClickHouse commands in
this section closed everything the first run deferred.

| # | Question | Result |
|---|---|---|
| Q10 | S3 lifecycle expiry API (`exports-ttl-90d`) | **PASS** — `put_bucket_lifecycle_configuration` accepted and read back intact |
| Q11 | Multipart upload + download, 24 MB | **PASS** — byte-exact; ETag carries a `-3` part suffix |
| Q12 | User metadata + Content-Type survive put and server-side copy | **PASS** — both preserved verbatim |
| Q13 | Pagination past 1,000 keys, in byte order | **PASS** — 1,100 keys across 2 pages, byte-lexicographic |
| Q14 | ClickHouse `s3()`: write Parquet, read back, recursive `**/*.parquet` glob, named collection | **PASS** — 8,500 rows, checksum exact via all four paths |
| Q15 | A **real dlt 1.4.0 run** mirroring `destination.py`, region `et-addis-1`, scoped ingestor credential | **PASS** — one Parquet file at the exact contract path, readable by ClickHouse |
| Q16 | Data PUT after a zero-byte PUT on one connection (botocore `Expect`) | **PASS with the header stripped** — default boto3 stalls 8.5 s; see finding 4 |

### Q10 corrects the assessment

The migration assessment (§3, break 5) claimed SeaweedFS expresses retention as a
filesystem TTL rather than the S3 lifecycle API, and that the provisioning code
would need a rewrite. **That was wrong.** The standard `PutBucketLifecycleConfiguration`
call is accepted and round-trips. `mc ilm add --expiry-days 90` translates directly
to one boto3 call. What this PoC did *not* do is wait 90 days to watch an object
expire — enforcement, as opposed to acceptance of the rule, remains unobserved.

### Q15 is the one that matters most

The dlt probe uses the same destination type, credential spec, layout string,
`extra_placeholders` and `dataset_name` as every ingestor, and the same custom
region they default to. It wrote:

```
nhdw-raw/dhis2/analytics/year=2026/month=09/day=07/dhis2_analytics_20260907T110319Z_run-e018d687_part-b017e54df1.parquet
```

which matches the path contract in `3_storage/minio/README.md` character for
character, plus dlt's own `_dlt_loads` / `_dlt_pipeline_state` / `_dlt_version`
bookkeeping under the dataset prefix. ClickHouse then read it through the same
recursive glob `raw_views.sql` uses, via a named collection, with an exact checksum.

**Conclusion for Phase 6:** every ingestor migrates by changing `MINIO_ENDPOINT`
and the credential pair. No code change. The custom region is accepted by SigV4
signing on the SeaweedFS side.

Two incidental findings from getting dlt to run in a fresh container, relevant to
anyone rebuilding the ingestor images: dlt 1.4.0 imports `pkg_resources`, which
`setuptools >= 81` no longer ships, so the images need `setuptools<81` pinned; and
`python:3.12-slim` does not include setuptools at all.

## Still not observed

- **Lifecycle enforcement.** The rule is accepted; actual expiry was not waited for.
- **OIDC / `AssumeRoleWithWebIdentity`.** Not tested; the assessment assumes absent,
  and the driver for this migration makes the point moot — the console was already
  being lost with MinIO's community edition.
- **Behaviour under the real cluster's resource limits.** The PoC ran unconstrained.

## Leaving the stack up

The PoC stack (and the `swpoc-clickhouse` container, which sits outside the
compose file) is left running so it can be inspected. Tear down with:

```bash
docker rm -f swpoc-clickhouse
docker compose -f docker-compose.yml -f docker-compose.pgfiler.yml down -v
```
