# MFR — Ingestor

Extracts the **Master Facility Registry** (MFR) over its FHIR R4 endpoint and
writes it as Parquet into the `nhdw-raw` bucket of the data lake.

Production source: `https://fhir-mfr.moh.gov.et/fhir` (set `MFR_FHIR_BASE_URL`).

## What this ingestor produces

One pipeline, two tables in `s3://nhdw-raw/mfr/`:

### `facilities` (full-refresh, run daily)

| Table | FHIR endpoint | Cardinality | Notes |
|---|---|---|---|
| `facilities` | `/Location` | ~68,000 | One row per Ethiopian facility. The fact-of-record for the facility dimension. |
| `organizations` | `/Organization` | hundreds–thousands | Facility owners / managing bodies. Referenced by `facilities.managing_organization_reference`. |

Full-refresh (`write_disposition="replace"`), because a facility registry is
slow-moving dimension data — like DHIS2 metadata. A full pull each run removes
"stale dimension" bugs and is cheap. Set `MFR_FHIR_SINCE` to switch to an
incremental `_lastUpdated` delta if the registry grows large.

## Why FHIR `/Location` instead of the legacy REST dump

The legacy REST facility dump returns ~11 flat fields:

```
id, name, status, operationalStatus, facilityType, parentFacilityType,
ownership, region, zone, woreda
```

The FHIR `Location` resource is a **superset** of that. We flatten the
high-value fields into columns and keep the complete resource in
`raw_resource` (nothing the source returned is lost):

| Column | Source (FHIR) | Covers / adds |
|---|---|---|
| `fhir_id` | `Location.id` | |
| `identifier` | `Location.identifier[]` | MFR codes / DHIS2 ids |
| `name` | `Location.name` | (legacy `name`) |
| `status` | `Location.status` | (legacy `status`) |
| `operational_status` | `Location.operationalStatus` | (legacy `operationalStatus`) |
| `facility_type_code` / `_display` | `Location.type[0]` | (legacy `facilityType`) |
| `physical_type_code` / `_display` | `Location.physicalType` | jurisdiction vs site |
| `longitude` / `latitude` / `altitude` | `Location.position` | **added — GPS** |
| `address` | `Location.address` (flattened) | region/zone/woreda as text |
| `address_raw` | `Location.address` | **added — full structured address** |
| `telecom` | `Location.telecom[]` | **added — phone, fax, email** |
| `managing_organization_reference` / `_display` | `Location.managingOrganization` | **added — ownership link** |
| `part_of_reference` / `_display` | `Location.partOf` | parent facility / admin unit |
| `raw_resource` | whole resource | nothing lost |

The key additions over the legacy dump: **GPS coordinates, telecom contacts,
the full structured address, and the organization hierarchy.**

## Paths produced (matches `3_storage/minio/README.md`)

```
s3://nhdw-raw/mfr/<table>/year=YYYY/month=MM/day=DD/mfr_<table>_<utc_ts>_run-<short_id>_part-<part_id>.parquet
s3://nhdw-raw/mfr/<table>/year=YYYY/month=MM/day=DD/_manifest.json
```

Worked example:

```
nhdw-raw/mfr/facilities/year=2026/month=06/day=01/
  mfr_facilities_20260601T205051Z_run-fe21fd2c_part-c5d48eb193.parquet
  _manifest.json
```

## How to start

```bash
cd ./2_pipelines/ingestor/MFR
cp .env.example .env                    # set MINIO_SECRET_KEY (from data-lake .env), MFR auth if required
docker compose build mfr-ingestor
```

## How to run a pipeline manually

```bash
# Facilities only (FHIR Location).
docker compose --profile ingestor run --rm mfr-ingestor facilities

# Owners only (FHIR Organization).
docker compose --profile ingestor run --rm mfr-ingestor organizations

# Both, one run.
docker compose --profile ingestor run --rm mfr-ingestor all

# Verbose logs.
docker compose --profile ingestor run --rm mfr-ingestor -v all
```

