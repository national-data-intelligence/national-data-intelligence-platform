# `2_pipelines/marts/` — dbt project

Populates the `bi_*` schemas (`bi_facility`, `bi_supply`, `bi_hmis`,
`bi_idsr`, `bi_service`, `bi_quality`, `bi_governance`, `bi_staging`,
`bi_public`) in `postgres-vault` (the schemas themselves are declared in
[`3_storage/postgres/init/01_schemas.sql`](../../3_storage/postgres/init/01_schemas.sql)).

## What goes where

- `models/<domain>/` — internal marts. Default schema is `bi_<domain>`.
- `models/<domain>/public/` — k-anonymised projections of the same domain
  for the Public Dashboard. Schema overridden to `bi_public`.

Pick the domain folder by **what the data is about**, not by what
dashboard consumes it. Facility counts, woreda lookups, MFR matches all
go under `facility_distribution/`. Indicator coverage goes under
`hmis_coverage/`. Stock availability under `supply_chain/`.

## Models (Phase 2 initial)

| Model                                                | Schema       | Used by                                              |
|------------------------------------------------------|--------------|------------------------------------------------------|
| `bi_dhis2_facility_with_region`                      | `bi_facility`| Base join — every DHIS2 PHCU/facility ↔ region.      |
| `bi_facility_distribution`                           | `bi_facility`| Internal BI "Health Facility Distribution" card.     |
| `public/bi_facility_distribution`                    | `bi_public`  | Public Dashboard `facility-counts` series, k≥5.      |

## Local build

```bash
cd ./2_pipelines/marts
cp .env.example .env   # fill PG_PASSWORD from 3_storage/postgres/.env
docker compose build marts-dbt
docker compose --profile dbt run --rm marts-dbt deps
docker compose --profile dbt run --rm marts-dbt debug    # sanity-check the connection
docker compose --profile dbt run --rm marts-dbt build    # compile + run + test
```

## Scheduled build

Builds run as the `dbt-marts` k8s Job (`1_infrastructure/k8s/base/dbt-jobs.yaml`),
driven by `bundle/scripts/seed-realistic.sh` during boot and re-runnable on
demand. (The compose-era `marts_daily` Airflow DAG + OpenBao credential
wrapper are archived at `_archive/2026-07-03/airflow-compose-era/`.)

## Read-side

Consumers (Internal BI, Public Dashboard, JupyterHub notebooks) connect
as `bi_reader` — a SELECT-only role. The `ALTER DEFAULT PRIVILEGES` set
in `01_schemas.sql` ensures every new model lands readable by `bi_reader`
without per-model GRANT.
