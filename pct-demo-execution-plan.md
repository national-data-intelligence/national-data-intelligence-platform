# PCT / Zambia reference application — assessment and proposed execution plan

**Status: PROPOSAL FOR APPROVAL. Nothing in the repository or the cluster has been changed.**
Written 2026-09-20 (Sunday) against `plans/demo-direction-plan.md`, which this plan follows strictly.
Possible executive demo: Tuesday 2026-09-22. Working rule from Abenezer: everything is built and run
locally on this VM (Docker + the local cluster); nothing is pushed to GitHub until he says so.

Evidence base: five read-only repository sweeps (naming, seeds, dashboards/Control Tower, ML/orchestration/ops,
QAT + Global Fund material), live runtime queries on 2026-09-20, the Global Fund KPI Handbook 2023-2028
(theglobalfund.org), and the licence pages of the candidate foundation models.

---

## 0. Assessment summary (section 16 of the direction)

### Current state (measured)
- **Zambia data is complete but headless.** eLMIS archive: 2,807 facilities, 1,100 products (64 tracer), 11 programmes, 108 districts,
  11 provinces, 73,926 requisitions, 7,543,506 lines, Sep 2017–Aug 2018, flowing source → SeaweedFS → ClickHouse → landing → vault →
  8 `bi_supply.mart_elmis_hist_*` marts + 3 `bi_mdm` objects. **No dashboard widget reads any of them.**
- **Forecasting profile verified 2026-09-20** exactly as stated in the direction: 389,203 series; 29,202 tracer; median 11, max 12 monthly
  points; 228,647 series ≥10 months; 61.4% zero series-months; 13.2% rows with stockout days.
- **Everything the executive sees is Ethiopian.** ~832 files mention Ethiopia/NHDW; product name hard-coded in ~34 UI files, 5 page titles,
  the Keycloak login theme, 6 logo copies; **no central branding mechanism**. Demo users, articles, workshop groups, five of seven ML models,
  all dbt seed CSVs and the entity model are Ethiopian.
- **Control Tower is reusable.** It is a port of a Zambian prototype: regions, hubs, commodities and periods are data-driven from
  `GET /api/ct/plan` (marts `mart_ct_nodes / movements / vehicle_runs / plan_stats`); the movement panel already renders a "how this
  shipment was sized" explanation. Ethiopian coupling = 5 literals in `MapView.tsx` (centre/zoom, basemap tiles, outline geojson, terrain,
  elevation ramp), a region→code `CASE` in two mart SQL files, a few label strings, and a baked-in fallback plan file.
- **A band chart exists** (`timeSeriesBand`: history + forecast + interval), used by one disease widget; P10/P50/P90 map onto it unchanged.
- **Approval pattern exists** (project graduation: status + reviewer + verdict + transactional change + `log_policy_decision` audit).
- **No planning or optimisation code exists anywhere.** Today's Control Tower plan comes from a JavaScript generator outside the platform,
  mirrored into the HCMIS source. No `ops_plan` schema. No dbt snapshots / bitemporal machinery.
- **ML platform gaps** (pre-existing): scheduled scoring ignores the model alias (a challenger is never scored); `model_deployment.model_name`
  is unique; `model_performance` deletes by window without version (two versions overwrite); `ml_predictions` has no horizon/origin key;
  the `actuals` join is hard-wired to district/disease/year/week; package validators test a retired contract; no wheels directory, so a
  non-baked library needs internet at Job time; runner Jobs have no resource limits; **no GPU inside Kubernetes** (the T4 is reachable
  from Docker on the host: verified, 15 GB free).
- **Mesay's MDM release 2 received and inspected 2026-09-20** (`plans/mdm-release-assessment.md`): strong publication contract, one approved facility, restricted data-use marking.
- **QAT is not deployed here** (only a parked design document). **"Scoptim" appears nowhere** in the repository or hand-off material.
- Housekeeping found: four proof-of-concept containers of mine (`swpoc-*`) from the SeaweedFS Phase 1 are still running on the host.

### Target state
Zambia eLMIS archive → MDM-conformed masters → governed warehouse → PCT marts + KPI layer → forecast (model competition, champion in
MLflow) → shortage/surplus → deterministic planner with explained recommendations → human approve/reject with audit → Control Tower and
two PCT pages in the existing Internal BI, under a neutral product identity. Reproducible from repository mechanisms; nothing hand-inserted.