In the k8s deployment, the `mfr-ingest` Job
(`1_infrastructure/k8s/base/ingestor-jobs.yaml`) runs these — the CLI surface
is what the Job's args call.

## "Pull consistently until it finishes"

The FHIR client follows each Bundle's `link[next]` until it's gone — one
resource type drains completely before the next starts. With
`MFR_FHIR_MAX_PAGES=0` (default) there is no page cap, so a run pulls the whole
registry. Transient `502/503/504`/connection errors retry with exponential
backoff. Set a small `MFR_FHIR_MAX_PAGES` for quick smoke runs.

## Auth, and the Basic↔Bearer throttle test

Switching auth is a **one-line `.env` change, no code edit** — `MFR_FHIR_TOKEN`
takes precedence over `MFR_FHIR_USER`/`_PASSWORD`:

- Bearer: set `MFR_FHIR_TOKEN=…`
- Basic: clear `MFR_FHIR_TOKEN`, set `MFR_FHIR_USER`/`_PASSWORD`

Each run logs throughput per resource so you can tell if Basic is throttling:

```
facilities: drained 68450 resource(s) over 343 page(s) in 84.3s (453.4 rec/s, auth=basic)
```

Run once each way (a bounded smoke run is enough, e.g. `MFR_FHIR_MAX_PAGES=20`)
and compare the `rec/s`. If Basic is materially slower, switch to the token.

## Configuration knobs

All env-driven, see `.env.example` for the canonical list.

| Var | Default | Meaning |
|---|---|---|
| `MFR_FHIR_BASE_URL` | `https://fhir-mfr.moh.gov.et/fhir` | FHIR base (everything before `/Location`). |
| `MFR_FHIR_USER` / `MFR_FHIR_PASSWORD` | (blank) | HTTP Basic, if the endpoint requires it. |
| `MFR_FHIR_TOKEN` | (blank) | Bearer token; takes precedence over user/password. |
| `MFR_FHIR_PAGE_SIZE` | `200` | FHIR `_count` page size. |
| `MFR_FHIR_MAX_PAGES` | `0` | `0` = unbounded (drain everything). |
| `MFR_FHIR_SINCE` | (blank) | ISO floor on `_lastUpdated`; blank = full pull. |
| `MFR_DEV_MAX_ROWS` | `0` | Dev row cap per resource; `0` = unbounded. |
| `MINIO_ENDPOINT` | `http://minio-datalake:9000` | In-network MinIO. |
| `MINIO_ACCESS_KEY` | `nhdw_ingestor` | Must match data-lake `INGESTOR_ACCESS_KEY`. |
| `MINIO_SECRET_KEY` | (changeme) | Must match data-lake `INGESTOR_SECRET_KEY`. |
| `MINIO_RAW_BUCKET` | `nhdw-raw` | |

## State

`state/dlt/` holds dlt's pipeline metadata and schemas. It is bind-mounted into
the container so it survives container recreations, and is also mirrored to S3
(`s3://nhdw-raw/mfr/_dlt_*/`) by dlt — that is the durable copy.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `403 SignatureDoesNotMatch` from MinIO | `MINIO_SECRET_KEY` doesn't match data-lake's `INGESTOR_SECRET_KEY` | Copy from `3_storage/minio/.env`. |
| `401`/`403` from MFR | Endpoint needs auth | Set `MFR_FHIR_TOKEN` (or `MFR_FHIR_USER`/`_PASSWORD`). |
| `ModuleNotFoundError: pkg_resources` at import | setuptools 76+ removed `pkg_resources` | Pinned `setuptools<76` in `requirements.txt`. |
| Run never ends | `MFR_FHIR_MAX_PAGES=0` on a huge/looping endpoint | Set a finite `MFR_FHIR_MAX_PAGES` to bound it. |
