# Evidence for the dashboard and access-point review

These are the screenshots and measurements behind the runtime findings in
[`../dashboard-access-point-review.md`](../dashboard-access-point-review.md). All captures were taken on 2026-10-20/21
from the live system:
- namespace `nhdw`, hosts `*.20.84.70.78.nip.io`;
- headless Chromium at 1440×900;
- the seeded demo personas (synthetic identities).

Screenshots are compressed copies. Every file name starts with the finding ID it supports.

## How each capture was produced

| Mode | Meaning |
|---|---|
| **As deployed** | The live application, unmodified. |
| **Simulated token** | The browser attached the user's *own* login token to `/gw/profile*` requests, client-side only. This shows what the page does once DAP-F01 is fixed. Nothing changed on the server. |
| **Fixture** | The two map data calls were answered in the browser with a labelled test dataset, because the live marts are empty or failing: OR = 80, AM = 0 (genuine zero), SO = null, others absent. Used only to test click and colour behaviour. |
| **Simulated state** | A request was held, refused, failed or emptied in the browser, to show how the page handles that state. |
| **Simulated delay** | One response was delayed in the browser, to test the order in which responses arrive. |

## Index

| Finding | File(s) in `screens/` | Mode | What it shows | Reproduce |
|---|---|---|---|---|
| DAP-F01 | `DAP-F01-bi-region-selector-all-areas.jpg` | As deployed | Region menu has one option, "All areas" | Log in to internal BI as `superadmin` or `analyst.ana`; open any page; open the Region chip |
| DAP-F01 | `DAP-F01-bi-disease-as-deployed.jpg`, `DAP-F01-bi-disease-with-token-simulated.jpg` | As deployed / simulated token | Same page before and after the token is supplied (regions and names appear) | As above; in devtools the `/gw/profile/reference` call returns 401 |
| DAP-F01 | `DAP-F01-bi-locked-chip-raw-code-OR.jpg` | As deployed | Oromia user's locked chip reads "OR" | Log in as `kebede.oromia` |
| DAP-F01 | `DAP-F01-map-geometry-401-fixture.jpg` | Fixture | The map cannot draw even with rows, because the outline file returns 401 | `GET https://internal-bi.<host>/gw/profile/geo/admin1.geojson` without a session returns 401 |
| DAP-A02 | `DAP-A02-hiv-director-disease-national-rows.jpg` | As deployed | The HIV-locked director's Disease page | Log in as `abebe.bekele`. The outbreak-table response has 95 rows and the signal chart 530 rows, identical to a national user, although the response echoes `applied_row_filter: {programme: [HIV]}` |
| DAP-F02 | `DAP-F02-resource-zeros.jpg` | As deployed | "0 at risk", "0%", "0 mo" from empty supply data | Resource page as any national user |
| DAP-F02 | `DAP-F02-service-programme-MNCH-zeros.jpg` | As deployed | Programme = MNCH turns the topline to 0% / 0% / 0 / 0 | Service page, Programme = MNCH |
| DAP-F04, DAP-D01 | `DAP-F04-D01-geographic-risk-502-as-no-data.jpg` | As deployed | A 502 shown as "No geographic surveillance data" | Disease page. Network: `dz-region-map` returns 502 with `TABLE_NOT_FOUND … bi_quality.mart_data_quality` in the body |
| DAP-A01 | `DAP-A01-column-governance-superadmin-403.jpg`, `DAP-A01-column-governance-ops-admin-ok.jpg` | As deployed | Super-admin denied; the ops admin sees 11 rows | Admin console → Column Governance as `superadmin` (privileged-ops), then as `hana.d` |
| DAP-F05 | `DAP-F05-classified-loading-simulated.jpg`, `…-403-simulated.jpg`, `…-500-simulated.jpg`, `…-abort-simulated.jpg`, `…-empty200-simulated.jpg`, `DAP-F05-review-500-simulated.jpg` | Simulated state | "nothing classified" while loading, on 403, 500 and abort; "scanning…" after an error. Only the empty-200 case is correct | As `hana.d`, hold or fail `/gw/classification/columns` in devtools (request blocking) |
| DAP-D02, DAP-F06 | `DAP-D02-signal-ears.jpg`, `…-farrington.jpg`, `…-seasonal.jpg`, `…-ewars-csd.jpg` | As deployed | EARS and Farrington "expected" lies under "observed"; seasonal steps at the year boundary; EWARS-CSD flags every week | Disease page → Anomaly & Trend → each Detection Model |
| DAP-F07 | `DAP-F07-model-select-stale-chart-simulated-delay.jpg`, `DAP-F07-farrington-baseline.jpg` | Simulated delay | The select reads "Seasonal-naive" while the Farrington series is drawn | Delay the `model=outbreak` response by 6 s, pick Farrington then Seasonal-naive |
| DAP-F09 | `DAP-F09-service-MNCH-cascades-hidden.jpg`, `DAP-F09-resource-period-hides-8.jpg` | Simulated token | MNCH hides the MNCH cascade; any period hides 8 of 11 Resource cards | Service → Programme = MNCH; Resource → Period = Last 12 weeks |
| DAP-F10, DAP-F11 | `DAP-F10-F11-resource-map-click-fixture.jpg`, `DAP-F10-disease-map-click-fixture.jpg` | Fixture | A click only updates the card's own strip; null and zero regions share one colour and read "0" | Click regions on each map with the fixture loaded |
| DAP-F12 | `DAP-F12-public-open-data.jpg` | As deployed | Fallback catalogue (fake DOIs) | `curl -s https://public.<host>/api/proxy/catalogue` returns 404 `{"datasets":[],"count":0}`. `…/api/proxy/datasets/D-003/preview` returns facility-count columns under the title "PHEM weekly IDSR bulletins" |
| DAP-F14 | `DAP-F14-woreda-table-palarm-1pct.jpg` | As deployed | P(alarm) "1%" for probability 1.0 | Disease → Hotspot table |
| DAP-F15 | `DAP-F15-alert-routing.jpg`, `DAP-F15-quality-lineage.jpg`, `DAP-F15-models-datasets.jpg` | As deployed | Sample recipients; "0/0 · 0.0s"; stale failed-run count | Admin console pages as `superadmin` |
| DAP-F16 | `DAP-F16-kpi-strip-clipped.jpg`, `DAP-F16-workshop-public-site-link.jpg` | As deployed | 6th card clipped at 1440 px; "Public site" lands on the workshop | Disease page; Workshop → Public site |
| DAP-D03, DAP-D07 | `DAP-D03-D07-service-page.jpg` | As deployed | Every indicator "OTHER", 98.7% "on track"; cascades empty | Service page |
| DAP-D04 | `DAP-D04-disease-full-climate.jpg` | As deployed | Climate legend lists three series that have no data | Disease page, scroll to Climate |
| DAP-D07 | `DAP-D07-overview.jpg` | As deployed | "This week" = whole-period total; 893 silent facilities | Overview |
| DAP-B01, DAP-B02 | `DAP-B01-B02-public-home.jpg` | As deployed | Raw tokens; "Palladium" repeated | `curl -s https://public.<host>/api/proxy/profile/copy/public` contains `{ministry.native_name}` and `{platform.native_name}` |
| DAP-B05 | `DAP-B05-keycloak-login.jpg` | As deployed | Palladium + National Health Data Warehouse + Federal Ministry of Health · Ethiopia on one page | Open any staff app while signed out |
| DAP-B09 | `DAP-B09-sso-identity-placeholders.jpg`, `DAP-B09-documentation-base-domain.jpg`, `DAP-B09-mdm-mixed-profiles.jpg` | As deployed | `TODO_GOOGLE_CLIENT_ID`, `localhost` issuer, "(mock)" marked active; `127.0.0.1.nip.io`; mixed-country MDM queue | Admin console pages |
| DAP-E09 | `DAP-E09-health-topology.jpg` | As deployed | Health & topology ("Cluster Activity"); numbers verified against kubectl | Admin → Health & topology |
| DAP-A04 | `DAP-A04-researcher-mlflow.jpg`, `DAP-A04-researcher-superset.jpg` | As deployed | External researcher in full MLflow and Superset SQL Lab | Log in as `genet.e`, open MLflow and Superset |

