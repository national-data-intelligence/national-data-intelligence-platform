# Public Portal — Presenter's Guide

> Part of the NHDW Dashboard Presentation Guide — see [README.md](README.md)

This guide documents the **Public dashboard** (the anonymous citizen / open-data
portal) of Ethiopia's National Health Data Warehouse (NHDW) so a presenter can
explain it confidently in a meeting. Every statement below is grounded in the
actual code, catalog, SQL, and API routes in the repository; file paths are
absolute. Anything the code did not let me verify with certainty is collected in
the **Requires confirmation** section at the end rather than guessed.

## What the Public portal is (one paragraph)

The Public portal is a **separate, deployed single-page app (SPA)** — anonymous,
read-only, **no login, no PHI**. It is the public face of NHDW: credible national
health numbers, an open-data catalogue, and a newsroom, all served from
**k-anonymised public marts (`bi_public.*`)** where any group representing fewer
than 5 reporting facilities is suppressed (k ≥ 5). The whole app resolves against
one role, **`R-PUB-ANON`**; the gateway maps anonymous traffic to that role and
enforces the widget grant plus an OPA mart gate before any mart is touched.

- SPA source: `6_access-points/dashboards/public/ui/src/`
- App server (FastAPI): `6_access-points/dashboards/public/app/main.py`
- Gateway data fetchers: `6_access-points/api/nhdw-gateway/app/fetchers.py`
- Dashboard catalog: `6_access-points/dashboards/public/catalog/`

### Data seam (how a widget gets real numbers)

Every data-driven public widget follows the same fallback-safe pattern
(`.../ui/src/hooks/widgetData.ts`, `useArticles.ts`, `useDatasets.ts`):

1. The SPA calls its **own FastAPI backend** at `/api/proxy/...` (same-origin).
2. The backend forwards **server-side** to the `nhdw-gateway` with **no auth
   header** → the gateway treats it as `R-PUB-ANON`, checks the widget grant on
   dashboard `public`, and applies the OPA mart gate.
3. On **any** failure (network, non-200, empty rows, permitted-stub), the widget
   silently renders its **bundled static fallback** so the page never breaks.

> Presenter note: this means a widget can look populated even when the live
> gateway/mart is unavailable — it is showing a bundled fallback, not live data.
> The fallbacks are honest published figures, not invented deltas, but they are
> not the live warehouse numbers.

### The actual page composition (source of truth)

The **runtime** composition lives in
`6_access-points/dashboards/public/ui/src/runtime/pages.ts`
and is what actually renders:

| Page (nav) | Full-bleed | Content widgets |
|---|---|---|
| **home** | `pub-hero` | `pub-newsroom`, `pub-insights` |
| **data** ("Open data") | — | `pub-data-catalogue` |
| **articles** | — | `pub-articles` |
| **article** (transient reading view, not in nav) | — | `pub-article-view` |

Persistent chrome around every page: `pub-govbar` (top), `pub-footer` (bottom).
Two overlays: `pub-dashboards-modal` (the "Dashboards" button) and
`pub-access-modal` (the "Request access" button).

> Note on the YAML catalog: the descriptive catalog under
> `.../public/catalog/pages/*.yaml` lists widget ids `pub-region`, `pub-supply`,
> and `pub-articles-list`. These are **not** separate rendered widgets — the
> runtime composes only the widgets in the table above. `pub-region` and
> `pub-supply` are **data seams consumed inside `pub-insights`** (see below), and
> `pub-articles-list` corresponds to the `pub-articles` widget. Treat
> `runtime/pages.ts` as authoritative when there is a discrepancy.

---

## 1. Page-level overview

### Home page (`public/home`)

- **What it is:** the national headline — the trustworthy 30-second read.
- **Story it tells:** "Ethiopia's health data, in one place." A branded hero,
  the latest bulletins, and the national/regional health indicators with a
  privacy-and-trust posture made visible rather than hidden.
- **Target audience:** the general public, journalists, and partners/donors
  glancing at national performance.
- **Decisions/actions it supports:** whether the country is on track against its
  own plan (HSDIP targets); which regions lag (equity); where to go next (open
  data or bulletins).
- **One-line takeaway:** *credible national health numbers, privacy-protected and
  disaggregated to region, that the public can cite.*

