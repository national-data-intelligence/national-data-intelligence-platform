# NHDW Data-Layer Enhancement — Plan

**Goal: a production-grade data layer that follows industry best practices.** The architecture is decided on
best-practice grounds, **not** on what today's synthetic Ethiopian data happens to contain — that data is a
**test case** we validate against and use to find gaps. Each component lists the gaps the live system revealed as
**"corrections to make,"** and frames every change as **modify / replace / remove / add** against the existing BI
and Admin dashboards.

## Progress (2026-09-21)

| Component | State |
|---|---|
| 1 · nhdw_ref vocabulary | **LIVE + WHO layer.** 163 concepts / 187 crosswalk rows; programme + commodity resolution join it (parity-proven byte-identical). ICD-10 (8) and ATC (27) now published as 36 `Maps to` edges — `concept_relationship` only, with a test that FAILS if an external code ever reaches `source_to_concept_map` (that would re-key conformance) |
| 2 · in-house MDM | **LIVE end to end, round trip PROVEN.** Matcher (facility 991 candidates live; commodity probabilistic-vs-vocabulary) → steward console → append-only bitemporal decision log → FDW seam → resolution override (facility + commodity) → `master_entity_uid`/`mdm_state` in dim and marts. Golden record `sat_facility_canonical` (3295) + `lnk_facility_identifier` (5762 ids / 5 namespaces) live. Accept re-keyed exactly ONE record of a 3-record hash-collision cluster; revert restored the pre-MDM checksum byte-for-byte with history retained. **Releases** pin the decision cut AND the source watermark; reproduction is `SET nhdw.release_as_of` — a query, not a deployment. Person/patient is BLOCKED on the sources (see Data gaps), deliberately not built |
| 3 · column masking | **LIVE + enforced.** Classification store + per-role reveal sets in OPA + masking on every read path (marts, widgets, CT feed, exports, reports, ad-hoc SQL with alias-evasion refusal); gateway refuses to boot on policy drift. Governance console with a fail-open detector that scans live mart columns for sensitive names carrying no classification |
| 4 · DQ detector | Track B batch 2 **MERGED** (PR #4): threshold store, incident record + append-only events, detector endpoint, daily DAG, governance KPIs. Live and already raising 7 true incidents — including `mdm_backlog`, the quality plane reading the MDM queue |
| 5 · OpenMetadata | Track B batch 1 **MERGED** (PR #3). Not yet deployed on the shared cluster (CI does not apply manifests — it arrives at the next provision); `superadmin` still live-only and must move into `users.yaml` |
| 6 · Lineage | Track B batch 1 **MERGED**: ingestor emitters (sidecars untouched, env-gated), dbt exposures, catalog.json upload |

**Cold boot (from bare, `provision.yml` → ansible `site.yml`)** — exercised for the first time on
2026-09-21. It had never been run end to end, and surfaced six defects IN THE PROVISIONING PATH
(none in the platform): missing ansible collections, `ansible-galaxy` off PATH, a Docker apt
`Signed-By` conflict, that repair ordered after the first apt call, `nhdw_helm` pointing at a
gitignored `bundle/bin/helm`, and fixed `/tmp` build-log names colliding between users on the
shared host. All fixed at the source; details in `docs/k8s-deployment-changelog.md`. Three of the
six are one pattern — a gitignored DERIVED artifact assumed present, which works only on the
machine where someone once created it by hand.

CI grew alongside and is now the quality gate it should have been: a hosted test suite on every
branch push (opa policy, MDM matcher, loader provenance, vocabulary parity, gateway import, masking
contract, admin-ui type build), `check-dbt-sql.py` planning 107 dbt models against the live
warehouse before a deploy runs them, and failure honesty throughout — a failed seed, rollout, policy
regen or pipeline job now fails the run instead of scrolling past, and a failed job is reported the
moment it fails rather than after a 40-minute timeout.

## The pipeline, and where each new piece attaches

```
                  ┌────────────── OpenMetadata (5) — catalog · glossary · column lineage · DQ results · classification ─────────────┐
                  └────▲───────────────▲───────────────────▲──────────────────────────────────────────▲─────────────────────────────┘
                       │ dbt artifacts  │ lineage events (6): dlt source→lake, Airflow, dbt exposures  │ classification → ops_perm (one-way)
 SOURCES ─▶ dlt ─▶ LAKE (raw/proc/arch) ─▶ ClickHouse ─▶ RAW VAULT ─▶ BUSINESS VAULT ─▶ bi_* MARTS ─▶ gateway ─▶ dashboards
                       │                                      │      (conformance layer:  │ +master_entity_uid,   │ (3) MASKING: OPA emits
                       │                                      │       MDM-driven — see 2) │  snapshot_uid,        │  masked_columns → gateway
   ┌───────────────────▼───── MDM SIDE LANE (2), async ────┐  │                           │  mdm_state columns    │  masks EVERY read path
   │ matcher (Splink; nhdw_ref-normalised) → candidates →  │  │  the vault build READS    │                       │
   │ steward console (Admin) → DECISION LOG ───────────────┼──┘  the decision log; the    │                       │
   │ publisher → versioned master-release ARCHIVE (lake)   │     release is the archive/  │                       │
   └───────────────────────────────────────────────────────┘     audit copy + the socket  │                       │
                                     (1) nhdw_ref (OMOP vocabulary: entity-model + ICD-10/ATC/…) feeds the         │
                                         resolution views AND the MDM matcher                                      │
                                     (4) DQ DETECTOR extends the existing Admin DQ page → dq_flag incidents ───────┘
```

Three groups: **conformance** (1 reference vocabulary, 2 MDM), **governance** (3 masking, 4 DQ & observability),
**metadata** (5 OpenMetadata, 6 lineage emission).

## How the pieces work together — one facility, end to end

A hospital appears in HCMIS and mBrana. (1) The vault resolution translates each source's codes to canonical
concepts via `nhdw_ref`. (2) The **MDM matcher** proposes the two records are the same hospital; a **steward**
accepts it in the Admin console, writing one row to the append-only **decision log**. On the next vault build the
resolution **reads that decision**, the two source hubs join one conformed (master) entity carrying a stable
`master_entity_uid`, and survivorship picks the golden attributes into the canonical satellite; the **publisher**
separately archives the resulting master state as a versioned, `snapshot_uid`-pinned release in the lake (the
audit copy and the socket for any future external producer). Facility marts now show `master_entity_uid` +
`mdm_state='conformed'`. (3) When an analyst opens a facility widget, OPA masks the hospital's GPS/phone unless
their role+purpose grants it — identically on widgets, the mart API, exports, reports, the SQL editor and the
chatbot. (4) Overnight the **DQ detector** raises incidents for unmatched records, failed tests, anomalies.
(5/6) **OpenMetadata** shows the whole chain — source → lake → master entity → mart → dashboard widget — with
column-level lineage, the golden-record definition, owner, and PII tags. Human decisions are durable data, so a
rebuild reproduces everything.

---

## Placement facts (verified against the live system)
- `ops_perm` and `ops_governance` are in the **`nhdw_ops`** database (the gateway's ops DB), not `nhdw_vault`; new
  ops DDL must `\connect nhdw_ops` and grant `ops_gateway`.
- Init files: `column_classification` goes in the **existing `17_perm_schemas.sql`** (the step-18 loader seeds it —
  a later file breaks the load); new files `34_ref_vocab.sql`, `35_mdm.sql`, `36_governance.sql`,
  `37_openmetadata_db.sh`. Init runs only on fresh PGDATA — the live cluster needs a one-time apply for new tables
  (and `alert_routing` from init 29 is currently absent there); the seed files guarantee cold-boot reproducibility.
- Security seeds live in `bundle/seed-pack/app/security/`. Object store is **SeaweedFS**
  (`seaweedfs-s3.nhdw.svc.cluster.local:8333`) — fix remaining stale `minio-datalake` references when touched.

---

## 1. Reference-data vocabulary & terminology — `nhdw_ref` (OMOP-style, extensible)

**What it is.** A governed **vocabulary + terminology service**: an OMOP-style model holding canonical concepts
and the crosswalks from every source's native codes to them, growing to ingest standard code systems — **ICD-10 +
ATC first** (with the internal source→concept crosswalks), LOINC/SNOMED/ICD-11 as domains need them. It is the
single, steward-editable, versioned source of truth for "what does this code mean," replacing today's
code-embedded regex/dicts. (External vocabularies ship as the curated subset NHDW references — ICD-10/ATC are
WHO-licensed for this kind of use; never bundle the multi-GB full distributions.)

**Integration — two distinct points, don't conflate them:**
1. **Seed-generation time:** `build_vocab.py` becomes the single source of the code mappings; `build_sample.py`'s
   embedded dicts (`TIER_MFR_TYPES`, `REGION_NAME_TO_ID`, `MFR_OWNERSHIP_NORMALISED`) are lifted into it and
   `build_sample.py` reads the generated vocab — one source of truth for what gets baked into the seeded ids.
2. **Vault-resolution time:** the `v_*_resolution` views JOIN `nhdw_ref.source_to_concept_map` to resolve
   canonical concepts at build time — this is where governance takes effect without a reseed.

**Tables (`34_ref_vocab.sql`, schema `nhdw_ref` in the vault DB, seeded before the vault build).** The curated
OMOP metamodel: `concept`, `concept_relationship`, `source_to_concept_map`, plus `vocabulary`, `domain`,
`concept_class` — all bitemporal (`valid_from/valid_to/invalid_reason`). Adding a new standard vocabulary is
**rows + a loader** (`bundle/seeds/ref-vocab/`), never a code change.

**Inputs.** `entity-model.yaml`; the lifted dicts; ICD-10/ATC curated subsets; steward edits.
**Outputs.** The canonical concept for any source code; the vocabulary tables.
**Connections.** Feeds the vault resolution views and the **MDM matcher** (normalisation + blocking); surfaces as
the OpenMetadata business glossary.

**Modify / Replace / Remove / Add.** *Add* the schema + loaders. *Replace* the code-embedded mappings with
governed `source_to_concept_map` joins — **progressively and parity-first**: each vocabulary migrates only after
proving byte-identical `conformed_bk`/`hk_*_conformed` on the current data (the DHIS2 programme crosswalk is
already proven byte-identical, 71 rows, 0 mismatches). No dashboard change; the vocabulary is exposed inside
OpenMetadata.

**Corrections to make (from the test data).** Today's conformance is largely a pre-baked `FAC-…` slug + regex —
i.e. most mappings live at seed-generation, not resolution. Both integration points above bring them under
governance; the pass-through vocabularies (facility ids, geography codes, indicators) migrate last, each
parity-first, so nothing re-keys silently.

---

## 2. In-house MDM — replaces the weak conformance *logic*, keeps and enriches the vault *structures*

**What it is.** A production-grade master-data subsystem: match → survivorship → human stewardship → golden
records with stable ids, full bitemporal history and field-level provenance, and a published master release.
Industry-standard shape for an in-house build: a real entity-resolution engine plus a stewardship workflow and a
durable decision store, realised on Data Vault 2.0's native constructs.

**What is replaced vs kept (the settled architecture — read this first).**
- **Replaced:** the *population logic* of the business-vault conformance layer — today a single weak line
  (`v_*_resolution`'s `COALESCE(facility_id, norm_name)`) with no fuzzy matching, no review, no survivorship, no
  stable id, no history, and a real double-counting bug. That logic becomes the MDM engine's output.
- **Kept and enriched:** the conformance *structures*, because they are already the correct DV2.0 MDM constructs:
  `hub_*_conformed` **is** the master-entity hub (it gains a minted, stable `master_entity_uid`), `lnk_same_as_*`
  **is** the source→master association (its `source_system`-in-the-key stays — it disambiguates the confirmed
  891 facility / 34 commodity hash collisions), `dim_*` remain the golden dims.
- **Never touched:** the raw vault — every per-source hub, link and satellite is the immutable foundation.
- **Net-new objects:** an **identifier link** (`identifier_namespace, identifier_value → master`, e.g.
  `hcmis.institution.slug`, `mbrana.facility.id`, later national/Fayda ids); a **canonical-revision (golden)
  satellite** (survivorship-chosen attributes, `valid_from/valid_to`, `recorded_from/recorded_to`, `snapshot_uid`,
  per-field provenance); the candidate + decision stores; the publisher.

**The engine (side lane, `2_pipelines/mdm/`, asynchronous — never blocks the pipeline).**
- **Matcher** — **Splink** (probabilistic, explainable, scales, runs on the existing Postgres/Spark-free stack) as
  the engine; today's deterministic rules (shared `FAC-…` slug; exact codes) migrate in as its level-0 rules.
  Blocking via `nhdw_ref`-normalised codes + geography; geo tie-break with source coordinates. Output: candidate
  pairs with scores and the rule/model that fired → `ops_governance.mdm_match_candidate` (`35_mdm.sql`).
- **Conservative auto-accept (a wrong merge is worse than a missed one):** only exact-key/exact-unambiguous-name
  matches auto-accept; everything probabilistic goes to a steward; merges are reversible via the decision log.
- **Steward console** — accept / reject / merge in the Admin app (below).
- **Decision log** — `ops_governance.mdm_match_decision`: append-only, bitemporal. **The reproducibility
  contract:** the vault build reads it; a rebuild from sources + decisions reproduces identical masters.
- **Survivorship** — declarative source-priority + recency rules per attribute, producing the canonical satellite.
- **Publisher** — archives each master state as a **versioned, `snapshot_uid`-pinned release** in the lake
  (release log, identifier namespaces, bitemporal fields — contract informed by the teammate's release bundle).
  The release is the **audit/interchange copy and the pluggable socket** for a future external producer; **the
  authoritative application of identity happens in the vault build from the decision log**, so warehouse identity
  never depends on a post-vault artifact.

**Dependencies on the current conformance — preserved via parity-first (nothing silently lost):**
the spine link `lnk_facility_indicator_period` (keyed on `hk_facility_conformed`) and **every cross-source mart**
that joins it; `dim_facility` (+ its `n_source_systems`, which becomes `mdm_state`); `/api/dq/reconciliation`
(joins the same-as links and folds `source_system`); the same-as collision guard; every `bi_*` mart joining the
conformed hubs/dims. **Parity contract:** with an empty decision log the engine must reproduce today's conformed
keys **byte-identically**; only stewarded decisions then change conformance — deliberately, reviewably,
reversibly.

**Integration place.** Matcher/publisher under `2_pipelines/mdm/`; candidate + decision tables in `nhdw_ops`
(`35_mdm.sql`); the resolution views + new vault objects under `2_pipelines/vault/models/business_vault/`;
console in the Admin app; releases in the lake.

**Inputs.** Raw-vault hubs/sats (+ processed lake for match attributes), `nhdw_ref`, steward decisions.
**Outputs.** Golden masters + associations + identifier links + canonical history; `master_entity_uid`,
`snapshot_uid`, `mdm_state ∈ {conformed, single_source}` on the marts; the release archive.
**Connections.** Normalises via `nhdw_ref` (1); `master_entity_uid` is classified `tokenize` (3); its match
backlog is a DQ metric (4); masters + releases appear in the OM catalog/lineage (5/6).

**Modify / Replace / Remove / Add.**
- **Add** the engine (matcher, console, decision log, survivorship, publisher) + the identifier link + canonical
  satellite.
- **Add** Admin page `admin/mdm-review` + widget `adm-mdm-review` + gateway `routes/mdm.py`, modelled on the
  existing project-graduation review (`routes/graduation.py` + `Review.tsx`: same reviewer-role gate,
  transactional writes, `log_data_event` audit).
- **Grant R-STEW** the admin dashboard + this widget + `view_ops_console` — R-STEW holds **zero** admin grants
  today; this gives stewards their surface.
- **Replace** the `v_*_resolution` population logic with the MDM-driven conformance (deterministic rules migrate
  into the matcher; decisions override/extend; parity-first). Structures keep their shape and gain
  `master_entity_uid`.
- **Modify** BI facility/commodity widgets to surface `master_entity_uid`/`mdm_state` provenance
  (`rm-facilities`, `ov-benchmarks`, `ov-trust-*`, `ct-*`, the `rm-*` supply family) via `fetchers.py`.
- **Remove** the `bi_mdm` mock mart (throwaway; zero live UI references).

**Corrections to make (from the test data).** The mBrana bug: all 891 mBrana facilities are stranded
`single_source` although **883 are exact-name twins** of FAC facilities (same hospitals, double-counted) — the
matcher's exact-name pass fixes it as stewarded/auto-accepted decisions, not a silent view edit. Real fuzzy
false-positives exist (two different "Nejashi … Hospital" at 0.89) — hence the conservative auto-accept.
`pg_trgm`/`fuzzystrmatch` are already installed; mBrana has lat/lng on 891/891 for the geo tie-break.
**Scope this phase: facility + commodity; person/patient (Fayda-linkable) is the next phase** — the model
generalises to it.

---

## 3. Column-level data masking (full, all read paths)

**What it is.** Production-grade field-level protection — hiding or transforming sensitive column values by role
and purpose, with real primitives (drop / hash / partial / generalize / tokenize) and room for purpose-based
access to grow. The gateway seam exists but is **inert** (no policy emits `masked_columns`); this makes it real
and complete.

**Add.** `ops_perm.column_classification` (in **`17_perm_schemas.sql`**, DB `nhdw_ops`, keyed on the real dbt
`schema.table.column`; `managed_by` distinguishes `seed`/`steward`/`openmetadata` rows) + seed
`bundle/seed-pack/app/security/column_classification.yaml` + loader entry; `common.rego` emits `masked_columns` +
a per-column `column_mask` map from a `column_access:` block in `bundle/roles/*.yaml` via `compile.py` (byte-
stable for roles without the block; R-SUPER reveals all); `app/opa.py` carries the real column list into the OPA
input; new `app/masking.py` (unknown mask_class ⇒ drop = fail-closed; `tokenize` = deterministic HMAC pseudonym
so intra-response joins survive — the mask class for `master_entity_uid` and any key-like column).

**Modify / Replace / Remove / Add.**
- **Modify every read path:** **`routes/ct.py` first** (it returns real facility GPS today — the one live leak),
  then `routes/marts.py` and `permissions.py::widget_data` (both currently log-only), and the three that bypass
  masking entirely — `routes/sql_lab.py`, `routes/queries.py`, `routes/chat.py` (the chatbot `run_sql`). Upgrade
  `exports.py`/`reports.py` from drop-only to the full transforms.
- **Widget path nuance (resolved, not hand-waved):** fetcher SQL aggregates/aliases physical columns, so
  physical-name matching alone is a no-op there. Each `Fetcher` gains an optional **output-classification map**
  (which output columns carry a classified physical column); paths returning physical columns (`ct.py`,
  `fetch_mart`) mask by name directly. In `sql_lab`, masking matches output names best-effort and **refuses
  `SELECT *`** on marts carrying restricted columns (alias-laundering is otherwise possible).
- **Modify what BI shows:** Control-Tower coordinates and facility contact/GPS return masked for unprivileged
  roles — identically across widget, mart API, export, report, SQL editor, chatbot.
- **Add (optional):** a read-only classification/masking-coverage panel on the existing DQ page; no new page —
  OpenMetadata authors the tags (5).

**Corrections to make (from the test data).** Classify now: `bi_supply.mart_ct_nodes.lat/lng/name` (real
coordinates, leaking today), `bi_facility.mart_facility_capacity.latitude/longitude/telecom`,
`bi_staging.bi_demo_patient_observations.patient_id/observation`. Do **not** mask dimension/join columns
(`region_name`, `woreda_name`, `programme_name`, …) — that breaks every dashboard. A brand-new sensitive column
is visible until classified — mitigated by OM's PII auto-tagging sync (5) plus a DQ check (4) flagging
PII-pattern columns lacking classification.

---

## 4. Data-quality detector & observability (full)

**What it is.** An automated detector that raises tracked incidents (failed dbt tests, orphans/unmatched masters,
statistical anomalies, timeliness breaches), a central threshold/SLA config, and wired (default-off) alerting —
completing the existing scorecard, which measures but never auto-raises.

**Integration — extend, don't add a page.** The Admin DQ page already has the 5-dimension scorecard, per-source
health, cross-source reconciliation, a lineage summary, and a dbt-test Acknowledge flow writing
`ops_governance.dq_flag`. The detector extends this and reuses `dq_flag`.

**Add.** `POST /api/dq/detect` (`routes/dq.py`, service-token, pattern: `alert_evaluation.py`) + DAG
`dq_detection.py`; `ops_governance.dq_threshold` (`36_governance.sql`, `nhdw_ops`) as the single home for the
SLA/band values scattered across gateway/dbt/widget; a `fingerprint` column + partial-unique index on `dq_flag`
(idempotent re-runs; a resolved flag can re-open); **timeliness** in `mart_data_quality` from a
`reporting_deadlines` seed; distributional anomaly checks (simple range checks stay with dbt — don't duplicate
the ~750 tests, auto-raise from their failures instead); the unclassified-PII-column check (3).

**Modify / Replace / Remove / Add.**
- **Extend `adm-dq`** with a generalized incident queue over `dq_flag` (the dbt-test-ack panel becomes its
  `dbt_test` subset — one surface, not two).
- **Replace** hardcoded threshold bands in `routes/dq.py` + `fetchers.py` with reads from `dq_threshold`.
- Alerts route through the existing `adm-alerts-routing` / `alert_routing`.

**Corrections to make (from the test data).** SMTP is **live and points at the operator's personal Gmail** —
`DQ_EMAIL_ENABLED=false` (default) gates every `mailer.send`; the in-app incident queue is the source of truth;
`alert_routing` (absent on the live cluster) lands on the next reseed. First real detections on the test data:
auto-raise from dbt-test failures + the MDM stewardship backlog (2,403 unmatched facilities). **Timeliness is a
built capability**; the current synthetic data is bulk-loaded (single `load_ts` instant, no per-report arrival
signal) — a test-data limitation fixed by **enhancing the synthesizers to stamp realistic report-arrival
timestamps**, so the capability is exercised end-to-end; real operational feeds carry arrival times natively.

---

## 5. OpenMetadata — catalog, glossary, column lineage (out of the enforcement path)

**What it is.** The metadata platform: searchable catalog, business glossary, end-to-end column-level lineage, DQ
results, PII/classification tags — the map of the whole estate.

**Deployment.** `1_infrastructure/k8s/base/openmetadata.yaml` + a single-node `opensearch.yaml` (+ Helm parity,
`values.openmetadata.enabled`), **reusing `postgres-vault`** (PG 16 supported) via `37_openmetadata_db.sh` (DB
`nhdw_openmetadata` — clone the `31_superset_db.sh` pattern); an OM `db-migrate` initContainer; a native-OIDC
`openmetadata` client in `setup-keycloak.py` `TOOL_CLIENTS`, realm **`moh-staff`** (R-STEW's realm; no
tool-gate); ingress `openmetadata.<hostBase>` (wildcard TLS covers it); pinned images in `cache-images.sh`
(~5 GiB bundle growth); connectors (dbt-from-lake / Postgres / ClickHouse / S3 / Airflow) as an Airflow
**KubernetesPodOperator** DAG + a file-declared `seed-openmetadata.sh` bootstrap step.

**Inputs.** dbt artifacts from the lake (model + **column** lineage + tests), the Postgres vault+marts and
ClickHouse staging schemas, the S3 lake datasets, the Airflow DAGs, lineage events (6), steward glossary +
classification.
**Outputs.** The catalog/glossary/lineage UI; classification tags exported **one-way to `ops_perm`**.
**Connections.** Feeds `column_classification` (3); glossary from `nhdw_ref` (1); sink for lineage emission (6).

**Modify / Replace / Remove / Add.**
- **Add** the OpenMetadata tile to `adm-documentation` `TOOLS[]`.
- **Replace/supersede** the dbt-Docs tiles (Documentation + DQ quick-links) → repoint to OpenMetadata; retire the
  dbt-docs deployment (archive per repo rule) once OM's dbt connector is proven.
- **Keep** `/api/dq/lineage` + the in-app lineage summary as the always-on, in-path fallback (survives OM down);
  repoint only the "full interactive lineage" link.
- **Keep** the DQ scorecard/reconciliation (marts-served). **OM never enters the enforcement path:** the
  classification sync writes `ops_perm.column_classification` rows (`managed_by='openmetadata'`, never
  overwriting `seed`/`steward`) **and regenerates the seed YAML for commit**, so a cold boot reproduces it and
  OPA reads only the committed seed.

**Corrections to make (from the test data).** The single-node resource fear was unfounded — 108 GiB RAM,
~86 GiB free, requests at 3–6 %, `vm.max_map_count` already set: OM+OpenSearch (~4–5 GiB standing) is
on-by-default here, opt-in only for smaller fleet hosts. The dbt artifacts are already in the lake; the dbt jobs
must additionally upload `catalog.json` (listed but not produced today) so OM gets column types.

---

## 6. Lineage emission + dbt exposures (feeds OpenMetadata)

**What it is.** Emitting the lineage OM cannot derive from artifacts alone, in an OpenLineage-compatible shape:
each run records "read X → produced Y."

**Design decision — no message broker.** OM's OpenLineage connector requires Kafka; standing up a broker on this
cluster **only to move lineage events** is unjustified. Instead emit **directly to OpenMetadata's lineage API**:
dlt ingestors get a thin `lineage.py` client (fail-safe no-op when the OM endpoint env is unset), and Airflow
uses **OM's native Airflow lineage backend** (provider available). The OpenLineage-standard event stream over
Kafka remains a documented option if an event bus ever exists for other reasons.

**Add.**
- **dlt source→lake edge:** `2_pipelines/ingestor/*/src/lineage.py` **beside** `manifest.py` — the sidecars are
  load-bearing (pipeline change-gate, `/api/dq/ingestion` freshness) and are never altered; emission is strictly
  additive and best-effort.
- **dbt DAG lineage:** via **OM's dbt connector** from the lake artifacts (column lineage included) — **do not
  deploy `dbt-ol`** (redundant + dbt-version risk). Fix the missing `catalog.json` upload in the dbt
  `entrypoint.py`.
- **marts → dashboard-widget hop:** `bundle/scripts/gen-exposures.py` reads `fetchers.py` (the authoritative
  widget→mart map) → `2_pipelines/marts/models/_exposures.yml` → OM renders the last hop.
- **Airflow:** OM lineage backend, config-only.

**Modify / Replace / Remove / Add.** Backend only (reinforces 5's supersession of dbt-Docs). Rebuild the ingestor
images (+ `openlineage`/OM client dep) and the marts image (for `_exposures.yml`); re-bundle.

---

## Verification (how "done" is proven, per component)
- **nhdw_ref:** parity harness — recompute `conformed_bk`/`hk_*_conformed` before/after each vocabulary
  migration; assert byte-identical, no new hub rows, `/api/dq/reconciliation` unchanged.
- **MDM:** empty-decision-log parity (identical keys); accept a candidate → rebuild → same-as link +
  `mdm_state='conformed'` appear; **rerun reproduces identical masters**; a rejected/reversed merge un-merges;
  the mBrana twins collapse only via recorded decisions.
- **Masking (negative path):** as a non-reveal role, read a restricted column via widget, mart API, export,
  report, **SQL editor and chatbot** — value absent/transformed everywhere; R-SUPER sees cleartext; `opa test` +
  the compile byte-stability check + the gateway startup self-tests pass.
- **DQ:** inject a breach → `POST /api/dq/detect` raises a deduped `dq_flag`, visible in the incident queue,
  **zero emails** with the default flag; unauthorized detect 403s.
- **OpenMetadata/lineage:** catalog + column lineage render end-to-end incl. the exposure hop; classification
  round-trips OM → `ops_perm` → masking; **OPA still enforces with OM scaled to zero**.
- **Cold boot:** teardown → bootstrap reproduces every schema/seed/grant/image; Playwright walk of the touched
  BI/Admin pages (incl. the stewardship console as R-STEW).

## Reproducibility (applies to every component)
Every change lives in seeds / manifests / images — never only on the live cluster; human decisions (steward
matches, classifications) are durable data the build reads; every touched image is rebuilt and re-bundled.

## Removal / consolidation (archive superseded — don't leave two)
`bi_mdm` mock mart → remove. dbt-Docs → superseded by OpenMetadata (tiles repointed, deployment archived once
proven). Scattered DQ thresholds → `dq_threshold`. One `dq_flag` incident surface. The `v_*_resolution` weak-join
logic → superseded by the MDM engine (parity-first).

## Design decisions baked into this plan
- **MDM ↔ vault:** replace the conformance *logic*, keep + enrich the *structures* (`hub_*_conformed` =
  master hub + `master_entity_uid`; `lnk_same_as_*` = source association; raw vault untouched); identity is
  applied in the vault build from the decision log; the published release is the archive/socket, never the
  authoritative path.
- **Matcher engine:** Splink (deterministic rules as level-0; conservative auto-accept; steward reviews the
  probabilistic middle; merges reversible).
- **MDM entities:** facility + commodity now; person/patient (Fayda-linkable) next — the model generalises.
- **Vocabularies:** ICD-10 + ATC + internal crosswalks first; LOINC/SNOMED/ICD-11 as domains need them.
- **Classification authority:** OpenMetadata authors; `ops_perm` (committed seed) is what OPA enforces — OM never
  in the enforcement path.
- **Lineage transport:** direct OM lineage-API emission; no Kafka for lineage alone.
- **Timeliness:** built as a real capability; synthesizers enhanced to stamp realistic arrival timestamps so it is
  exercised on the test data.

## Beyond this plan (next hardening steps, recorded so they aren't lost)
Person/patient MDM (Fayda-linked master person). PIT/bridge tables in the business vault (DV2.0 query-performance
standard once satellites deepen). Data contracts at the dlt ingest boundary (schema+SLA as code). Multi-valued
purpose-of-use (full PBAC) on the masking seam.

## Data gaps found while building (test-case findings — things to CORRECT, not scope cuts)
- **MFR Location sat is empty live** (`v_sat_mfr_facility_current` = 0 rows; all MFR facility identity arrives as
  Organization, which per FHIR carries no `position`). Consequence: the FAC side has NO coordinates, so the
  matcher's `distance_km` tie-break is NULL on the live corpus (works in tests; mBrana-side GPS is fully
  populated, 891/891). Correct at the source: regenerate the MFR replica with Location resources carrying
  `position.latitude/longitude` for each facility.
- **Entity-model programme mislabels** (recorded earlier): "IDSR timeliness"/"Reporting completeness" carry
  `programme: HIV` in entity-model.yaml; AEFI/CC rows richer than the deployed CASE mapped. Pinned to OTHER by
  parity supplements for now — fix as stewarded vocabulary changes after the MDM console ships.
- **Person/patient mastering is BLOCKED on the sources, not on the code** (investigated 2026-09-21,
  and deliberately NOT built). Three facts decide it: only ONE source carries persons
  (`hub_ethioemr_patient`, 1500 rows) — MDM exists to reconcile an entity across DIFFERENT sources,
  so with one source a "person master" would just be a renamed copy of that hub; the only attributes
  that survive into the warehouse are `gender` and `birth_date` (1484 distinct pairs across 1500
  patients), which is far too little entropy to match on and would manufacture false merges out of
  birthday coincidences; and the PII that would make demographic matching work is stripped at the
  lake **by design** (verify-system asserts it), which is correct and must not be undone to enable
  matching.
  **The correction, when a second person-bearing source exists:** match on a PSEUDONYMOUS LINKAGE
  TOKEN, not on demographics — each source computes a keyed HMAC of the national identifier (Fayda
  FAN) before the record leaves it, the warehouse only ever sees `person_token`, and person matching
  is exact-on-token (deterministic, no probabilistic demographic pass at all). No PII enters the
  warehouse, linkage still works, and the token is useless outside this deployment. The decision
  tier already generalises (candidates and decisions are keyed by `entity_class_code`), so the work
  is source-side: emit the token, and add a person hub/token link. Prerequisites: (1) a second
  source carrying persons, (2) an owner decision that a keyed pseudonym may flow into the warehouse.
- **DHIS2 org-unit sat has no coordinates** and HCMIS facility sat carries only name/description — a second
  coordinate authority (or admin-area column) on the FAC side would make ambiguity resolution stronger. mBrana's
  `woreda`/`zone`/`town` ride in `match_features` as today's tie-break.
