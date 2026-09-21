# PCT Final Build — Hand-off briefing (the authoritative plan, 2026-09-21)

You are building the **PCT product phase** on the completed NHDW data-layer platform: the
Palladium-branded demo surface AND the capability jump from "a dashboard displaying
supply-chain information" (state A) to "a decision-support product producing traceable,
approvable recommendations" (state B). This document absorbs `pct-demo-sprint.md`
(S0–S9, decisions confirmed 2026-09-21) and adds the decision spine the gap assessment
(`briefings/pct-gap-assessment-2026-09-21.md`) showed every design generation demands
and no plan yet contained. **Read Part 0 fully before writing any code.** Then Part 1
(the whole), Part 2 (the batches), Part 3 (interfaces), Part 4 (grounding + delivery).

Historical record: the August design (pct-system-capabilities-draft v0.1, pct-work-ahead,
pct-roadmap), the September chunk maps (C01–C21), and the gap assessment stand as
evidence. Where they disagree, THIS document is the decision.

---

## PART 0 — How PCT sits in this system, and how to work in it (do not skip)

### What exists underneath you (all verified live 2026-09-21)
The platform pipeline: **sources → dlt ingestors → SeaweedFS lake → ClickHouse staging →
Postgres raw/business vault (Data Vault 2.0, AutomateDV) → `bi_*` marts → Trino → FastAPI
gateway (OPA row filters + column masking on every read path) → SPA dashboards.** The
data-layer enhancement is COMPLETE and delivered, ready for you to *consume*:

- **Master data:** facility MDM at national scale (`sat_facility_canonical` 3,298,
  `lnk_facility_identifier` 5,763 across 5 namespaces, steward console, append-only
  bitemporal decision log, releases pinned by `SET nhdw.release_as_of`). Commodity golden
  is thin (34 records). Mesay's external release 2 approves exactly ONE facility — the
  demo maps facilities through the eLMIS↔MFL reference lane, never through MDM.
- **Reference terminology:** `nhdw_ref` (163 concepts, 187 crosswalk rows, WHO ICD-10/ATC
  edges), joined by the vault resolution views.
- **Governance:** DQ incident record + detector + KPIs (+ our governance marts), column
  masking verified on all main read paths, OpenMetadata catalog with 582 lineage edges
  including the dashboard/widget hop.
- **ML rails:** MLflow champions, runner Jobs, drift/performance monitoring, a promote
  endpoint and an `R-OPS-ML-APPROVER` role — and an EMPTY `ops_artifact.promotion_log`
  (never exercised). Registered model `elmis_consumption_forecast` (MASE 0.977 vs naive)
  with 6.18M rows in `ops_ml.ml_predictions` that NO supply surface reads.
- **Zambia data:** the eLMIS 2016–2018 archive, 7,543,506 lines reconciled end to end;
  8 `mart_elmis_hist_*` marts; the 3.44M-row facility×product×month feature mart.
  Demo "today" = **August 2018**; forecasts Sep–Nov 2018; NEVER `now()`.