### Open Data page (`public/data-catalogue`, nav label "Open data")

- **What it is:** a browsable catalogue of governed, aggregate datasets you can
  preview in the browser and download as CSV.
- **Story it tells:** the open-government / transparency differentiator — a
  warehouse hands you the governed dataset behind the number, not just the number.
- **Target audience:** researchers, journalists, and partner analysts who need
  reusable, citation-quality data.
- **Decisions/actions it supports:** find, preview, and download a dataset;
  request facility-level access for anything below the public aggregate tier.
- **One-line takeaway:** *published, CC-BY-4.0, k≥5-protected datasets cut once
  from the warehouse and served as citable snapshots.*

### Articles page (`public/articles`, nav label "Articles")

- **What it is:** a public-health newsroom — bulletins, press releases,
  advisories, programme notes, and research explainers.
- **Story it tells:** data turned into stories the public understands.
- **Target audience:** the general public and press.
- **Decisions/actions it supports:** read and filter public-health communications;
  open a full article.
- **One-line takeaway:** *the ministry's public-health communications in one
  filterable feed.*

---

## 2. Sections (per page)

### Home — "National headline" (the `pub-insights` KPI grid + trust tile)
- **Purpose:** show the recognised official indicators against their national
  plan targets, with a data-confidence signal.
- **How to interpret:** each tile is a coverage/outcome rate versus its HSDIP (or
  programme) target; tone (good/watch/alert) is computed from the value-to-target
  ratio. The "Data confidence" tile is reporting **completeness**, deliberately
  kept out of the coverage tiles.
- **Questions it answers:** are we on track? Against what target? How complete is
  the data behind the number?
- **Presentation message:** "These are the indicators the public already knows —
  and we show the data-quality signal behind each, not just the headline."

### Home — "Equity & trend" (the region bar + 24-month trend, inside `pub-insights`)
- **Purpose:** regional disaggregation (equity) and direction of travel over time.
- **How to interpret:** the bar shows coverage indicators across regions (sorted
  so the worst-served are visible); the line shows the last 24 months of coverage
  indicators nationally.
- **Questions it answers:** which regions are behind? Is the trend improving?
- **Presentation message:** "Regional equity is the strongest public story here —
  and every regional cell is still k≥5-protected."

### Home — "What's happening" (`pub-newsroom`)
- **Purpose:** surface the three most recent bulletins/press/advisories.
- **Presentation message:** "The newsroom is driven by the same published article
  store as the Articles page — one bulletin looks identical wherever it appears."

### Open Data — "Open datasets" (`pub-data-catalogue`)
- **Purpose:** a searchable master–detail register of published datasets with an
  in-browser preview and download.
- **Presentation message:** "Governed, aggregate, privacy-protected — with
  provenance and a real row count, not a vanity catalogue number."

### Articles — the feed (`pub-articles`)
- **Purpose:** a featured carousel plus a filterable grid of all articles.
- **Presentation message:** "A proper newsroom: search, category, topic, date
  range, and pagination over the ministry's public content."

---

## 3. Widgets (detail)

### `pub-govbar` — government top bar / navigation
- **File:** `.../ui/src/widgets/pub-govbar/index.tsx`
- **Purpose:** persistent brand + primary nav + the two call-to-action buttons.
- **Business meaning:** the site's wayfinding and the entry to access-request and
  dashboards.
- **Data source:** none — static chrome. Reads `active`/`setPage`/`openModal`
  from the SPA host.
- **Fields shown:** FMoH logo, "NHDW", tagline "Federal Ministry of Health ·
  Ethiopia"; nav links Home / Open data / Articles; buttons "Request access"
  (opens `pub-access-modal`) and "Dashboards" (opens `pub-dashboards-modal`).
- **How to interpret:** "Dashboards" and "Request access" are the only routes off
  the anonymous portal toward the protected surfaces.
- **Talking point:** "One bar, three public pages, and two doors to the governed
  system — request access, or open a dashboard you already have."

