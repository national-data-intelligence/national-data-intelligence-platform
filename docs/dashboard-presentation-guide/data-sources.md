# Data sources — per-widget provenance

*Part of the NHDW Dashboard Presentation Guide — see [README.md](README.md).*

This maps every widget to the **exact mart/table/endpoint (or mock location)** it
reads. It is the reference for "where does this number come from?".

## How the data path works (internal-BI)

Each internal-BI widget is bound to a mart by a **Fetcher** in the gateway
(`6_access-points/api/nhdw-gateway/app/fetchers.py`, keyed by widget id). The
runtime path:

```
SPA widget → GET /gw/permissions/widget/<id>/data  (proxy → gateway /api/…)
           → gateway PEP → OPA allow + row-filter obligation
           → Trino executes the Fetcher's SQL against Postgres  marts.<schema>.<table>
           → rows back to the widget (or null → empty state)
```

- **Catalog** (`marts.<schema>."<table>"`) is Postgres database **`nhdw_vault`**,
  `bi_*` schemas, reached through Trino's `marts` catalog.
- **ML columns** join `ops_ml.ml_predictions` / `ops_ml.ml_run` through Trino's
  `ops` catalog (cross-catalog join).
- `data_class` is the OPA sensitivity tag the widget declares (DC.PRO = programme
  operational, DC.STK = stock, DC.PRF = facility/registry, DC.CAT = catalogue/
  national context).

## Internal BI — widget → source map

### Overview page

| Widget | Primary mart | Also reads | data_class |
|--------|--------------|-----------|-----------|
| `ov-brief` (Decision Brief) | `bi_supply.mart_supply_outbreak_response` | 5-way UNION: `bi_idsr.mart_idsr_outbreaks`, `bi_supply.mart_resource_allocation`, `bi_hmis.mart_hmis_indicator_coverage`, `bi_service.mart_programme_cascade`, `bi_public.public_region_reference` | DC.CAT |
| `ov-benchmarks` | `bi_facility.mart_facility_capacity` | `bi_facility.mart_health_workforce` (population) | DC.PRF |
| `ov-reliability-table` | `bi_hmis.mart_hmis_indicator_coverage` | `bi_supply.mart_supply_region_stock` (readiness) | DC.PRO |
| `ov-act-first-woredas` | `bi_idsr.mart_idsr_disease_weekly` | `ops_ml.ml_predictions` (alarm) | DC.PRO |
| `ov-source-pulse` | `bi_quality.mart_data_quality` | — | DC.PRO |
| `ov-trust-completeness` | `bi_idsr.mart_idsr_disease_weekly` | — | DC.PRO |
| `ov-trust-mapping` | `bi_facility.mart_facility_capacity` | — | DC.PRF |
| `ov-trust-silent` | `bi_facility.mart_facility_capacity` | — | DC.PRF |
| `ov-disease-snapshot` | `bi_idsr.mart_idsr_disease_weekly` | `ops_ml.ml_predictions`, `bi_public.public_region_reference` | DC.PRO |

### Disease Surveillance page

| Widget | Primary mart | Also reads | data_class |
|--------|--------------|-----------|-----------|
| `dz-kpi-strip` | `bi_idsr.mart_idsr_disease_weekly` | `bi_idsr.mart_idsr_outbreaks`, `ops_ml.ml_predictions` | DC.PRO |
| `dz-region-map` | `bi_idsr.mart_idsr_disease_weekly` | `bi_supply.mart_supply_region_stock`, `bi_quality.mart_data_quality`, `bi_facility.mart_health_workforce`, `bi_idsr.mart_ml_disease_input`, `ops_ml.ml_predictions` | DC.PRO |
| `dz-outbreaks-table` | `bi_idsr.mart_idsr_outbreaks` | — | DC.PRO |
| `dz-signal-chart` | `bi_idsr.mart_ml_disease_input` | `ops_ml.ml_predictions` | DC.PRO |
| `dz-woreda-table` | `bi_idsr.mart_idsr_disease_weekly` | `bi_idsr.mart_ml_disease_input`, `bi_hmis.mart_hmis_indicator_coverage`, `bi_supply.mart_supply_region_stock`, `ops_ml.ml_predictions` | DC.PRO |
| `dz-climate-ts` | `bi_idsr.mart_idsr_climate_drivers` | — | DC.PRO |
| `dz-climate-corr` | `bi_idsr.mart_idsr_climate_drivers` | — | DC.PRO |

### Resource Management page

