# Improvements backlog

A running list of deliberate improvements to return to in a focused execution round.
Each entry: **current state → target → how → caveats → why it's worth it.** Newest ideas
on top; move an item to a task (and this file's "done" note) when it's executed.

---

## 1. Retire the custom bridge — do the ClickHouse→Postgres hop with Trino

**VERDICT (reviewed 2026-07-12): NOT worth it — keep the Python bridge.** On close inspection the
bridge is not bespoke glue that Trino would simplify; it's a typed cross-engine ETL Trino can't do more
cheaply. Feasibility is real (Trino has both the `clickhouse` and `postgresql` plugins loaded), but a
faithful Trino version is a *lateral* move with a real regression risk — details under "Why it turned
out not to be worth it." Left here as a documented decision, not a to-do.

**Current state.** The lake→warehouse hop is a hand-written service: `2_pipelines/vault/bridge/sync.py`
(~227 lines, its own image `nhdw/vault-bridge:dev`, run as the `bridge-sync` k8s Job, PIPELINE step
between dbt-staging and dbt-vault). For every `nhdw_staging.stg_*` view on ClickHouse (26 of them) it
reads `system.columns`, maps CH types → PG types via a real `CH_TO_PG` table, `DROP+CREATE`s a
self-contained typed snapshot in `nhdw_vault.nhdw_landing` (writer `landing_writer`), streams rows in
50k batches, and runs `ANALYZE`. It exists because **dbt can't cross database engines**.

**Target.** Remove the bespoke copy. Use **Trino** (already deployed for Superset — it natively speaks
both ClickHouse and Postgres) to make the hop a declarative federated query:
```sql
-- per stg_* view, full-reload semantics:
DROP TABLE IF EXISTS pg_landing.nhdw_landing.stg_x;
CREATE TABLE pg_landing.nhdw_landing.stg_x AS
SELECT * FROM clickhouse.nhdw_staging.stg_x;
```

**How.**
- Add a Trino **ClickHouse catalog** (`3_storage/trino/etc/catalog/clickhouse.properties`,
  `connector.name=clickhouse`) alongside the existing postgres catalogs (`marts`, `ops`).
- Add a Trino **Postgres catalog with write** pointing at the `nhdw_landing` schema (the postgresql
  connector supports `CREATE TABLE AS` / `INSERT`).
- Replace `sync.py` / the `bridge-sync` Job with a small step that enumerates the `stg_*` views and runs
  the CTAS per view against Trino (a thin Trino-client loop, or dbt-on-Trino if we want it in the dbt DAG).

**Why it turned out NOT to be worth it (the real finding).**
- **Staging is typed, not all-string.** The 26 stg_* views carry a mixed surface: 133 String, 74
  Int64/Float64/Bool/Date32, 39 Decimal(p,s), 26 UInt64, and **51 DateTime64**. The vault casts *from*
  these specific PG types, so the landing types are a contract, not incidental.
- **Trino's default CH→PG mapping diverges on load-bearing columns.** Notably the **51 DateTime64
  columns**: the bridge writes `TIMESTAMPTZ`, Trino maps ClickHouse DateTime → `timestamp` (no tz).
  UInt64 → `decimal(20,0)` vs the bridge's `NUMERIC(20)`; String → `varchar` vs `TEXT`. So a faithful
  Trino version can't be `SELECT *` — it needs a **generated per-column CAST list**, i.e. the same
  `system.columns → typed DDL` logic the Python already does, just moved into a SQL generator.
- **`ANALYZE` is not optional.** The bridge runs it post-load; its own comment records that skipping it
  made dbt-vault plan hour-long nested loops at ~650k rows. Trino CTAS won't run Postgres ANALYZE → a
  separate psql step is required.
- **Grants/ownership.** Trino CTAS re-owns each table as `landing_writer` every run; the vault reader's
  SELECT grant must be re-established.
- **Net:** trades ~227 lines of clear, self-contained Python for 2 new Trino catalogs + a CAST-generating
  SQL script + a separate ANALYZE step + grant management — comparable complexity across more components,
  plus a real type-fidelity regression risk on 51 columns. (dlt's `sql_database` source was also
  considered; ClickHouse-as-a-dlt-source isn't first-class, so it's no better.)

**If ever revisited, the ONLY safe path:** build in parallel into a shadow schema (`nhdw_landing_trino`),
byte-diff all 26 tables (types + row counts + checksums) vs the bridge, confirm dbt-vault builds
identically, then cut over and archive `2_pipelines/vault/bridge/`. Never a blind swap on a live system.

---

## Backlog — surfaced in the platform review (weakness assessment) / architecture Q&A

Lower-detail seeds for later rounds (full findings: `scratchpad/weakness-assessment.md`):

- **CI gate** — no CI today. Add GitHub Actions: `bash -n` all scripts, `opa test`, `dbt build --target ci`,
  SPA typecheck/build. Biggest single credibility win.
- **Provisioning as IaC** — bring-up is ~3k LOC of bash. For production, stand the cluster up with
  **kubespray** (Ansible, self-managed HA) or a managed cluster; k3d stays dev-only. Add a `BASE_DOMAIN`
  parameter + cert-manager/ACME for a real host (retires the `*.127.0.0.1.nip.io` hardcoding).
- **HA** — everything is single-replica/single-instance; no failure tolerance. Replicas + HA datastores.
- **MFA + NetworkPolicies** — MFA enforced for 1/20 users; zero NetworkPolicies (flat namespace). Enforce
  MFA for privileged roles; add default-deny network policies.
- **Secrets vault** — OpenBao is advertised but not deployed; secrets are k8s Secrets. Deploy OpenBao or
  stop presenting it as part of the architecture.
- **#91 runtime hot-reload** — the OPA policy regen is deploy-time (Option A). The production-idiomatic
  upgrade is a signed OPA **bundle → MinIO → OPA polls + hot-reloads** (schema already scaffolds
  `policy_revision.bundle_url`). Runtime permission edits then take effect without a reboot.
- **Public portal wiring** — the public SPA still ships some hardcoded figures; wire to the MinIO CMS /
  real marts and fix the woreda-count mismatch.
- **Repo hygiene** — prune the ~38GB of stale `.claude/worktrees/` agent copies; document the
  images/weights/seed-data reconstitution story (a bare `git clone` isn't bootable by design).
