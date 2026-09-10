# eLMIS (OpenLMIS) — Source Replica

## What this source is

**eLMIS** is the electronic Logistics Management Information System built on
**OpenLMIS** — the requisition-and-resupply system health facilities use to report
consumption and request commodities up the supply chain. It is the canonical
record of *what was requested, what was on hand, and what was shipped* per
facility, per programme, per reporting period.

Within the NHDW it is a **supply-chain** source, sitting alongside HCMISWDM (EPSS
warehouse movements) and mBrana (USSD stock-on-hand reports). Where those two
describe the warehouse and the phone-reported snapshot, eLMIS describes the
**formal requisition cycle**.

## What this replica actually contains — read this first

> **The extract is Zambian, not Ethiopian.** The reference data in this dump is
> the Zambia eLMIS deployment: 2,807 facilities named *Chibombo DHO*, *Kabwe DHO*,
> *Medical Stores Ltd*; a Country → Province → District hierarchy over Zambia's ten
> provinces (Central, Copperbelt, Lusaka, Muchinga, …); CHAZ programmes (Churches
> Health Association of Zambia); and a period dimension spanning **Mar 2008 →
> Feb 2019**, of which only **Sep 2017 → Aug 2018** actually carries requisitions.
>
> The rest of the warehouse is keyed to the Ethiopian shared entity model in
> `bundle/seeds/entity-model/_build/` — 893 `FAC-*` facilities under `ET-*` regions,
> programmes `HIV/TB/EPI/MNCH/NCD/MALARIA/FP/NUTRITION`, and a period window of
> **2023-01-01 → 2026-06-30**.
>
> **These do not join.** Facility codes overlap on nothing, the geographic levels
> are differently shaped (Province/District vs Region/Zone/Woreda), and the date
> ranges do not even intersect. Standing this source up is therefore *not* the same
> as making it ingestible — a mapping or rebasing step has to come first. See
> **Integration status** below.

### Shape of the extract

This is **not** a live OpenLMIS operational schema. It is a *historical extract*
already reshaped into three schemas:

| Schema | Purpose |
|---|---|
| `reference` | Conformed dimensions — facility, product, programme, geography, periods |
| `history` | The fact tables — requisitions and their line items |
| `mutation` | Provenance of the simulation that produced the extract (immutable; guarded by a trigger that raises on any write) |

| Table | Rows |
|---|---|
| `history.requisition_line` | 7,543,506 |
| `history.requisition` | 73,926 |
| `reference.facility_programme_schedule` | 16,403 |
| `reference.facility` | 2,807 |
| `reference.programme_product` | 1,142 |
| `reference.product` | 1,100 |
| `reference.reporting_period` | 173 |
| `reference.geographic_zone` | 120 |
| `reference.product_category` | 51 |
| `reference.product_form` | 20 |
| `reference.facility_type` | 16 |
| `reference.programme` | 11 |
| `reference.product_group` | 12 |
| `reference.processing_schedule` | 10 |
| `reference.dosage_unit` | 9 |
| `reference.geographic_level` | 3 |
| `mutation.validation_metric` | 194 |
| `mutation.scenario_manifest` | 1 |
| **total** | **7,639,504** |

`history.requisition_line` is the grain that matters: one row per product per
requisition, carrying the full OpenLMIS calculation chain — `beginning_balance`,
`quantity_received`, `quantity_dispensed`, `stock_in_hand`, `stockout_days`,
`normalized_consumption`, `amc`, `max_stock_quantity`, `packs_to_ship`.

**Time coverage.** `reference.reporting_period` carries 173 periods across three
schedules — `MONTHLY` (132, Mar 2008 → Feb 2019), `WEEKLY1` (39) and `WEEKLY` (2).
The facts are far narrower: requisitions land in **52 periods spanning
2017-09-01 → 2018-08-31** (23,975 in 2017; 49,951 in 2018). The rest of the period
dimension is empty scaffolding — do not read the 2008–2019 span as data coverage.

Programmes present: `EM` (Essential Medicine), `HIV` (Test Kits), `ARV`, `LAB`,
`TB`, `CDH` (Cancer Diseases Hospital), `SUFP`, plus the CHAZ mirrors `c_em`,
`c_lab`, `c_hiv`, `c_arv`.

## Real-world interface

| Surface | Endpoint | Used by | Standard |
|---|---|---|---|
| **PostgreSQL** (direct query / CDC) | `jdbc:postgresql://elmis.<host>:5432/elmis` | Bulk extract, CDC pipelines | Postgres wire protocol |
| OpenLMIS REST API | `https://elmis.<host>/api/requisitions` | Operational integrations | OpenLMIS v3 REST |

Only the **Postgres surface** is modelled here — the extract has no operational
schema behind it, so there is no OpenLMIS app that could serve the REST API over
this data. The in-cluster dlt ingestor reads the tables directly, the same way it
reads EthioEMR's MySQL.

## Deviations from real

