# HCMIS WDM — Ingestor

Extracts from EPSS's **HCMISWDM** SQL Server database (the source replica in `0_external/sources/HCMISWDM/`) and writes Parquet to the `nhdw-raw` bucket.

HCMIS WDM exposes data **only** via SQL Server — there is no REST/FHIR API. Real production EPSS issues read-only SQL logins (`nscd_reader` is the canonical name) accessible over SSH tunnel.

## What this ingestor produces

`s3://nhdw-raw/hcmiswdm/<schema_table>/year=YYYY/month=MM/day=DD/...`

Tables (full list in `src/pipelines/tables.py`):

| Schema | Tables |
|---|---|
| `Commodity` | `CommodityType`, `Country`, `SupplierType`, `Category`, `UnitOfIssue`, `DosageForm`, `Program`, `Manufacturer`, `Supplier`, `Product` |
| `Dim` | `Mode`, `Program`, `Environment`, `Item`, `Date` |
| `Fact` | **`DailyRecord`** (the canonical ingestion target per the requirements primer), `Inventory` |
| `Vaccine` | `Environment`, `Unit`, `Item`, `Institution`, `DailyRecord`, `Received`, `Issued`, `Expired` |

Full-refresh today; promote a table to incremental by setting `cursor=` in `tables.py` (e.g. `cursor="ModifiedDate"`).

## How to start

```bash
cd ./2_pipelines/ingestor/HCMISWDM
cp .env.example .env       # set HCMISWDM_PASSWORD + MINIO_SECRET_KEY
docker compose build hcmiswdm-ingestor
```

## How to run

```bash
docker compose --profile ingestor run --rm hcmiswdm-ingestor extract
docker compose --profile ingestor run --rm hcmiswdm-ingestor extract --only fact_dailyrecord
docker compose --profile ingestor run --rm hcmiswdm-ingestor -v extract
```

## To swap to real production HCMIS WDM

Change in `.env`:

- `HCMISWDM_HOST` → real EPSS hostname (via SSH tunnel — typically `127.0.0.1:1433` after `ssh -L 1433:hcmis.epss.gov.et:1433 jumpbox`)
- `HCMISWDM_USER`, `HCMISWDM_PASSWORD` → EPSS-issued `nscd_reader` credentials
- `HCMISWDM_TRUST_SERVER_CERTIFICATE=no` if a CA-signed cert is in place

No code change.
