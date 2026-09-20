# Admin dashboard — presenter's guide

Part of the NHDW Dashboard Presentation Guide — see [README.md](README.md).

This file documents the **Admin dashboard** — the operator / administrator
cockpit. It is the fifth SPA under `6_access-points/dashboards/admin/`. Where the
other four dashboards *consume* the data warehouse, this one *runs* it: cluster
health, what widgets are switched on, alert routing, data-quality, the model
fleet, who has access, the role/permission model, federated identity, and the
operator documentation.

Every statement below is traced to the actual catalog, widget code, gateway route,
SQL, or seed in this repo. Anything the implementation does not fully pin down is
flagged **_requires confirmation_** at the end rather than invented.

---

## 0. How to read this dashboard (the shared truths)

Understand these five facts before you present any page — they answer 80% of the
technical questions and they are enforced in code, not asserted on a slide.

**1. Each admin page is one big "organism" widget, not a grid of small tiles.**
The catalog (`6_access-points/dashboards/admin/catalog/`)
maps exactly one widget onto each page. So "the Health & Topology page" *is* the
`adm-topology` widget; "the Roles and Permissions page" *is* the
`adm-roles-permissions` widget. Each widget then renders its own internal
sections/tabs. Widget source lives under
`.../admin/ui/src/widgets/<widget-id>/`.