| Widget | Primary mart | Also reads | data_class |
|--------|--------------|-----------|-----------|
| `rm-hero` | `bi_supply.mart_resource_allocation` | `bi_supply.mart_supply_region_stock` | DC.STK |
| `rm-statboard` | `bi_supply.mart_resource_allocation` | — | DC.STK |
| `rm-map` | `bi_supply.mart_supply_region_stock` | — | DC.STK |
| `rm-hotspots` | `bi_supply.mart_supply_region_stock` | — | DC.STK |
| `rm-stock-heatmap` (National Stock Distribution) | `bi_supply.mart_supply_region_stock` | — | DC.STK |
| `rm-wastage` | `bi_supply.mart_resource_allocation` | — | DC.STK |
| `rm-cold-chain` | `bi_hmis.mart_epi_cold_chain_safety` | — | DC.CAT |
| `rm-stockout-impact` | `bi_supply.mart_stockout_service_impact` | — | DC.STK |
| `rm-forecast` | `bi_supply.mart_supply_stockout_forecast` | — | DC.STK |
| `rm-events` | `bi_supply.mart_supply_stockout_events` | — | DC.STK |

### Service Performance page

| Widget | Primary mart | Also reads | data_class |
|--------|--------------|-----------|-----------|
| `sv-topline-kpis` | `bi_hmis.mart_hmis_indicator_coverage` | — | DC.PRO |
| `sv-flagship-table` | `bi_hmis.mart_hmis_indicator_coverage` | — | DC.PRO |
| `sv-cascade-hiv` / `-tb` / `-mnch` / `-ncd` | `bi_service.mart_programme_cascade` | (programme hard-locked per widget) | DC.PRO |
| `sv-continuity-mnch` | `bi_programme.mnch_coverage_v` | — | DC.PRO |
| `sv-dropoff-region` | `bi_programme.mnch_coverage_v` | — | DC.PRO |
| `sv-risk-woredas` | `bi_hmis.mart_hmis_indicator_coverage` | — | DC.PRO |
| `sv-zero-dose` | `bi_hmis.mart_epi_zero_dose` | — | DC.PRO |
| `sv-agreement-donut` | `bi_service.mart_reported_vs_recorded` | — | DC.PRO |
| `sv-data-trust-table` | `bi_service.mart_reported_vs_recorded` | `bi_public.public_region_reference` (names) | DC.PRO |

### Fetchers that exist but are NOT placed on a current page
Documented for completeness (they have a Fetcher but no catalog placement):
`rm-act-week` → `bi_supply.mart_supply_outbreak_response`; `rm-workforce` →
`bi_facility.mart_health_workforce`; `rm-equipment` →
`bi_facility.mart_equipment_availability`; `rm-facilities`/`ov-resource-facilities`
→ facility/supply marts; `sv-compliance`, `sv-facility-outliers`,
`ov-disease-pulse`, `ov-disease-outbreaks`, `ov-national-kpis` and the
`ov-resource-status`/`ov-service-attainment`/`ov-service-cascade` **aliases**
(which reuse `rm-hero`/`sv-flagship-table`/`sv-compliance`). See `fetchers.py` for
the exact bindings.

## The marts (dbt models) behind the schemas

All under `2_pipelines/marts/models/**` → Postgres `nhdw_vault` `bi_*` schemas:

| Schema.table | dbt model file | Grain |
|--------------|----------------|-------|
| `bi_idsr.mart_idsr_disease_weekly` | `idsr/mart_idsr_disease_weekly.sql` | region × woreda × disease × ISO week |
| `bi_idsr.mart_idsr_outbreaks` | `idsr/mart_idsr_outbreaks.sql` | outbreak episode (region × disease) |
| `bi_idsr.mart_idsr_climate_drivers` | `idsr/mart_idsr_climate_drivers.sql` | region × disease × week (+ climate) |
| `bi_idsr.mart_ml_disease_input` | `idsr/mart_ml_disease_input.sql` | woreda × disease × week (+ population) |
| `bi_hmis.mart_hmis_indicator_coverage` | `hmis_coverage/mart_hmis_indicator_coverage.sql` | region × woreda × indicator × programme × month |
| `bi_hmis.mart_epi_cold_chain_safety` | `hmis_coverage/mart_epi_cold_chain_safety.sql` | month (national) |
| `bi_hmis.mart_epi_zero_dose` | `hmis_coverage/mart_epi_zero_dose.sql` | region × year |
| `bi_service.mart_programme_cascade` | `service_performance/mart_programme_cascade.sql` | programme × region × year (funnel steps) |
| `bi_service.mart_reported_vs_recorded` | `service_performance/mart_reported_vs_recorded.sql` | region × indicator × month |
| `bi_supply.mart_resource_allocation` | `supply_chain/mart_resource_allocation.sql` | month × commodity (national) |
| `bi_supply.mart_supply_region_stock` | `supply_chain/mart_supply_region_stock.sql` | month × commodity × region |
| `bi_supply.mart_supply_stockout_forecast` | `supply_chain/mart_supply_stockout_forecast.sql` | environment × commodity (point-in-time) |
| `bi_supply.mart_supply_stockout_events` | `supply_chain/mart_supply_stockout_events.sql` | stockout episode |
| `bi_supply.mart_supply_outbreak_response` | `supply_chain/mart_supply_outbreak_response.sql` | region × disease × commodity |
| `bi_supply.mart_stockout_service_impact` | `supply_chain/mart_stockout_service_impact.sql` | commodity × region (12-month) |
| `bi_facility.mart_facility_capacity` | `facility_distribution/mart_facility_capacity.sql` | facility |
| `bi_facility.mart_health_workforce` | `facility_distribution/mart_health_workforce.sql` | region (+ population) |
| `bi_facility.mart_equipment_availability` | `facility_distribution/mart_equipment_availability.sql` | equipment type (national) |
| `bi_quality.mart_data_quality` | `data_quality/mart_data_quality.sql` | source × period × geography × dimension |
| `bi_programme.mnch_coverage_v` | **seeded view**, not a dbt mart — defined in `3_storage/postgres/init/03_program_demo.sql` over the hand-seeded `bi_facility.programme_metrics` table | region_code × quarter (MNCH continuum) |