### `pub-hero` — masthead / hero panel
- **File:** `.../ui/src/widgets/pub-hero/index.tsx`
- **Purpose:** branded hero with an animated dot-globe and the site promise.
- **Business meaning:** first impression and the trust posture.
- **Data source:** **none in the current widget — it is fully static.** The globe
  is an animation (`hooks/heroGlobe.ts`); the copy and the trust ribbon are
  hardcoded. (A `pub-hero` **gateway fetcher does exist** — it counts regions and
  facilities from `bi_public.bi_facility_distribution_public`, `fetchers.py`
  ~L824 — but the current hero component does **not** call `useWidgetData`, so
  those live counts are not displayed. See Requires confirmation.)
- **Fields shown:** eyebrow "Public health information service"; H1 "Ethiopia's
  health data, in one place." + Amharic subtitle; a lede; a **trust ribbon**
  "Privacy-protected national health data" (tooltip: "Aggregate and
  privacy-protected, k-anonymity at least 5, sourced from national health
  systems"); two buttons — "Open the data catalogue" → data, "Read the latest
  bulletins" → articles.
- **How to interpret:** decorative, but the trust ribbon is the credibility claim
  — aggregate, k≥5, national sources.
- **Limitations / misinterpretations:** there is **no live "last refreshed"
  timestamp** in the current hero (an earlier "Refreshed 4 minutes ago" string
  was removed). Do not claim a live freshness counter.
- **Talking point:** "The governance posture is the headline, not the fine print
  — privacy-protected, aggregate, from national systems."
- **Likely question — "Is this real-time?"** No. It is a static masthead; the live
  numbers are on the insights section below.

### `pub-insights` — KPI tiles + equity bar + 24-month trend
- **File:** `.../ui/src/widgets/pub-insights/index.tsx`
- **Purpose:** the data heart of the home page — national indicators, regional
  equity, and the trend.
- **Business meaning:** national accountability against the HSDIP plan.
- **Data sources (three live seams, all `bi_public`, all fallback-safe):**
  1. **KPI tiles + trend** — widget id `pub-insights` → gateway fetcher
     (`fetchers.py` ~L834) over **`bi_public.mart_public_indicator_kpis`**
     (model: `2_pipelines/marts/models/hmis_coverage/public/mart_public_indicator_kpis.sql`).
  2. **Equity bar** — widget id `pub-region` → same mart, region × coverage
     indicator, **latest month** (`fetchers.py` ~L860).
  3. **Service-readiness strip** — widget id `pub-supply` → gateway fetcher
     (`fetchers.py` ~L850) over **`bi_public.mart_supply_stockout_public`** plus
     facility-distribution totals.
- **Fields shown per KPI tile:** label, value (`rate_pct` rounded to whole %),
  MoM delta vs prior month (in percentage points), target line
  (`<source> target <value>%`), and — when present — a "facilities reporting"
  confidence line and a definition tooltip.
- **The eight KPIs (from the committed reference seed, NOT hardcoded in the UI):**
  source is
  `2_pipelines/marts/seeds/public_indicator_reference.csv`
  (rows `WHERE is_public_kpi`). In seed order:

  | # | Indicator | Programme | Kind | Target | Direction | Target source |
  |---|---|---|---|---|---|---|
  | 1 | Penta3 coverage <1y | EPI | coverage | 95% | higher better | HSDIP 2023-2030 |
  | 2 | ANC4 coverage | MNCH | coverage | 81% | higher better | HSDIP 2023-2030 |
  | 3 | Skilled birth attendance | MNCH | coverage | 76% | higher better | HSDIP 2023-2030 |
  | 4 | Modern contraceptive prevalence | FP | coverage | 50% | higher better | HSDIP 2023-2030 |
  | 5 | TB treatment success | TB | outcome | 90% | higher better | End TB / HSDIP |
  | 6 | ART viral suppression | HIV | outcome | 95% | higher better | 95-95-95 / HSDIP |
  | 7 | Under-5 stunting | NUTRITION | outcome | 25% | **lower better** | SDG 2.2 / HSDIP |
  | 8 | Reporting completeness | (OTHER) | **trust** | 95% | higher better | HSDIP 2023-2030 |

  The **eighth is a "trust" tile, not a coverage tile** — it is HMIS reporting
  completeness (share of expected facility reports received), rendered as a
  separate "Data confidence" card with a meter, explicitly labelled "Reporting
  completeness, not a coverage rate."
- **Calculation logic (KPI value):** `mart_public_indicator_kpis` is
  region × indicator × month; the region rate is the **facility-reporting-weighted
  mean** of the woreda-grain achievement rate from
  `mart_hmis_indicator_coverage`. The public **fetcher** rolls regions up to a
  **national** figure with the same facilities-reporting weighting:
  `ROUND(SUM(rate_pct * facilities_reporting) / NULLIF(SUM(facilities_reporting),0), 1)`.
  The tile shows the **latest month**; the delta is latest minus prior month.
- **Aggregation / period / geo:** national (KPI tiles + trend) and regional
  (equity bar); monthly; last 24 months for the trend, latest month for the bar.
- **k-anonymity:** enforced in the mart — any region × indicator × month cell with
  `SUM(facilities_reporting) < 5` is dropped (`HAVING ... >= 5`).
- **Provenance:** every value traces `mean_value → mart_hmis_indicator_coverage →
  business vault → raw vault → staging → DHIS2 dataValues` (documented in the
  mart header).
- **Service-readiness strip fields:** total health facilities and region count
  (from `bi_facility_distribution_public`), plus commodity availability
  (`stocked_pct`) and "N/M supply hubs stocked" from `mart_supply_stockout_public`.
  A facility/hub counts as "stocked" if at least one tracked commodity has
  `projected_days_remaining >= 30` at the latest snapshot; stockout is national
  (see limitation).
- **Offline fallback:** `KPIS_FALLBACK` in the widget uses **real published EDHS
  2024-25 / programme figures** (e.g. Penta3 40%, ANC4 53%, SBA 64%) with **no
  fabricated month-on-month deltas** — shown **only** when the gateway returns
  nothing. These fallback values differ from the live mart values and should not
  be quoted as the warehouse's live numbers.
- **Limitations / common misinterpretations:**
  - The **KPI values are computed from the seeded source replicas**, so exact
    percentages depend on the demo's seed data. Do not memorise specific live
    percentages — read them off the running dashboard.
  - `mart_supply_stockout_public` is **national only** (its region column is the
    literal `'National'`) — there is no honest region breakdown for stockout
    today (the mart header explains why: no facility→region bridge in the HCMIS
    vault). The "regions" number in the readiness strip comes from facility
    distribution, not from stockout.
  - Completeness is **not** coverage — do not read the trust tile as a coverage rate.
- **Talking points:** "Official HSDIP indicators, each with the count of
  facilities behind it and a one-tap definition"; "regional equity, k≥5-protected";
  "the completeness tile is a data-quality signal, deliberately separated."
- **Likely questions:**
  - *"Where do these numbers come from?"* DHIS2 (HMIS), through the vault into the
    public `bi_public` marts; supply from HCMIS.
  - *"Can I see a single facility?"* No — public marts are aggregate and k≥5.
  - *"Why HSDIP and not HSTP-II?"* The targets are attributed to HSDIP 2023-2030
    in the reference seed.

### `pub-newsroom` — "What's happening" (3-card home strip)
- **File:** `.../ui/src/widgets/pub-newsroom/index.tsx`
- **Purpose:** the three most recent articles as cards on the home page.
- **Data source:** `useArticles()` → `/api/proxy/articles?limit=100` (public app)
  → gateway `/api/public/articles` → **`ops_governance.public_article`** table.
  Falls back to the bundled `ARTICLES` when the gateway returns nothing.
- **Fields shown:** category tag, date, title, summary/excerpt, "Read more".
  Clicking opens the full `pub-article-view`.
- **Aggregation/period:** the first 3 of the newest-first article list.
- **Limitations:** editorial content, not a warehouse metric. Articles can carry
  an optional `linked_widget` field (3 of the 10 seeded articles set it), but the
  current newsroom card does not render a live embedded chart.
- **Talking point:** "One article store powers both the home strip and the
  Articles page, so a bulletin is consistent everywhere."

### `pub-data-catalogue` — Open Data catalog (master–detail)
- **File:** `.../ui/src/widgets/pub-data-catalogue/index.tsx`
- **Purpose:** browse, preview, and download published datasets.
- **Data source:** `useDatasets()` → `/api/proxy/catalogue` (public app) →
  **MinIO object `nhdw-static/catalogue.json`**, materialised by the publish job
  `2_pipelines/marts/publish_public_datasets.py` from
  the `bi_public.*` marts. Falls back to the bundled `DATASETS` (12 rows) if the
  manifest is unavailable.
- **The published datasets (defined in the publish script — 8 today):** D-001
  national coverage indicators by region (`mart_public_indicator_kpis`, DHIS2/HMIS),
  D-002 programme reporting summary (`mart_public_summary`), D-003 facility
  distribution (`bi_facility_distribution_public`, MFR/DHIS2 org-units), D-004
  commodity availability (`mart_supply_stockout_public`, HCMIS/EPSS), D-005
  notifiable-disease surveillance (`mart_public_disease_surveillance`, IDSR/EWARS),
  D-006 health workforce density (`mart_public_workforce`), D-007 data-quality
  scorecard (`mart_public_data_quality`), D-008 zero-dose reach index
  (`mart_public_zero_dose`).
- **Per-entry metadata exposed:** title, tier (aggregate / facility-level /
  bulletin), primary topic, description, row count, column count, updated month,
  licence (CC-BY 4.0 default), and provenance carried in the manifest
  (`source_system`, `grain`, `k_anonymity: 5`, `last_refresh`, `download_url`,
  `doi`).
- **Preview / Schema tabs:** Preview calls
  `/api/proxy/datasets/{id}/preview?rows=40` → the app streams the first N rows of
  `nhdw-static/datasets/{id}.csv` from MinIO (default up to 200). Schema infers a
  column type (identifier/date/decimal/integer/text) from the sampled values —
  this is a **client-side heuristic**, not the mart's declared type.
- **Download:** the "Download CSV" button links to `download_url` from the
  manifest — a **direct MinIO public URL** to the pre-generated CSV (or a
  disabled/no-op link if the manifest has no URL).
- **Filters:** free-text search (title/desc/topic), tier tabs, topic select, sort
  (recently updated / most rows / title A–Z), plus dataset-list pagination
  (7/page) and preview-row pagination.
- **Header count:** "N curated datasets" where N = the number of catalogue entries
  loaded (live manifest count, or 12 from the fallback).
- **Footer note:** "CC-BY 4.0 · k-anonymity ≥ 5 · aggregated to woreda or coarser"
  and a "Request facility-level access" link that opens `pub-access-modal`.
- **Limitations / misinterpretations:**
  - When the gateway/MinIO is unreachable, the widget shows the **bundled 12-row
    fallback** and a **sample preview table** (synthetic rows) — clearly a design
    harness, not real data.
  - The fallback DATASETS list is different content from the 8 published datasets;
    the **live** catalogue is the 8 from the publish script.
- **Talking point:** "Suppression is applied once at publish; these are citable,
  decoupled snapshots — the CKAN / data.gov pattern."
- **Likely questions:**
  - *"How current is a dataset?"* The manifest carries `last_refresh`; the job runs
    after the dbt marts build (cadence — see Requires confirmation).
  - *"Can I get facility-level data?"* Not from the public tier — request access.

### `pub-articles` — Articles newsroom page
- **File:** `.../ui/src/widgets/pub-articles/index.tsx`
- **Purpose:** the full article feed with a featured carousel and filtering.
- **Data source:** `useArticles()` — same `ops_governance.public_article` store
  as the newsroom.
- **Fields shown:** a dark featured hero band cycling the **newest 5** articles
  (prev/next + dots); a unified filter bar (search, category, topic from tags,
  date range: any / last 30 / last 90 / this year, sort: newest / oldest /
  title A–Z); a 3-column card grid (6/page) with numbered pagination.
- **Categories:** `PHEM`, `Press`, `Advisory`, `Programme`, `Research`
  (`ARTICLE_CATEGORIES` in `.../ui/src/data/articles.ts`; the seed ships 10
  articles across these categories).
- **Limitations:** filtering/sorting/pagination are **client-side** over the
  fetched list (limit 100). Category tint is cosmetic.
- **Talking point:** "A real newsroom UX over the ministry's published content."

### `pub-article-view` — article reading view
- **File:** `.../ui/src/widgets/pub-article-view/index.tsx`
- **Purpose:** the full-article reading page (transient `article` page, reached by
  clicking a card; renders nothing if no article is selected).
- **Data source:** the selected article object held in the SPA host
  (`currentArticle`), i.e. the same `public_article` record.
- **Fields shown:** category · date · author kicker, title, standfirst (summary),
  the article **body rendered as HTML** (`dangerouslySetInnerHTML`), a "Filed
  under" tag list, and back/home controls.
- **Limitation / trust note:** `body_html` is **trusted authored HTML** from the
  curated CMS store — never visitor input (the gateway route documents this).
- **Talking point:** "Long-form explainers, rendered from the same governed
  content store."

### `pub-access-modal` — access-request modal
- **File:** `.../ui/src/widgets/pub-access-modal/index.tsx`
- **Purpose:** let a non-registered visitor request access to the protected
  surfaces. (Full flow in section 4.)
- **Data source / endpoint:** POST `/api/proxy/access-requests` (public app) →
  gateway `/api/public/access-requests` → `ops_governance.access_request`.
- **Business meaning:** the front door to governed access — never a login and
  never linked to the admin console.
- **Talking point:** "The public can request exactly the dashboards they need,
  optionally verify their national ID with Fayda, and get a tracking ID — the
  request lands in the admin queue for review."

### `pub-dashboards-modal` — dashboards launcher
- **File:** `.../ui/src/widgets/pub-dashboards-modal/index.tsx`
- **Purpose:** a **directory / launcher** for the protected dashboards — **not a
  sign-in form**.
- **Fields shown (three cards):** Internal Business Intelligence (FMoH staff / RHB
  / programme directors), Infrastructure & Access Management (IT ops / security),
  Community Workshop Portal (researchers / analysts / community). Each card shows
  label, description, and audience.
- **Data source:** destination URLs resolve at runtime from `/api/access-points`
  (`hooks/accessPoints.ts`) so the shipped bundle links at the real `nip.io`
  Ingress hosts; a same-origin fallback derives sibling hosts by swapping the
  `public.` subdomain.
- **How it works:** clicking a card navigates to that dashboard, where the **real
  login** happens on that dashboard's own Keycloak page (or, with a live SSO
  session, the visitor is taken straight in). There is no IdP choice or credential
  entry in this modal.