### Gap analysis (what stands between the two)
| Gap | Size | On Tuesday's critical path? |
|---|---|---|
| Product identity on the demo surface (Internal BI + login) | small, many files | yes |
| Zambia basemap/outline assets for the Control Tower map | small, needs assets | yes |
| PCT marts (demand/stock position, inferred network, shortage/surplus, KPI layer) | medium | yes |
| Forecast with quantiles at facility×product, produced by the runner | medium | yes |
| Planner 0.1 + persisted runs + explained recommendations | medium | yes |
| Approval workflow (ops schema + gateway routes + one modal) | medium | yes (thin) |
| Plan/forecast datasets flowing lake → marts → Control Tower shape | medium | yes |
| Demo roles/users/pages that show only the Zambia story | small | yes |
| MDM integration with Mesay's release | contract known, payload = 1 facility; ingestion path medium | thin slice only, after his authorization |
| Full model competition incl. foundation models, feature selection, reconciliation | large | time-boxed slice only |
| Rebrand of public portal, admin, workshop, docs, diagrams | medium | no |
| Routing (PCT 0.2) | medium | no |

---

## 1. Product name and positioning (deliverable 1)

Constraint I am applying: the dataset is a *pattern-preserving simulation of a Zambian eLMIS archive*. The product must not present
itself as a Zambian government system; "reference application on Zambia eLMIS data" is accurate, "Ministry of Health Zambia" would not be.

| Option | Product-facing name | Assessment |
|---|---|---|
| **A (recommended)** | Platform: **National Data Intelligence Platform (NDIP)** · Application: **PCT — Supply Chain Control Tower** · tagline "Zambia reference implementation" | Matches the repository and organisation name already on GitHub (`national-data-intelligence-platform`); separates the governed platform from the PCT product exactly as the architecture boundary requires; country appears as the dataset, not the owner. |
| B | **PCT Supply Intelligence** (single name for everything) | Simple, but erases the platform/product boundary the direction insists on. |
| C | **Zambia Health Supply Chain Intelligence** | Reads as an official national system; ties the product to one country; weakest for reuse. |

Technical identifiers stay: namespace `nhdw`, databases `nhdw_*`, buckets `nhdw-*`, env vars `NHDW_*`/`MINIO_*`, image names, realm ids.

## 2. Ethiopia / NHDW context that must change (deliverable 2)

Categories per the direction (counts from the audit):
A technical identifiers (~450 files) **keep** · B internal infrastructure names (~90) **keep** · C user-facing product names (~22) **change** ·
D documentation/diagrams (~28) change after the demo · E dashboard labels (~40) change on the demo surface, hide elsewhere ·
F seed/demo data (~206) replace for the demo roles · G code comments (~120) **leave** · H API labels (~10) change the chatbot prompt and
email copy only · I architecture descriptions (~12) rewrite with the capabilities document.

Exact areas for the Tuesday surface (Internal BI + login):
1. `6_access-points/dashboards/internal-bi/ui/index.html:5`, `ui/src/sections/{Sidebar.tsx:42-44,61, Topbar.tsx:37-38,54}`, `AuthSplash.tsx:18`
2. `7_security/keycloak/themes/nhdw/login/{template.ftl:18-20,53, login.ftl:5}`, realm display names (`setup-keycloak.py:861-862`, `realm-configs/*.json:3`), theme images
3. Logo binaries `internal-bi/static/assets/logo-fmoh.png` (+ keycloak theme copy)
4. Control Tower: `ui/src/ct/components/MapView.tsx:186-224` (5 literals), `static/ct/{ethiopia.pmtiles, et-regions.geojson, terrain/}`, `ui/src/ct/mount.tsx:83,88,94`, section eyebrow "EPSS distribution", fallback `ui/src/ct/data/plan.ts`
5. `internal-bi/ui/src/biApp.ts:36-42` (14-region list) — only if a Zambia page uses the region filter; the new pages will use province data from the marts instead
6. Chatbot: `nhdw-gateway/app/routes/chat_configs/internal-bi/{system-prompt.md, intents.yaml}`
7. Demo users: `bundle/seed-pack/app/security/users.yaml` (add Zambia-neutral demo users and a PCT role grant set rather than rewriting the existing ones)

Recommendation: introduce **one small brand module per SPA** (`ui/src/brand.ts`: product name, tagline, logo path) and replace literals
with it, starting with Internal BI. It removes the root cause (no central mechanism) and makes the remaining three SPAs a mechanical follow-up.
Deferred to after Tuesday: public portal (hero, globe, articles), admin, workshop, docs, diagrams, banner, outbound email copy.
Ethiopian pages are **hidden from the demo roles through role grants** (catalog-level, no code removed), not deleted.

## 3. Zambia data contract and seeding changes (deliverables 3 and 10)