**2. Nothing on this dashboard is mocked.** Every widget header carries an
explicit "no fabricated numbers" contract, and the code honours it: a feed that
cannot load shows a labelled empty state ("not yet available", "metrics-server
unavailable", an honest `NULL`) rather than inventing a value. The two historical
mock tables (a 412-fake-user directory; a fake on-call routing table) were
deleted, not hidden. The few hardcoded arrays that remain are *configuration*
(option lists, external tool URLs, icon maps), never metric values — each is
called out where it appears.

**3. The SPA never talks to a database directly.** Every widget calls the admin
proxy path `/gw/<x>`, which transparently prepends `/api/` and forwards to the
**nhdw-gateway** with the operator's session. So `/gw/perm-admin/roles` in the UI
is `GET /api/perm-admin/roles` at the gateway. The gateway is the only thing that
reads Postgres / Trino / MinIO / the k8s API.

**4. Access is capability-gated at the gateway, per page.** The admin SPA loads
for any signed-in operator, but each backend route enforces a capability. The
relevant capabilities and the roles that hold them (from
`bundle/seed-pack/app/security/roles.yaml`):

| Capability | Roles that hold it | Gates (admin pages) |
|---|---|---|
| (role in `R-OPS-ADM/ENG/SEC` or `R-SUPER`) | R-OPS-ADM, R-OPS-ENG, R-OPS-SEC, R-SUPER | Health & Topology (all `/api/topology/*`) |
| `view_ops_console` | R-OPS-ENG, R-OPS-ADM, R-OPS-SEC, R-SUPER | Alert Routing, Quality & Lineage, Documentation, Models fleet |
| `manage_catalog` | R-OPS-ADM, R-SUPER | Dashboard Control |
| `manage_users` | R-OPS-ADM, R-SUPER | Users directory, Roles list/audit |
| `edit_roles` | R-OPS-ADM, R-SUPER | Roles editor (saving) |
| `approve_access_request` | R-OPS-ADM, R-SUPER | Access-request queue + decisions |
| `manage_identity_sources` | R-OPS-ADM, R-SUPER | SSO & Identity |

Practical consequence to know on stage: a **Security Officer (R-OPS-SEC)** can see
Topology, Quality, Alerts and Documentation, but the Users/Roles/SSO/Dashboard-
Control panels will show a polite "the gateway declined … you need the `X`
capability" banner. A **System Admin (R-OPS-ADM)** and the **Super-User
(R-SUPER)** see everything. Demo with `R-OPS-ADM` or `R-SUPER`.

**5. Writes are audited.** Permission-model edits write an
`ops_perm.audit_permission_change` row tied to a `policy_revision`; access-request
decisions and DQ acks write governance rows. The audit trail is itself surfaced in
the UI (Roles page → Permission-change audit; Topology → gateway's Audit tab).

**Target audiences for this dashboard:** platform **operators** (SRE / pipeline /
infra engineers), **data-governance** stewards (quality, lineage, access), and
**security** administrators (identity, roles, policy).

**The pages, in sidebar order** (from each page's `ordering:` in the catalog):

| # | Page (title) | Catalog id | Widget | One-line takeaway |
|---|---|---|---|---|
| 1 | Health & Topology | `admin/infra` | `adm-topology` | Live cluster map + health, from the real k8s API. |
| 2 | Dashboard Control | `admin/dashboard-control` | `adm-dashboard-control` | Switch any widget on/off at runtime; subtract-only. |
| 3 | Alert Routing | `admin/alerts` | `adm-alerts-routing` | Live alerts (Prometheus) + editable routing rules. |
| 4 | Quality & Lineage | `admin/dq` | `adm-dq` | dbt health, source freshness, DQ dimensions, lineage. |
| 5 | Models and datasets | `admin/models-datasets` | `adm-models-datasets` | Model-fleet health + the graduation review queue. |
| 6 | Backups & DR | `admin/backups` | *(none)* | Registered page, **no widget wired yet.** |
| 7 | Users and Access | `admin/users-access` | `adm-users-access` | Access-request queue + the live user directory. |
| 8 | Roles and Permissions | `admin/roles-permissions` | `adm-roles-permissions` | The 4-axis role editor, audit, and OPA tester. |
| 9 | SSO & Identity | `admin/sso` | `adm-sso-cards` | Federated identity-provider catalog (CRUD). |
| 10 | Documentation | `admin/documentation` | `adm-documentation` | Env facts, API ref, system docs, operator tools. |

---

## 1. Health & Topology (`admin/infra` → `adm-topology`)

**What it is.** A live, apps-only map of the Kubernetes cluster the demo runs on,
plus rich per-node and per-edge detail. Source of truth:
`6_access-points/api/nhdw-gateway/app/topology_graph.py`
(structure + health) and `.../app/traffic_providers.py` (traffic), served by
`.../app/routes/topology.py`.

**The story.** "This is not an architecture drawing someone kept up to date by
hand — it is derived on every refresh from the running cluster. The boxes are the
workloads actually deployed; the lines are the wiring the workloads actually
declare; the colours are their real health right now; and the traffic is measured,
not simulated."

**Audience & decisions.** Platform operators. Answers: is everything up? what is
degraded or not deployed? what is talking to what, how hard, and with what error
rate? which workload is restarting / OOM-killing / logging errors? Supports the
"scale it live" demo lever (there is a `POST /api/topology/scale` behind the
cluster, capped at 20 replicas).

**One-line takeaway:** a self-deriving, honest picture of the cluster's health and
real traffic — no hand-maintained diagram, no fake metrics.

**Structure — a single scrolling page (NOT top-level tabs).** The old three-tab
table view was retired. Top to bottom the widget renders: (a) five summary cards,
(b) the "Topology map" (a Cytoscape graph) with controls, (c) a context-sensitive
detail panel that changes when you click a node or an edge. Tabs exist **only
inside the node-detail panel**.

### 1a. The five summary cards (`TopoSummary.tsx`)

All five are computed from data the page already fetches; no card invents a number.

- **Cluster health** — donut, centre reads `{healthy}/{deployed}` "healthy", with a
  legend of `up / degraded / down / not-deployed / unknown` counts. Meta: "`{n}
  in-cluster workloads`".
- **Host resources** — three gauges: **CPU LOAD**, **MEMORY**, **LOAD 1m**, plus
  "mem GB used/total" and "load · cores". Feed: `GET /api/topology/infra` (reads
  `/proc` inside the gateway pod — a single-node-demo proxy for "the box").
- **Inbound traffic · req/s** — three tiles (inbound edges, req/s now, edges with
  errors) + an aggregate req/s sparkline. Caption is explicit: "User → cluster
  requests entering via the gateway … internal pod-to-pod hops excluded."
- **Workloads by tier** — a bar per tier (api / storage / security / ui / ml / …).
- **Cluster capacity** — pods-by-phase (Running/Pending/Succeeded/Failed/Unknown),
  per-node CPU%/Mem% vs allocatable, and HPA rows (current→desired, min–max,
  CPU%/target%). Feed: `GET /api/topology/cluster` (k8s API + metrics-server). Note
  on the card: "RED (req/err/latency) + history need the observability stack (#81)."

### 1b. The map (nodes, edges, tiers)

**Nodes = deployed application workloads only** (Deployments + StatefulSets in the
`nhdw` namespace). Derivation (`topology_graph.py`):

- Node **kind** comes from the workload's own `tier:` label (api→api,
  storage→datastore, security→security, ml→ml, dashboard/bi→ui, etc.).
- Node **zone/band** (the swimlane rectangle it sits in) is decided server-side so
  the renderer and the semantics stay in lockstep (access / apis / storage /
  compute / security / observability).
- **Health** is real, from ready-replica counts: `CrashLoopBackOff → down`;
  `ready ≥ desired (>0) → up`; `0 < ready < desired → degraded`; `ready == 0 →
  down`; `replicas == 0 → unknown`. A workload that is *declared but has no running
  pod* is marked **`phantom` / "not deployed."**
- **Distress signals** per node, from the same pod scan (zero extra API calls):
  total container **restarts**, **OOMKilled**, and (fail-soft, merged from Loki)
  **error-log lines in 15m**.
- **Deliberately excluded:** Jobs/CronJobs (ingestors, dbt, bridge-sync,
  ml-runner), DB tables, MinIO buckets, external source systems, and every
  data-lineage/ETL edge — "that story belongs to dbt-docs + the data-lineage page."
- **One ephemeral exception:** dynamically-spawned JupyterHub single-user lab pods
  appear as ephemeral compute nodes with a `hub → lab` "spawns" edge, so an
  operator can watch labs come and go. A synthetic `kubernetes-api` node is added
  to de-island headlamp + the gateway (the API server lives outside the scanned
  namespace). Off-cluster dependencies (the Ollama LLM, the Fayda replica) are
  **intentionally NOT drawn** — the map is a pure in-cluster view.

**Edges = declared wiring, auto-derived every call.** For each workload the gateway
scans its container `env` plain values, `command`/`args` (with `$(VAR)`/`${VAR}`
resolution), and referenced ConfigMap connection strings, then matches host tokens
against every Service's names → the workload that Service selects. Edge **kind**
(http/db/s3/native/oidc/k8s) is inferred from the target + a port→protocol map.
Edge **status** rolls up the two endpoints' health (down > degraded > up). An edge
is only drawn from a genuine connection signal (an explicit `:port`, a `.nhdw`
FQDN, or a `//`/`@` before the token) — bare name-shaped tokens in DDL/realm
exports are ignored.

**Traffic is REAL, not synthetic — and this is the key honesty point on this page.**
`traffic_providers.py` layers measured per-edge RED (request rate / error rate /
p95 latency / bytes) onto edges. The primary, always-available provider is
**`gateway_log`**: a windowed `GROUP BY` over `ops_audit.gateway_log` (the
gateway's own append-only request log) mapped path→edge — so gateway-centric edges
carry genuine req/s, 5xx-or-deny error rate, p95, bytes and a 12-bucket sparkline.
A second **`hubble`** provider (Cilium eBPF flow metrics via Prometheus job
`hubble`) can fill every *other* edge with real CNI-level flow/drop counts when
that observability stack is running. There is **no synthetic traffic anywhere** —
an edge with no measured data stays "structural" (grey, no numbers). The map
legend distinguishes "live traffic (animated)" from "structural."

### 1c. Map controls & window

- **Refresh-interval selector:** 10s / 30s / 60s / off, default **30s**. A 5s
  ticker keeps the "N s ago" chip fresh.
- **Traffic window is fixed at 5m** — the widget calls `/graph` and `/traffic` with
  no argument, so both default to `window=5m`; the "window 5m" label you see is
  reported by the backend, not chosen in the UI.
- Graph toolbar: zoom in/out, fit, reset layout. Three external launcher buttons
  (Prometheus, Alertmanager, Cluster console/Headlamp) open on the existing session.

### 1d. Node-detail panel (the tabs)

Click a node → a per-node tab set (computed for that node):

- **Overview** (always): Identity (kind, tier, deployment, namespace, declared,
  observed); Health & runtime (health pill + `ready {r}/{desired}`, restarts, QoS,
  pod count, workload kind, image(s)); a **Signals** block (OOM-killed pill, "{n}
  restarts", and a clickable "{n} error lines · 15m" badge that loads recent lines
  via `GET /api/topology/errors` — Loki-backed).
- **Resources** (live nodes only): Compute — real CPU/memory usage vs request/limit
  from **metrics-server** (`metrics.k8s.io`), with bars (thresholds >85 alert, >60
  watch); Storage — per-PVC volume usage + ephemeral writable-layer usage from the
  kubelet Summary API. It also carries a labelled "Per-service request rate (RED)"
  slot that shows a **`pending #26`** note with no number (honest placeholder — the
  per-service RED needs the gateway `/metrics` scrape). Feed: `GET /api/topology/node`.
- **Logs** (live nodes only): kubelet-tail of the last 150 lines, per-container
  sub-tabs, a search box, and a level filter (error/warn/info/debug/other with
  counts). Feed: `GET /api/topology/logs`.
- **Config & secrets** (when present): chips listing the Secrets and ConfigMaps the
  workload mounts (names only — no values).
- **Connections** (always): a sortable table of this node's wired peers (direction,
  peer, protocol·port, req/s).
- **Audit** (only on the `nhdw-gateway` node): see 1e.

Click an **edge** instead → an edge card with four KPI tiles (Req rate, Error rate,
p95 latency, Volume/Flow rate), an optional "Packet drops by reason" (Hubble
verdicts), a req/s sparkline, and — for a structural edge — text naming the two
real traffic sources (`gateway_log`, `hubble`).

### 1e. The "gateway logs" / Audit tab (consolidated audit)

On the **`nhdw-gateway`** node only, an **Audit** tab shows the API-gateway request
audit — "who accessed what, and the OPA policy decision. Consolidated here from the
retired standalone Audit-logs page. Latest 100 events." Feed:
`GET /api/audit/events` (server-side paginated/filterable over
`ops_audit.gateway_log`, see `.../app/routes/audit.py`). Columns: **Time · Actor ·
Request (method+path) · Status · Policy** (allow=green, deny=red); expand a row for
realm, client IP, latency, rows, mart scope, denied reason, user agent.

**Talking points.** "The map re-derives itself from the live cluster every 30
seconds." · "Health is ready-replica truth; a greyed 'not deployed' box is declared
but has no pod." · "The traffic on the gateway edges is the gateway's *own audit
log*, grouped by path — real req/s and error rate, no simulation." · "Click the
gateway and open Audit — that's every request and its OPA allow/deny decision."

**Limitations / common misinterpretations.** (1) "Where's the pipeline / the
sources?" — deliberately not here; this is apps-only. Point them to dbt-docs +
Quality & Lineage. (2) Per-*service* RED (as opposed to per-*edge*) is a labelled
`#26` placeholder, not a hidden number. Historical time-series is `#81`. (3) The
5m traffic window is fixed in the UI. (4) On an idle demo cluster the gateway edges
may legitimately show near-zero req/s — that is honest, not broken.

**Likely questions.**
- *"Is the traffic real or a demo animation?"* Real — from `ops_audit.gateway_log`
  (and Cilium/Hubble if deployed). Structural edges with no measured flow stay grey.
- *"How does it know what connects to what?"* It parses each workload's env/args/
  ConfigMap connection strings and matches them to Services — the declared wiring.
- *"Can I actually change the cluster from here?"* The backend exposes a live
  `scale` (replicas, capped at 20, `R-OPS-*`/`R-SUPER` only) — the "watch the HPA
  react" lever.

---

## 2. Dashboard Control (`admin/dashboard-control` → `adm-dashboard-control`)

**What it is.** The operator cockpit over the reconciled widget catalog: turn any
widget on or off at runtime, at the widget-everywhere or single-page (placement)
level, plus a soft-orphan panel for widgets whose code left the catalog. Backed by
`ops_perm.catalog_override` via `.../app/routes/perm_admin.py`.

**The story.** "The authored dashboard structure lives in the repo as YAML and is
seeded on boot. This page is the *runtime* layer on top of it — an operator can
disable a widget for a demo without editing files or redeploying, and the change
survives every re-seed."

**Audience & decisions.** Platform operators / demo drivers (`manage_catalog` →
R-OPS-ADM, R-SUPER). Answers: what widgets exist and where are they placed? which
should be hidden right now? which have been orphaned by a code change and should be
purged?

**One-line takeaway:** a runtime, subtract-only kill-switch over every widget —
survives re-seed, never widens access.

**Structure — three stacked panels:**

1. **Widget placements** — a searchable, sortable, paginated table (page size 15),
   one row per widget placement. Columns: **Widget** (`widget_id` code, an
   "orphaned" pill if applicable, title as subtext) · **Dashboard** · **Page**
   (+ section) · **Kind** · **Enabled** (toggle) · **Placement** (toggle). Plus a
   search box, an "All dashboards" filter dropdown, and Refresh. Feed:
   `GET /api/perm-admin/catalog-tree` (the full dashboards→pages→sections→widgets
   tree with each node's override state).
2. **Orphaned widgets** (shown only when any exist) — table: **Widget · Orphaned
   (when) · Grants (count) · Placements (count) · Purge**. Feed:
   `GET /api/perm-admin/catalog-orphans`.
3. **Catalogs** (read-only reference, moved here from the Roles page) — a **Widget
   catalog** panel and a **Filter catalog** panel. Feed:
   `GET /api/perm-admin/catalog`.

**What the toggles actually do.**

- **Enabled** column → `toggle('widget', <widget_id>)`: disables the widget
  **everywhere** it is placed.
- **Placement** column → `toggle('placement', '<page_id>::<widget_id>')`: disables
  it **on that page only**.
- Mechanics: *disabling* writes an override row (`PUT /api/perm-admin/catalog-
  override` with `enabled:false`); *re-enabling* **deletes** the override row
  (`DELETE /api/perm-admin/catalog-override`) rather than writing `enabled:true`.
  The override model supports five granularities — `dashboard / page / section /
  widget / placement` — but the UI wires up `widget` and `placement` only.

**Where state persists (say this precisely).** Overrides are rows in
**`ops_perm.catalog_override`** (keyed on `(kind, scope_id)`). They are **runtime
state that survives every re-seed** — the seed loader never touches this table. The
override is **subtract-only**: the permission resolver still gates access by role
grant *first*; an override can only remove a widget that a role would otherwise
see, it can **never widen access**. Every write also records an
`audit_permission_change` row against a new `policy_revision`.

**Soft-orphan + purge.** When the catalog reconciler notices a widget whose code
left the authored catalog, it *soft-orphans* it (hidden from every spec, but its
grants and placements are preserved — re-adding the widget to the catalog revives
it). The Purge button (`DELETE /api/perm-admin/catalog-orphans/{widget_id}`, with a
confirm dialog) hard-deletes one orphan and cascades its grants + placements; the
backend refuses to purge a live (non-orphaned) widget.

**Honesty note.** All rendered rows are live. The Widget-catalog panel's
"Dashboard" column/filter is derived from a **hardcoded widget-id-prefix map**
(`pub→public`, `ov/dz/rm/sv/ex/st→internal-bi`, `adm→admin`, `ws→workshop`)
because the catalog payload carries no widget→dashboard mapping — this is heuristic
labelling, not authoritative. The placements table's Dashboard column, by
contrast, comes straight from the fetched tree.

**Talking points.** "Kill any widget live, no redeploy." · "Subtract-only — it can
hide, never grant." · "It survives the next cold boot because it's a DB override
the seed won't overwrite." · "Orphans are a safety net: remove a widget's code and
its grants are parked, not lost, until you explicitly purge."

**Likely questions.**
- *"If I disable a widget here, can a re-seed bring it back?"* No — the override is
  in a table the seed never touches.
- *"Could I use this to give someone extra access?"* No, by design — it only
  subtracts.
- *"What's an orphan?"* A widget the catalog no longer references; its grants are
  preserved until you purge it.

---

## 3. Alert Routing (`admin/alerts` → `adm-alerts-routing`)

**What it is.** Two things on one page: the **live firing/pending alerts** from
Prometheus, and **editable routing rules** that map an alert selector to a delivery
channel + recipient. Backend: `.../app/routes/alerts.py`; rules table
`ops_governance.alert_routing` (DDL/seed in
`3_storage/postgres/init/29_alert_routing.sql`).

**The story.** "The platform's alerts are real Prometheus alerts. This page is
where an operator decides *who gets paged* for what — and those routing decisions
are stored in the governance DB and survive re-seed."

**Audience & decisions.** Operators / on-call owners (`view_ops_console` →
R-OPS-ENG, R-OPS-SEC, R-OPS-ADM, R-SUPER — note: engineers and security officers
can edit routing too, not just admins). Answers: what is firing now? and where
should critical/warning/info alerts route?

**One-line takeaway:** live alerts up top, real editable routing rules below — no
fabricated on-call names.

**Structure — three regions:**

1. **Active alerts** (read-only) — from `GET /api/alerts/active` (Prometheus
   `/api/v1/alerts`). Columns: **Alert · Severity · Service · State · Since ·
   Summary**. Honest states: "Alert source unavailable: …", "No alerts firing or
   pending — all clear."
2. **Routing rules** (full CRUD) — from `GET /api/alerts/routing`. Columns:
   **Severity · Selector (`match_label`) · Channel · Recipient · Note · Source
   (`seed`/`runtime`) · Enabled (toggle) · Edit / Delete**. Ordered
   critical→warning→info.
3. **Editor modal** — add/edit a rule.

**What a rule is (and is NOT).** A rule maps an alert **selector** — a `severity`
(critical/warning/info) plus a `match_label` like `service=gateway` or
`kind=dq.test`, matched against the labels on a Prometheus/Alertmanager alert — to
a delivery **channel** + **recipient**. Fields: `severity`, `match_label`,
`channel`, `recipient`, `note`, `enabled`, and `managed_by` (`seed` vs `runtime`).
There is **no metric or numeric-threshold field** and **no "send test" action** in
this widget. The channel is free-text; the placeholders show the intended forms
(`pagerduty:nhdw-oncall`, `slack:#nhdw-platform`, `email:…`).

**Endpoints.** `GET /api/alerts/active` · `GET /api/alerts/routing` ·
`POST /api/alerts/routing` · `PATCH /api/alerts/routing/{id}` (also used by the
on/off toggle) · `DELETE /api/alerts/routing/{id}`.

**Persistence / re-seed.** Any edit stamps `managed_by='runtime'` so it survives a
cold-boot re-seed (the seed upsert only refreshes `seed` rows). The table ships
with **six seeded platform defaults** (`managed_by='seed'`), which the presenter
can name from `29_alert_routing.sql`:

| id | severity | selector | channel | recipient | note |
|---|---|---|---|---|---|
| `ar-gw-5xx` | critical | `service=gateway` | `pagerduty:nhdw-oncall` | ops-oncall@moh.gov.et | Gateway 5xx > 5/min for 2m |
| `ar-db-down` | critical | `service=postgres-vault` | `pagerduty:nhdw-oncall` | ops-oncall@moh.gov.et | DB primary unreachable |
| `ar-mlflow-lat` | warning | `service=mlflow` | `slack:#nhdw-platform` | @platform | ML registry latency > p95 SLA |
| `ar-loki-lag` | warning | `service=loki` | `slack:#nhdw-platform` | @platform | Log ingestion lag > 30s |
| `ar-bi-lat` | info | `service=internal-bi` | `email:platform@moh.gov.et` | platform@moh.gov.et | Dashboard latency > p95 SLA |
| `ar-dq-tests` | info | `kind=dq.test` | `email:stewards@moh.gov.et` | stewards@moh.gov.et | dbt test failures (rolled up daily) |

**Honesty note.** Everything rendered is live: active alerts from Prometheus, rules
from the DB. The old hardcoded mockup table (with fake on-call names) was removed;
the only literals in the code are the severity dropdown options and the greyed-out
input placeholders.

**Talking points.** "The rules are real governance state, not slideware — the six
seeded defaults show the intended paging map." · "Edit a rule and it's stamped
`runtime`, so a re-seed won't clobber it." · "The `Source` pill tells you which
rules are platform-seeded vs operator-authored."

**Likely questions.**
- *"Does saving a rule actually page someone?"* This page is the routing *config*;
  active alerts come from Prometheus. (Whether Alertmanager is wired to physically
  deliver via these channels in the demo — see _requires confirmation_.)
- *"Can I test-fire an alert here?"* No test button in this widget.
- *"Is a rule a threshold?"* No — it's a label selector → channel mapping;
  thresholds live in the Prometheus alert rules.

---

## 4. Quality & Lineage (`admin/dq` → `adm-dq`)

**What it is.** A one-page data-quality and lineage cockpit: dbt build health,
per-source freshness and quality, a five-dimension DQ scorecard, cross-source
reconciliation, k-anonymity compliance, failing/warning dbt tests with
acknowledgement, and a lineage summary. Backend: `.../app/routes/dq.py`.

**The story.** "This is how we prove the warehouse is trustworthy. Every figure is
real-or-empty: it comes from the actual dbt run artifacts, the raw-lake ingestion
manifests, and the governed quality marts — and a blank cell means 'no honest
signal yet', never a fabricated score."

**Audience & decisions.** Data-governance stewards + operators (`view_ops_console`).
Answers: did the last build pass? are the six sources ingesting on time? where is
data quality weak? do sources agree? is public data safely k-anonymous? which test
failures are known/triaged? Auto-refreshes every 30s; all nine feeds load together
(`Promise.allSettled`), so a failed feed degrades to a note.

**One-line takeaway:** an evidence-based trust panel for the pipeline — real dbt +
mart + ingestion signals, honest `NULL`s where a signal doesn't exist.

**Sections & their exact data sources:**

- **Headline KPIs** (4 cards): **dbt build health** `{pass}/{total}` (`GET
  /api/dq/summary` over dbt `run_results.json`) · **Last build** runtime + age
  (same) · **Sources reporting on time** `{live}/{ingestable}` (`GET
  /api/dq/ingestion`) · **k-anonymity · public marts** Pass/Fail (`GET
  /api/dq/compliance`; "k ≥ 5" is a display literal, the Pass/Fail is real).
- **Source health** — one row per ingested system, joining freshness
  (`GET /api/dq/ingestion`, from the raw-lake `_manifest.json` sidecars in
  `nhdw-raw/<source>/…`) with quality (`GET /api/dq/sources`, from the Trino mart
  **`marts.bi_quality.mart_data_quality`**). Columns: Source · Status
  (live/stale/down/unknown) · Last ingest (+ new-data/unchanged chip) · Records ·
  Lag/SLA · Completeness · Validity · Volume trend (sparkline). The seven sources'
  freshness SLAs live in **`ops_governance.dq_threshold`** (scope `sla_hours`,
  seeded by `38_governance.sql`: DHIS2 6h, EthioEMR 1h, HCMIS 4h, mBrana 2h,
  eLMIS-hist 720h, MFR 48h, Climate 168h); the `dq.py` registry is the
  fallback when a row is absent. Status logic: `live` within SLA,
  `stale` past SLA, `down` only after ≥3 days of silence (`max(72h, 2×SLA)`).
- **Incident queue & governance KPIs** — the durable DQ record
  (`GET /api/dq/flags`, paged; `GET /api/dq/kpi`): incidents raised by the
  detector (`POST /api/dq/detect` — service token from the 06:15 `dq_detection`
  DAG, or an admin on demand) into `ops_governance.dq_flag` with every status
  transition appended to `dq_flag_event`. KPIs: open by class/severity/source,
  raise-rate per week, hours-to-acknowledge/-resolve, re-opened fingerprints,
  MDM steward backlog. In-app only — no email path exists in the detector.
- **DQ dimension scorecard** — Completeness · Validity · Timeliness · Consistency ·
  Uniqueness (`GET /api/dq/dimensions`). Completeness/validity/timeliness are
  `avg` over `mart_data_quality`; consistency = relationship-test pass rate,
  uniqueness = unique-test pass rate (from dbt `run_results.json`). A tooltip
  shows the basis of each.
- **Cross-source reconciliation** — real master-data agreement from the business
  vault same-as links (`GET /api/dq/reconciliation`): for **Facility master**
  (DHIS2 · HCMIS · MFR · mBrana) and **Commodity master** (HCMIS · mBrana), the
  share of conformed entities recognised by ≥2 real source systems, plus per-source
  counts. No mock rows — a check is omitted if its vault view can't be reached.
- **dbt tests · failing & warning** — from `GET /api/dq/tests?status=fail|warn`
  (each capped at 25, table shows 14). Columns: Model · Test · Failures · Severity ·
  Acknowledge. The **Acknowledge** button (`POST /api/dq/ack`) records who triaged
  a known issue into `ops_governance.dq_flag` + `dq_ack`.
- **Lineage & operator tools** — from `GET /api/dq/lineage` (built from dbt
  `manifest.json` nodes/sources + `run_results.json` statuses). **Rendered as a
  compact summary, not an interactive graph**: tier-count chips (Source / Staging /
  Vault·raw / Vault·business / Marts / Other) + a model-test rollup (pass/warn/fail/
  untested). The full DAG is delegated to **dbt Docs** via an "Open full lineage"
  deep-link. The tools row deep-links dbt Docs, MinIO Console, Airflow.

**dbt artifacts source.** `dq.py` reads `manifest.json` / `run_results.json` from
MinIO `nhdw-artifacts/dbt/marts/` (uploaded by the dbt-marts job), with a
bind-mount fallback for non-k8s dev. Cached ~30s.

**Assumptions / limitations.** DQ depends on the dbt-marts job having run and
uploaded its artifacts; before that, feeds return a labelled note (e.g. "dbt
manifest not yet uploaded"). Only completeness + validity render per-source-row
(timeliness/consistency/uniqueness live in the scorecard). Timeliness and some
per-source dimensions are legitimately `NULL` where no reporting-deadline contract
exists (documented in `mart_data_quality.sql`).

**Common misinterpretations.** A blank quality cell is "no honest signal for that
dimension yet", not "zero quality." "Down" needs ≥3 days of silence — a few hours
past SLA is only "stale" (batch cadences idle overnight). The lineage here is a
summary; the real graph is dbt Docs.

**Talking points.** "Every number traces to a dbt artifact, an ingestion manifest,
or the quality mart — nothing is fabricated." · "Reconciliation is genuine
master-data agreement from the data-vault same-as links, not a made-up %." · "An
acknowledged test records *who* triaged it and *when* into the governance DB."

**Likely questions.**
- *"Where does completeness come from?"* Per-source rules in `mart_data_quality`
  (e.g. DHIS2 facilities-reporting-vs-expected), averaged.
- *"Why is a dimension blank for a source?"* That source carries no honest signal
  for it yet (e.g. no deadline contract → no timeliness).
- *"Is the lineage the full DAG?"* No — a summary here; click through to dbt Docs.

---

## 5. Models and datasets (`admin/models-datasets` → `adm-models-datasets`)

**What it is.** Two stacked sections (not tabs): **Model fleet health** (`MLHealth`)
on top and the **graduation review queue** (`Review`) below. Backends:
`.../app/routes/ml.py` and `.../app/routes/graduation.py`.

**The story.** "The platform runs real ML models and lets analysts graduate a
project to public. This page is where an operator watches the model fleet for drift
and failures, and where a reviewer approves a project to become public."

**Audience & decisions.** Operators + data stewards. Answers: which models are
drifting, failing, or overdue on their schedule? and: is this submitted project
ready to publish?

**One-line takeaway:** model-fleet vitals + the human gate for publishing a project
— every figure real-or-empty.

### 5a. Model fleet health (`MLHealth.tsx`)

- **KPIs (4):** Models monitored · Drifting now (≥1 drifted feature) · Failed last
  runs · Stale schedules (overdue vs cadence). Feed: `GET /api/ml/monitoring/fleet`.
- **Fleet table** (search, sort, page size 15): Model (+ `@alias`) · Last run
  (success/failed/running/no-runs + age) · Drift (`{drifted}/{checked} features ·
  max PSI`) · Performance (`{metric} {value}`) · Schedule (stale/on-schedule) ·
  Details / Open-in-workshop.
- **Expandable detail** (loads on expand): a **Feature drift** table (Feature ·
  Kind · PSI · threshold · KS · Status · Computed) from `GET
  /api/ml/{model}/drift`, and a **Performance over time** SVG chart from `GET
  /api/ml/{model}/performance`.
- A 404 on the fleet endpoint renders an honest "Fleet monitoring endpoint not
  available yet" panel — no fabricated fleet. There is **no** promote/retrain button
  in this widget (those endpoints exist in `ml.py` but this UI doesn't call them).
- Hardcoded deep-links only: Workshop model catalogue, Open MLflow registry.

### 5b. Graduation review queue (`Review.tsx`)

The unit of review is a **project** an owner submitted to become public
(project-centric graduation).

- **Left — queue** (page size 12): project name, `review_status` pill, an
  essentials ✓/missing badge, owner, submitted date. Feed:
  `GET /api/graduation/project-queue`.
- **Right — detail** (`GET /api/graduation/project/{id}`): status/visibility/
  essentials badges; Owner · Submitted · Files; an **essential-files checklist**
  (Requirement · Result present/missing/optional · Matched files); a **Files** list
  (File · Size · Modified); and a **Review history** trail (Verdict · Reviewer ·
  When · Note).
- **Reviewer actions:** **Open in JupyterLab** (`POST /api/workspace/spawn`, spawns
  a lab on the project so the reviewer can run its notebooks) · **Approve & publish**
  (`POST /api/graduation/project/{id}/approve`, optional comment — flips the project
  to public; surfaces the #45 catalogue-integration hook's reason if it no-ops) ·
  **Reject / request changes** (`POST /api/graduation/project/{id}/reject`, with a
  "request changes" checkbox + note). A 403 shows a "Reviewer access required" panel.
  There is no separate "promote" step — approval itself publishes.

**Honesty note.** No fabricated ML metrics or fake review rows — every value is a
live fetch, empty otherwise. The old artifact-centric graduation endpoints
(`/queue`, `/{id}/promote`) are retired and now 404; this widget is project-centric.

**Talking points.** "Drift is measured (PSI/KS vs thresholds), not asserted." · "A
reviewer can spin up a real JupyterLab on the project before approving." · "Approve
publishes the project; the model-catalogue integration is a downstream hook."

**Likely questions.**
- *"Can I retrain from here?"* Not in this widget (the backend supports it; the UI
  doesn't expose it).
- *"What does 'essentials missing' mean?"* The project is missing a required file
  (README/notebook/etc.) per the graduation checklist.

---

## 6. Backups & DR (`admin/backups`)

**Honest status:** the page is **registered in the catalog** (`admin/backups`,
title "Backups & DR", ordering 50) but has **no widget assigned** — the page file
lists no `widgets:`. There is no `adm-backups` widget directory. So this page
renders as an empty/placeholder page today. If asked, present it as a **planned
page, not yet built** — do not describe backup/DR features it does not have.

---

## 7. Users and Access (`admin/users-access` → `adm-users-access`)

**What it is.** The merged access-request queue **and** the live user directory —
review incoming public access requests, and browse/assign roles + data scope for
existing users. Backends: `.../app/routes/access_requests.py` (queue) and
`.../app/routes/perm_admin.py` (users/roles/scope). The former 412-fake-user mock
table was retired with this merge.

**The story.** "Access is governed end to end: a citizen or analyst requests access
on the public dashboard, an admin reviews it here, and on approval the system
provisions a real Keycloak account with the granted role and data scope and emails
a set-password link — no manual account creation."

**Audience & decisions.** Access administrators (`approve_access_request` +
`manage_users` → R-OPS-ADM, R-SUPER). Answers: who is waiting for access? who do we
grant, as what role, scoped to which region/programme? who has what today, and
should their roles/scope change?

**One-line takeaway:** the front door to the platform — request in, reviewed here,
provisioned automatically, with a live directory of who has what.

**Structure:** 4 KPI tiles (Pending / Approved / Declined / Resolved) → **Users**
panel → **Pending requests** table → **Recently resolved** table (+ `ReviewModal`).

### 7a. Users directory (`UsersPanel`)

There is **no flat user endpoint** — the directory is synthesised by calling
`GET /api/perm-admin/roles` then `GET /api/perm-admin/roles/{id}` for each role and
folding every role's `.users[]` into one row per `kc_sub`. Columns: **User**
(avatar + name + email) · **Realm · source** · **Roles** (each a pill; click the
`×` to revoke) · **Status** (active/revoked) · **Data scope** ("Scope…" opens an
inline editor) · **Assign role** (dropdown of roles not yet held). Editable inline:

- Assign role → `POST /api/perm-admin/user-roles`.
- Revoke role → `DELETE /api/perm-admin/user-roles?...` (with confirm).
- Data scope → `GET /api/perm-admin/user-scope/{kc_sub}` / `PUT
  /api/perm-admin/user-scope` — per-user row-level narrowing over five dimensions
  (`geography, programme, facility, artifact_tier, workshop_group`), intersected
  with the role scope; empty = unrestricted. This writes `ops_identity.user_scope`,
  the table OPA row-filters on.

User identity (name/email) is **not** editable here; a 403 shows a "needs
`manage_users`" banner.

### 7b. Pending requests + review

The queue table (from `GET /api/admin/access-requests?status=pending`) shows: **ID**
(tracking `AR-YYYY-NNNN`, + a green **Fayda** pill when the request was
Fayda-verified) · **Submitted** · **Applicant** · **Organisation** · **Requested
dashboards** · **Purpose** · **SLA** · **Review**. **Recently resolved** shows
ID · Resolved · Applicant · Decision · Account (Provisioned / Not provisioned) ·
Notes.

**ReviewModal** — decision buttons **Approve / Decline / Request info**. On
Approve, the reviewer picks a **Granted role** (a curated list:
R-CONS-ANA/SCI/RES/PRT, R-DEC, R-STEW, R-PROD-CLIN, R-PROD-SUBMIT), a **Region
scope** (`all` + the 14 Ethiopian regions with 2-letter ids), and a **Programme
scope** (`all, HIV, TB, EPI, MNCH, NCD, Malaria, FP, Nutrition`), plus a note.
Submit → `POST /api/admin/access-requests/{id}/decide`. On **approve with a
granted role**, the backend `_provision_account` creates the Keycloak account,
assigns the realm role, writes the coherent ops rows under the same `kc_sub`
(`ops_identity.user`, `ops_perm.user_role`, `ops_identity.user_scope`), and emails
a set-password link; a separate `POST …/provision` is the retry seam if inline
provisioning failed.

**Honesty note.** All of the above is live. **Two things to know:** (1) the pending
table's **SLA column is a hardcoded "—"** — `_shapePending` sets `sla:'—'` for
every row, so no real SLA countdown is computed even though the lede mentions a
2-business-day SLA. (2) The SPA still carries vestigial mock email-preview strings
(a fake `nhdw.local/login/setup` link) and a `duration` field that the modal
**never renders or sends** — the real email is sent server-side; don't demo those.

**Talking points.** "Request → review → automatic provisioning, all governed." ·
"Approving with a role literally creates the Keycloak user, assigns role + region/
programme scope, and emails them — no manual account admin." · "The directory is the
*live* `ops_perm` role assignments, not a static list." · "Per-user data scope here
is what OPA uses to filter rows."

**Likely questions.**
- *"What's the Fayda pill?"* The applicant verified their identity via the Fayda
  (national ID) popup on the public form; a National-ID/Passport number is recorded
  as "pending manual verification", never as verified.
- *"Does approval create the account?"* Yes, when a role is granted — Keycloak +
  ops rows + set-password email, in one transaction-coherent flow.
- *"What's the SLA column?"* Currently a placeholder dash (_requires confirmation_
  on whether a real SLA is computed anywhere).

---

## 8. Roles and Permissions (`admin/roles-permissions` → `adm-roles-permissions`)

**What it is.** The role editor for the 4-axis permission model, the
permission-change audit trail, and a live OPA "what-if" policy tester. Backends:
`.../app/routes/perm_admin.py` (roles/grants/audit) and `.../app/routes/policy.py`
(OPA evaluate). The widget & filter *catalogs* were moved to Dashboard Control.

**The story.** "Authorization is a real, editable, audited model in the ops DB —
not hardcoded. An admin edits a role's access here; every save is versioned; and
you can simulate any role against any resource/action to see the OPA decision."

**Audience & decisions.** Security / access administrators (`manage_users` to
browse, `edit_roles` to save → R-OPS-ADM, R-SUPER). Answers: what can each role
see and do? who holds each role? and: would role X be allowed to do Y on Z?

**One-line takeaway:** the live, audited RBAC editor plus an OPA decision simulator
— DB-backed, with an honest, disclosed gap to the hand-authored OPA policy.

**Structure — three sections:**

1. **Roles & grants** — a roles master list (Code, Name, Users count; a "no-OPA"
   pill marks roles with no rego policy) and a per-role editor. Feeds:
   `GET /api/perm-admin/roles`, `GET /api/perm-admin/roles/{id}`,
   `GET /api/perm-admin/catalog`.
2. **Permission-change audit** — read-only trail (When · Actor · Table · Op ·
   Target · Revision). Feed: `GET /api/perm-admin/audit?limit=100`.
3. **Policy enforcement (OPA)** — a "Test policy" card: pick a role, resource
   (PT/PRG/FAC/HP/PRD), and action → `POST /api/policy/evaluate` → shows
   ALLOWED/DENIED, reason, rule hits, masked columns, obligations, and the
   evaluated-for context (role, geographies, programmes). Read/evaluate only.

**The permission model (as the UI expresses it).** A role has:

- **Capabilities** — app-level powers (e.g. `manage_users`, `view_ops_console`,
  `edit_roles`, `assistant:run_sql`), toggled as pills. (The pill list is an
  SPA-curated catalog; a role can hold a capability not shown, which round-trips
  untouched as a green ✓ pill.)
- **Axis A — dashboards** (`ops_perm.role_dashboard`): which dashboards the role
  can open.
- **Axis C — widget grants** (`ops_perm.role_widget`): which widgets, grouped by
  dashboard (a checked widget is granted across every page of that dashboard,
  because the catalog exposes no page/section placement here).
- **Data scope** (`ops_perm.role_scope`, the #50b replacement for the retired
  Axis B/D filter grants): per-dimension allowed values
  (`geography, programme, facility, artifact_tier, workshop_group`), resolved at
  runtime as **role_scope ∩ user_scope**; a dimension left empty = unrestricted.
- **Assigned users** (`ops_perm.user_role`): holders, with per-row revoke and an
  assign control.

**Where it saves.** Metadata/capabilities → `PUT /api/perm-admin/roles/{id}`; the
grant axes → `PUT /api/perm-admin/roles/{id}/grants` (atomic replace, returns a
`revision_id`); user assignment → `POST`/`DELETE /api/perm-admin/user-roles`. New
role → `POST /api/perm-admin/roles`; delete → `DELETE …/{id}` (cascades grants).
Separately, there is a reusable **data-access permission store**
(`ops_perm.permission` + `role_permission`, schema
`3_storage/postgres/init/32_permission_store.sql`): one
row per distinct OPA allow-rule tuple (subject ∈ PT/HP/FAC/PRD/PRG, members,
granularity, verbs, purposes, data_classes, sensitivity), granted M:N to roles —
`compile.py --from-db` emits the rego from these.

**The disclosed gap (say this plainly).** Saving here writes the **DB grant model
only**. It does **not** push an OPA bundle. OPA row/column enforcement for a role
still requires a hand-authored `7_security/opa/policies/<role>.rego` + a dispatch
line — the UI says so in a banner and in the new-role form. So a brand-new role's
DB grants shape the dashboard/widget surface, but mart-backed (OPA-gated) widgets
**fail closed** for it until a platform engineer adds its rego. Every DB write is
versioned (`policy_revision`) and audited (`audit_permission_change`).

**Honesty note.** No fake rows. Several hardcoded arrays are *vocabulary/config*,
disclosed in the code: the capability pill catalog, the set of OPA-enforced role
codes (drives the "no-OPA" pill), a widget-id-prefix→dashboard map, the scope
dimensions, and the OPA-tester's role/resource/action option lists. The policy
decision itself is computed live by the gateway.

**Talking points.** "Authorization is data, editable and audited — not code you
redeploy." · "Every save is a numbered policy revision you can trace in the audit
tab." · "The OPA tester lets you prove 'this role would be denied that' before you
ship." · "There's an honest gap: DB grants ≠ OPA rego; a new role needs a rego file
before row-level security applies."

**Likely questions.**
- *"If I grant a role a mart widget here, can it read the data?"* Only if the role
  also has an OPA policy — otherwise the mart-backed widget fails closed.
- *"Can I edit the rego from here?"* No — OPA is *tested* here, *authored* in the
  repo.
- *"Is scope per-role or per-user?"* Both — the effective scope is role_scope ∩
  user_scope (user scope is edited on the Users page).

---

## 9. SSO & Identity (`admin/sso` → `adm-sso-cards`)

**What it is.** A live CRUD grid over the federated **identity-source catalog**
(`ops_identity.identity_source`) — one card per identity provider. Backend:
`.../app/routes/perm_admin.py` (`/identity-sources`). Note: these cards are
**identity providers, not deep-links to tools** (the tool links live on the
Documentation page).

**The story.** "Every way a person can sign in — direct Keycloak accounts, the
national Fayda ID for citizen verification, social login, and SAML federations with
partner agencies — is catalogued here and editable. Dashboards only ever see
Keycloak tokens; these are the upstream sources that feed Keycloak."

**Audience & decisions.** Security administrators (`manage_identity_sources` →
R-OPS-ADM, R-SUPER). Answers: what identity sources exist, which are active, and how
is each configured? Supports the "onboard a partner via SSO" demo.

**One-line takeaway:** the editable catalog of federated login/identity sources —
DB-backed today, with Keycloak sync explicitly stubbed until P6.

**Structure.** A header count ("N total · N active · N available · N disabled",
computed from the fetched data) + "New IdP", then a `grid-3` of cards. Feed:
`GET /api/perm-admin/identity-sources`. Each card shows: name + status pill
(active=green, available=neutral, disabled=amber), `code · kind · PROTOCOL`, and
conditional detail lines (Keycloak alias, Realm, Issuer, EntityID, Client ID,
purpose). Actions: **Configure** (edit modal), **Disable/Activate** (toggle status),
**delete** (✕, with confirm). Editor modal fields: Code, Display name, Kind
(`direct/oidc/saml/social/fayda`), Protocol (none/OIDC/SAML 2.0), Status, Keycloak
alias, and a raw `config_json` JSON textarea. Writes: `POST` / `PUT
/{id}` / `DELETE /{id}` under `/api/perm-admin/identity-sources`.

**Which cards appear (seeded).** From
`bundle/seed-pack/app/security/identity_sources.yaml`, seven
sources load: **FMoH Direct (Keycloak)** `moh-staff-direct` — direct, active ·
**Fayda (Ethiopian National ID)** `fayda` — oidc, active (verification-only, not a
login realm) · **Google** `google` — social/oidc, active · **Microsoft**
`microsoft` — social, available · **EHIA SAML Federation (mock)** `ehia-saml` —
saml, active · **WHO Azure AD** `who-azure` — saml, available · **AAU MoSHE
Federation** `aau-moshe` — saml, available. (The `available` ones are catalog-only;
`active` ones are wired end-to-end per the seed's header.)

**Role-gating on the cards: NONE in the UI** — the whole page is gated at the
gateway by `manage_identity_sources`; there is no per-card role filter. The card
icon is chosen by a hardcoded `iconFor` map keyed on the code (fayda→shield,
ehia→hospital, who→globe, …) — icon only; the card data is fetched.

**Honesty note (important stub).** Saving here **updates the DB catalog only** — the
Keycloak Admin API call that would actually create/update the IdP inside Keycloak is
**stubbed** (the backend logs a warning; "real integration ships in P6"). This is
disclosed both in the page lede and inside the editor modal. So: the catalog is
real and editable; the live wiring into Keycloak for *new* edits is not yet
connected.

**Talking points.** "Every login path is catalogued and editable — direct, Fayda,
social, SAML." · "Fayda here is *verification*, not a 'sign in with Fayda' — it
pre-fills a public access request and sets `verified_via='fayda'`." · "Partner
onboarding (e.g. EHIA/WHO SAML) is a card you activate." · "Be honest: editing a
card updates the DB catalog; the Keycloak apply step is P6."

**Likely questions.**
- *"If I add an IdP here, can people log in with it immediately?"* Not yet — the DB
  row is written; the Keycloak sync is stubbed until P6.
- *"Do dashboards see Fayda/SAML directly?"* No — always Keycloak tokens with
  normalised claims.

---

## 10. Documentation (`admin/documentation` → `adm-documentation`)

**What it is.** The operator's reference page: live deployment facts + feature
flags, the gateway's API reference, the curated system docs (served real from
MinIO), and one-click deep-links to every operator tool on the existing session.
Backends: `GET /api/observability/env` (env) and `GET /api/docs` (docs, from the
MinIO `nhdw-docs` bucket — see `.../app/routes/docs.py`).

**The story.** "Everything an operator needs to reason about this deployment,
in one place, and all real: what this instance is, where the API contract lives, the
actual system documentation served from the data lake, and every console one click
away — no second login."

**Audience & decisions.** Operators (`view_ops_console`). Answers: what exactly is
this deployment (name/namespace/domain/TLS/build)? which feature flags are on?
where's the API spec? where are the docs? how do I jump to Airflow / MLflow /
Grafana-style tools?

**One-line takeaway:** the operator's real, self-describing reference and tool
launcher — env, API, docs from the lake, and SSO tool links.

**Structure — four sections:**

- **This deployment** — an env table (**Name, Namespace, Base domain, TLS, Gateway
  build**) + a **Feature flags** table (label + on/off pill). Feed:
  `GET /api/observability/env`. "Read-only here · changes go through CI/CD."
- **API reference** — a link card to the gateway's live Swagger UI
  (`https://gateway.127.0.0.1.nip.io/docs`, FastAPI OpenAPI, behind your session).
- **System documentation** — the **real** curated docs, served from MinIO
  `nhdw-docs` via `GET /api/docs` (a `docs-index.json` catalogue with
  name/title/section/description/size). Grouped by section with filter chips; each
  doc opens in an in-app markdown viewer (`GET /api/docs/{name}`) or downloads
  (`?download=1` → presigned URL). Degrades honestly if the feed is down.
- **Operator tools** — a curated deep-link grid (config, not data). Each tile opens
  on the existing Keycloak session (realm `privileged-ops`). Tiles are
  **role-gated client-side**: `currentRoles()` decodes the JWT already on `window`
  (no extra fetch) and a tile with a `roles:` list is hidden unless the signed-in
  role matches its tool-gate `ALLOWED_ROLES`, so a shown tile never lands on a 403.
  The ten tiles and their gating:

  | Tool | Role-gated to | Notes |
  |---|---|---|
  | dbt Docs | (all ops) | model lineage / compiled DAG |
  | Airflow | (all ops) | pipeline & ML batch orchestrator |
  | MLflow | R-OPS-ADM, R-SUPER | experiment tracking / registry |
  | MinIO Console | (all ops) | data lake + `nhdw-docs` |
  | Cluster console (Headlamp) | (all ops) | k8s control (edit in `nhdw`) |
  | Prometheus | (all ops) | metrics store/query |
  | Alertmanager | (all ops) | alert routing/silences |
  | Jupyter | R-SUPER | moh-staff realm tool |
  | Superset | R-SUPER | self-service SQL/BI (Trino) |
  | Keycloak | (all ops) | IdP admin console |

**Honesty note.** Env facts, feature flags, and the system docs list/content are
all **fetched and degrade honestly**. The Swagger URL, the realm, the tool-tile
deep-links, and the icon/field maps are legitimate **config**, not fabricated data.

**Talking points.** "The deployment facts and feature flags are live from the
gateway, not a slide." · "The docs are the actual repo docs, served from the data
lake — open or download them here." · "Every tool opens on your existing session —
no re-login — and tiles you're not allowed to use are hidden, not 403'd."

**Likely questions.**
- *"Are these docs the real ones?"* Yes — served from MinIO `nhdw-docs`, uploaded at
  boot.
- *"Why don't I see the MLflow / Jupyter tile?"* Role-gated — your role isn't in
  that tool's allow-list, so it's hidden to avoid a 403.

---

## Requires confirmation

Items below could not be fully pinned down from the code/config read for this guide.
Verify before asserting them on stage.

1. **Topology traffic — is Hubble actually deployed in the demo?** The `gateway_log`
   traffic (from `ops_audit.gateway_log`) is confirmed real and always present. The
   second provider `HubbleFlowProvider` (Cilium eBPF via Prometheus job `hubble`)
   is real *if* that stack is running; whether the k3d demo actually deploys
   Cilium/Hubble + Prometheus so non-gateway edges get live traffic is not
   confirmed here. (The gateway edges are real regardless.)
2. **Loki / metrics-server / kubelet-stats availability in the demo.** Node error
   badges (Loki), live CPU/mem (metrics-server), and PVC/ephemeral storage (kubelet
   Summary API) are all fetched fail-soft — they render real numbers *if* those
   components + RBAC are present, and an honest "unavailable" otherwise. Which are
   actually up in the demo cluster is unconfirmed.
3. **Alert delivery vs. routing config.** The routing rules and active-alert feed
   are confirmed. Whether Alertmanager is wired to *physically deliver* to the
   configured channels (PagerDuty/Slack/email) in the demo — and whether an
   `ALERTMANAGER_URL` is set — is not confirmed (the widget only manages routing +
   reads Prometheus alerts).
4. **Pending-request "SLA" column.** Confirmed to render a hardcoded "—"
   (`_shapePending` sets `sla:'—'`). Whether any real SLA/countdown is computed
   elsewhere (or is simply not implemented) is unconfirmed — present the column as a
   placeholder.
5. **Documentation "Feature flags" — which flags, and their meaning.** The widget
   renders whatever `GET /api/observability/env` returns as `feature_flags`; the
   specific flag keys/labels and semantics were not read for this guide (route
   `observability.py` not inspected). Don't enumerate specific flags without
   checking.
6. **SSO → Keycloak apply is a stub.** Confirmed from code that saving an identity
   source updates the DB catalog only and the Keycloak Admin API sync is stubbed
   ("ships in P6"). Confirm the current state before claiming a card edit changes
   real login behaviour.
7. **Backups & DR page.** Confirmed to have no widget in the current catalog.
   Confirm whether any backup/DR functionality is intended to be demoed at all
   before mentioning it.
8. **Exact live vs. catalog-only identity sources at demo time.** The seed marks
   `moh-staff-direct / fayda / google / ehia-saml` as wired end-to-end and
   `microsoft / who-azure / aau-moshe` as catalog-only; confirm this still holds in
   the running instance (an operator may have toggled statuses, since the grid is
   live CRUD).