- **Talking point:** "This modal just picks a door; the lock is Keycloak on the
  other side. If you already have an SSO session, you walk straight in."

### `pub-footer` — site footer
- **File:** `.../ui/src/widgets/pub-footer/index.tsx`
- **Purpose:** brand block + link columns.
- **Data source:** none — static.
- **Fields shown:** FMoH brand, "National Health Data Warehouse · NHDW",
  "Established 2026"; three link columns — About (Methodology / Governance /
  Contact), Open (API docs / dbt docs / Code repository), Legal (Privacy notice /
  Terms of use / Data licence).
- **Limitation:** every footer link is a placeholder `href="#"` — none navigate
  yet. Do not demo a footer link as working.

---

## 4. Access-request flow (end to end)

Grounded in `.../ui/src/widgets/pub-access-modal/index.tsx`, the public app
`.../public/app/main.py`, and the gateway
`6_access-points/api/nhdw-gateway/app/routes/access_requests.py`.

**Step 1 — the form (public SPA).** Fields:
- **Full name** (required, ≥ 2 chars — validated client-side and server-side).
- **Email** (required, must be a valid email; server type is `EmailStr`).
- **Phone**, **Organisation**, **Role / job title** (all optional).
- **Dashboards requested** (checkboxes): Internal Business Intelligence,
  Infrastructure & Access Management (marked "privileged"), Community Workshop
  Portal, Data Submission Portal, Research-tier API access.