## Measurements without a screen

| Finding | Measurement | How to re-run (read-only) |
|---|---|---|
| DAP-D03 | `nhdw_ref.source_to_concept_map` = 0 rows, `nhdw_ref.concept` = 0 rows; `count(DISTINCT programme_id)` in `bi_hmis.mart_hmis_indicator_coverage` = 1 (`OTHER`) | `kubectl -n nhdw exec deploy/nhdw-trino -- trino --catalog marts --execute "select (select count(*) from nhdw_ref.source_to_concept_map),(select count(*) from nhdw_ref.concept),(select count(distinct programme_id) from bi_hmis.mart_hmis_indicator_coverage)"` |
| DAP-D02 | In the latest run, predicted = observed in 51/53 (EARS) and 48/53 (Farrington) national weeks. Cause at `bundle/seed-pack/app/ml/ears/train.py:86-105` (`n_years = g["year"].nunique()`) | Sum `ops_ml.ml_predictions` and `bi_idsr.mart_idsr_disease_weekly` by ISO week for the latest `ears` run and compare |
| DAP-D01 | `marts.bi_quality.mart_data_quality` does not exist | `… trino --catalog marts --execute "show tables from bi_quality"` |
| DAP-A02 | Scope skipped when the mart lacks the column | Code: `6_access-points/api/nhdw-gateway/app/fetchers.py:131-155` (`_where`); outbreak and signal row counts in the table above |
| DAP-A03 | External researcher gets 200 on `/gw/marts` (51 marts) and `/gw/reports/templates` | Log in to workshop as `genet.e`; call both in devtools |
| DAP-F03 | Anonymous `/api/series/national-coverage` returns hard-coded `[86,88,89,90]` | `curl -s https://public.<host>/api/series/national-coverage` |
| DAP-F04 | 502 bodies contain the Trino error text | Network tab on the Disease page (`dz-region-map`) |
| DAP-F08 | Programme options vs IDSR `programme_id` {MALARIA, EPI, VBD, TB, WASH}; `programme=cholera` returns 0 rows | `… trino --catalog marts --execute "select distinct programme_id from bi_idsr.mart_idsr_disease_weekly"` |
| DAP-F05 | Classification store unchanged after the review's single authorisation probe: 11 rows, last updated 2026-09-22 | `… trino --catalog ops --execute "select count(*), max(updated_at) from ops_perm.column_classification"` |

The full per-run logs, raw JSON responses and all 192 screenshots are retained by the review owner. They hold
operational detail that does not belong in the repository.