### What the archive actually provides (fill rates measured on the source)
| Domain | Fields | Coverage |
|---|---|---|
| facility | code, name, type (13 types: HC 1,737 · HP 765 · DHO 105 · LVL1 105 · LVL2 36 · LVL3 17 · MSL 5 …), district zone, active/enabled, cold storage, electricity, `supplies_others` (227 true) | 100% |
| facility coordinates | latitude, longitude | **67.3%** |
| district / province | zone hierarchy Country → Province (11) → District (108) | 100%; **zone coordinates 0%** |
| product | names, strength, form, dosage unit, pack size 100%, tracer flag (64), storage flags, dimensions; product group 74.5% | as noted |
| programme | 11 programmes, programme×product (category, doses per month, **price 99.9%** — to be re-checked against the mutation note that prices were omitted) | 100% |
| period | 173 definitions, 3 schedules; **data only 2017-09 … 2018-08** | — |
| consumption | quantity_dispensed, normalized_consumption, period_normalized_consumption, AMC (97.0%) | 97%+ |
| stock | beginning_balance, stock_in_hand (97.1%), previous_stock_in_hand, losses/adjustments (100%) | 97%+ |
| stockout / censoring | stockout_days (13.2% of rows > 0), reporting_days (92.2%), skipped flag (53% of raw lines, excluded) | — |
| requisitions | status (RELEASED 33,358 · IN_APPROVAL 32,411 · AUTHORIZED 5,698 · …), emergency flag, created/modified timestamps | 100% |
| ordering | quantity_requested (sparse), calculated_order_quantity (97.0%), quantity_approved (99.4%), packs_to_ship, quantity_received (97.6%) | — |
| stock policy | max_months_of_stock (100%), max_stock_quantity (97.0%); facility type nominal max = 3 months, emergency order point = 0.5 | 100% |
| patients | new_patient_count | 47.5% |

### What we do NOT have, and how the demo handles it
| Missing | Consequence | Handling (always labelled) |
|---|---|---|
| Supplying store (`parent_facility_code` 0%, drop-off 1.8%) | no observed supply network | **Inferred network**: facility → District Health Office of its district (105 DHOs for 108 districts; DHOs have their own R&R stock lines) → provincial hub (MSL) ; marked `network_basis = 'inferred'` in the mart and on screen |
| Shipments, deliveries, lead times | OTIF and plan adherence not computable | not shown as KPIs; lead time is a **stated planning assumption** (30 days, from the Global Fund spot-check calibration in the hand-off), editable parameter |
| Pipeline (in transit) | only approximable | `approved − received` on RELEASED requisitions of the latest period; labelled "approved, not yet received" |
| 33% of facility coordinates, all zone coordinates | map gaps | district centroid **derived** from facilities with coordinates; flag `coord_basis = 'district_centroid'` |
| Catchment population (0%) | no per-capita KPIs | none offered |
| Fleet, roads, transport cost | routing inputs | synthetic and labelled, only in the optional 0.2 phase |
| Central-store ledger (MSL has 136 requisitions) | hub stock thin | hub availability taken from its R&R lines; when absent the planner reports "source stock unknown" rather than inventing it |
"Today" in the demo is the archive's own last period (**August 2018**); forecasts cover September–November 2018. No `now()`.

### Seed mechanisms (32 inventoried) — classification
- **Keep as is:** platform DDL, RBAC roles, OPA regeneration, docs seed, resource requests, pack/restore, the eLMIS source restore, `elmis_consumption_forecast`.
- **Ethiopia-specific, hide for demo roles (not deleted):** entity model and its six synthesizers, DHIS2/IDSR/EthioEMR/HCMIS/mBrana/MFR/Climate sources, programme demo SQL, articles, workshop groups, four disease models + `stockout_forecast`, two graduation projects, demo-console scenarios.
- **Parameterise:** `sources-up.sh` and `seed-realistic.sh` get a **profile** (`DEMO_PROFILE=zambia-pct`) selecting sources, ingest Jobs and ML packages — default behaviour unchanged.
- **Generate from Zambia source data (dbt, not CSV by hand):** province/district reference, product/programme reference, inferred hub catchment.
- Minimum chain for a Zambia demo: cluster + DDL + Keycloak → `sources-up.sh up elmis` → `elmis-hist-ingest` + full dbt chain → security seed (with PCT grants and demo users) → ML seed (PCT packages only) → plan run → verify.