- **Purpose & intended use** (required, ≥ 10 chars).
- **Supporting documentation** (a multi-file input in the UI).
- **Optional identity verification** (see Fayda below).

**Step 2 — optional identity verification (§6.3 in code).** Three ID types:
- **Fayda (Ethiopian National ID):** the "Verify" button opens a popup to the
  app's `/auth/fayda-start`, which 302s to the Fayda Replica `/authorize`; the
  citizen picks themselves; `/auth/fayda-callback` exchanges the code, decodes the
  ID-token claims, and `postMessage`s them back to the modal, which pre-fills the
  form and marks the state **`verified`**. This sets `verified_via='fayda'` and a
  `fayda_id`. It is a **verification step, not a login** — no session, no Keycloak
  realm involved.
- **National ID card / Passport:** format-checked and recorded as **`provided,
  pending manual verification`** — never faked as verified, never written to
  `fayda_id`.
- Client-side format rules: Fayda 12–16 digits; National ID 6–20
  letters/digits/hyphen; Passport 6–15 letters/digits.

**Step 3 — submit.** The SPA validates inline (mirroring the backend), then POSTs
a JSON payload to `/api/proxy/access-requests`. The public app **proxies
server-side** to the gateway, forwarding the real client IP (`X-Forwarded-For`)
and User-Agent so the audit row can record the source.