### The decisive ground truths from the gap assessment (build on these, not on memory)
1. **The Control Tower's plan content is frozen demo-ware.** `mart_ct_{nodes,movements,
   vehicle_runs,plan_stats}` (259/3,258/145/6 rows) carry the 1:1 mirror of the old UI
   mock (`synthesize_dispatch.py` ← `plan.ts`); the solver that produced it
   (`gen-plan-et.cjs`) NO LONGER EXISTS in the repo. The plumbing (source→vault→mart→
   `GET /api/ct/plan`→UI) is real and stays; the content gets replaced by Zambia reality.
2. **No decision loop exists anywhere**: zero plan/approval tables in `nhdw_ops`, zero
   plan approve/reject endpoints (`ct.py` has exactly one read route), zero
   plan-vs-actual code. The patterns to build it sit one lane over (MDM decide/revert,
   the FDW read seam, approval flows in groups/workspace/graduation).
3. **The unmerged foundation:** branch `feat/pct-zambia-reference` (d4c0769, cut from old
   main) holds the 5 policy/price/schedule reference tables through staging+vault. Its
   models were applied LIVE during evidence runs — that is why ClickHouse/Postgres hold
   5 eLMIS objects with no model on `develop`. First job is landing it properly.
4. **Zambia geo:** 1,888/2,807 facilities (67%) have coordinates; the CT map's basemap is
   Ethiopian (pmtiles + DEM). Zambia needs at least a boundary geojson; full offline
   terrain is out of scope.
5. `mart_supply_stockout_forecast` is deterministic AMC arithmetic (646 rows) and
   `mart_elmis_hist_resupply_plan`'s own header calls itself "the planning-module mock".
   Both are honest about it — keep that honesty on every new surface.

### Non-negotiable rules (unchanged from the platform)
1. **Bounded chunks, 8-step protocol**: plan presented at each phase boundary BEFORE
   implementing; evidence before the next chunk; no unrelated fixes; no refactors.
2. **Cold-boot reproducibility**: everything in seeds / manifests / images / numbered
   init files; "done" = teardown → bootstrap reproduces it. A frozen dataset carried
   around a deleted generator (ground truth #1) is the counterexample this rule exists
   to prevent — never create another.
3. **Never delete — archive** (`_archive/<date>/<topic>/`), then grep the old name.
4. **Push only on Abenezer's word, per push. No AI traces in the repo** — grep every
   staged diff. Author identity: Abenezer Tesfaye <tesfayeben46@gmail.com>.
5. **Bini works in parallel.** Fetch/rebase before every image build; zero-overlap check
   before every import; his merges to `develop` are the integration truth.
6. **Every mart** follows the house conventions: `_models.yml` docs+tests, sources
   declared, `mart_attrs.yaml` row, grants post-hook, materialized **table** for PCT
   marts (the 2026-09-20 CASCADE incident rule: PCT marts are never views), and a
   passing `check-dbt-sql.py`.
7. **Labeling honesty (rule E9):** nothing on screen is called a "Global Fund KPI"
   unless it follows the Handbook method; adaptations say "facility-grain adaptation"
   on the surface; inferred/assumed/derived values say so.

### Load-bearing contracts you must not break
- **`GET /api/ct/plan` response shape** (`routes/ct.py` → `ct/data/runtime.ts` with
  static fallback): extend additively; never rename existing keys — the UI falls back
  to the static mock on parse failure and that failure is silent.
- **The conformed-key spine and MDM stores are Bini's** — read `master_entity_uid`,
  resolution views and marts; never edit `business_vault/**` conformance, `ops_governance.
  mdm_*`, OPA policy, `masking.py`, `opa.py`, or init 17/34/35/36/38/39.
- **`fetchers.py` is the authoritative widget→mart registry** — new widgets register
  there; `gen-exposures.py` + `sync-om-dashboards.py` both parse it (rerun BOTH after
  widget changes: same registry, two catalogs, no drift).
- **The access-point OM emission standard** (docs/metadata-plane.md): the reworked PCT
  page's pages/widgets/lineage flow through `sync-om-dashboards.py` — the catalog yamls
  are the source of truth, never a hand-kept list.
- **`_manifest.json` lake sidecars** are read by freshness/DQ/watermarking — the
  forecast/plan lake writes (Batch 3) add their OWN manifests in the same convention.
- **Init numbering:** 40 is taken (`40_dq_read.sql`). **Next free is 41.** Check
  `origin/develop` again at branch time — this is the third collision hazard.
- **The real-email path** (`mailer.send` → live SMTP to a personal Gmail): nothing in
  this phase emails; anything that could defaults OFF.
- **Role grants / Sidebar / adminApp / cache-images / build-images** are append-only,
  clearly-marked sections.

---

## PART 1 — The full final-work plan (three workstreams, one thesis)

**The thesis:** the demo must show a *product*, not a themed dashboard. Concretely:
real Zambia KPIs computed by declared methods → an honest forecast with its accuracy on
screen → a projected position → a recommendation with its `why` → **a human approving or
rejecting it, persisted with audit** → the approved plan back in the warehouse. That
last clause is the A→B move; everything else supports it.

- **W1 — Palladium rebrand** (tier 1 = what the demo shows: Keycloak login, internal-BI,
  admin, emails/export stamps; tier 2 = public + workshop + Superset + dbt-docs after).
  Grounded in the 2026-09-20 branding inventory (5 identical MoH logo copies, 4 tab
  titles, login theme, email templates, export/report citation stamps, Superset DB
  display name, realm displayNames). Product name: **"Data Intelligence Center ·
  Palladium"**; three official logo files are in `~/inbox/` — pick/adapt the best
  renderer. Realm IDs (`moh-staff`) stay (a rename is a migration — recorded follow-up).
- **W2 — the PCT product build** (Part 2, Batches 1–4): foundation merge → KPI/geo/
  position marts → forecast surfaced → **decision spine** → dispatch best-effort →
  the PCT page.
- **W3 — packaging and gates**: demo checklist (13 items), forbidden-branding sweep,
  verify-system, OM re-emission, decision records, journal/STATUS, PR flow.

Deliberately NOT in this phase (assessment §10, each with recorded cause): LP/network
optimization, road-network routing, QAT integration (two owner questions open; D8
facility-grain pinning keeps us out of its lane), scenario planning, national-grain
forecasting, person MDM, realm renames.

---

## PART 2 — THE ASSIGNMENT (four batches; each batch = bounded chunks with gates)

### Batch 1 — Foundation (chunks F1–F3)
- **F1 · Land the reference lane.** Rebase `feat/pct-zambia-reference` (d4c0769) onto
  current `develop` into the working branch; resolve the 5 "modelless" live objects into
  repo-owned models; rebuild staging/vault images; **ROOT STEP: Abenezer runs the
  `k3s ctr images import`** (batched — the only other import comes at Batch 4). Gate:
  chunk-1 tables live from repo models, `verify-system` green, alignment checker OK.
- **F2 · Palladium tier 1.** Logo replacement at all 5 referenced copies + the Keycloak
  theme (template.ftl logo/alt/footer, login.ftl copy + placeholder, REALM_DISPLAY,
  email fromDisplayName), tab titles/favicons/sidebar marks/auth splashes (internal-bi,
  admin), the 3 admin email templates, gateway onboarding/alert email strings, the
  export/report citation stamps, FastAPI titles. Gate: grep sweep = 0 renderable
  "Ministry of Health / FMoH / Ethiopia NHDW" strings on tier-1 surfaces + a login/BI/
  admin screenshot walk showing only Palladium.
- **F3 · Palladium tier 2** (public, workshop, Superset DB name, dbt-docs wordmark;
  Ethiopian editorial content hidden/genericized, NOT rewritten; the hero globe swapped
  for a neutral visual). May run after Batch 3 if time presses — tier 1 is the demo gate.

### Batch 2 — Real numbers (chunks K1–K4)
- **K1 · `mart_pct_kpi`** (bi_supply, TABLE): long format (kpi_code, period, province,
  programme, value, numerator, denominator, target, basis_label) computing from the 8
  existing marts + F1's policy tables: tracer availability (**GF S8 method**, target 90,
  basis_label carries the Handbook citation), stockout exposure, months-of-stock bands,
  SATP (labeled adaptation), demand trend, reporting coverage/timeliness, order fill.
  Plus seed `pct_kpi_definitions.csv` (name/definition/formula/grain/source/decision/
  limitation/official_reference — the per-KPI template from the September plan). Gate:
  every KPI recomputed by independent hand-SQL for one province×month; totals reconcile
  (7,543,506 / Σ 1,072,527,469); dbt tests green.
- **K2 · Zambia geo mart** (`mart_pct_facility_geo`): coords for the 67%, district
  centroid + `coord_basis='district_centroid'` for the rest; Zambia boundary geojson
  into the internal-bi static assets (fallback plain boundary+points map — no terrain).
- **K3 · Derived demand quantities** (change-impact C06, into the feature-mart family):
  `unconstrained_demand = dispensed × reporting_days ÷ (reporting_days − stockout_days)`
  capped + `censored` flag; `pipeline_qty` from RELEASED requisitions of the latest
  period. These feed K4 and Batch 3.
- **K4 · `mart_pct_position`** (TABLE; supersedes the resupply mock — archive its
  "mock" framing, keep the model): per facility×product×horizon: target stock (policy
  months × AMC), projected position = SIH + pipeline − demand, signed shortage/surplus
  in units and value (F1 prices), replenishment need, and district-level redistribution
  opportunity = Σ min(surplus, shortage). Until Batch 3 lands, the demand term is AMC
  (labeled `basis='amc'`); Batch 3 flips it to forecast P50 (`basis='forecast_p50'`).
  Gate: 3 sampled rows recomputed by hand from source data.

### Batch 3 — The forecast, surfaced honestly (chunks M1–M3)
- **M1 · Backtest.** Rolling-origin backtest of `elmis_consumption_forecast` vs naive-1
  and seasonal-naive on the tracer set: origins months 8/9/10, horizons 1–3, month 12
  held out and touched ONCE. Runs through the ML-runner pattern; logs to MLflow
  experiment `/research/pct_forecast`; artifacts (+ feature registry) to the lake
  `nhdw-raw/pct_forecast/…` + `pct_backtest/…` with `_manifest.json` sidecars.
- **M2 · Forecast marts.** `mart_pct_forecast` (facility_uid, product_uid, target_month,
  horizon, p10, p50, p90, model, model_version, run_id) + `mart_pct_forecast_accuracy`
  (run_id, model, fold, horizon, segment, metric ∈ {MASE, bias, pinball, coverage},
  value, n_series) — the first supply marts to READ `ops_ml` predictions. K4 flips its
  demand basis. Gate: MLflow run id on screen ≡ run id in the mart; metrics recomputable.
- **M3 · First real promotion.** If the champion beats baselines, promote it through
  `POST /api/ml/{model}/promote` so `ops_artifact.promotion_log` receives its FIRST row,
  approved under `R-OPS-ML-APPROVER`. If it does not beat them, the accuracy tile says
  so — that is a feature of the story, not a failure.

### Batch 4 — The decision spine + the page (chunks D1–D4) — the A→B move
- **D1 · Plan store** (init **41**, `nhdw_ops`, `\connect nhdw_ops`): `ops_plan.plan`
  (id, created_at, period, scope, basis jsonb: model run_id + assumptions + mart
  snapshot refs) and `ops_plan.plan_line_decision` (plan_id, line_ref, decision ∈
  {approved, rejected, modified}, decided_by kc_sub, decided_at, note) — cloned from the
  MDM decision-log shape (append-only; a revert is a new row). Grants to `ops_gateway`;
  **grant the sequences too** (the 2026-09-21 detector lesson); cold-boot test asserts it.
- **D2 · Decide endpoints** (`routes/ct.py`, cloned from `mdm.py`'s decide/revert):
  `POST /api/ct/plan/{plan_id}/lines/{line_ref}/decide` + revert; audit rows via the
  house audit helper; role-gated to R-DEC (+R-SUPER); OPA untouched (subject PRG,
  verb write on this route only). Partner/analyst roles get 403 — demo checklist item.
- **D3 · Return to the warehouse:** FDW read seam for `ops_plan` (same shape as 36/40 —
  Bini reviews the seam like the DQ one) + `mart_pct_plan_decisions` so approved plans
  are queryable warehouse facts. This closes the August loop: operational systems →
  NHDW → PCT → planner → approved plan → NHDW. Plan-vs-actual becomes a one-mart
  follow-up AFTER a decided plan exists (recorded, not built now).
- **D4 · The PCT page.** Catalog reorder (Overview 10, control-tower → **15**), page
  retitled "PCT — Supply Chain Control Tower"; sections: KPI strip with the 90% GF
  target line (K1) · Zambia map (K2) · forecast band chart (history + P10/P50/P90 +
  accuracy tile + run id, M2) · position/replenishment table with the `why` (K4 basis
  fields rendered — inputs, assumptions, model version; the "how this was sized"
  stepper) · **decide buttons on recommendation lines (D2)** · dispatch panel
  (best-effort: haversine savings-heuristic over district hubs filling the
  `mart_ct_vehicle_runs` SHAPE with Zambia rows + `mart_ct_plan_stats` savings vs
  one-truck-per-facility, clearly labeled inferred — the first REAL solver in the
  product; degrades to omission if time runs out). New widgets register in
  `fetchers.py`; catalog yamls updated; `gen-exposures.py` + `sync-om-dashboards.py`
  rerun; admin/bi images rebuilt (**second and last ROOT import**, unless CI-merge
  handles it first). Gate: Playwright walk as R-DEC — approve one line, reject one,
  audit rows shown; 403 for a partner role; every widget on real mart data.

### The exit checklist (Batch 4 gate = the demo checklist, all 13 items)
Totals reconcile · KPI tiles ≡ independent SQL · MLflow run id ≡ mart · 3 recommendations
recomputed by hand · approve/reject with audit rows · partner 403 · inferred/assumed
labeled on screen · full rerun reproduces the marts · verify-system ALL GREEN ·
forbidden-branding grep clean · OM lineage shows the new page · demo "today" = Aug 2018
everywhere · cold-boot test green with init 41.

---

## PART 3 — Interfaces you must honor (so it merges under Bini cleanly)

- **Bini's territory (read-only):** conformance spine, `ops_governance.mdm_*` +
  releases, OPA/masking/opa.py, `check-dbt-sql.py` (his tool now carries our seed-schema
  fix), init 34/35/36/38/39. The MDM view↔hub 2-key gap (selihom/vitality pharmacy) is
  HIS open item — do not "fix" it in passing.
- **Our own prior lanes are conventions to follow, not files to rework:** DQ plane
  (routes/dq.py — D2's endpoints go in ct.py, not dq.py), governance marts, OM emission
  standard, seaweedfs-gate (PR may still be unmerged — rebase discipline).
- **Init 41 is the only new init this phase.** Announce it to Bini at branch time.
- **`reporting_deadlines` seed is shared** (his timeliness anchor moved onto it) —
  additive rows only.
- **The eLMIS lane is internal-only** (excluded from the public scorecard by his
  2026-09-21 decision) — no PCT mart may leak into `bi_public` or the Open Data page.
- **QAT boundary (D8, standing):** facility×product grain ONLY. Anything national-grain
  is QAT's lane and out of scope until the two owner questions resolve.
- **Data-use:** Mesay's MDM release bundle is restricted ("authorized local workspace
  only") — never surfaces in the demo UI or leaves the lake bucket.

## PART 4 — Grounding (read-only) and delivery

**Ground every assumption live before building on it** (the reconnaissance for the gap
assessment repeatedly found code and data disagreeing):
- Postgres: `kubectl -n nhdw exec postgres-vault-0 -- env PGPASSWORD=$(kubectl -n nhdw
  get secret postgres-vault-secrets -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)
  psql -U vault_admin -d nhdw_vault` (marts/vault/nhdw_ref) · `-d nhdw_ops` (ops_*).
- ClickHouse staging, lake via `bundle/bin/mc` (admin identity `nhdw_root` in
  `seaweedfs-secrets` — NOT the minio-secrets creds), MLflow via port-forward :5000,
  OM API via port-forward :8585 with the ingestion-bot token.
- Live host base `20.84.70.78.nip.io`; keycloak master admin is `keycloak_admin`
  (KC_BOOTSTRAP_ADMIN_PASSWORD) — 2026-09-20 lessons, in the journal.
- Demo identities: `~/nhdw-notes/reference/services-and-access.md` (mode 600 — never
  into repo or chat).

**Delivery loop (per batch):** branch `feat/pct-final` off fresh `origin/develop` →
chunk → live test → evidence to `~/nhdw-backups/pct-final-evidence/<chunk>/` → Abenezer
checks → **push on his word** → PR → Bini merges to `develop` → CI deploys → post-merge
gates re-run on the merged cluster. Decision records for this phase: a
`docs/decisions/…-pct-product-phase.md` in the repo (D1–D4 architecture calls, the
labeled-adaptation rule, the AMC→forecast basis flip) written as the chunks land, in the
house decision-record style. Session end: journal + plan tick + STATUS, always.
