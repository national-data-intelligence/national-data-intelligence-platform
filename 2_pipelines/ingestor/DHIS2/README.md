# DHIS2 — Ingestor

Extracts data from DHIS2 (the source replica in `0_external/sources/DHIS2/` or, in production, `https://ethio-dhis2.dataforimplementation.org`) and writes it as Parquet into the `nhdw-raw` bucket of the data lake.

## What this ingestor produces

Two pipelines, each producing a set of tables in `s3://nhdw-raw/dhis2/`:

### `metadata` (full-refresh, run daily)

| Table | DHIS2 endpoint | Cardinality (Sierra Leone demo) |
|---|---|---|
| `organisation_units` | `/api/organisationUnits` | ~1,800 |
| `data_elements` | `/api/dataElements` | ~1,400 |
| `data_element_groups` | `/api/dataElementGroups` | ~200 |
| `data_sets` | `/api/dataSets` | ~80 |
| `category_combos` | `/api/categoryCombos` | ~60 |
| `category_option_combos` | `/api/categoryOptionCombos` | ~600 |
| `indicators` | `/api/indicators` | ~700 |
| `programs` | `/api/programs` | ~30 |

### `data-value-sets` (incremental on `lastUpdated`, run hourly)

| Table | DHIS2 endpoint | Watermark | Notes |
|---|---|---|---|
| `data_value_sets` | `/api/dataValueSets` | `lastUpdated` | The fact rows. Tagged with `data_set` id. |

We deliberately **do not** consume `/api/analytics.json` — see the rationale in `0_external/sources/DHIS2/README.md` § "On `/api/analytics.json` (and why we don't use it)".

## Paths produced (matches `3_storage/minio/README.md`)

```
s3://nhdw-raw/dhis2/<table>/year=YYYY/month=MM/day=DD/dhis2_<table>_<utc_ts>_run-<short_id>_part-<part_id>.parquet
s3://nhdw-raw/dhis2/<table>/year=YYYY/month=MM/day=DD/_manifest.json
```

## How to start

```bash
cd ./2_pipelines/ingestor/DHIS2
cp .env.example .env                    # set DHIS2_PASSWORD, MINIO_SECRET_KEY (from data-lake .env)
docker compose build dhis2-ingestor
```

## How to run a pipeline manually

```bash
# Pull all metadata (full-refresh).
docker compose --profile ingestor run --rm dhis2-ingestor metadata

# Incremental dataValueSets since the saved watermark.
docker compose --profile ingestor run --rm dhis2-ingestor data-value-sets

# Both, sequentially.
docker compose --profile ingestor run --rm dhis2-ingestor all

# Verbose logs.
docker compose --profile ingestor run --rm dhis2-ingestor -v metadata
```

In the k8s deployment, the DHIS2 ingestor Jobs (`1_infrastructure/k8s/base/ingestor-jobs.yaml`) run these — the CLI surface is what the Jobs' args call.

## How to verify the contract end-to-end

There is a smoke test that bypasses DHIS2 entirely — it writes 5 synthetic rows through the same destination factory and confirms the path + filename + manifest are correct.

```bash
docker run --rm \
  --env-file .env \
  --network nhdw_net \
  -v $(pwd)/tests:/app/tests \
  -v $(pwd)/state:/app/state \
  --entrypoint python \
  nhdw/dhis2-ingestor:dev \
  -m tests.smoke_writer
```

Expected output ends with:

```
OK  1 parquet file(s), 2615 bytes, 0.9s
OK  manifest: s3://nhdw-raw/dhis2/smoke_test/year=YYYY/month=MM/day=DD/_manifest.json
```

After running, clean up the test artifact:

```bash
docker exec minio-datalake mc rm --recursive --force local/nhdw-raw/dhis2/smoke_test/
```

## Configuration knobs

All env-driven, see `.env.example` for the canonical list.

| Var | Default | Meaning |
|---|---|---|
| `DHIS2_BASE_URL` | `http://dhis2-web:8080` | DHIS2 host. Swap for production URL with no code change. |
| `DHIS2_USER` / `DHIS2_PASSWORD` | `admin` / `district` | HTTP Basic. Replace with PAT / OAuth when real DHIS2 mandates it. |
| `DHIS2_PAGE_SIZE` | `200` | Page size for metadata endpoints. |
| `DHIS2_INITIAL_LAST_UPDATED` | `2020-01-01` | Floor watermark for the first `data-value-sets` run. |
| `DHIS2_TIMEOUT` | `120` | HTTP timeout (seconds). |
| `MINIO_ENDPOINT` | `http://minio-datalake:9000` | In-network MinIO. |
| `MINIO_ACCESS_KEY` | `nhdw_ingestor` | Must match data-lake `INGESTOR_ACCESS_KEY`. |
| `MINIO_SECRET_KEY` | (changeme) | Must match data-lake `INGESTOR_SECRET_KEY`. |
| `MINIO_RAW_BUCKET` | `nhdw-raw` | |

## State

`state/dlt/` holds dlt's incremental watermarks and pipeline metadata. It is bind-mounted into the container so watermarks survive container recreations.

It is **also** mirrored to S3 (`s3://nhdw-raw/dhis2/_dlt_*/`) by dlt — that is the durable, restore-able copy. The local copy is just for performance.

## Replacing dlt with OpenFn (production switch)

This ingestor is the dev/early-prod implementation. Production will run OpenFn. The contract that must not change:

1. Same path scheme: `s3://nhdw-raw/dhis2/<table>/year=…/month=…/day=…/`.
2. Same filename pattern (lowercase snake_case, UTC timestamp, run id, content hash).
3. Same `_manifest.json` sidecar (one per partition).
4. Same Parquet schema per table — pin via dlt schema export when stable.

OpenFn writes Parquet via `@openfn/language-fs` + a custom S3 adaptor; the path layout is configurable. As long as the four points above hold, dbt and downstream readers don't know whether dlt or OpenFn wrote the file.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `403 SignatureDoesNotMatch` from MinIO | `MINIO_SECRET_KEY` doesn't match data-lake's `INGESTOR_SECRET_KEY` | Copy the value from `3_storage/minio/.env`. |
| `Cannot extract unique table prefix in layout` | Layout uses `{schema_name}` after another placeholder | Layout must start with `{table_name}` (dlt rule). |
| `ModuleNotFoundError: pkg_resources` at import | setuptools 76+ removed `pkg_resources` | Pin `setuptools<76` (already in `requirements.txt`). |
| `Connection refused` on `dhis2-web:8080` | 0_external/sources/DHIS2 isn't running, or our container is on a different network | `docker compose -f ./0_external/sources/DHIS2/docker-compose.yml up -d`, or point `DHIS2_BASE_URL` at a reachable instance. |