| Deviation | Reason |
|---|---|
| Zambian reference data in an Ethiopian warehouse | The extract is what it is; see **Integration status**. Not a modelling choice. |
| Postgres only — no OpenLMIS web app | The dump is a historical extract, not an operational schema. Nothing could boot against it. |
| `synchronous_commit=off` | Disposable read-only replica restored from a dump. Restore speed over durability. Do **not** copy this into the warehouse. |
| Single instance vs. the real national + CHAZ deployments | We model "the eLMIS data surface", not the federation. |
| 12 months of facts (Sep 2017 – Aug 2018) | Fixed by the extract. The warehouse's window is 2023-01-01 – 2026-06-30. |

## How to start the replica

```bash
cd 0_external/sources/OpenLMIS
cp .env.example .env                  # then edit the changeme values
docker compose up -d                  # Postgres 16, published on 0.0.0.0:5434
bash scripts/restore.sh               # stream the 236 MB gz dump in (~8 min)
bash scripts/verify.sh                # reachability + row counts + integrity
```

Or via the aggregate orchestrator, which restores only if the DB is empty:

```bash
bash bundle/scripts/sources-up.sh up elmis
```

**Port 5434**, not 5433 — 5433 is `dhis2-db`. Published on `0.0.0.0` so cluster
pods reach it via `host.k3d.internal:5434`.

**No synthesizer.** Unlike EthioEMR / HCMISWDM / mBrana, there is no
`synthesize.py` here and no `SYNTH_VERSION` contract: the dump is the only way to
populate this source. If `sample-data/elmis_historical_data_simulated.sql.gz` is
absent, the source stays empty — `sources-up.sh` reports that and moves on.

### Restore notes

* The dump is **streamed** (`zcat | psql`) — 1.5 GB is never unpacked to disk and
  never `docker cp`'d into the container.
* It carries the `\restrict` / `\unrestrict` psql meta-commands introduced in the
  August 2025 patch releases. `psql` older than 16.10 aborts on line 5;
  `restore.sh` detects this and strips the two lines from the stream. Keep
  `ELMIS_PG_IMAGE_TAG` at 16 (or 17) and it never comes up.
* Indexes and foreign keys are defined at the tail of a plain `pg_dump`, so the
  last few minutes of the restore are index builds, not data load.
* `restore.sh` runs `ANALYZE` afterwards — a plain-SQL restore leaves the planner
  with no statistics, and the first join over 7.5M rows is unusable without it.

## How to verify it's working

```bash
bash scripts/verify.sh
```

Checks reader connectivity over TCP, the published port, row counts, orphaned
requisition lines, the reporting-period span, and the installed mutation scenario.

## Integration status

**Landed 2026-09-10 as the historical lane (`elmis_hist`) of the OpenLMIS source family —
option (c), standalone by decision (2026-09-02; reaffirmed at landing).** The
Zambian identities are preserved end to end; nothing is re-keyed to the Ethiopian entity
model; the only bridge to the master data is the MDM *candidate* table for commodities
(`bi_mdm.mdm_commodity_match_candidates`), which a steward must accept before any link exists.

| Layer | Object | Gate (measured at landing) |
|---|---|---|
| replica | this container, read-only user `ingestor`, port 5434 | 7,543,506 / 73,926 / 2,807 / 1,100 rows |
| ingestor | `2_pipelines/ingestor/OpenLMIS/` verb `history` → `nhdw-raw/elmis_hist/` (16 tables, 16 `_manifest.json`) | lake count 7,543,506; Σ quantity_dispensed 1,072,527,469 |
| ClickHouse | 7 `raw_elmis_hist__*` views, 7 `stg_elmis_hist__*` models, `pii_policy.yaml` ×16 (`drop: []`) | staging count 7,543,506 |
| landing | bridge → `nhdw_landing.stg_elmis_hist__*` | 7,543,506 |
| vault | `raw_vault/elmis_hist/` 6 hubs · 2 links · 7 sats + `v_sat_elmis_hist_*_current` | `lnk_elmis_hist_requisition_line` = 7,543,506 |
| marts | `bi_supply.mart_elmis_hist_{monthly_activity,availability,timeliness,satp,product_stockout,facility_activity,facility_product_month,resupply_plan}` | Σ dispensed 1,072,527,469; tracer 2018-01 38.1%; ARV timeliness 2018-01 543/391/72.0% |
| MDM | `bi_mdm.{mdm_commodity_match_candidates, mart_mdm_commodity_golden, mart_mdm_commodity_match_review}` | candidates populated, no eLMIS key in any conformed hub |
| ML | `bundle/seed-pack/app/ml/elmis_consumption_forecast` (damped-trend Holt) | registered `@champion`, batch predictions written |

Orchestration: Job `elmis-hist-ingest` (`ingestor-jobs.yaml`), DAG row `elmis_hist` in `pipeline_refresh`,
`seed-realistic.sh` `INGEST_JOBS`. The live OpenLMIS v3 lane (`openlmis-ingest`, suspended) is NOT deployed
on this VM (13 containers; no analytical value at demo scale). Evidence of the landing run is kept with the operator's backups (`~/nhdw-backups/elmis-evidence/`).

Governance: facility-named marts are `default_sensitivity: sensitive` in `mart_attrs.yaml`; the dump is
classified restricted-derived-known-entity-scenario; data-owner clearance for facility display is still open.