**Step 4 — gateway persistence.** `POST /api/public/access-requests` (anonymous,
no Bearer token):
- Validates against the `PublicSubmission` model (name 2–200, valid email,
  purpose 10–4000, etc.). Unknown dashboard keys are **dropped** (kept set:
  `internal-bi, infra-admin, community-workshop, submission-portal, dbt-docs,
  research-api`).
- **Identity honesty:** `verified_via='fayda'` (with `fayda_id`) only on a real
  Fayda verify; a National ID / Passport becomes `verified_via='<type>_pending'`
  with `fayda_id=NULL` (so the admin queue's "Fayda-verified" badge is never
  falsely tripped).
- **Duplicate guard:** inside a transaction, if the same email already has a
  **pending** request whose dashboard scope **overlaps** (or both are blanket),
  it returns **409** with the existing tracking ID rather than creating a
  duplicate row.
- Generates a tracking ID via `ops_governance.next_access_request_tracking_id()`
  (format **`AR-YYYY-NNNN`**) and INSERTs a row into
  **`ops_governance.access_request`** with `status='pending'`, client IP, UA, and
  the identity fields.
- Returns `{ tracking_id, id, status, submitted_at }`.

**Step 5 — the success view.** The modal shows the **tracking ID**, tells the user
to keep it, and lists "what happens next": an administrator reviews scope +
documents; the user receives an approval/denial email with sign-in instructions;
once approved, they open the granted dashboard from the **Dashboards** menu and
sign in there. A "Return to datasets" button goes to the Open Data page.