## 4. Mesay's MDM (deliverable 4) — REVISED 2026-09-20 after inspecting release 2
Full assessment: `plans/mdm-release-assessment.md`. Bundle: `~/inbox/mdm-release/` (verified, Mesay's verifier PASS).

**What it is:** a published *release bundle* (object-store tree, five contracts, a Postgres bridge schema, three tools) — not the MDM
application, no SDK, no client. **Contract: strong** — ordered immutable release log, content-addressed Parquet, pinned snapshots,
`master_entity_uid`, source associations, identifier namespaces (`zambia-elmis.facility.code` = our vault business key), bitemporal
validity, field-level provenance; 14 entity classes = the eLMIS reference tables; fed by the same eLMIS archive we run plus a Master Facility List.
**Payload: almost empty** — 1 approved entity (Kafue District Hospital, eLMIS `502001` ↔ MFL `2374`), 24,690 records "identity unassigned",
no products/programmes/zones. It is a validation of the publishing machinery, not a master-data load.
**Data-use boundary:** the release is marked restricted / local-evaluation-only, and its README asks for owner authorization and a new
release before it is sent to the warehouse. Until Mesay answers, it stays in `~/inbox/`: not in git, not in SeaweedFS, not in the cluster DB.

**Integration design (to his contract, platform-native):** bucket `mdm-published-releases` (his name) + write identity for the publisher +
read identity for us → ingestion verb that walks `release-log/<scope>/` and lands each release under `nhdw-raw/mdm/…` with our manifest →
ClickHouse raw views (`JSONExtract` over `row_json`) → staging per role → vault (master-entity hub, source-association and identifier
links, canonical-revision satellite, all carrying `snapshot_uid`) → business-vault same-as from eLMIS hubs to master entities →
PCT marts expose `master_entity_uid` and an `mdm_state` column (`conformed` / `single_source`). His Postgres bridge importer is not
used on the platform (it bypasses staging and the vault); it remains useful for a throw-away local check.

**Tuesday position:** show conformance for real on what exists (release chain, pinned snapshot, the Kafue record resolved across two
sources with provenance, the stewardship backlog as a data-quality number) and label all other masters *single-source, not yet
MDM-conformed*. If Mesay publishes a release 3 that admits the 13 single-source classes, the same path conforms everything.
No second MDM is built. Our `bi_mdm` matcher leaves the demo surface (it maps Zambian products to the Ethiopian list).

## 5. KPI layer (deliverable 5)

### Documented concepts (sources cited; never relabelled)
- **Global Fund KPI S8 — On-Shelf Availability** (KPI Handbook 2023-2028, p.79-80): per facility and product *category*, availability of at
  least one tracer product; country score = available / expected; portfolio = average of country scores; target 90%; baselines 85/84/84% from
  Round 2 spot checks (2022). **Data source per the handbook: eLMIS for countries with mature systems, on-site collection otherwise.**
- **Global Fund KPI S9 — Supply continuity**: number of quality-assured suppliers per priority product — a market indicator, not computable here, not offered.
- **Spot-check programme concepts** (hand-off reference): OSA on day of visit; **OTIF** (central-store order lines, on time and in full);
  **SATP** stocked according to plan (central store); reporting timeliness; tracer products; storage-practice audits.

### Proposed PCT KPIs (ours — labelled as PCT KPIs, with the documented concept they follow where one exists)
| KPI | Definition / formula | Grain | Source | Decision supported | Computable? |
|---|---|---|---|---|---|
| Tracer availability (after GF S8 method, eLMIS-based) | facilities with ≥1 tracer product of a group in stock at period end ÷ facilities expected to stock it | month × product group × province | demand/stock position | where availability is failing | yes; product categories approximated by programme/product group — stated on screen |
| Stockout exposure | facility-product-months with stockout_days>0 ÷ reporting facility-product-months; also stockout days per 100 reporting days | month × province × programme | existing stockout mart | size of the problem | yes |
| Months of stock | stock_in_hand ÷ AMC, banded against policy (0.5 / 3 months) | facility × product | stock position | over/under-stock | yes |
| Stocked according to plan (facility-grain adaptation of SATP) | share of lines between emergency order point and max | month × programme | existing SATP mart | policy adherence | yes, adaptation stated |
| Demand trend | 3-month vs previous 3-month unconstrained consumption | product × province | demand position | demand shifts | yes |
| Forecast accuracy | WRMSSE / MASE / bias / P10–P90 coverage from rolling-origin backtest | model × demand class × product group × province | backtest dataset | can the forecast be trusted | yes |
| Stockout risk | probability projected stock < 0 within horizon (from forecast quantiles) | facility × product | forecast + stock | who to act on first | yes |
| Projected shortage / surplus | target stock − (stock + pipeline − forecast demand), signed, in units and months | facility × product × horizon | shortage/surplus mart | how much is missing / movable | yes |
| Replenishment need | Σ positive requirement, in units and value (price) | district × programme | planner run | budget / volume of action | yes (price to be verified) |
| Redistribution opportunity | Σ min(surplus, shortage) within a district | district × product | planner run | avoidable stockouts without new supply | yes |
| Facility reporting coverage & timeliness | reporting facilities ÷ active facilities; on-time = created ≤ period end + 15 d | month × programme | existing timeliness mart | data trust | yes |
| Order fill (approved ÷ calculated order) | Σ approved ÷ Σ calculated order quantity | month × programme | facility activity | supply constraint signal | yes — *not* OTIF |
| Recommendation status | recommended / approved / rejected, units and value | run | ops decisions | is the plan being acted on | yes once the workflow exists |
| OTIF, plan adherence, allocation performance vs delivery | need shipment/delivery data | — | — | — | **no — stated as not available** |

## 6. PCT marts (deliverable 6) — all dbt, `2_pipelines/marts/models/supply_chain/`, schema `bi_supply`
**Keep (8):** monthly_activity, availability, timeliness, satp, product_stockout, facility_activity, facility_product_month (feature mart), resupply_plan (becomes superseded by the planner output; removed once replaced).
**Add:**
| Mart | Grain | Source |
|---|---|---|
| `mart_pct_geo` | facility → district → province (+ derived centroids, coord basis) | vault facility/zone |
| `mart_pct_demand_position` | facility × product × month: dispensed, unconstrained demand, AMC, zero/intermittency flags, censoring flags | feature mart |
| `mart_pct_stock_position` | facility × product at as-of month: stock, MOS, policy band, pipeline (approved−received) | feature mart + requisition status |
| `mart_pct_supply_network` | facility → inferred supplying store → hub, basis flag | geo + facility type |
| `mart_pct_forecast` | facility × product × horizon: P10/P50/P90, model, version, run id | forecast dataset (lake) |
| `mart_pct_forecast_accuracy` | model × fold × demand class × product group × province: metrics | backtest dataset (lake) |
| `mart_pct_shortage_surplus` | facility × product × horizon: signed position, risk | forecast + stock position |
| `mart_pct_planning_run`, `mart_pct_recommendation` | run; recommendation (from, to, product, units, rule, why JSON) | planner dataset (lake) |
| `mart_pct_kpi` | KPI × period × province/programme | the marts above |
| `mart_pct_ct_nodes / _movements / _plan_stats` (+ `_vehicle_runs` in 0.2) | exactly the columns of the existing `mart_ct_*` | planner dataset |
Forecast, backtest and plan outputs reach the marts **as datasets through the lake** (runner/planner writes Parquet + manifest to
`nhdw-raw/pct_forecast|pct_backtest|pct_plan/` → raw views → staging → landing → vault → marts). No shadow SQL, no inserts into dashboards.

## 7. Forecasting architecture and evaluation (deliverable 6 of the direction's list; its sections 7 + the three forecasting addenda)

**Where it lives:** a defined package `2_pipelines/ml/forecast_lab/` (CLI, no notebooks): `profile`, `features`, `backtest`, `compete`,
`report`, `export`. It runs in Docker on the host (GPU available there) and logs everything to MLflow experiment `/research/pct_forecast`.
The winning configuration is then packaged in the platform's package contract and trained/scored by the **ML runner**.

**Protocol (fixed before any model is run):** 12 monthly points → rolling origins at months 8, 9, 10 (horizons 1–3 where available);
**month 12 is the final holdout, touched once**. Skipped lines never enter. Both constrained demand and **unconstrained** demand
(dispensed × reporting_days ÷ days in stock, capped, flagged) are evaluated. Series classified smooth/erratic/intermittent/lumpy (ADI, CV²).
Leakage controls: features carry an `available_at` time; selection and tuning happen inside each training fold only.

**Feature registry** (`features.yaml` + generated report): name, source, definition, grain, availability time, transformation, leakage
possible?, models tested, selection evidence, decision. Candidates cover everything the direction lists that exists in the contract above
(lags, rolling stats, zero-run lengths, ADI/CV², stock, stockout days, days in stock, pipeline, requisition history, order quantities, facility
type/district/province, product/group/programme, service levels, MOS; calendar month only as a weak signal given 12 months; lead time absent).
Selection: quality screen → leakage screen → variance/redundancy → permutation and tree importance → ablation by feature family → SHAP for
the champion's explanation. Nothing is optimised on the holdout.

**Competition:** naive-1, mean, damped Holt, Croston, SBA, TSB, ADIDA, global LightGBM (Tweedie + quantile objectives), zero-shot
**Chronos-2** and **TimesFM 2.5** (both Apache-2.0, run on the T4). **Moirai 2.0 is excluded: its weights are CC-BY-NC (non-commercial).**
Principled ensemble of the best per demand class if complementary. Questions answered with numbers: zero-shot vs local statistical vs global
supervised; effect of fine-tuning (expected unjustified with ≤12 points per series — to be shown, not assumed); intermittent series; censoring;
inference cost for the full catalogue; maintainability inside the runner. **A simpler model stays champion if it wins.**

**Metrics:** MASE, WRMSSE (weights by value where price is valid, else volume), bias, pinball loss and P10–P90 coverage, stockout-risk hit rate.
**Hierarchy:** bottom-up vs MinT-shrink across facility → district → province → national, judged on coherence and accuracy.

**Platform integration without touching other people's code where avoidable:**
- champion/challenger through MLflow aliases and the existing `POST /api/ml/{model}/promote`; every promotion recorded in the existing but
  unused `ops_artifact.promotion_log`; promotion rule written down (WRMSSE and coverage on the folds, not the holdout).
- backtest results are a **dataset** (→ `mart_pct_forecast_accuracy`), so the limits of `model_performance` do not block us.
- quantiles: `pred_cases_lwr95/upr95` keep their 95% meaning; P10/P50/P90, horizon, origin, model and run id go in `attrs`.
- logged per run: configuration, training-data version (lake manifest run ids + dbt invocation id), feature definition, metrics, forecast artifact.
- Recorded, **not fixed** (pre-existing, outside our lane unless you bring them in): alias ignored by scheduled scoring, unique deployment
  name, performance table key, stale validators, missing wheels directory, no Job limits.

**Forecast inspection page** (part of this workstream): one Internal BI page built from existing widget kinds — series explorer
(band chart: history, P10/P50/P90, actual vs forecast, stock, model/version/run id), top shortage risks, top surplus, accuracy by model /
demand class / product group / province, champion vs challenger. Reads the forecast marts only.

## 8. Planner architecture (deliverable 7)
- Package `2_pipelines/planning/` + image `nhdw/plan-runner` following the ML runner pattern (ephemeral Job, parameters, run record, outputs as datasets).
- **Inputs:** `mart_pct_forecast` (P50 and P90), `mart_pct_stock_position`, pipeline, stock policy (max months, emergency order point),
  `mart_pct_supply_network`, pack size, tracer priority.
- **0.1 logic (deterministic, reproducible from run parameters):** target stock = max-months × forecast demand, safety from P90−P50;
  requirement = target − stock − pipeline; rounding to packs; source = inferred supplying store; when source stock is insufficient,
  priority tiers (stocked-out tracer → tracer → other) then proportional fair share; lateral redistribution inside a district from stock
  above max to stock below the emergency point. An LP formulation (OR-tools) is the 0.1b upgrade once the greedy baseline is validated — it needs a new baked library.
- **Every recommendation carries `why`**: forecast demand, opening stock, pipeline, target, deficit, source stock, allocated quantity, rule,
  priority, binding constraint — in the JSON shape the existing movement panel already renders.
- **Persistence:** runs and recommendations as datasets (→ marts); **decisions** in a new `ops_plan` schema (`planning_run`,
  `recommendation_decision` with status, reviewer, decided_at, note; valid-time + recorded-time columns = the team's bitemporal decision, applied where it matters).
- **Workflow:** gateway routes `POST /api/pct/recommendations/{id}/approve|reject`, `GET /api/pct/runs`, copying the graduation pattern
  (role gate, transactional status change, `log_policy_decision`, `ops_audit.data_event`). One modal in Internal BI using the existing modal host.

## 9. Dashboard / Control Tower (deliverable 8)
No new framework. Catalog-driven additions to Internal BI, shown to PCT demo roles only:
1. **PCT Overview** (new page, existing widget kinds): the KPI strip (availability vs the 90% GF target line, stockout exposure, MOS bands,
   projected shortage value, redistribution opportunity, recommendations approved), province risk table, top 10 risks.
2. **Forecast** (new page): the inspection views of section 7.
3. **Supply Control Tower** (existing page, reused): fed by `mart_pct_ct_*`; movement panel shows the planner's `why`; approve/reject modal.
   Required code: the five `MapView.tsx` literals + Zambia basemap/outline assets, the region-code `CASE` replaced by province codes from
   `mart_pct_geo`, label strings, and a source switch in `routes/ct.py` (`?domain=pct` or an env default) so the Ethiopian plan stays intact.
4. Data quality: existing admin DQ page already lists `eLMIS-hist`; timeliness/coverage KPIs surface on the overview.
The Zambia map assets: the hand-off notes say Abenezer's local repository contains the original standalone Zambia Control Tower prototype —
its `pmtiles`, outline and terrain files are the fastest source (to be transferred); otherwise a plain vector outline is generated from public boundaries.

## 10. QAT / PCT / forecasting / planner boundary (deliverable 9)
- **QAT (external, not deployed here):** national quantification and supply planning by programme — multi-year forecasts, shipment schedules,
  funding, procurement agents. Authoritative for *what the country procures and when*.
- **Warehouse:** governed history, conformance, marts, security, lineage.
- **PCT:** operational, facility-level, monthly — demand intelligence, forecasting for replenishment, shortage/surplus, recommendations, approvals.
  Authoritative for *what should move between which facilities now*.
- **One forecasting system in this demo: the PCT/ML layer.** No QAT forecasting is reimplemented. QAT's future role = the plan side
  (approved supply plans, shipments) that would make OTIF and plan adherence real; its connector stays deferred.
- **"Scoptim" is not mentioned anywhere in the repository or hand-off material.** I need its definition from Abenezer before placing it;
  if it is the optimisation engine, it sits behind the planner's allocation/routing interface (0.1b/0.2).

## 11. Repository implementation map (deliverable 10)
| Area | Path | Workstream |
|---|---|---|
| PCT marts, KPI layer, geo/network | `2_pipelines/marts/models/supply_chain/mart_pct_*.sql`, `_models.yml`, `_sources_vault.yml` | B |
| Forecast/plan datasets through the pipeline | `2_pipelines/staging/raw_views`, `staging/models/pct_*`, `pii_policy.yaml`, `vault/models/raw_vault/pct_*`, `macros/sat_payloads.sql` | B with C/E contracts |
| Forecast lab | `2_pipelines/ml/forecast_lab/` (new package) | C |
| Champion package(s) | `bundle/seed-pack/app/ml/pct_demand_forecast/`, `deployments.yaml` | D |
| Runner image extras | `2_pipelines/ml/runner/Dockerfile` (LightGBM) — **Bini's component, needs agreement** | D |
| Planner | `2_pipelines/planning/` (new), image entry in `bundle/scripts/build-images.sh`, Job in `1_infrastructure/k8s/base/` | E |
| Decisions | `3_storage/postgres/init/35_ops_plan.sh` (new), `nhdw-gateway/app/routes/pct.py` (new), `routes/ct.py` source switch | E/F — gateway is Bini's component |
| Dashboard | `internal-bi/catalog/pages|sections/*pct*`, `ui/src/widgets/pct-*/`, `ui/src/modals/pct-decision/`, `ui/src/ct/components/MapView.tsx`, `static/ct/` | F, I — Bini's component |
| Branding | `internal-bi/ui/src/brand.ts` (new) + the files in section 2; Keycloak theme | H0 — Bini's component |
| Governance | `bundle/seed-pack/app/security/{mart_attrs,role_grants,users}.yaml` | G |
| Seeding profile | `bundle/scripts/{sources-up,seed-realistic,seed-ml}.sh`, new `seed-pct.sh` | G |
| MDM integration | ingestion verb + staging/vault models (after inspection) | A |
| Docs | `docs/pct-capabilities.md`, architecture, data dictionary | H |

## 12. Agents and worktrees (deliverable 11)
One branch + worktree per workstream under `~/worktrees/<stream>` (outside the main clone), one integration owner (me):
A MDM integration · B PCT marts + KPI layer · C forecast research/backtesting · D ML packaging/MLflow · E planner · F Control Tower integration ·
G demo seeding + governance · H documentation/capabilities · H0 branding · I forecast inspection page. Two adversarial verifier agents
recompute key numbers independently and audit leakage and governance. Agents run in parallel only after the contracts below are frozen:
**C→D:** forecast dataset schema · **D→E:** `mart_pct_forecast` · **E→F:** `mart_pct_ct_*` = existing CT columns, recommendation id + `why` ·
**B→everyone:** geo/network/position marts. Each increment: inspect → design → implement → test locally → test on the platform → evidence → commit → publish its contract.
Hard boundary applied to every agent: no edits outside its lane; unrelated defects are recorded, not fixed.

## 13. Critical path to Tuesday (deliverable 12) and sequence with gates (deliverable 16)
I keep your phase order with **two changes, from the evidence**: (1) the forecasting harness (your phase 3) starts on day one in parallel
with the marts, because it depends only on the feature mart that already exists; (2) a thin Control Tower integration spike moves early,
because the map assets and the gateway source switch are the longest external dependencies (they involve Bini's components and your root imports).

| When | Phase | Work | Acceptance gate |
|---|---|---|---|
| Sun eve | 0 | decisions below; branding module + Internal BI/login identity; architecture note | name approved; login + BI chrome show the new identity locally |
| Sun eve–Mon am | 1 | demo profile for seeding; PCT roles/users/grants; MDM inspection if the zip arrives | demo user sees only Zambia pages; `verify-system` green |
| Sun eve–Mon am | 2 | geo, network (inferred), demand + stock position, KPI marts | dbt tests green; totals reconcile to 1,072,527,469; KPI values recomputed by a verifier |
| Sun eve–Mon noon | 3 | forecast lab: protocol, registry, baselines + intermittent + LightGBM on the tracer set; zero-shot Chronos-2/TimesFM on a stratified sample | reproducible run ids; leakage audit passes; results table by demand class |
| Mon pm | 4 | champion packaged, trained by the runner, P10/P50/P90 forecast → lake → marts; promotion logged | model in MLflow with alias; `mart_pct_forecast` populated; beats damped Holt on folds |
| Mon pm | 5 | planner 0.1 run → datasets → marts → CT shape; `ops_plan` + approve/reject routes | every recommendation has a `why`; rerun gives identical output; decision round-trips with audit rows |
| Mon eve | 6 | Control Tower on Zambia plan + 2 PCT pages + decision modal | the ten questions of your section 9 answerable on screen from marts |
| Tue am | 7 | end-to-end validation (checklist below), rehearsal, freeze, snapshots | checklist all green; rollback tested |
| after | 8 | routing 0.2, full competition, remaining rebrand | — |
Image imports need you: I will batch them into **two** root imports (Monday evening, Tuesday morning).
Executives reach the demo through your laptop (SSH tunnel) unless port 443 is opened in Azure.

## 14. What can be built now without Mesay or Yoni (deliverable 13)
Phases 0, 2, 3, 4, 5, 6, 7 entirely; phase 1 except the MDM step (single-source master fallback).

## 15. What must wait for Mesay (deliverable 14) — REVISED
1. **Authorization:** may release 2 be loaded into the demo environment, or will he cut a release with a demo-approved data-use policy?
2. **Coverage:** a release 3 that admits the single-source classes (products, programmes, programme-products, zones, facility types,
   periods) and as many facilities as stewardship allows — without it, MDM conformance on Tuesday is one facility.
3. Supplying-facility attribute and tracer flag in his canonical models (the planner and KPI layer need them; we infer/derive meanwhile).
4. The MDM Client and the publisher deployment (not in the bundle) — timing.
What no longer waits: the consumer contract — we have it and can build the ingestion path against the bundle locally.
From us to him (answers his 2026-09-09 request): S3 endpoint, a write-scoped identity on bucket `mdm-published-releases`, and the access path.

## 16. What Bini must supply (deliverable 15)
Agreement that we change his components on local branches (Internal BI, gateway routes, Keycloak theme, runner Dockerfile), or his own hands
on them; review before anything is pushed; ideally passwordless `k3s ctr images import` for the demo window; Azure port 443 if executives
connect directly; confirmation that hiding Ethiopian pages by role grant is acceptable.

## 17. Demo-day validation checklist (deliverable 17)
1. Login page and BI chrome show the approved identity; no Ethiopian label on any page a demo role can open.
2. Source: `verify.sh` counts = manifest. 3. Lake/landing/vault = 7,543,506; Σ dispensed = 1,072,527,469.
4. Masters conformed (MDM or labelled single-source). 5. KPI tiles = verifier's independent SQL.
6. MLflow: champion alias, run id on screen = run id in the mart; backtest table present; holdout used once.
7. Forecast page: one facility-product series shows history, P10/P50/P90, actual vs forecast.
8. Plan run id on Control Tower = run in marts; three sampled recommendations recomputed by hand from their `why`.
9. Approve one, reject one → status on screen, rows in `ops_plan` and audit; refused for a role without the grant.
10. Partner role sees nothing of PCT (403). 11. Inferred/assumed/derived items are labelled on screen.
12. Full rerun from the seeding profile reproduces the marts. 13. `verify-system` green; snapshots taken; rollback rehearsed.

## 18. Unnecessary for Tuesday — defer (deliverable 18)
Routing and fleet (0.2); LP optimiser; foundation-model fine-tuning and full-catalogue inference; MinT reconciliation beyond a first
comparison; public portal, admin, workshop, docs and diagram rebrand; renaming technical identifiers; removing Ethiopian sources (hide
instead); QAT connector; live OpenLMIS v3 lane; fixing the pre-existing ML platform gaps and the four placeholder DAG rows; CI/provision
changes; credential rotation; bitemporal modelling beyond the decisions table; full catalogue (tracer set first).

## Decisions I need before starting
1. Product name: option A? 2. Tuesday slice as in section 13 (tracer set, greedy planner, routing deferred)?
3. May we change Bini's components on local branches, with his review before any push? 4. What is "Scoptim"?
5. MDM: ask Mesay (a) is release 2 authorized for the demo environment, (b) can he publish a release 3 with the single-source classes admitted? Also: the Zambia Control Tower map assets from the old local repository, if available.
6. Bake LightGBM into the runner image (one line, his component) — yes/no? 7. May I remove my four leftover `swpoc-*` PoC containers?
