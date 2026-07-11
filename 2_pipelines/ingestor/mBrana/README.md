# mBrana — Ingestor

Extracts from mBrana's **HCMISWCloud** SQL Server database (the source replica in `0_external/sources/mBrana/`) and writes Parquet to the `nhdw-raw` bucket.

mBrana exposes no REST/FHIR API — direct SQL Server (TDS) only. We use `pyodbc` + Microsoft's ODBC Driver 18 via `dlt.sources.sql_database`.

## What this ingestor produces

`s3://nhdw-raw/mbrana/<schema_table>/year=YYYY/month=MM/day=DD/...`

Tables (full list in `src/pipelines/tables.py`, explicit allowlist):

| Schema | Tables |
|---|---|
| `AdministrativeUnit` | `AdministrativeUnit` |
| `dbo` | `Region`, `Zone`, `Woreda`, `Institution` |
| `Commodity` | `CommodityType`, `Product` |
| `Institution` | `OwnershipType` |
| `USM` | `Environment`, `EnvironmentGroup` |
| `mBrana` | `InstitutionEnvironment`, `SiteStatus`, `TrendStatus` |
| `mFlowUSSD` | `Users`, `Institutions`, `Commodities`, `Requests`, `RequestLines`, `ASNs`, `ASNLines`, `SOHLogs` |

All full-refresh today. Promote a table to incremental by setting its `cursor` in `tables.py`.

## How to start

```bash
cd ./2_pipelines/ingestor/mBrana
cp .env.example .env                            # set MBRANA_PASSWORD + MINIO_SECRET_KEY
docker compose build mbrana-ingestor
```

## How to run

```bash
# All tables.
docker compose --profile ingestor run --rm mbrana-ingestor extract

# A subset (comma-separated dlt_names).
docker compose --profile ingestor run --rm mbrana-ingestor extract --only dbo_institution,mflowussd_sohlogs

# Verbose.
docker compose --profile ingestor run --rm mbrana-ingestor -v extract
```

In the k8s deployment, the `mbrana-ingest` Job (`1_infrastructure/k8s/base/ingestor-jobs.yaml`) runs this.

## SQL Server quirks handled

| Type | pyodbc default | Our handling |
|---|---|---|
| `hierarchyid` (type -151) | `ODBC SQL type -151 is not yet supported` error | `src/pyodbc_setup.py` registers a converter → hex string. |
| `geography` (-152), `geometry` (-150) | same | Same converter, prophylactically. |
| `Encrypt=yes` (mandatory in ODBC 18) | TLS-validation failure on self-signed cert | `TrustServerCertificate=yes` in `.env`. |

## To swap to real production mBrana

Change in `.env`:

- `MBRANA_HOST` → real EPSS SQL Server hostname (likely via SSH tunnel)
- `MBRANA_USER`, `MBRANA_PASSWORD` → EPSS-issued read-only credentials
- `MBRANA_TRUST_SERVER_CERTIFICATE=no` once a real CA-signed cert is in place

No code change.
