# NHDW Data Lake — MinIO

The data lake is the **contract surface** between every layer of the warehouse:

- **2_pipelines/ingestor/** writes to `nhdw-raw`.
- **2_pipelines/** (dbt) reads from `nhdw-raw`, writes to `nhdw-processed`.
- **6_access-points/** (Superset, dashboards, APIs) reads from `nhdw-processed`.
- **Retention jobs** copy from `nhdw-processed` → `nhdw-archive`.

If you only ever read one document about this project, this is the one — it defines the names, paths, formats, and policies every other folder depends on.

---

## Why MinIO and why object storage

We need a place to land raw extracts and intermediate transforms that is:

- **S3-compatible** so tooling (`dlt`, `dbt`, `polars`, Trino, DuckDB, Spark, OpenFn) reads/writes it natively
- **On-premise capable** (Ethiopia MoH data sovereignty — `_resources/proclamation 1321-2024.pdf` § cross-border transfer restrictions)
- **Versioned** so a botched ingest doesn't destroy yesterday's good data
- **Cheap** — flat files on disk, no DB licensing

MinIO checks every box. Apache 2.0, single-binary, exactly the S3 API.

---

## Buckets

| Bucket | Purpose | Format | Mutability | Versioning |
|---|---|---|---|---|
| `nhdw-raw` | Raw extracts from sources (1:1 with what the source returned) | Parquet, Snappy | Append-only; re-runs add files, never overwrite | **Enabled** |
| `nhdw-processed` | dbt-transformed: staging, hubs/satellites/links, marts | Parquet, Snappy | Regenerable from raw | Suspended |
| `nhdw-archive` | Cold tier — long-term retention | Parquet, Snappy | Append-only | **Enabled** |

Why three buckets instead of one with prefixes: cleaner IAM (per-bucket policies are smaller), per-bucket lifecycle rules (raw can hot-tier 90d → archive; processed can stay hot indefinitely), separate versioning settings.

---

## Path scheme

```
s3://<bucket>/<source>/<object>/year=YYYY/month=MM/day=DD/<filename>
```

Components:

| Position | Allowed values | Notes |
|---|---|---|
| `<bucket>` | `nhdw-raw`, `nhdw-processed`, `nhdw-archive` | |
| `<source>` | `ethioemr`, `hcmiswdm`, `dhis2`, `mbrana` (lowercase) | One per `0_external/sources/` folder. For `nhdw-processed`, this slot holds the dbt layer (`staging`, `hub`, `link`, `sat`, `mart`). |
| `<object>` | Snake_case entity name | E.g. `patient`, `fact_daily_record`, `data_value_sets`, `stock_movements`. |
| `year=YYYY/month=MM/day=DD/` | UTC date of the *run*, not the data | **Hive-style partitioning** — enables partition pruning by Trino/Athena/DuckDB. Zero-padded month + day. |
| `<filename>` | See below | |

**Why Hive-style date partitioning?** It is the dominant lake convention (Apache Hive, Iceberg, Athena, Trino, Spark, BigQuery external tables, AWS Glue all read it natively). Engines push down `WHERE year='2026' AND month='06'` into S3 list calls — no scan of unrelated days.

**Why UTC date of the run, not the data?** Run-date is deterministic (we know it when we write); data-date depends on schema and is content-dependent. dbt re-derives by-data-date partitions in `nhdw-processed`.

---

## Filename scheme

```
<source>_<object>_<utc_compact_ts>_run-<short_id>_part-<NNNN>.parquet
```

| Component | Format | Example |
|---|---|---|
| `<source>` | lowercase, matches the path slot | `ethioemr` |
| `<object>` | snake_case, matches the path slot | `patient` |
| `<utc_compact_ts>` | ISO 8601 basic, UTC, second precision | `20260601T120000Z` |
| `<short_id>` | First 8 hex chars of the run UUID | `a3f7c2b1` |
| `<part_id>` | 10-char hex content-hash of the Parquet part (produced by dlt's `{file_id}`). Sortable, dedup-friendly, deterministic per file content. | `f09b98b050` |
| Suffix | Always `.parquet` (Snappy is set inside the file metadata) | |

Worked example:

```
nhdw-raw/ethioemr/patient/year=2026/month=06/day=01/
  ethioemr_patient_20260601T120000Z_run-a3f7c2b1_part-f09b98b050.parquet
  ethioemr_patient_20260601T120000Z_run-a3f7c2b1_part-c7d31a2e91.parquet
  _manifest.json
```

### Reserved object names

Object slots starting with an underscore are **reserved** and must be ignored by every reader:

- `_dlt_loads/`, `_dlt_pipeline_state/`, `_dlt_version/` — dlt's internal tracking (load IDs, schemas, watermarks). Never read these as data.
- `_README.txt` (bucket root) — describes the zone.
- Any future `_*` prefix — reserved for tooling.

Real data objects always start with a lowercase letter.

### `_manifest.json` sidecar

Every run writes one `_manifest.json` per `(source, object, day)` partition next to the Parquet parts. Shape:

```json
{
  "run_id": "a3f7c2b1-94e1-4f0c-8d56-2a91e6fcb1f9",
  "source": "ethioemr",
  "object": "patient",
  "watermark_used": "2026-05-31T12:00:00Z",
  "watermark_advanced_to": "2026-06-01T11:59:58Z",
  "row_count": 487,
  "file_count": 2,
  "bytes_written": 196812,
  "dlt_pipeline_version": "1.4.0",
  "started_at": "2026-06-01T12:00:00Z",
  "completed_at": "2026-06-01T12:00:11Z"
}
```

This is what makes a run auditable, what the orchestrator's success-criteria checks, and what data-quality jobs key off.

---

## Format

**Apache Parquet with Snappy compression.** Industry-standard lakehouse format. Three reasons in order of importance:

1. **Schema-on-write prevents silent corruption.** A column's type is recorded in the file footer; readers can't accidentally coerce a string into an integer. Critical for clinical data.
2. **Columnar layout + Snappy** gives 5-10× smaller files than NDJSON on typical health data, with no decompression CPU penalty under DuckDB/Polars/Trino.
3. **Lakehouse on-ramp.** When we layer Iceberg or Delta later, Parquet is the underlying file format — no migration needed.

We use Snappy (not Zstd) because it's the dlt default and the most universally supported. Switch to Zstd later if storage becomes the binding constraint.

---

## Service accounts (least privilege)

Created by `init/create-buckets.sh`. Each has one policy attached.

| Account | nhdw-raw | nhdw-processed | nhdw-archive | Used by |
|---|---|---|---|---|
| `nhdw_ingestor` | rw | – | – | `2_pipelines/ingestor/*` |
| `nhdw_transformer` | ro | rw | – | `2_pipelines/` (dbt) |
| `nhdw_archiver` | – | ro | rw | Retention jobs |
| `nhdw_reader` | – | ro | – | `6_access-points/*` |

The MinIO root user (`MINIO_ROOT_USER`) is **only** used by the init container and humans operating through the console. No application uses it.

---

## How to start

```bash
cd ./3_storage/minio
cp .env.example .env                # then edit changeme- values
docker compose up -d minio          # boots in ~5 seconds
docker compose up minio-init        # one-shot: buckets + policies + users
bash scripts/verify.sh              # all checks pass
```

Top-level alternative: from `.`, `docker compose up -d` brings up everything (sources + data lake + …) via the aggregator. The init container still needs to be run once per fresh data volume.

---

## How to connect

### From a Python ingestor (`dlt`)

```python
import dlt
import os

pipeline = dlt.pipeline(
    pipeline_name="dhis2_data_values",
    destination=dlt.destinations.filesystem(
        bucket_url="s3://nhdw-raw",
        credentials={
            "aws_access_key_id":     os.environ["MINIO_ACCESS_KEY"],
            "aws_secret_access_key": os.environ["MINIO_SECRET_KEY"],
            "endpoint_url":          "http://minio:9000",   # inside compose network
            "region_name":           "et-addis-1",
        },
    ),
    dataset_name="dhis2",        # → s3://nhdw-raw/dhis2/...
)
```

dlt writes the `<object>/year=…/month=…/day=…/<filename>` path automatically when given `loader_file_format="parquet"` and a `layout` matching our convention.

### From outside the VM

```bash
# SSH tunnel from your laptop to the VM, then point any S3 client at 127.0.0.1:9100.
ssh -L 9100:127.0.0.1:9100 -L 9101:127.0.0.1:9101 nhdw

# In a separate terminal, e.g. with the official AWS CLI:
aws --endpoint-url http://127.0.0.1:9100 \
    --region et-addis-1 \
    s3 ls s3://nhdw-raw/
```

Console UI is at <http://127.0.0.1:9101> after the tunnel.

### From `mc` (MinIO Client)

```bash
docker exec minio-datalake mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
docker exec minio-datalake mc ls local/nhdw-raw/
```

---

## How to reset / wipe

```bash
bash scripts/reset.sh    # destructive — drops volume, re-provisions
```

---

## Operational notes

- **Backup**: the entire lake lives at `${DATALAKE_DATA_DIR}` (default `/data/storage/minio`). Snapshot the underlying disk or `mc mirror` to off-VM storage. We do **not** rely on MinIO replication in dev.
- **Capacity**: `/data` is a separate managed disk (currently 470 GB free). Parquet + Snappy keeps even years of replica data well under 50 GB.
- **TLS**: not configured. The compose binds to `127.0.0.1` only and all traffic stays inside `nhdw_net`. When we move to a production deployment that exposes MinIO over a network, terminate TLS at a reverse proxy.
- **OpenBao integration**: deferred to Phase 2. Today, service-account secrets are in `.env`. Phase 2 will source them from OpenBao via an init step.
