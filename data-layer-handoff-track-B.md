# NHDW Data-Layer Enhancement — Hand-off briefing (TRACK B)

You are building **one half** of a data-layer enhancement, in parallel with another team. Your half is the
**metadata + observability plane**. An integrator pulls your branch, merges it with the other half, tests it, and
pushes the merged result to the `develop` branch. **Read Part 0 fully before writing any code** — it is the
whole-system context that keeps your work from being myopic (breaking a contract you couldn't see from your own
files). Then Part 1 (the full plan, so you see the whole), Part 2 (your assignment), Part 3 (the interfaces you
must honor), Part 4 (grounding + delivery).

---

## PART 0 — How this system works, and how to work in it (do not skip)

### What NHDW is
A packageable demo of Ethiopia's National Health Data Warehouse: one bundle + one bootstrap brings the whole
system up on Kubernetes and seeds it. The pipeline is:

**sources → dlt ingestors → SeaweedFS object lake (raw / processed / archive zones) → ClickHouse staging
(ephemeral) → Postgres raw vault → Postgres business vault → `bi_*` marts → FastAPI gateway → 5 SPA dashboards
(internal-bi, public, admin, workshop, dbt-docs) + operator tools (Airflow, Superset, MLflow, JupyterHub) + a GPU
LLM assistant.** Access is a **two-plane authz model**: Plane 1 = a gateway *visibility resolver* backed by the
`ops_perm` permission store (which pages/widgets/filters a role sees); Plane 2 = an **OPA data-plane** (`decide`
entrypoint) that returns row-level filters and (soon) column masking. It is a **Data Vault 2.0** warehouse.

### The repo is numbered-layer — keep it that way, reuse patterns, never fork a parallel one
`0_external/sources` · `1_infrastructure/k8s/{base,overlays/dev}` + `1_infrastructure/helm/nhdw` ·
`2_pipelines/{ingestor,staging,vault,marts,ml,mdm}` · `3_storage/{postgres,clickhouse,minio}/init` (files are
`NN_*` and run in numeric order, **only on a fresh database volume**) · `5_orchestrator/dags` ·
`6_access-points/{api/nhdw-gateway,dashboards/*}` · `7_security/{keycloak,opa,openbao}` ·
`bundle/{scripts,seed-pack,seeds,images}`. Whatever you add, add it in the existing pattern for that area.

### Non-negotiable rules
1. **Kubernetes only, one canonical bootstrap.** No docker-compose as a runtime.
2. **Cold-boot reproducibility.** Every change must live in **seeds / manifests / images**, never only on the live
   cluster. A dashboard/widget change ⇒ rebuild the SPA image + reseed catalog/grants; a DDL change ⇒ a numbered
   Postgres init file + a reseed step; an OPA change ⇒ committed rego + the regen script; a new image ⇒
   `build-images.sh` + `cache-images.sh` re-bundle. The test of "done" is teardown → bootstrap reproduces it.
3. **Never delete — archive.** Superseded code/manifests → `_archive/<today>/<topic>/` in the same session, then
   grep the old name repo-wide.
4. **Repetition over shared coupling for dashboards** — copy a helper into each SPA; do not import across SPAs.
5. **Secrets** only in gitignored files (`overlays/dev/secrets.yaml`); templates carry `changeme-*` placeholders.

### The change protocol (apply to every edit)
- **Before — ramification analysis:** what contract does this touch (a schema, an env var, an image name, a
  hostname, a column, a hash key, an OPA obligation)? who consumes it? is the same root cause elsewhere? Fix at
  the source of the contract.
- **During — symmetry:** apply the fix the same way everywhere the pattern occurs.
- **After — verify like a human:** actually drive it (Playwright), test the **negative path**, run the affected
  stage end to end. State plainly what you verified and what you didn't.