**Step 6 — anonymous status check.** `GET /api/public/access-requests/{tracking_id}`
(proxied) returns only `status` + `decision_at` — never the reviewer note or
identity.

**Step 7 — what an approver does (admin side, same file).** The admin dashboard
lists pending rows via `GET /api/admin/access-requests` (gated by the
`approve_access_request` RBAC capability, seeded to `R-OPS-ADM` / `R-SUPER`) and
decides each via `POST /api/admin/access-requests/{id}/decide`
(`approved` / `declined` / `info_requested`). **Approve with a `granted_role`**
auto-provisions the applicant end-to-end (§4.8): creates a Keycloak account,
assigns the realm role, writes the coherent ops rows under the same `kc_sub`
(`ops_identity.user`, `ops_perm.user_role`, and any `ops_identity.user_scope` the
OPA row-filter reads), and emails a **set-password link** via Keycloak
execute-actions-email → realm SMTP → external relay. Approve without a role records
the decision only; provisioning can be retried via `POST …/{id}/provision`.

**Notification note (be precise):** the **applicant-facing** email is the
**set-password / decision** email sent by the **admin approval** path. The
**public submit** path does not itself appear to send a confirmation email even
though the success screen says "you will receive an email confirmation" — treat
that as a UI promise pending confirmation (see Requires confirmation).

---

## 5. Open Data catalogue (where the list and downloads come from)

- **Source of the list:** the manifest **`nhdw-static/catalogue.json`** in MinIO,
  generated by `publish_public_datasets.py` from the `bi_public.*` marts and read
  by the SPA via `/api/proxy/catalogue`. This is the industry-standard open-data
  pattern: suppression applied **once at publish**, citable snapshots decoupled
  from the live warehouse, regenerated idempotently by a boot Job after
  `dbt-marts`.
- **What each entry exposes:** id, title, topic, tier, description, source system,
  grain, `k_anonymity: 5`, licence (CC-BY 4.0), row count, columns, size, period
  (min→max of the period column), `last_refresh`, a `doi`, and a direct
  `download_url`.