> **Provenance caveat (say this if asked).** `bi_programme.mnch_coverage_v` (and
> the sibling `bi_programme.*` cascade views) are **program-demo seed data**, not
> pipeline-derived marts. Their `anc4` / `skilled_birth` / `postnatal` values are
> hand-seeded literals in `03_program_demo.sql` (region × quarter). So
> `sv-continuity-mnch` and `sv-dropoff-region` are **illustrative demo widgets**,
> whereas the rest of the internal-BI widgets read pipeline-built `bi_*` marts.
> This is by design — app/program-demo state is seeded directly, never derived.

**Upstream sources feeding these marts** (source → mart family): DHIS2 → HMIS
coverage, IDSR disease/outbreaks/climate, population; HCMIS/EPSS → supply
(resource allocation, region stock, forecast, events); MFR → facility capacity,
workforce, equipment; mBrana → zero-dose last-mile, data-quality; EthioEMR →
reported-vs-recorded, data-quality. See each mart's header comment for the exact
vault reads.

## Public portal — widget → source map

Detail (and the fallback-vs-live pattern) is in
[public-portal.md](public-portal.md). Summary of the real sources:

| Widget / seam | Source |
|---------------|--------|
| `pub-insights` (8 KPI tiles + 24-month trend) | fetcher → `bi_public.mart_public_indicator_kpis` (labels/targets from the `public_indicator_reference` seed) |
| `pub-hero` (fetcher) | `bi_public.bi_facility_distribution_public` — **_requires confirmation_**: the current static hero widget may not consume this fetcher |
| `pub-supply` (seam) | `bi_public.mart_supply_stockout_public` |
| `pub-region` (seam) | `bi_public.mart_public_indicator_kpis` (coverage-kind, latest month) |
| `pub-data-catalogue` | MinIO `catalogue.json` (pre-generated catalogue/datasets) |
| `pub-articles` / `pub-newsroom` / `pub-article-view` | `ops_governance.public_article` (CMS-style store) |
| `pub-access-modal` | access-request backend `routes/access_requests.py` (persisted to an ops table) |

All public marts apply **k≥5** suppression per cell.

## Admin — widget → source map

Detail is in [admin-dashboard.md](admin-dashboard.md). Admin widgets read **live
gateway endpoints / ops tables**, not `bi_*` marts:

| Widget | Source |
|--------|--------|
| `adm-topology` | `topology_graph.py` (manifest-derived nodes + live scans); gateway edges from `ops_audit.gateway_log`; traffic via `traffic_providers.py` |
| `adm-dq` | live `/gw/dq/*` endpoints (reads `bi_quality`/DQ marts + governance) |
| `adm-alerts-routing` | alert-routing config (`29_alert_routing.sql` store) + Prometheus alerts |
| `adm-users-access` | `ops_perm.*` (users) via `routes/perm_admin.py` |
| `adm-roles-permissions` | `ops_perm.permission` / `role_permission` (`32_permission_store.sql`) |
| `adm-sso-cards` | identity-source catalog (`identity_sources.yaml` seed) — apply-to-Keycloak is a stub |
| `adm-documentation` | served docs endpoint (`routes/docs.py`) |
| `adm-models-datasets` | `routes/ml.py` / graduation routes |

**_Requires confirmation_** (per the admin research): whether topology traffic on
non-gateway edges is live (needs Cilium/Hubble + Prometheus deployed) vs. gateway
edges which are confirmed real; whether Alertmanager physically delivers; whether
the SSO card "apply" writes to Keycloak (currently a catalog-only stub). See
[admin-dashboard.md](admin-dashboard.md) for the full list.