### The load-bearing contracts you must NOT break (this is the anti-myopia part)
- **The conformed-key spine (Track A's territory — do not touch).** `v_*_resolution` → `hk_*_conformed` →
  `hub_*_conformed` → `lnk_same_as_*` → `dim_*` → `lnk_facility_indicator_period` → every cross-source mart. You
  **read** the marts; you never edit the vault resolution views or conformed hubs.
- **`mart_attrs` ↔ `fetchers.py` namespace divergence.** `ops_perm.mart_attrs` uses on-the-wire names that don't
  always match the real dbt relations; `fetchers.py` is the authoritative widget→mart binding (real dbt
  `schema.table`). Anything column-level keys on the **real dbt `schema.table.column`**.
- **OIDC single-host convention.** A new tool host (`openmetadata.<hostBase>`) ripples to `setup-keycloak.py`
  (`TOOL_CLIENTS`), the dev ingress, the `gen-tls` wildcard, the admin deep-link tile, **and** the Helm chart —
  edit each. The Helm chart has a `hostBase` helper; the kustomize path repeats the convention literally. Remote
  hostBase is `20.84.70.78.nip.io`; local dev is `127.0.0.1.nip.io`.
- **The real-email path.** `nhdw-gateway/app/mailer.py` `mailer.send()` sends to the operator's **real personal
  Gmail** (SMTP is live on the pod), and Alertmanager's catch-all also reaches it. Anything that could email
  **defaults OFF** behind an explicit flag.
- **The `_manifest.json` lake sidecars are load-bearing** — the pipeline change-gate (`pipeline_refresh` /
  `probe-lake`), the `/api/dq/ingestion` freshness API, and ingest watermarking read them. OpenLineage
  **augments** them (a `lineage.py` beside `manifest.py`); it never replaces or alters them.
- **OPA is the enforcement point; OpenMetadata is NEVER in the enforcement/query path.** Classification flows
  **one-way OM → `ops_perm`** (a committed seed that OPA reads at boot); governance must still hold if OM is down.

### Ground truth (the local checkout is stale — verify against the remote)
- `ops_perm` and `ops_governance` live in the **`nhdw_ops`** Postgres database (not `nhdw_vault`). New ops DDL must
  `\connect nhdw_ops` and grant `ops_gateway`.
- Object store is **SeaweedFS** (`seaweedfs-s3.nhdw.svc.cluster.local:8333`); some manifests still reference a
  stale `minio-datalake` — use SeaweedFS.
- Security seeds live in `bundle/seed-pack/app/security/` (not `bundle/seeds/security/`).
- Postgres init: Track A has since taken `34` (ref vocab), `35` (MDM decision tier) and `36` (the MDM
  read seam). **You own `37_openmetadata_db.sh` (already merged) and `38_governance.sql` (DQ) — the DQ
  number moved from 36, which collided.**
  Track A owns `34_ref_vocab.sql`, `35_mdm.sql`, `36_mdm_decisions_read.sql`, and the
  `column_classification` addition to the existing `17_perm_schemas.sql` — do not create those.
- Init runs only on a fresh DB volume; on the live 45-day-old cluster new tables need a one-time apply (a bootstrap
  Job), and `alert_routing` from init 29 is currently absent there.
- **Ground every assumption in the real data with read-only queries (recipes in Part 4).** Code-reading alone
  misses intricate connections — the reconnaissance for this plan repeatedly found the code and the live data
  disagree.

### Commit / delivery discipline
- Work on your **own branch**; never push to `main`. Deliver the branch (or a patch) to the integrator, who merges
  → tests → pushes to **`develop`**.
- Commits **human-style**: concise/conventional. **No** "Claude"/"Anthropic"/"AI"/co-author strings and **no**
  absolute dev-path strings in any tracked file or commit message (public repo, shared with a manager). Grep the
  staged diff before every commit. No secrets.

---

## PART 1 — The full plan (all six components; you own two now, a third later)

The data layer is being brought to production grade. **Architecture is decided on best-practice grounds, not on
what today's synthetic Ethiopian data contains — that data is a test case to validate against and to find gaps.**
The six components:

1. **`nhdw_ref` — reference/terminology vocabulary** (OMOP-style: `concept`/`concept_relationship`/
   `source_to_concept_map`, extensible to WHO ICD-10/ATC/LOINC). Replaces code-embedded crosswalks; the vault
   resolution views JOIN it, parity-first. **(Track A)**
2. **In-house MDM** — a full match → survivorship → stewardship subsystem that **upgrades the business-vault
   conformance layer in place** (keeps `hub_*_conformed`/`lnk_same_as_*`; adds a matcher (Splink-style),
   `master_entity_uid`, a golden-record satellite, identifier links, bitemporal history, a steward console, and a
   published master release). Raw vault untouched. **(Track A)**
3. **Column-level masking** — activate the wired-but-inert gateway seam: `ops_perm.column_classification` →
   OPA emits `masked_columns` → `app/masking.py` transforms rows on **every** read path (closing the SQL-editor /
   chatbot / saved-query bypasses and the live GPS leak in `/api/ct/plan`). **(Track A)**
4. **DQ detector & observability** — auto-raise `dq_flag` incidents (failed dbt tests, orphans, anomalies,
   timeliness), a central `dq_threshold` config, email-OFF alerting; **extends** the existing Admin DQ page.
   **(Track B — your Batch 2)**
5. **OpenMetadata** — catalog + glossary + column-level lineage + DQ results + PII/classification, out of the
   enforcement path. **(Track B — your Batch 1)**
6. **OpenLineage** — emit lineage (dlt source→lake edge + Airflow + dbt exposures) into OpenMetadata.
   **(Track B — your Batch 1)**

The full per-component detail (integration, inputs/outputs/connections, modify-replace-remove-add, and the
grounded corrections) is in `data-layer-enhancement-plan.md` — read it in full.

---

## PART 2 — YOUR ASSIGNMENT

### Batch 1 (start now): OpenMetadata + OpenLineage

**OpenMetadata (item 5).**
- Deploy as a new operator tool: `1_infrastructure/k8s/base/openmetadata.yaml` (model on `base/mlflow.yaml`) + a
  single-node `base/opensearch.yaml` (`discovery.type=single-node`, security off, `-Xms1g -Xmx1g`, ClusterIP, a
  small PVC). Mirror both in the Helm chart (`1_infrastructure/helm/nhdw/templates/`), gated by
  `values.openmetadata.enabled`. Register both in `base/kustomization.yaml`.
- Metadata DB: **reuse `postgres-vault`** — new database via `3_storage/postgres/init/37_openmetadata_db.sh`
  (clone `31_superset_db.sh` verbatim; DB `nhdw_openmetadata`, role `openmetadata_writer`). Postgres is 16.14
  (supported). Include an OM `db-migrate` initContainer (OM won't start against an unmigrated DB).
- OIDC: a **native-OIDC** `openmetadata` client in `7_security/keycloak/scripts/setup-keycloak.py` `TOOL_CLIENTS`
  (not a tool-gate), realm **`moh-staff`** (R-STEW's realm), base `https://openmetadata.<hostBase>`, secret
  `OPENMETADATA_OIDC_SECRET`. Ingress `openmetadata.<hostBase>` in `overlays/dev/ingress.yaml` (wildcard TLS
  already covers it). Add the secret to `overlays/dev/secrets.yaml.template`.
- Images → `bundle/scripts/cache-images.sh` `PUBLIC[]`: `docker.getcollate.io/openmetadata/server:<pin>`,
  `.../ingestion:<pin>`, `opensearchproject/opensearch:2.<pin>` (pin GA versions). ~5 GiB bundle growth.
- Connectors as an **Airflow KubernetesPodOperator** DAG (`5_orchestrator/dags/openmetadata_ingestion.py`,
  pattern: `alert_evaluation.py` / the ml DAGs): dbt (from the lake `nhdw-artifacts/dbt/{staging,vault,marts}/` —
  gives model + **column** lineage from the manifest), Postgres (`nhdw_vault` + `nhdw_ops`), ClickHouse
  (`nhdw_staging`), S3 (`seaweedfs-s3:8333`, path-style), Airflow. File-declared connector configs +
  `bundle/scripts/seed-openmetadata.sh` for cold-boot.
- Admin: add an OpenMetadata **tile** to `6_access-points/dashboards/admin/ui/src/widgets/adm-documentation/index.tsx`
  `TOOLS[]` (host `openmetadata.<hostBase>`, roles R-STEW/R-OPS-ADM/R-SUPER). **Repoint** the dbt-Docs "full
  lineage" tiles to OpenMetadata (dbt-docs is superseded; keep the in-app `/api/dq/lineage` summary as the
  always-on fallback — do not remove it).
- **Classification sync (the cross-track interface):** a task that reads OM column tags and UPSERTs them one-way
  into `ops_perm.column_classification` (`managed_by='openmetadata'`, never overwriting `seed`/`steward` rows),
  committing back to the seed file. **OPA never calls OM.** (The table is created by Track A — see Part 3.)
- **Grounded facts:** the single node has ~86 GiB free — footprint is a non-issue; the dbt artifacts are already
  in the lake; fix stale `minio-datalake` references to `seaweedfs-s3:8333`.

**Lineage emission (item 6).**
- **Transport decision (revised): NO Kafka/broker.** OM's OpenLineage-connector path needs Kafka, and standing up
  a broker only to move lineage events is unjustified. Emit **directly to OpenMetadata's lineage API** instead:
  - **dlt source→lake edge:** `2_pipelines/ingestor/*/src/lineage.py` **beside** `manifest.py` (augment, never
    replace the sidecars); a thin client that posts "source system → `s3://nhdw-raw/<source>/<object>`" to the OM
    REST lineage API using the ingestion-bot token. **Fail-safe: silent no-op when the OM endpoint env is unset
    or unreachable** — ingest must never fail because OM is down.
  - **Airflow:** use **OM's native Airflow lineage backend** (provider), config-only in `base/airflow.yaml` +
    Helm; leave unset until OM is up.
  - The OpenLineage-standard Kafka event stream stays a documented option if an event bus ever exists for other
    reasons — do not build it now.
- **Do NOT deploy `dbt-ol`** — OM's dbt connector already derives column lineage from the lake manifest
  (redundant + dbt-version risk).
  - **Fix:** have the dbt `entrypoint.py` upload `catalog.json` (currently listed but not produced) so OM gets
    column types.
  - **dbt exposures:** `bundle/scripts/gen-exposures.py` imports `fetchers.py` (read-only — Track A owns that
    file) and emits `2_pipelines/marts/models/_exposures.yml` (the marts→dashboard-widget hop).
- Rebuild the ingestor images (for `lineage.py`) + the marts image (for `_exposures.yml`); re-bundle.

### ✅ Batch 1 — MERGED 2026-09-20 (PR #3 → `develop`)

Reviewed and merged whole; the classification sync honoring `managed_by` exactly as specified made the
cross-track interface a non-event. Two integration pieces were added on merge, because they depend on
things outside your branch:

1. **`seed-openmetadata.sh` is now bootstrap step 7.8** (non-fatal): your own doc names it a bootstrap step,
   and a catalog is never load-bearing, so a cold boot runs it and continues on failure.
2. **CI now rebuilds `nhdw/airflow` when `5_orchestrator/**` changes** — DAGs are BAKED into that image, so
   your new DAG would never have reached the scheduler on a deploy.

Two things to know about the live shared deployment (see PART 4 — you now run your OWN cluster):
- **Nothing OM-related is deployed to the shared k3s yet.** CI does not apply k8s manifests (the overlay render
  needs the server-side `secrets.yaml`), so OpenMetadata/OpenSearch arrive at the next provision or on a fresh
  bootstrap. Your admin tile is therefore visible before the tool answers on that host — cosmetic, expected.
- ~~**`superadmin` exists only in the live Keycloak, not in `users.yaml`.**~~ **RESOLVED — I was wrong.** It has
  been in `bundle/seed-pack/app/security/users.yaml` since the seed-pack migration (P1.4), as a deliberate
  cross-realm test account: `55555555-…` in `moh-staff` and `66666666-…` in `privileged-ops`, both R-SUPER.
  Confirmed live in `ops_identity.user` on the shared cluster. `AUTHORIZER_ADMIN_PRINCIPALS` names a
  reproducible account and a cold boot recreates it. No action needed.

**What changed under you while Batch 1 was in review — rebase on `develop` before starting Batch 2:**
- `v_facility_resolution` is **v3** and `v_commodity_resolution` now takes a steward-decision override
  (precedence: steward decision > facility_id / vocabulary > normalised name); `match_strategy` is a new column
  on both. `dim_facility` gained `master_entity_uid` + `mdm_state` and now filters to CURRENT entities.
- New vault models: `sat_facility_canonical` (golden record), `lnk_facility_identifier`.
- New DDL: `36_mdm_decisions_read.sql` (a postgres_fdw seam exposing `ops_governance.mdm_match_decision`
  read-only inside `nhdw_vault` as schema `nhdw_vault_governance`).
- **Masking is now live and enforced on every read path**, including ad-hoc SQL. If an OM-driven classification
  lands on a column your connectors read through the gateway, it WILL be masked for roles without a reveal
  grant. `ops_perm.column_classification` also has a console now (admin → Column Governance) — your
  `managed_by='openmetadata'` rows show there as catalog-managed and are read-only to stewards, as intended.
- **CI changed a lot**: a hosted test gate (`.github/workflows/test.yml`) runs on every branch push — opa test,
  MDM matcher + loader + vocabulary units against a real Postgres, gateway import + masking contract, admin-ui
  type build, script parse. Keep it green. Deploys now also fail loudly on a failed seed, a failed rollout, or a
  failed pipeline job (they used to scroll past), and `bundle/scripts/check-dbt-sql.py` EXPLAINs dbt models
  against the live warehouse — **run it before pushing any model change**, it costs a minute and has already
  caught three defects that each cost a deploy.

### ✅ Batch 2 — MERGED 2026-09-21 (PR #4 → `develop`)

Merged whole, clean auto-merge (it touched six files Track A had also edited — bootstrap, verify-system,
the secrets template, the gateway manifest, the app/security seeder, the base kustomization — and every
hunk composed). Reviewed against the two things that most needed to hold, and both do:

- **No email path exists in the detector by construction**, with an in-app `alert_routing` row saying so
  and the `DQ_EMAIL_ENABLED` requirement documented for any future integration. That is exactly the
  standing rule.
- **`38_governance.sql`** — the renumbering stuck; no collision with Track A's `34`/`35`/`36`. It is
  ops-side (`\connect nhdw_ops`), so CI applies it without triggering the 40-minute vault cascade.

Verified on merge: every script parses, the DAG and gateway modules compile, the marts `_models.yml` and
`dbt_project.yml` load, the base kustomization renders, the gateway image builds and exposes all 13
`/api/dq/*` routes, and Track A's masking contract still passes on the merged image.

**Batch 3 — nothing is assigned yet.** The metadata and quality planes are both in. Before more surface
gets added, the open items on your side are small and worth closing first:
1. ~~`superadmin` only in live Keycloak~~ — **CLOSED**, it was always in `users.yaml`; see above.
2. ~~OpenMetadata undeployed on the shared cluster~~ — **CLOSED**: the first provision brought up
   `openmetadata` + `opensearch` there, and the catalog holds 632 tables with dbt lineage. Still worth a
   pass over your connectors against that instance rather than only your own k3d.
3. `timeliness_pct` stays honestly NULL until the synthesizers stamp per-report arrival times. That is a
   SOURCE-side change (`bundle/seeds/...` generators), and it is the one thing that would make the
   timeliness detector produce real findings.

### (previous assignment, now delivered) the DQ detector (item 4)
Extend the **existing** Admin DQ page (don't add one). Add `POST /api/dq/detect` (`routes/dq.py`, service-token,
copy `alert_evaluation.py`) + DAG `dq_detection.py`; `ops_governance.dq_threshold` (`38_governance.sql`,
`nhdw_ops`) as the single home for thresholds; a `fingerprint` column on `dq_flag` for idempotency; `timeliness`
in `mart_data_quality` from a `reporting_deadlines` seed. **Email OFF by default** (`DQ_EMAIL_ENABLED=false`
gating every `mailer.send`). First real detections on the test data: auto-raise from dbt-test failures + the MDM
single-source backlog. (Grounded: SMTP is live to a personal Gmail; timeliness has no honest arrival signal on
the current bulk-loaded data until the synthesizers stamp arrival times — build the capability, keep the column
NULL where dishonest.) Full detail in `data-layer-enhancement-plan.md` §4.

---

## PART 3 — Interfaces you must honor (so it merges cleanly)

- **`ops_perm.column_classification` (Track A creates it in `17_perm_schemas.sql`, DB `nhdw_ops`).** Your OM
  classification-sync writes into it. Agreed schema:
  `(schema_name text, table_name text, column_name text, sensitivity text CHECK (sensitivity IN
  ('default','restricted','privileged')), mask_class text CHECK (mask_class IN
  ('none','drop','hash','partial','generalize','tokenize')), data_class text, pii boolean DEFAULT false,
  purpose_unmask text[] DEFAULT '{}', managed_by text DEFAULT 'seed', note text,
  PRIMARY KEY (schema_name, table_name, column_name))`. Write only `managed_by='openmetadata'` rows; never
  overwrite `seed`/`steward`.
- **`fetchers.py` is read-only for you** — `gen-exposures.py` imports it; do not edit it (Track A does).
- **Do not touch:** the vault resolution views / conformed hubs (`2_pipelines/vault/models/business_vault/**`),
  the security OPA policy (`7_security/opa/**`, `app/opa.py`, `app/masking.py`), or init files `17/34/35`.
- **DQ backlog input (Batch 2):** read the MDM single-source count from `dim_facility.n_source_systems` today
  (and from `ops_governance.mdm_match_*` once Track A's MDM lands) — a read-only query, no coupling.
- **Init files:** you own `36`, `37`. **Admin dashboard:** you own `adm-documentation` (OM tile) and `adm-dq`
  (DQ, Batch 2); Track A owns `adm-mdm-review`. `Sidebar.tsx` / `adminApp.ts` / `role_grants.yaml` /
  `cache-images.sh` / `build-images.sh` are **append-only, clearly-marked sections** — never reorder others'
  entries.

---

## PART 4 — Grounding (read-only) and delivery

**Run your OWN full deployment for testing — nothing shared (owner rule, 2026-09-20).**
The k3s cluster in the `nhdw` namespace on the VM is the OTHER track's CI-deployed system — do not
deploy into it, do not create namespaces on it, do not write to its Postgres. Instead:
- Spin up your own **k3d cluster from the bundle** on the same VM (the exact laptop bootstrap flow:
  fresh k3d cluster → `bundle/scripts/bootstrap.sh`). k3d lives inside Docker — separate API,
  separate containerd, separate ingress — and the VM has the RAM headroom (~79Gi free).
- Map your cluster's ingress to **alternate host ports** (80/443 are held by the k3s demo).
- Your OpenMetadata/OpenSearch deploy, its metadata DB, and the connectors' ingestion targets all
  live inside YOUR cluster (the bootstrap seeds the full pipeline, so there is real data to ingest).
- **Never push to `develop` or `main`** — those trigger the CI deploy onto the shared k3s cluster.
  Your feature-branch pushes are inert. Rebase on `develop` before your checkpoint (the CI and the
  vault resolution views changed under you).
- READ-ONLY peeking at the live k3s system (`sudo k3s kubectl -n nhdw ...`, psql SELECTs) stays
  fine for grounding; mutating it is the integrator's job through CI.

**Deliver:** your own branch (e.g. `feat/track-b-metadata`). The integrator pulls it, merges onto the integration
branch, tests (build the touched images, Playwright the admin OM tile + login, confirm connectors ingest, confirm
no email fired, confirm OPA still enforces with OM down), and pushes the merged, tested result to **`develop`**.
Then the next batch is issued.