- **Formats:** the published manifest sets `formats: ["CSV"]`; the download button
  streams the pre-generated CSV directly from MinIO. (The bundled fallback list
  advertises additional formats like JSON/XLSX/GeoJSON/PDF/Parquet — those are
  **fallback copy**, not the live published formats.)
- **Preview:** first N rows are streamed from the same CSV object
  (`/api/proxy/datasets/{id}/preview`), so the browser never needs MinIO/CORS
  access directly.
- **Governance line every presenter should say:** everything in the catalogue is
  aggregate and k ≥ 5; facility-level data require a separate access request.

## 6. Articles / newsroom (where content is stored and how it renders)

- **Where it lives:** the `ops_governance.public_article` table, **seeded from**
  `bundle/seeds/articles/articles.yaml` by the security
  seed job (`7_security/scripts/load_public_articles.py`,
  `managed_by='seed'`), and editable at runtime. The seed ships **10** curated
  articles across PHEM / Press / Advisory / Programme / Research; 3 set an optional
  `linked_widget`.
- **How it's served:** anonymously via the gateway `/api/public/articles`
  (list, newest-first, optional category) and `/api/public/articles/{id}`
  (by id or slug), proxied same-origin through the public app's
  `/api/proxy/articles`.
- **How it renders:** the SPA maps each row to its `Article` shape (`body` =
  `body_html`); the newsroom and articles grid show category/date/title/summary,
  and `pub-article-view` renders the trusted authored **HTML** body. Content is
  curated and published — never visitor input.

---

## Requires confirmation

These items could not be fully grounded in the code as read, and should be
verified before being asserted in a meeting:

- **Live data-refresh cadence.** The publish job and marts run "as a boot Job
  after `dbt-marts`" and the manifest carries a `last_refresh` timestamp, but the
  **production refresh schedule** (how often marts + `catalogue.json` regenerate
  in a running deployment) is not defined in the files read. Do not state a
  specific cadence (e.g. "daily").
- **Hero live counts.** A `pub-hero` gateway fetcher exists (regions + facilities
  counts) but the current `pub-hero` widget is static and does not consume it.
  Confirm whether the hero is intended to show live figures/a freshness stamp; as
  coded it does not.
- **Number of live datasets in the catalogue.** The publish script defines **8**
  datasets (D-001…D-008); the UI fallback ships **12** (different content). The
  count shown to a user depends on the live manifest at deploy time — verify how
  many are actually published in the demo you present.
- **Exact KPI values.** The eight KPI percentages are computed live from the
  seeded DHIS2 source replicas via `mart_public_indicator_kpis`, so specific
  numbers depend on the demo's seed. The labels/targets/definitions are grounded
  (from `public_indicator_reference.csv`), but read the live values off the
  running dashboard rather than quoting a fixed figure. The offline `KPIS_FALLBACK`
  values (EDHS 2024-25) are fallback-only and differ from live.
- **Supporting-documentation upload.** The access modal renders a multi-file
  input, but the submit payload built in the widget does **not** include the
  files, and no upload endpoint was found in the routes read. Confirm whether
  supporting documents are actually transmitted/stored, or whether the input is
  presently non-functional.
- **Applicant confirmation email on submit.** The success screen promises "you
  will receive an email confirmation," but the public submit path
  (`/api/public/access-requests`) was not seen to send any email — only the admin
  **approval** path sends a set-password/decision email. Confirm whether a submit
  acknowledgement email is actually sent.
- **Catalog vs runtime widget ids.** The descriptive YAML catalog lists
  `pub-region`, `pub-supply`, and `pub-articles-list`, which are not standalone
  rendered widgets (they are data seams inside `pub-insights` / the `pub-articles`
  widget). Confirm the catalog is intentionally descriptive and that
  `runtime/pages.ts` is the authoritative composition.
- **Production hostname.** The owner's content spec (`~/02-public.md`)
  cites `https://portal.nhdw.moh.gov.et`; the code uses
  `https://public.127.0.0.1.nip.io` (dev) and resolves real hosts from
  `NHDW_BASE_DOMAIN`. Confirm the exact public hostname for the environment being
  demoed.
