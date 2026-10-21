# Dashboard and access-point quality review

**Reviewed:** 2026-10-21.
**Repository:** `develop` 92ede8e, plus the release-readiness pack.
**Live:** the single-node cluster (namespace `nhdw`, hosts `*.20.84.70.78.nip.io`).

This review extends the [release-readiness assessment](release-readiness/README.md). Finding IDs `RR-xxx` refer to its
[findings register](release-readiness/03-findings-register.md). This document uses its own stable IDs, `DAP-xxx`.

**What runs differs from `develop`.**
- **Images:** the running images are a 2026-09-21 20:31 build (RR-004).
- **Pages reviewed here:** the public, internal-BI, admin and workshop code is the same as `develop`, except:
  - the Control Tower page;
  - a gateway block that exists only in the running build (`pub-zm-*` fetchers).
- **Where it matters:** where live and repository differ, each finding says which one was observed.

**Method.**
- Read-only throughout. Nothing was deployed, edited, saved, approved or submitted.
- Database statements were `SELECT` only.
- Browser walks ran headless with real logins for 9 personas across both staff realms, plus anonymous.
- **One exception to "GET only":** a single permission probe (`PUT` with a deliberately invalid value) to the
  classification API. It was refused before any database work (403, or 422 for authorised roles). Afterwards the
  classification store still held its 11 seed rows, last updated 2026-09-22.

**Evidence tags** used on every finding:

| Tag | Meaning |
|---|---|
| **[PO]** | The product owner's observation |
| **[repro]** | Independently reproduced on the live system |
| **[code]** | Read from source or configuration only |
| **[fixture]** | Reproduced in the browser with a clearly labelled test response (used only where the live data is empty) |

The raw evidence (commands, outputs, 192 screenshots) is held outside the repository and is available from the review
owner.

---

## 1. Executive assessment

The demo surface fails customer trust in five ways. Each was reproduced live.

1. **The dashboards look broken because of one plumbing defect.**
   - Every staff app (BI, admin, workshop) fetches its profile and reference data without the user's token, so those
     calls get `401`.
   - That one defect causes:
     - the geography selector shows only "All areas";
     - regions appear as codes ("OR", "CE");
     - both maps fail to draw even when data exists (the map outline file also gets `401`);
     - the staff apps never pick up the profile's branding, so they always say "NHDW";
     - the admin access-approval dialog can only grant national scope.
   - The fix is small (DAP-F01), but it must ship with the commodity and programme option fixes (DAP-F08). Otherwise
     the selector starts sending values the data does not use.
2. **Numbers that look authoritative are wrong or invented.**
   - Every Service "coverage" figure is a reporting rate. Maternal mortality, stunting and malaria incidence all show
     "98.7% on track".
   - The four care cascades are empty. Their data is also arithmetically corrupt, because the reference vocabulary that
     assigns programmes was never loaded.
   - Resource shows "0 at risk", "0% availability" and "No stockouts in the last 12 months" from supply data that never
     arrived.
   - The public open-data page lists 12 invented datasets with fake DOIs. Six of them preview real files that belong to
     *different* datasets.
3. **The Disease detection models all run, and every chart is wrong.**
   - EARS C1 and Farrington draw an "expected" line that equals the observed counts in 51 and 48 of 53 weeks.
   - Seasonal-naive jumps at the new year.
   - EWARS-CSD flags every week and claims "climate-driven" with no climate data.
   - The product owner's impression that "only EARS works" is the reverse of the truth: EARS only *looks* healthy.
     Its baseline copies the observed counts, which is a model defect, not a display one.
4. **A scoped user can silently see national data.**
   - When a widget's data has no region or programme column, the gateway drops the user's scope instead of refusing.
   - The HIV programme director sees the national outbreak register and signal chart.
   - The Oromia user sees national supply totals under an "Oromia" label.
   - This is an access-control fail-open (DAP-A02). It qualifies the release-readiness statement that region scoping
     holds: it holds only for marts that carry the column.
5. **The brand is three brands at once.**
   - The public page says "Palladium" six times, including "official press releases from Palladium".
   - It shows two raw template tokens.
   - Its "product icon" is the Ethiopian Ministry of Health emblem.
   - The staff apps say "NHDW v1.0 · PROD · National Health Data Warehouse", backed by no version data.
   - The Keycloak login shows Palladium, National Health Data Warehouse and Federal Ministry of Health · Ethiopia on
     one page.

**Demo readiness.** Not ready. The fastest credible path:
- Fix the plumbing and fail-closed scoping first (DAP-WP0, DAP-WP1).
- Then remove every fabricated or zero-for-missing value and make failure states honest (DAP-WP2).
- Then apply the copy and branding changes (DAP-WP3).

Data and model fixes (DAP-WP4, DAP-WP5) decide whether Service and Disease can be shown at all. Until they land, those
pages need explicit "not available" states or must be dropped from the script.

---

## 2. Feedback traceability

Every product-owner comment, mapped to its findings. "Status" uses one of:

| Status | Meaning |
|---|---|
| Reproduced | Independently confirmed |
| Not reproduced | Could not confirm; see the note |
| Partly | Some of the claim confirmed |
| Request | A change request, nothing to reproduce |
| Investigated | Looked into; no defect claimed |

### 2.1 Public page

| # | Comment | Status | Findings | Proposed resolution |
|---|---|---|---|---|
| P1 | Unresolved tokens `{platform.native_name}`, `Palladium · {ministry.native_name}` | Reproduced | DAP-B01 | Remove both tokens from the live copy deck. Add a CI and startup check that fails on any unresolved token |
| P2 | Trace profile loading, interpolation, missing fields and fallback; check all profiles | Investigated | DAP-B01, DAP-B07, DAP-B08 | Only the live (host) et-v3 profile leaks today. A profile switch, or the gateway's fallback profile, would leak or blank more keys |
| P3 | Standardise the product name to "Data Intelligence Platform" | Request | DAP-B02 | New `brand` block in the profile; header wordmark = product name |
| P4 | Remove duplicated Palladium; "Powered by Palladium" beneath the product name | Request | DAP-B02 | Exactly one "Powered by Palladium", under the wordmark |
| P5 | Keep country/deployment context without repeating product or company | Request | DAP-B02 | Country name in the hero strip and footer only |
| P6 | Geography selector offers only "All regions" | **Not reproduced on the public page.** The public app has **no** geography selector (repo, live bundle, runtime). Likely seen in internal BI ("All areas") or the admin access-review "Area scope" picker ("All regions (national)"); both are reproduced | DAP-Q01, DAP-F01 | Confirm the location with the product owner; the probable sources are fixed by DAP-F01 |

### 2.2 Internal BI shell

| # | Comment | Status | Findings | Proposed resolution |
|---|---|---|---|---|
| S1 | Replace visible "NHDW" / "National Health Data Warehouse" | Reproduced | DAP-B03, DAP-B05 | Profile-driven wordmark; replace about 20 hard-coded strings (list in §6.3) |
| S2 | Sidebar footer "NHDW v1.0 · PROD" | Reproduced; **no deployment metadata exists to back it** (mutable `1.0.0` tags, no labels, no version endpoint) | DAP-B04 | Remove it. Show a version only after a build-SHA endpoint exists (RR-004) |
| S3 | Reuse the public page's product icon in the upper-left | Reproduced, **with a caveat**: the public "product icon" is the Ethiopian Ministry of Health emblem (`logo-fmoh.png`, whitened by CSS). No Palladium or product logo exists anywhere in the apps | DAP-B06, DAP-Q04 | Decision needed on the mark; then one asset in every identity block and favicon |
| S4 | Naming, icon, spacing and attribution consistency across access points | Reproduced: inconsistent on all 9 surfaces checked | DAP-B03, DAP-B05, DAP-E08 | One identity block and one title pattern (§6.2) |
| S5 | Do not rename technical identifiers | Request | §6.4 don't-touch list | — |

### 2.3 Disease Surveillance

| # | Comment | Status | Findings | Proposed resolution |
|---|---|---|---|---|
| DS1 | Remove "NHDW › Disease Surveillance" breadcrumb | Reproduced; it is the shared top bar, on **every** BI page | DAP-E01 | Delete it once in `Topbar.tsx` |
| DS2 | Icons for the Signal Header cards | Reproduced: **no icon renders**, because the widget never reads the field; 3 of the gateway's icon names do not exist in the sprite | DAP-E03 | One existing sprite icon per card (§6.1) |
| DS3 | Remove the "EWARS, notifiable diseases" intro | Reproduced | DAP-E02 | Clear the section eyebrow (catalogue seed + reseed) |
| DS4 | Remove the secondary card strings (completeness %, expected woreda-weeks, death reporting completeness, woreda reliability, received/expected, model ids) | Reproduced: 10 strings. Two are labels with **no value behind them**; one count appears twice | DAP-E03 | Card face = label, value, at most one delta |
| DS5 | Which of those stay available in a methodology view | — | DAP-E03, DAP-E07 | Method & coverage popover (§6.1) |
| DS6 | Investigate every empty value in Geographic Risk | Reproduced: the whole widget is blank because one missing data-quality table fails its query (`502` shown as "no data"). Once fixed, readiness stays empty (no supply feed), reliability stays empty (woreda ids do not match across sources), and the map would mis-colour missing data as zero | DAP-D01, DAP-D05, DAP-D06, DAP-F04, DAP-F14 | Build the mart; make reliability optional; show "no data" distinctly |
| DS7 | Remove "Explore health burden and system readiness across Ethiopia's regions." | Reproduced (it also hard-codes "Ethiopia") | DAP-E02 | Delete it |
| DS8 | Test every Detection Model option; only EARS C1 appeared to work | **Partly.** All four return data and render. **None is correct.** EARS only looks right | DAP-D02, DAP-F06 | Fix the season-count bug; withhold failing models with a reason |
| DS9 | Verify model ids, parameters, backend support, prediction coverage, chart contracts | Investigated: all four ids are accepted; each has 23,320 predictions per run (44 woredas × 10 diseases × 53 weeks); all registered as champion v1; the chart contract matches | DAP-D02, DAP-F06 | — |
| DS10 | Unsupported models must not appear as working controls | Reproduced: no gating exists | DAP-F06 | Disable with a tooltip reason until a model passes an acceptance check |
| DS11 | Geography selector issue here too | Reproduced | DAP-F01 | — |

### 2.4 Resource Management

| # | Comment | Status | Findings | Proposed resolution |
|---|---|---|---|---|
| RM1 | Audit every empty KPI and chart | Reproduced: 9 of 11 widgets empty or zero; the supply feed (HCMIS) never landed | DAP-D04, DAP-F02, §5 | "Source not connected" states, never zeros |
| RM2 | Remove "Where supply pressure concentrates…" | Reproduced (catalogue section text) | DAP-E04 | Delete it; weighting note to the tooltip |
| RM3 | Remove "Act this week, outbreaks vs response stock." | Reproduced; the phrase appears **three times** (eyebrow, section title, card title) | DAP-E04 | Card title = section title; eyebrow removed |
| RM4 | Remove "Regions shaded by composite supply stress…" | Reproduced | DAP-E04 | Delete it. Note: the "composite" is really drug stress only (§6.1) |
| RM5 | Do map clicks filter or drill down? | Reproduced *[fixture]*: **neither**. A click updates only the card's own info strip; no request fires and no other widget changes | DAP-F10, DAP-Q02 | Decision: make a click set the page region, or change the copy |
| RM6 | Geography selector and its effect on every widget | Reproduced: picking a region hides 5 of 11 Resource cards; picking a period hides 8 of 11; the map only zooms | DAP-F01, DAP-F09 | Keep cards visible with a "latest month only" note |

### 2.5 Service Performance

| # | Comment | Status | Findings | Proposed resolution |
|---|---|---|---|---|
| SV1 | Audit every empty KPI and chart | Reproduced: four cascades empty; programme filter turns every card to 0; several values mislabelled | DAP-D03, DAP-D07, DAP-F03 | Fix the pipeline; empty states |
| SV2–SV6 | Remove five explanatory strings | All reproduced | DAP-E05 | Delete; keep the scope chip and move the method to a tooltip (§6.1) |
| SV7 | Preserve scope and estimation assumptions in a secondary location | — | DAP-E05, DAP-E07 | "EMR-active" scope chip **only where true**; "3.2% crude birth rate" estimate in the tooltip |
| SV8 | Geography filtering, denominator consistency, cross-source agreement, cascade calculations | Reproduced. Geography narrows correctly. Denominators disagree across the platform (ANC4 55.6% / 83.1% / 57.6%). The EMR side of "agreement" is a seeded demo table, not the EMR pipeline. The cascade maths divides every step by HIV tests and multiplies across programmes | DAP-D03, DAP-D07, DAP-D08 | §5.3 |

### 2.6 Admin

| # | Comment | Status | Findings | Proposed resolution |
|---|---|---|---|---|
| AD1 | Review "Cluster Activity" (no defect named) | Investigated. No page has this name; it maps to **Health & topology**. Every number matched kubectl, metrics-server and Prometheus at the same moment. **No data defect.** Presentation and error-state weaknesses only | DAP-E09, DAP-F13 | Label fixes; explicit stale and error states |
| AD2 | Column Governance shows `403 missing capability: manage_classification` | Reproduced for super-admin and root | DAP-A01 | Split read from write; least-privilege grants |
| AD3 | Do not remove the check or grant broad permissions | Respected | DAP-A01 | — |
| AD4 | Distinguish loading / denied / failure / loaded-empty | Reproduced: **"nothing classified" shows while loading, on 403, on 500 and on network failure** | DAP-F05 | Four explicit states |
| AD5 | Unauthorised users get an appropriate interface; stewards can complete the workflow | Partly. Stewards and ops admins see everything and have the controls (not saved). Super-admin sees a page it cannot use. The security officer can call the API but cannot see the page | DAP-A01, DAP-Q05 | One gate for navigation and API |
| AD6 | Audit suspected dummy data throughout Admin | Reproduced (§5.4): sample alert recipients that nothing reads; placeholder identity providers marked "active"; a hard-coded `127.0.0.1` base domain; "0/0 · 0.0s" build health from a missing artefact | DAP-B09, DAP-F12, DAP-F15 | §5.4 |

### 2.7 Cross-cutting patterns (section 4 of the brief)

| # | Pattern | Result | Findings |
|---|---|---|---|
| X1 | Empty metrics: trace source → render | Done for every mounted widget on Overview, Disease, Resource, Service and the public portal (§5) | DAP-D01…D08, DAP-F02 |
| X2 | Filters: option source, scope, request effect, global/local, combinations, races, null-vs-zero maps | Done (§4.3) | DAP-F01, F07–F11, A02 |
| X3 | Static and fallback data classification | Done (§5) | DAP-F03, DAP-F12, DAP-D07 |
| X4 | Copy, branding, interaction | Done (§6) | DAP-B*, DAP-E*, DAP-F16 |

---

## 3. Page and widget coverage matrix

**Status key**

| Status | Meaning |
|---|---|
| PASS | Meaningful, correct output |
| FAIL | Wrong, misleading, empty-as-zero or broken |
| BLOCKED | Cannot be exercised (page unreachable, or data absent upstream) |
| UNVERIFIED | Code-read only |

"Roles" lists the personas used for the check.

**Totals for this review** (counted from the tables below)

| Scope | Rows | FAIL | PASS / partly PASS | BLOCKED | n/a |
|---|---|---|---|---|---|
| Public and internal-BI widgets and elements (§3.1–3.6) | 42 | 35 | 3 | 3 | 1 |
| Admin pages (§3.7) | 12 | 5 | 4 (+ 2 partial) | 1 | — |
| Workshop and export/query items (§3.7) | 5 | 2 | 3 (1 also fails authorisation) | — | — |
| Tool SSO and deep links (§3.8) | 6 | 2 | 1 (8 tools) | — | — |

### 3.1 Public (anonymous)

| Widget / element | Status | Note | Findings |
|---|---|---|---|
| Header, strip, hero copy | FAIL | Raw tokens; Palladium ×6; ministry emblem as product icon | DAP-B01, B02, B06 |
| KPI tiles (8) | FAIL | Values equal the mart, but "national" is 5 regions and the month is not shown; invented fallback on any failure | DAP-F03, DAP-D08 |
| Coverage by region | FAIL | Labelled "all 14 regions", shows 5; hard-coded 14-region fallback | DAP-F03, DAP-D08 |
| 24-month trend | FAIL (latent) | `Math.random()` fallback ships in the live bundle | DAP-F03 |
| Readiness strip | PASS | Hidden honestly when the supply data is empty | — |
| Newsroom / articles | FAIL | Seeded mock bulletins attributed to real institutions (RR-008) | — |
| Open-data catalogue | FAIL | Fake catalogue live; 6 previews of real but unrelated files; 6 invented previews; dead download | DAP-F12 |
| Dashboards / access modals | PASS / FAIL | Work. "Request NHDW access", "FMoH staff"; unlabelled input (a11y) | DAP-B03 |
| Geography selector | n/a | Does not exist | DAP-Q01 |

### 3.2 Internal BI: Overview (superadmin, analyst.ana, kebede.oromia, dec.nat)

| Widget | Status | Note | Findings |
|---|---|---|---|
| ov-brief | FAIL | "Weakest cascade: OTHER retains 0.0%"; supply lines silently dropped | DAP-D03 |
| ov-benchmarks | PASS (live) / FAIL (failure path) | 893 / 101.2M / 14 / 619 is correct; invented 17,550 / 107.3M / 1,082 on any failure | DAP-F03 |
| ov-reliability-table | FAIL | Same metric counted twice; readiness "0%" for missing data | DAP-D07, DAP-F02 |
| ov-source-pulse | FAIL | `502` (missing mart) shown as "no rows" | DAP-D01, DAP-F04 |
| ov-act-first-woredas | FAIL | P(alarm) "1%" for 1.0; readiness and reporting "0" for missing data | DAP-F14, DAP-F02 |
| ov-trust-completeness | FAIL | 100% by construction (denominator = woredas that ever reported) | DAP-D07 |
| ov-trust-mapping | FAIL | Says "MFR id", measures the DHIS2 hierarchy path | DAP-D07 |
| ov-trust-silent | FAIL | 893 = 100% (empty heartbeat source; wall clock vs data clock; 30 vs 60 days) | DAP-D07 |
| ov-disease-snapshot | FAIL | "This week" shows the whole-period total (131,432 vs 1,976) | DAP-D07 |

### 3.3 Internal BI: Disease Surveillance (superadmin, analyst.ana, abebe.bekele)

| Widget | Status | Note | Findings |
|---|---|---|---|
| dz-kpi-strip | FAIL | 10 secondary strings; no icons; 6th card clipped at 1440 px; always shows "Model ears"; Active Outbreaks ignores the region filter | DAP-E03, DAP-F06, DAP-F16 |
| dz-region-map (Geographic Risk) | FAIL | Whole widget blank (`502`); geometry `401`; null drawn as zero | DAP-D01, DAP-F01, DAP-F04 |
| dz-signal-chart | FAIL | All four models wrong; alarm flags contradict the threshold; model select can show a stale chart | DAP-D02, DAP-F06, DAP-F07 |
| dz-woreda-table | FAIL | P(alarm) "1%"; readiness and reliability empty; lead says "burden", sort is by alarm | DAP-F14, DAP-D05, DAP-D06 |
| dz-outbreaks-table | FAIL | "95 active outbreaks" (7 active); unknown new cases shown as "0" | DAP-F02, DAP-F16 |
| dz-climate-ts / dz-climate-corr | FAIL | Climate source empty; the legend lists three absent series | DAP-D04 |

### 3.4 Internal BI: Resource Management (superadmin, kebede.oromia)

| Widget | Status | Note | Findings |
|---|---|---|---|
| rm-hero, rm-statboard | FAIL | Zeros for a supply feed that never arrived | DAP-F02, DAP-D04 |
| rm-forecast, rm-wastage, rm-hotspots, rm-stock-heatmap | BLOCKED | No source data; honest empty states, but latent zero/vocabulary defects | DAP-D04, DAP-F02 |
| rm-map | FAIL | No data; geometry `401`; click does not filter; "composite" is drug stress only | DAP-F01, DAP-F10, DAP-E04 |
| rm-events, rm-stockout-impact | FAIL | Empty state claims "stock levels are healthy" / "No stockouts in the last 12 months" | DAP-F02 |
| rm-act-week | FAIL | Ranks outbreaks "vs response stock" with no stock data; phrase repeated three times | DAP-E04, DAP-D04 |
| rm-cold-chain | FAIL | One month labelled "this quarter"; "FHIR-linked" and "Linked AEFI" are false; NULL → 0 | DAP-D07, DAP-F02 |

### 3.5 Internal BI: Service Performance (superadmin, abebe.bekele)

| Widget | Status | Note | Findings |
|---|---|---|---|
| sv-topline-kpis | FAIL | "Coverage" = reporting rate; 19,128 facilities; programme filter → 0/0/0/0 | DAP-D07, DAP-F02 |
| sv-flagship-table | FAIL | MMR / stunting / malaria "98.7% on track"; timeliness 0% for NULL; untoned pills | DAP-D07 |
| sv-agreement-donut | FAIL | Band labels ≠ SQL; "vs last quarter" = previous month; EMR side is a seeded table | DAP-D07, DAP-D08 |
| sv-data-trust-table | FAIL | "Facility" column shows regions; rates labelled as counts | DAP-D07 |
| sv-cascade-hiv / tb / mnch / ncd | FAIL | Empty (all `OTHER`); underlying mart arithmetically corrupt | DAP-D03 |
| sv-continuity-mnch, sv-dropoff-region | FAIL | Seed table fixed at 2026-Q1 that bypasses the pipeline, labelled "EMR-active"; negative "gap" | DAP-D08 |
| sv-risk-woredas | FAIL | Risk score = one metric counted twice; "EMR-active" on DHIS2 data | DAP-D07 |
| sv-zero-dose | FAIL | Every region "watch" because the mBrana data is unknown; reach 12.2% vs public Penta3 96.9% | DAP-F02, DAP-D07 |
| sv-rr-timeliness | BLOCKED | Profile-disabled (intentional) | — |

### 3.6 Internal BI: Control Tower

| Item | Status | Note | Findings |
|---|---|---|---|
| Page | BLOCKED | Disabled for every role under the live profile (RR-005) | — |
| Numbers | FAIL | ≈4× inflated (RR-002) | — |
| Repository UI vs live gateway | FAIL (latent) | Deploying the repository UI before the gateway turns all four stock-health cards to "no data" (shape mismatch) | DAP-F17 |

### 3.7 Admin (superadmin, root, hana.d, steward.ops) and Workshop (superadmin, genet.e, analyst.ana)

| Page | Status | Note | Findings |
|---|---|---|---|
| Health & topology ("Cluster Activity") | PASS (data) / FAIL (presentation, error states) | All numbers verified | DAP-E09, DAP-F13 |
| Dashboard control | PASS | Gate mismatch for a `manage_catalog`-only role | DAP-A06 |
| Alert routing | FAIL | 7 rules with sample recipients that nothing reads; 3 false TargetDown alerts | DAP-F15 |
| Quality & lineage | FAIL | "0/0 · 0.0s" from a missing artefact; raw database error | DAP-F15, DAP-D01 |
| MDM stewardship | PASS (with note) | Ethiopian and Zambian test facilities in one queue | DAP-B09 |
| Column governance | FAIL | `403` for super-admin; misleading states | DAP-A01, DAP-F05 |
| Models & datasets | PARTIAL | Daily job failures not reflected | DAP-F15 |
| Users & access | PARTIAL | Region picker national-only; non-human roles assignable | DAP-F01, DAP-A06 |
| Roles & permissions | PASS (with note) | Capability picker omits 4 enforced capabilities | DAP-A01 |
| SSO & identity | FAIL | `TODO_GOOGLE_CLIENT_ID`, localhost issuer, mock provider marked "active" | DAP-B09 |
| Documentation | FAIL | Base domain `127.0.0.1.nip.io`; "No documents published" | DAP-B09 |
| Backups & DR | BLOCKED | Catalogue page with no UI; no backup job exists | DAP-Q06 |
| Workshop: all pages | PASS | — | — |
| Workshop: Help footer, "Public site" link | FAIL | Dead anchors; "Public site" returns to the workshop | DAP-F16 |
| Export & query: templates, mart list | PASS (UI) / FAIL (authorisation) | Researcher gets `200` on listings | DAP-A03 |
| Export trail | FAIL | Empty-state text promises logging that does not happen | DAP-F16 |
| Export download | PASS | 893 rows = screen | — |

### 3.8 Tools and deep links

| Item | Status | Findings |
|---|---|---|
| SSO into dbt-docs, MLflow, Prometheus, Alertmanager, Headlamp, SeaweedFS, Jupyter, Superset | PASS | — |
| Airflow, OpenMetadata | Extra click | — |
| Researcher reaches full MLflow and Superset SQL Lab | FAIL | RR-214, DAP-A04 |
| Tile role labels match the gates | FAIL | DAP-A04 |
| Undeployed hosts (grafana, cloudbeaver, minio, label-studio) | Not linked from any UI | — |
| Palladium console | Outside the repository; own login | RR-212 |

---

## 4. Findings register

**Severity**

| Level | Meaning |
|---|---|
| S1 | Wrong or fabricated information can be shown as real, or access control fails open |
| S2 | Broken or misleading visible behaviour |
| S3 | Gap or latent defect |
| S4 | Cosmetic |

**Classes**

| Prefix | Class |
|---|---|
| **E** | Requested visual or editorial change |
| **F** | Functional defect |
| **D** | Data availability or correctness |
| **B** | Configuration and branding |
| **A** | Authorisation and governance |
| **Q** | Needs clarification or reproduction |

Each finding gives:
- the page or component;
- observed vs expected;
- the evidence tag;
- the cause (or `[hyp]`);
- the files and endpoints;
- the resolution;
- **observable** acceptance criteria.

### 4.1 Authorisation and governance (A)

**DAP-A01 · S2 · Column Governance: super-admin denied; read gated on write.**
- **Observed [PO][repro]:** super-admin and root see the navigation item. Every classification call returns
  `403 missing capability: manage_classification`.
- **Two permission planes disagree:**
  - The R-OPS-SEC security officer, described as "read-only", holds the write capability but has no navigation item.
  - Reading the inventory requires the *manage* capability.
  - The console's capability picker is a hard-coded list that omits `manage_classification` and three others, so the
    grant cannot be fixed from the UI.
- **Cause [code]:**
  - Navigation follows widget grants (`ops_perm.role_widget`, where super-admin has `*`).
  - The API follows capability grants (`role_capability`).
  - When the feature was added, the capability went to R-STEW, R-OPS-SEC and R-OPS-ADM, and super-admin's explicit list
    was not updated.
  - Keycloak provisioning and the live tables match the seed, so this is a design defect, not drift.
- **Files:**
  - `nhdw-gateway/app/routes/classification.py:40,82-96,130-140,188-193`
  - `bundle/seed-pack/app/security/roles.yaml:85,101,105-109,150-174`
  - `admin/ui/src/sections/Sidebar.tsx:100-107`
  - `admin/ui/src/widgets/adm-roles-permissions/index.tsx:39-58`
- **Resolution (least privilege; the check is not removed and no broad grant is made):**
  1. Add `view_classification`. GETs require view **or** manage; PUT and DELETE keep manage.
  2. Super-admin gets view + manage.
  3. The security officer gets **view only** plus the page; this needs an owner decision (DAP-Q05).
  4. Navigation shows the page only when the role holds the widget **and** the capability.
  5. The seed loader fails CI when a role has a widget without its capability, or the reverse.
  6. Serve the capability catalogue from the gateway instead of a hard-coded list.
- **Acceptance:**
  - Super-admin and root load 11 classified columns and 18 review findings.
  - The security officer sees the page with no Classify buttons, and their PUT returns `403`.
  - A role without either capability has no navigation item and gets `403` on GET.
  - A seeded mismatch fails the loader test.

**DAP-A02 · S1 · A scoped user's scope is dropped when the data has no matching column (fails open).**
- **Observed [repro]:**
  - The HIV-locked programme director receives the outbreak register with 95 rows and the signal chart with 530 rows,
    identical to national, while the gateway echoes an applied filter of `programme: [HIV]`.
  - The Oromia-locked user gets national supply aggregates (`rm-hero`, `rm-statboard`) under a locked "OR" chip. The
    values are zero only because the mart is empty.
  - A national user who picks Oromia gets those same widgets *hidden*, so scoped users get less protection than
    national users.
- **Cause [code, confirmed]:**
  - `fetchers.py:131-155` `_where` applies a scope dimension only "if the mart actually has a column for it" and
    silently skips the rest. The OPA scope obligation therefore fails open.
  - The UI never treats a locked value as an active filter, so the hide-at-scope rule never fires.
- **Files:** `nhdw-gateway/app/fetchers.py:131-155,263-277`, `routes/permissions.py:206-213`,
  `internal-bi/ui/src/runtime/reactivity.ts`.
- **Resolution:**
  - In `widget_data`, when the OPA `row_filter` carries a dimension that the fetcher cannot apply, return `403` or an
    explicit "not available at your scope" stub. Never return unscoped rows.
  - In the UI, treat a locked value as an active dimension for hiding.
  - Do **not** widen any user's options.
- **Acceptance:**
  - The HIV director's outbreak and signal widgets show HIV-only rows or a scope notice, never 95 / 530 national rows.
  - The Oromia user never sees an aggregate computed over other regions.
  - A gateway unit test covers every fetcher × scoped dimension combination.

**DAP-A03 · S2 · SQL tool and listings lack capability checks.**
- **Observed [repro][code]:**
  - The external researcher (no internal-BI access) gets `200` on `/gw/marts` (51 marts) and `/gw/reports/templates`.
  - `/api/sql/execute` has no capability gate.
  - `SHOW`, `DESCRIBE` and `EXPLAIN` bypass OPA. `EXPLAIN ANALYZE` executes.
  - CTEs are rejected.
  - Any "limit" token bypasses the forced limit.
- **Files:** `routes/sql_lab.py:84-199`, `routes/reports.py:63-74`, `routes/marts.py:25`.
- **Resolution:**
  - Gate on a `run_sql` capability.
  - Route introspection through OPA.
  - Reject `ANALYZE`.
  - Wrap the user query in an outer `LIMIT`.
  - Gate the listings on the widget grant.
- **Acceptance:**
  - The researcher gets `403` on the marts list, the templates list and execute.
  - `EXPLAIN ANALYZE` returns `400`.
  - An analyst's CTE query works.

**DAP-A04 · S2 · Tool tiles and tool gates disagree.**
- **Observed [repro]:**
  - The external researcher gets silent SSO into full MLflow (delete and rename on 12 experiments) and into Superset
    SQL Lab (RR-214).
  - Admin tiles advertise MLflow for R-OPS-ADM and R-SUPER only.
  - "Lake browser" and "Open MLflow registry" are shown to R-OPS-ENG, whose gate refuses them.
- **Cause:** two hand-maintained lists (`adm-documentation/index.tsx:60-81`, `MLHealth.tsx:39,358`) vs
  `1_infrastructure/k8s/base/tool-gates.yaml`.
- **Resolution:**
  - One tool registry, consumed by both the gates and the tiles.
  - Tighten the MLflow gate; this is an owner decision on scientist access.
  - Map Superset roles from Keycloak.
- **Acceptance:** every visible tile opens without `403` for that role, and the researcher gets `403` at MLflow.

**DAP-A05 · S2 · Audit log readable by every role (and anonymously).**
- Re-confirmed: steward.ops gets `200` on `/gw/audit/events`.
- Tracked as **RR-001**; fix there.

**DAP-A06 · S3 · Minor governance gaps.**
- Topology and observability authorise on JWT realm roles, not the permission store. `POST /topology/scale` takes the
  namespace from the request body and allows the "read-only" security role (`topology.py:106-111,1105-1130`) [code].
- Non-human roles (`R-PUB-ANON`, `R-SERVICE`) are assignable to people in Users & Access [repro].
- Dashboard control needs `manage_users` where `manage_catalog` is intended [code].
- steward.ops fires 8 background `403`s on boot for widgets it is not granted [repro].
- **Acceptance:**
  - Security-role scale returns `403`.
  - Assigning `R-SERVICE` to a person returns `422`.
  - A `manage_catalog`-only role loads Dashboard control.
  - steward.ops boot makes 0 calls that return `403`.

### 4.2 Functional defects (F)

**DAP-F01 · S2 · Staff apps load profile, reference and map data without the user's token (one root cause, many symptoms).**
- **Observed [PO][repro]**, on every load of internal BI, admin and workshop: 2–4 calls to `/gw/profile`,
  `/gw/profile/reference` and `/gw/profile/copy/common` return `401`. The resulting symptoms:
  - The Region selector offers only "All areas" on all four BI pages for every national role.
  - The locked chip shows "OR" instead of "Oromia".
  - Regions render as codes in tables.
  - Both maps' outline file (`/gw/profile/geo/admin1.geojson`) returns `401`, so maps cannot draw even with data
    *[fixture]*.
  - The staff apps always show bundled "NHDW" branding.
  - The admin access-review "Area scope" picker offers only "All regions (national)".
- **Verified with the token supplied:** the selector lists "All Ethiopia" plus 14 regions, and the Oromia user still
  sees only Oromia, locked.
- **Cause [code]:**
  - Plain `fetch` with no bearer in:
    - `internal-bi/ui/src/widgets/_shared/reference.ts:129,171`
    - `internal-bi/ui/src/sections/Sidebar.tsx:30`
    - `internal-bi/ui/src/widgets/_shared/geo.ts:27,45,72`
    - `admin|workshop/ui/src/hooks/useProfile.ts:85-86`
    - `admin/ui/src/widgets/adm-users-access/ReviewModal.tsx:39`
  - Each app's `/gw` proxy requires a session (`internal-bi/app/main.py:100-124,188`), while the gateway route itself
    is public.
  - In internal BI the reference load also runs before login (`main.tsx:42`).
- **Resolution:** use `authFetch` after login for every `/gw/profile*` call, **or** let the three app proxies pass the
  public profile routes anonymously. Ship it together with DAP-F08.
- **Acceptance:**
  - 0 × `401` in the network log on load for every persona.
  - The national Region menu = "All {country}" + every region by name.
  - The Oromia user sees one locked "Oromia".
  - A tampered `geography=AM` for that user still returns `403`.
  - Both maps draw 14 regions when rows exist.
  - The admin picker lists the regions.

**DAP-F02 · S1 · Missing data rendered as zero or as good news.**
- **Observed [repro]:**
  - Resource: "0 commodities at risk of 0 pairs", "0 already in stockout", "Stock availability 0%", "Avg months of
    stock 0 mo", "Stocked out 0", "Wastage 0", "Services exposed 0", "Est. disruption 0".
  - Empty states claim "stock levels are healthy" and "No stockouts in the last 12 months".
  - Overview: reliability readiness "0%" ×14; act-first readiness 0 and reporting 0%.
  - Service: timeliness "0%"; zero-dose "watch" for every region; any programme filter → topline "0% / 0% / 0 / 0".
  - Disease: outbreak "new 7d" "0".
  - Admin DQ: "0/0 · 0.0s".
- **Cause [code]:**
  - Aggregates over zero rows return 0.
  - 128 `?? 0` coercions across 45 widgets.
  - UNION fetchers emit NULL rows.
  - Hard-coded reassuring empty copy.
- **Resolution:**
  - Fetchers return no row, or NULL, on an empty base.
  - Widgets render "—" with a "Not measured" or "Source not connected" reason.
  - Status fields become tri-state (known / not / unknown).
  - Remove reassuring empty copy.
  - **No numbers are substituted.**
- **Acceptance:**
  - With every supply mart empty, no Resource card shows a numeric 0 or a "healthy" message.
  - With programme = MNCH, no Service card shows 0 derived from NULL.
  - A widget mapper unit test with NULL fixtures shows "—", never 0, "Steady" or "watch".

**DAP-F03 · S1 · Fabricated fallback content on failure.**
- **Observed [repro][code]:**
  - Public KPI tiles fall back to profile `fallback_kpis` / `KPIS_FALLBACK` (e.g. Penta3 40%, against a live 96.9%).
  - Region bars fall back to a hard-coded 14-region set.
  - The 24-month trend falls back to a `Math.random()` series (present in the live public bundle).
  - The Overview benchmarks card falls back to 17,550 / 107.3M / 14 / 1,082.
  - The anonymous `/api/series/*` serves hard-coded statistics.
  - The internal-BI live bundle ships the 2.1 MB Ethiopian synthetic EPSS plan (verified by bundle grep; it is not
    rendered).
  - No surface discloses that any of these values is illustrative.
- **Files:**
  - `public/ui/src/hooks/widgetData.ts:12-38`
  - `pub-insights/index.tsx:151-160,190-192`
  - `hooks/charts.ts:43-54,92-107`
  - `ov-benchmarks/widget.ts:14-27`
  - `public/app/main.py:545-596`
  - `ct/data/runtime.ts:10`
- **Resolution:** delete every fallback dataset, and render "Data temporarily unavailable" instead (RR-006, RR-017).
- **Acceptance:**
  - With the gateway blocked, no numeric tile or series renders.
  - A CI grep over source **and built bundles** finds no `Math.random`, `FALLBACK`, numeric `DEFAULTS`, `EPSS` or
    `Ayder`.

**DAP-F04 · S2 · Errors shown as "no data" and cached for the session.**
- **Observed [repro]:**
  - A `502` (missing table) renders "No geographic surveillance data for the selected filters" or "No source-quality
    rows".
  - The raw Trino error, including the internal table name, is sent to the browser.
  - A failed or `401` result is cached until a full reload. In one test, an earlier `502` stopped a later valid
    request from ever being made.
  - Re-selecting a filter value makes 0 requests (`invalidateWidgetData` is never reached).
  - After 31 minutes idle the token expires and pages show "No data for the selected filters" instead of a sign-in
    prompt (release-readiness walk).
- **Files:** `internal-bi/ui/src/runtime/dataHook.ts:25-48`, `runtime/filterBus.ts`, `sections/CatalogPage.tsx:39-43`,
  gateway widget-data error path.
- **Resolution:**
  - A typed result `{ok | empty | denied | error | expired, asOf}`.
  - Never cache non-success.
  - Invalidate on filter change.
  - `401` triggers a silent refresh or a sign-in prompt.
  - Sanitised `5xx` bodies with a correlation id.
- **Acceptance:**
  - A forced `403`, `502`, empty response and expired token each show a distinct message.
  - A retry recovers without a reload.
  - No response body contains SQL or Trino text.

**DAP-F05 · S2 · Column Governance shows "nothing classified" when it does not know.**
- **Observed [repro]:** using request interception as hana.d, the header reads "nothing classified" while loading, on
  `403`, on `500` and on network abort. The Review tab stays on "scanning…" after an error, and access denial shows as
  a raw JSON string.
- **Cause:** `adm-classification/index.tsx:79` renders from an initial `{}`; `:179-180` keys on `findings === null`.
- **Resolution:**
  - Four explicit states: loading; "You don't have access to column governance"; "Couldn't load — retry" (with no
    count header); loaded-empty.
  - Hide the edit controls without the manage capability.
- **Acceptance:** for held, `403`, `500` and abort, the page never contains "nothing classified" and never shows
  "scanning…" after a response arrives. Only an empty `200` shows the empty message.

**DAP-F06 · S2 · Detection-model selector offers models that are broken, and the rest of the page ignores the choice.**
- **Observed [PO][repro]:**
  - All four options are selectable and all three model defects in DAP-D02 render as if valid.
  - The KPI strip, map and woreda table never send a model and always show EARS ("Model ears").
  - The selection resets on redraw.
  - The chart caption does not name the model.
- **Resolution:**
  - Serve the list of selectable models from the gateway, filtered by an acceptance check on the latest run:
    - predicted ≠ observed;
    - history ≥ 104 weeks for same-week models;
    - climate inputs non-null for EWARS-CSD.
  - Disabled options carry a reason, e.g. "Withheld: needs two full seasons of history".
  - Either share the choice across the page, or label the other widgets with the fixed model.
  - Put the model name and run date in the caption.
- **Acceptance:**
  - Every enabled option produces a chart whose expected line differs from observed in at least 90% of weeks.
  - Every disabled option shows its reason.
  - The KPI strip names the same model as the chart.

**DAP-F07 · S3 · Model select can display a stale chart.**
- **Observed [repro]:** with Farrington delayed, picking Seasonal-naive leaves the select on "Seasonal-naive" over the
  Farrington series. The assistant's copy of widget data can also keep stale rows.
- **Cause:** `dz-signal-chart/widget.ts:63-87` has no request guard. `PageRenderer.ts:136` records without a
  generation check.
- **Resolution:** a per-widget sequence guard or AbortController; record only the current generation.
- **Acceptance:** a delayed earlier response never replaces the newer selection on screen or in the assistant registry.
- Note: global filter changes are already safe on screen; this was tested.

**DAP-F08 · S2 · Filter option values do not match the data keys.**
- **Programme [repro]:** the "Programme" list merges programme codes with disease keys (28–29 options, "Malaria"
  twice).
  - On Disease only 3 options can return rows (`cholera` returns 0), and two real programmes (VBD, WASH) cannot be
    picked.
  - On Service every programme returns 0 rows (see DAP-D03).
- **Commodity [repro]:** once the reference loads, Commodity values switch from names to codes (`commodity=VAC-BCG`),
  while the supply marts filter on `commodity_name`.
- **Admin access-review [code]:** the hard-coded programme scope uses mixed case (`Malaria`, `Nutrition`) where the
  data uses `MALARIA`.
- **Files:** `chrome/global-filter/widget.ts:78-82`, `_shared/reference.ts:160-162,211-212`,
  `admin/.../ReviewModal.tsx:53`, `bundle/seed-pack/app/security/filters.yaml`.
- **Resolution:**
  - Source options from the role-capped `GET /api/permissions/filter/{id}/values`.
  - Separate disease from programme.
  - Pick one commodity key and assert it in a contract test.
- **Acceptance:**
  - Every offered option returns at least one row, or is not offered.
  - No duplicate labels.
  - Option values equal `SELECT DISTINCT` of the mart key.

**DAP-F09 · S2 · Filters hide the widgets the user asked about.**
- **Observed [repro]:**
  - Service + MNCH hides **all four** cascades, including MNCH's own, plus agreement and data-trust.
  - Resource + any period hides 8 of 11 cards.
  - Resource + any region hides 5 of 11.
  - Overview + any filter hides the brief and the mapping tile.
- **Cause:** binary hide when `supports[dim] === false` (`runtime/reactivity.ts:47-51`), with no notion of a widget
  pinned to one programme.
- **Resolution:**
  - Pinned values: the MNCH cascade stays visible for MNCH.
  - Show "Latest month only — not filtered by period" instead of hiding.
- **Acceptance:**
  - Service + MNCH shows the MNCH cascade.
  - Resource + Last 12 weeks keeps every card with time-insensitive data visible, with a note.

**DAP-F10 · S3 · Map clicks neither filter nor drill down.**
- **Observed [PO][fixture]:**
  - Resource map: a click updates only the card's own info strip. No request; chips unchanged.
  - Disease map: a click loads only a sparkline, although the section copy promises "worst-affected woredas".
- The `filterBus.ts` contract ("a map click sets geography") is not implemented: no widget calls `bus.set`.
- **Resolution:** owner decision (DAP-Q02).
  - Either a click sets the page Region for national users, and never outside a scoped user's allowed values;
  - or the copy says "click to inspect".
- **Acceptance:** the behaviour matches the copy. If filtering, clicking Amhara sets the chip and the woreda table
  refetches with `geography=AM`.

**DAP-F11 · S3 · Maps draw missing data as zero.**
- **Observed [fixture]:** a region with no data, a NULL region and a genuine zero share the lightest colour. The NULL
  region reads "Composite 0.0", "Low burden", "P(alarm) 0%".
- **Cause:** `_shared/charts.ts` `valFor` defaults to 0; `?? 0` in `rm-map` and `dz-region-map`.
- **Resolution:** a distinct no-data style; "No data" in the tooltip and ranking; exclude missing regions from the scale
  and the ranks.
- **Acceptance:** in the fixture, null and absent regions render grey with "No data", and a zero renders the zero colour
  with "0".

**DAP-F12 · S1 · Public open-data catalogue is invented, and its previews show the wrong files.**
- **Observed [repro]:**
  - `/api/proxy/catalogue` returns `404`, so 12 fallback datasets display, with fake DOIs, download counts and "all
    1,148 woredas".
  - Previews D-002 to D-006 return **real files under the wrong titles**. Examples: "PHEM weekly IDSR bulletins"
    previews facility counts; "NCD STEPS 2023" previews IDSR cases; "Maternal mortality ratio" previews workforce
    density.
  - D-007 to D-012 show invented "1,248 rows" previews.
  - The download button is `href="#"`.
- **Files:** `hooks/useDatasets.ts:62`, `data/datasets.ts:19-31`, `pub-data-catalogue/index.tsx:26-41,133-145,279`,
  `public/app/main.py:509-531`.
- **Resolution:**
  - The publish job writes `catalogue.json` with the real titles and schemas.
  - Delete `DATASETS` and `samplePreview`.
  - With no manifest, show "No datasets published yet".
- **Acceptance:**
  - Each listed title's preview columns match its manifest schema.
  - Every download returns a non-empty file whose row count equals the listed count.
  - A missing manifest shows no dataset rows.

**DAP-F13 · S3 · Health & topology: error states and two weak signals.**
- **Observed:**
  - [code] A failed `/infra` or `/cluster` request leaves the cards on "loading…" forever, or keeps old data labelled
    "live". A traffic failure reads as "no traffic".
  - [repro] The node "error logs (15 m)" count includes Loki's own query logs (Loki 34 → 136 across polls) and Trino
    WARN lines.
- **Resolution:**
  - Per-feed error and staleness ("stale · last ok 10:42").
  - Count error-level lines only, excluding Loki query logs.
- **Acceptance:**
  - A simulated `500` on `/cluster` shows an error badge within one poll.
  - The Loki error count stays flat across 10 polls.

**DAP-F14 · S2 · Probability shown as "1%" instead of 100%.**
- **Observed [repro]:** the woreda table and the Overview act-first table print P(alarm) 1.000 as "1%" and 0.707 as
  "0.707%". The ≥60 alert colour can never fire.
- **Cause:** `_shared/charts.ts:242` appends "%" without scaling.
- **Resolution:** scale ×100, or format as a probability band (also see DAP-E10).
- **Acceptance:** the top row reads "100%" (or "≥95%" under the banding rule) and is coloured as an alert.

**DAP-F15 · S2 · Admin operational pages present placeholders or stale state as working.**
- **Alert routing [code][repro]:** 7 routing rules (PagerDuty, Slack, `@moh.gov.et` addresses) are displayed and
  editable, but nothing consumes them. Edits need only the read capability.
- **False alerts [repro]:** 3 `TargetDown` alerts have fired since 2026-09-26 for services that are up (scrape
  endpoints not enabled).
- **Quality & lineage [repro]:** a missing dbt artefact renders as neutral "0/0 · 0 pass · 0 fail · 0.0s". It prints a
  raw database error and reads "0 bi_public marts" while 3 exist.
- **Models & datasets [repro]:** shows "1 failed last run, 29 d ago", while two ML jobs fail every night (116 failed
  pods) without updating it.
- **Resolution:**
  - Wire routing rules into the Alertmanager config, or label the page "not connected", with a manage capability for
    writes.
  - Enable or remove the three scrape jobs.
  - A missing artefact shows an amber "No dbt run found".
  - Record failed runs.
- **Acceptance:**
  - A test alert reaches the configured channel, or the page states it is not connected.
  - No false `TargetDown`.
  - With no artefact the DQ card is amber and names the cause.

**DAP-F16 · S3 · Labels, counts and links that contradict the data.**
- **Disease outbreaks table [repro]:** "95 active outbreaks" when 7 are active.
- **Disease KPI strip [repro]:**
  - "Case fatality · 30D" is computed over 28 days.
  - The 6th card is clipped at 1440 px, which forces a sideways page scroll.
  - Active Outbreaks ignores the region filter.
- **Period menu [repro]:** two "All" entries.
- **Resource [repro]:** a programme filter is granted on the page but never shown.
- **Workshop [repro]:** "Public site" returns to the workshop; the footer has dead links.
- **Export trail [repro]:** promises logging that does not happen.
- **Admin [repro]:** three pages show the fallback heading "Admin › Admin"; one icon (`i-code`) is missing from the
  sprite.
- **Acceptance (one line per item):**
  - Each label equals the computed quantity.
  - The Period menu lists "All periods" once.
  - No `href="#"`.
  - Every admin heading equals its navigation label.

**DAP-F17 · S2 (at deploy time) · Control Tower repository UI and live gateway are incompatible.**
- **Observed [code]:** the repository `KpiCards.tsx` needs `kpis[].month`, which the live `ct.py` omits. Shipping the
  UI before the gateway turns all four stock-health cards to "no data".
- **Resolution:** deploy the gateway first, or both together (RR-004).
- **Acceptance:** a build of the repository UI against the deployed gateway renders values.

### 4.3 Data availability and correctness (D)

**DAP-D01 · S1 · Data-quality mart never built: Geographic Risk and Source Pulse blank.**
- **Observed [repro]:** `bi_quality.mart_data_quality` does not exist. Every query that references it fails:
  - the Disease map's main query (a reliability join), which blanks the whole widget;
  - `ov-source-pulse`;
  - `/api/dq/sources` and `/api/dq/dimensions`;
  - the admin DQ quality columns.
- **What a fixed query would show:** with that join stubbed, the map query returns 13 regions with burden, P(alarm),
  cases, CFR and data date. Harari is absent from the surveillance data.
- **Cause:** the dbt model `2_pipelines/marts/models/data_quality/mart_data_quality.sql` exists but was not built. The
  build logs are gone (RR-012).
- **Resolution:**
  - Build it, tolerating empty upstream sources.
  - Make the reliability join optional, so one missing input cannot blank the widget.
- **Acceptance:** `dz-region-map` returns `200` with ≥ 13 rows; the map shades; the side card shows numeric P(alarm),
  cases and CFR; source pulse renders.

**DAP-D02 · S1 · Disease detection models produce degenerate output.**
- **Observed [repro]:**

  | Model | Defect |
  |---|---|
  | EARS C1 | Predicted = observed in 51 of 53 weeks |
  | Farrington | Predicted = observed in 48 of 53 weeks |
  | Seasonal-naive | Expected ≈ 2.8× observed until the year boundary, then ≈ 0.36× |
  | EWARS-CSD | Every week flagged although observed is below the plotted threshold in all 53. "Climate-driven" with 100% NULL climate inputs |

- **Cause, confirmed in code and data:**
  - `n_years = g["year"].nunique()` counts *calendar* years
    (`bundle/seed-pack/app/ml/{ears,outbreak,seasonal}/train.py`, e.g. `ears/train.py:86-105`).
  - 53 weeks spanning 2025-W27 to 2026-W27 count as two years. That enables the same-week-of-other-years baseline, which
    exists only for W27.
  - Every other week then sets `mean = obs`.
  - Separately, the chart's national alarm is `max(alarm_flag)` over 44 woredas against a *summed* threshold
    (`fetchers.py:366-372`).
- **Resolution:**
  - Count seasons (≥ 104 weeks), or use the rolling-window branch.
  - Compute the national alarm on the aggregated series, or plot "woredas in alarm" separately.
  - Add a runner check that refuses to publish degenerate output (share of |predicted − observed| < 1 above 10%).
  - Retrain.
  - Until then, the models are withheld per DAP-F06.
- **Acceptance:**
  - For the latest run, fewer than 10% of rows have predicted = observed.
  - No step change at the year boundary for seasonal.
  - No flagged week where observed ≤ the plotted threshold.

**DAP-D03 · S1 · Reference vocabulary never loaded: every service metric is programme `OTHER`, and the cascades are arithmetically corrupt.**
- **Observed [repro]:**
  - `nhdw_ref.source_to_concept_map` and `nhdw_ref.concept` hold 0 rows.
  - All 547,965 HMIS rows and all 828 cascade rows carry programme `OTHER`.
  - The four cascade widgets are empty.
  - Any programme filter on Service returns nothing.
  - The Overview brief prints "OTHER retains 0.0% of entry cohort".
  - The HIV director sees no HIV data.
- **The cascade mart is also wrong, not just unreachable.** With one shared programme, the step-to-step `LAG` crosses
  programmes:
  - HIV viral suppression = 74,825 (99.8% × *skilled-birth* count) vs 13,607 ART starts.
  - Retention divides every step by HIV tests: ANC4 shows 21.8% where ANC4/ANC1 is 57.6%.
- **Cause:** the seed (`bundle/seeds/ref-vocab/build_vocab.py` → `3_storage/postgres/init/34_ref_vocab.sql`) was not
  loaded on the live system. `v_programme_resolution` defaults to `OTHER`, and `mart_programme_cascade.sql:97-117`
  partitions by programme.
- **Resolution:**
  - Load the vocabulary, then rebuild the business vault and marts.
  - Add dbt tests:
    - `programme_id` is not 100% `OTHER`;
    - unique `step_order` per partition;
    - cascade counts are non-increasing.
  - Use step-to-step ratios for test → positive → treatment funnels.
  - Stop silently dropping zero steps (`_shared/cascade.ts:20`).
  - One programme resolution for every mart.
- **Acceptance:**
  - ≥ 4 distinct programmes in the cascade mart.
  - Each cascade widget renders 3–4 non-increasing steps.
  - The HIV director sees HIV data.
  - The brief names a real programme.

**DAP-D04 · S2 · Supply (HCMIS), mBrana and climate sources never landed.**
- **Observed [repro]:** 0 rows from source to marts. This affects:
  - 9 of 11 Resource widgets;
  - readiness on the Disease map, the woreda table and the Overview reliability table;
  - the climate chart and correlation chart (legend lists three absent series);
  - zero-dose hotspot status.
- **Cause:** `[hyp]` the ingestors failed or were skipped during the 2026-09-22 seed (RR-301).
- **Resolution:**
  - Per-lane scope decision (DAP-Q03).
  - In-scope lanes are ingested under observation.
  - Out-of-scope widgets show "Source not connected", with legend entries only for drawn series.
- **Acceptance:** each affected widget shows either real values or "Source not connected"; never zeros, empty legends
  or "healthy" copy.

**DAP-D05 · S2 · Woreda identifiers do not match across sources.**
- **Observed [repro]:** surveillance woredas use synthetic ids (`WOR-AA-…`), the HMIS data uses DHIS2 ids. They share
  0 of 44 ids while all 44 names match, so woreda reliability is NULL everywhere.
- **Resolution:** join through a governed master-data woreda crosswalk.
- **Acceptance:** ≥ 40 of 44 woredas show reliability.

**DAP-D06 · S3 · Plausibility check needed on woreda incidence.**
- Up to 5,229.9 per 100,000 over 12 weeks (Nedjo Rural), against a regional maximum of 69.6.
- `[hyp]` The woreda population denominators do not fit the demo case volumes.
- **Acceptance:** documented denominators and a plausibility range before any figure is cited.

**DAP-D07 · S1 · Metric semantics: labels do not describe the numbers.**
- **Observed [repro]:**
  - **Service "coverage" is a reporting rate** (`mart_hmis_indicator_coverage.sql:156-158`). MMR, stunting and
    malaria incidence show "98.7% on_track".
  - **"Facilities reporting" = 19,128**, summed across 50 indicators (registry 893).
  - **The reliability composite counts the same metric twice**, and caps at 75 when readiness is missing.
  - **The risk score equals the coverage gap.**
  - **"Reporting completeness"** reads 100%, 91.1%, 97.5% and 99.1% on different widgets.
  - **Overview "silent facilities" = 893 (100%)**, from an empty heartbeat source on the wall clock.
  - **"This week"** shows the whole period.
  - **"Locations resolved to an MFR id"** measures the DHIS2 path.
  - **Cold chain:** "this quarter" = one month; "Linked AEFI" and "FHIR-linked" are false.
  - **Agreement donut:** labels ≥95 / 80–94 / <80 vs SQL ≥80 / 50–80 / <50; "vs last quarter" = previous month.
  - **Data-trust table:** "Facility" holds regions; "Expected/Actual" are per-facility rates.
  - **Zero-dose:** reach 12.2% of expected infants beside a public Penta3 of 96.9%, from different denominators.
- **Resolution:**
  - **Short term:** relabel (e.g. "Reporting rate"), drop the "on track" status for non-coverage indicators, and print
    the period and the n regions / facilities on each card.
  - **Then:** compute true indicator values.
  - Keep a metric dictionary with one definition per KPI name.
  - Derive "silent" from DHIS2 reporting at the data's own date.
- **Acceptance:**
  - No field labelled coverage is derived from `facilities_reporting / facilities_expected`.
  - Same label → same value for the same scope.
  - Each label's thresholds and period equal the SQL (unit test).

**DAP-D08 · S2 · Values that bypass the pipeline are labelled as observed.**
- **Observed [repro]:**
  - MNCH continuity and drop-off read a seeded table through a hand-written view with `period_month = '2026-Q1'` fixed
    (`3_storage/postgres/init/03_program_demo.sql`, `bi_programme.mnch_coverage_v`). They are labelled
    "EMR-active … retained", and one region shows a negative "gap".
  - The EMR side of DHIS2-vs-EMR agreement is the init-seeded demo patient table, not the EMR pipeline.
  - Public "national" KPIs cover 5 regions and about 67 facilities in the latest month.
- **Resolution:**
  - Rebuild MNCH from the HMIS mart through dbt with lineage, or label it "demo seed".
  - Re-point agreement at the EMR lane, or disclose it.
  - Print scope on public tiles.
- **Acceptance:**
  - Every widget's lineage reaches a lake source in the exposures file.
  - No hard-coded period in any view.
  - Public tiles print "n regions · YYYY-MM".

### 4.4 Configuration and branding (B)

**DAP-B01 · S2 · Raw template tokens on the public page.**
- **Observed [PO][repro]:** the copy API returns `hero.strip_owner = "Palladium · {ministry.native_name}"` and
  `hero.headline_native = "{platform.native_name}"`.
- **Cause:**
  - The live profile (`/opt/nhdw-profiles/et-v3`, on the host, not in git) was rebranded by hand, and its `native_name`
    fields were deleted.
  - The copy deck (lines 18 and 22) still references them.
  - The resolver (`routes/profile.py:294-307`) keeps unknown tokens visible by design.
- **Latent risk [repro, offline resolver over every profile × deck]:**
  - Only the live pair leaks today.
  - Switching to `zm-v1` with the Ethiopian deck would also leak `{geography.admin3.singular_lower}`.
  - The gateway's fallback profile would blank eight strings ("from ,", "Ministry of Health · ", "All "), against its
    own docstring.
- **Resolution:**
  - Remove the two tokens (or set them `""`).
  - Commit the agreed profile to git.
  - Add a CI and startup check that resolves every deck against every installed profile and fails on `{…}` or a
    trailing separator.
  - Make the fallback define every level used by any deck.
- **Acceptance:**
  - `curl …/api/proxy/profile/copy/public | grep -c '{'` = 0 for every installed profile.
  - The resolver check reports 0 unresolved and 0 dangling separators.

**DAP-B02 · S2 · Public branding hierarchy.**
- **Observed [PO][repro]:** "Palladium" appears 6 times: header wordmark, header tag, strip, footer brand, footer owner,
  and "official press releases from Palladium". That last one is a false attribution; the Zambian profile would say
  "from the Palladium".
- "Data Intelligence Platform" appears once, in the footer.
- **Cause:** the rebrand overloaded the profile's `ministry.*` and `platform.abbr` fields with the company name.
- **Resolution:**
  - A separate `brand` block in the profile (product, attribution, logo).
  - `ministry` stays the data owner.
  - Apply the hierarchy in §6.2.
- **Acceptance:**
  - A text scan of the public home finds "Palladium" exactly once, inside "Powered by Palladium", directly beneath
    "Data Intelligence Platform" in the header.
  - The newsroom names the ministry.

**DAP-B03 · S2 · Staff apps and backends show "NHDW", "National Health Data Warehouse", "FMoH Ethiopia".**
- **Observed [repro]:**
  - Sidebar wordmark "NHDW".
  - Page titles "NHDW Internal BI · Federal Ministry of Health · Ethiopia" and "NHDW Workshop · … · FMoH Ethiopia".
  - Splash "NHDW", "NHDW Assistant", "Request NHDW access".
  - Admin e-mail previews "National Health Data Warehouse".
  - dbt-docs bar "NHDW · Data lineage".
  - FastAPI titles "NHDW …" on public `/docs`.
  - Hard-coded "Ethiopia's regions" and "Of 14 regions".
- **Cause:** static `index.html` titles and literals. The profile could not reach the staff apps anyway (DAP-F01).
- **Resolution:** after DAP-F01, read every title and brand string from the profile, with the title pattern in §6.2.
- **Acceptance:**
  - No "NHDW", "National Health Data Warehouse", "Federal Ministry" or "FMoH" in any user-facing text or `<title>` on
    the audited hosts.
  - With `zm-v1` active, no "Ethiopia", "14 regions" or "woreda" on BI pages.

**DAP-B04 · S3 · Sidebar footer "NHDW v1.0 · PROD" has no backing.**
- **Observed [PO][repro]:** hard-coded at `internal-bi/ui/src/sections/Sidebar.tsx:77-81`. Nothing backs it: every
  image is the mutable `1.0.0`, there are no image labels, no version or environment variable, and `/health` has no
  version field.
- **Resolution:** remove it. Reintroduce it only from a build-SHA / environment endpoint (RR-004).
- **Acceptance:** the sidebar contains no version, environment or "NHDW" text.

**DAP-B05 · S3 · Keycloak login shows three identities.**
- **Observed [repro]:** "Sign in to Palladium" (realm display name set by hand on the live system; the seed still says
  "Ethiopia NHDW") + "National Health Data Warehouse" + "Federal Ministry of Health · Ethiopia" + the ministry emblem
  + "you@moh.gov.et".
- **Files:** `7_security/keycloak/themes/nhdw/login/template.ftl:8,18-20,53`, `login.ftl:5,13`,
  `7_security/keycloak/scripts/setup-keycloak.py:874-877`.
- **Resolution:** theme strings come from message keys set by the seed. Keep the theme name `nhdw`.
- **Acceptance:** the login page shows "Data Intelligence Platform" and "Powered by Palladium", with no "National Health
  Data Warehouse" and no "Federal Ministry". A reseed does not change it.

**DAP-B06 · S2 · The "product icon" is the Ethiopian Ministry of Health emblem.**
- **Observed [repro]:**
  - The public header and footer, the favicons of all four apps and the Keycloak logo are all `logo-fmoh.png`
    (identical file), whitened by CSS in the public header.
  - The live profile removed the logo, but the public app back-fills it from its bundled Ethiopian defaults.
  - The profile comment promising a "bundled Palladium wordmark" is false: no such asset exists in any app.
  - The BI upper-left shows no icon at all.
- **Resolution:**
  - A product mark is chosen (DAP-Q04) and shipped as the profile's `brand.logo`, plus a favicon.
  - Stop back-filling the ministry logo.
  - Every identity block shows the same asset, at the same 36–40 px treatment.
- **Acceptance:** public, BI, admin and workshop headers and favicons all show the agreed asset, and no non-Ethiopian
  profile requests `logo-fmoh.png`.

**DAP-B07 · S2 · Brand and profile source of truth live outside git; two "active profile" pointers disagree.**
- **Observed [repro]:**
  - `/opt/nhdw-state/ACTIVE` = `et-v3` and wins; `/opt/nhdw-profiles/ACTIVE` = `zm-v1`. Deleting the first flips the
    deployment to Zambia.
  - Repository and host profiles differ.
- **Resolution:** commit the profile; keep one pointer (RR-011).
- **Acceptance:** `diff -r bundle/profiles /opt/nhdw-profiles` is empty, and exactly one ACTIVE file exists.

**DAP-B08 · S3 · Title clean-up deletes scope and period.**
- **Observed [code]:** `PageRenderer.ts:305-311` strips trailing parentheses. "Maternal & Newborn Continuity of Care
  **(EMR-active)**" loses its scope; "Disease Snapshot **(This Week)**" loses its period.
- **Resolution:** explicit `scope` / `period` catalogue fields, rendered as chips.
- **Acceptance:** both chips are visible on their cards.

**DAP-B09 · S2 · Admin shows placeholder configuration as real.**
- **Observed [repro]:**
  - **SSO & identity:** Google "active" with `TODO_GOOGLE_CLIENT_ID`; Fayda "active" with issuer
    `http://localhost:8096`; "EHIA SAML Federation (mock)" active. The real login pages offer only "Continue with EHIA".
  - **Documentation:** base domain `127.0.0.1.nip.io` (hard-coded, `routes/observability.py:196-199`) and "No documents
    published" (the docs store is empty, RR-024).
  - **MDM queue:** mixes Ethiopian and Zambian test facilities.
  - **Health & topology:** hostname shows the fallback "nhdw-demo".
- **Resolution:**
  - Unconfigured identity providers show "available", not "active".
  - Remove `TODO`/localhost/mock values from the profile seed.
  - Base domain from settings.
  - Hostname from the pod's node name.
  - Filter MDM candidates to the active profile.
- **Acceptance:** a text scan of admin finds no `TODO`, `localhost`, `127.0.0.1` or "mock". Every "active" provider
  appears on the realm login page.

### 4.5 Requested visual and editorial changes (E)

| ID | Sev | Change | Where | Acceptance |
|---|---|---|---|---|
| DAP-E01 | S3 | Remove the "NHDW › {page}" breadcrumb (all BI pages) | `internal-bi/ui/src/sections/Topbar.tsx:70-74` | No breadcrumb on any BI page; heading unchanged |
| DAP-E02 | S3 | Disease: remove the "EWARS, notifiable diseases" eyebrow, the "Explore health burden…" line and the duplicate Geographic Risk section description (which also promises an unimplemented woreda drill) | `catalog/sections/internal-bi--disease--signal-header.yaml:4`, `…--geographic-risk.yaml:4`, `widgets/dz-region-map/widget.ts:184` | Strings absent from the live page and from `ops_perm.section` |
| DAP-E03 | S3 | Signal Header: remove the 10 secondary strings from card faces; add icons; add a Method & coverage view | `nhdw-gateway/app/fetchers.py:320-347`, `widgets/dz-kpi-strip/widget.ts:25-38` | Card face = label + value + ≤ 1 delta; one icon per card; the popover lists unit, period, denominator, coverage, data-through date, model status |
| DAP-E04 | S3 | Resource: remove the three requested strings; collapse "Act this week" repetition | `…--resource--supply-stress-geography.yaml:4`, `widgets/rm-act-week/widget.yaml:2`, `…--resource--act-this-week.yaml:3-4`, `widgets/rm-map/widget.ts:43` | Strings absent; each phrase appears once |
| DAP-E05 | S3 | Service: remove the five requested strings; keep scope and estimation basis in chips or tooltips | `sv-data-trust-table/widget.ts:52`, `sv-agreement-donut/widget.ts:29`, `sv-zero-dose/widget.ts:33`, `sv-risk-woredas/widget.ts:49`, `sv-dropoff-region/widget.ts:20` | Strings absent; tooltips carry the method (§6.1) |
| DAP-E06 | S4 | Recommended extension: remove page subtitles that restate the navigation, layout jargon ("Signal Header", "Headline") and narrating leads | `Topbar.tsx:23-27`; catalogue sections; leads listed in §6.1 | Each removed string listed in the PR |
| DAP-E07 | S3 | One shared ⓘ / methodology affordance per widget, fed from the catalogue (the `ops_perm.widget.description` column exists and is unused) | `runtime/PageRenderer.ts:317-323` | Every composite or estimated widget has an ⓘ whose text contains its formula or estimation basis |
| DAP-E08 | S4 | Icons: fix wrong-meaning navigation icons (warning triangle as the permanent Disease icon; upload arrow for Export; the same icon for two admin pages); add the missing `i-code` | sprite `static/assets/icons.html`; Sidebars | No blank icons; one meaning per icon |
| DAP-E09 | S3 | Health & topology presentation: one CPU and one memory figure per node; consistent GiB; real hostname; "avg req/s (5 min, logged routes)"; explain the 116 failed pods (leftover ML jobs) or filter them; remove the stale "#81" note | `routes/topology.py:590-622`, `TopoSummary.tsx:262-392` | One labelled figure per metric; hostname = node name |
| DAP-E10 | S3 | Model outputs: show probability bands (cap at "≥95%"), model name and run date; suppress "Immediate" for unvalidated models (RR-021) | `dz-*`, `ov-act-first-woredas` | No "100%" probability displayed |

### 4.6 Needs clarification or reproduction (Q)

| ID | Question | Why it cannot be resolved from evidence |
|---|---|---|
| DAP-Q01 | Where exactly did the product owner see "All regions" with a single option? | The public page has no geography selector. Candidates: BI "All areas" (DAP-F01) and admin "All regions (national)" (DAP-F01). A screenshot or URL would settle it |
| DAP-Q02 | Should a map click filter the whole page, or only inspect a region? | Both are defensible; the copy currently promises filtering, the code does inspection |
| DAP-Q03 | Which source lanes (HCMIS, mBrana, climate, MFR facilities) are in the demo scope? | It decides "ingest" versus "Source not connected" for 12+ widgets |
| DAP-Q04 | Which asset is the product mark? Does the ministry remain on the public page as data owner? Does the country appear in staff-app titles? | No product logo exists; it is a brand decision |
| DAP-Q05 | Should the security officer (R-OPS-SEC) have read-only classification access instead of write? | It is a role-design decision; least privilege suggests view-only |
| DAP-Q06 | Build a Backups & DR page, or remove it from the catalogue? | No backup job exists to report on (RR-102) |
| DAP-Q07 | How should the disputed "Contested" polygon be labelled on national maps? | Content and sensitivity decision for the data owner |
| DAP-Q08 | Health & topology ("Cluster Activity") had no specific complaint. Was a particular behaviour intended? | Data verified correct; only presentation issues found |

---

## 5. Data provenance and fallback audit

### 5.1 Origin classes

| Class | Meaning | Legitimate for a demo? |
|---|---|---|
| Operational telemetry | Live cluster state (k8s API, metrics-server, Prometheus, Loki, Hubble) | Yes |
| Pipeline-derived | Computed by dbt or the gateway from vault data | Yes, if correct |
| Historical source data | A real or replayed archive through the pipeline (Zambian eLMIS 2017–18) | Yes, if disclosed |
| Reference data | Facility registry, regions, population | Yes |
| Synthetic source fixture | Controlled demo data **inside a source system** that flows through the pipeline (DHIS2, IDSR, EMR demo dumps) | Yes, disclosed as demonstration data |
| Static editorial | Fixed text written into the UI or catalogue | Yes, if true |
| Sample data | Seeded straight into a reporting table, bypassing the pipeline | Only if labelled |
| Fallback output | Values the UI or API invents when its data call fails | **No** |

### 5.2 Flagged values

| Value (page) | What it actually comes from | When the dependency fails | Disclosed? |
|---|---|---|---|
| Public KPI tiles 96.9 … | DHIS2 synthetic fixture → pipeline (5 regions) | **Fallback output**: profile `fallback_kpis` / `KPIS_FALLBACK` (Penta3 40%…) | No |
| Public region bars, 24-month trend | Same | **Fallback output**: hard-coded 14 regions; `Math.random()` series | No |
| Open-data catalogue | **Fallback output** (manifest missing) | Live now | No |
| Open-data previews D-002…D-006 | Real pipeline files **under the wrong titles** | D-007…012 → invented `samplePreview` | No |
| `/api/series/*` | **Fallback output** (hard-coded) | Always | No |
| Newsroom | Static editorial seeded as mock bulletins (RR-008) | Bundled mock | No |
| Overview benchmarks 893 / 101.2M | Reference data | **Fallback output** 17,550 / 107.3M / 1,082 | No |
| Overview trust tiles, snapshot | Pipeline-derived over fixtures; definitions wrong (DAP-D07) | Empty copy | No |
| Overview / Disease P(alarm) | Pipeline-derived (degenerate models) | Empty copy | No |
| Resource zeros | Pipeline-derived over an **absent** source → zeros | "Healthy" empty copy | No |
| Resource cold chain 1,645 / 6,291 | DHIS2 fixture via pipeline; "quarter", "linked", "FHIR" claims false | Empty copy | Partly |
| Service coverage / flagship | DHIS2 fixture via pipeline; reporting rate mislabelled | Empty copy | No |
| Service agreement / data trust | DHIS2 fixture × **sample data** (init-seeded demo patient table) | Empty copy | No ("EMR-active") |
| Service MNCH continuity / drop-off | **Sample data** (seed table + hand view, fixed 2026-Q1) | Empty copy | No |
| Service cascades | Pipeline-derived, corrupted (DAP-D03) | Empty copy | No |
| Control Tower units 11.08M, OSA 99.7% | Historical source data, ≈4× inflated (RR-002) | Cached "No plan data" (live build) | Page disabled |
| Admin topology figures | Operational telemetry | Silent "loading…" or stale "live" | No |
| Admin alert routing rules | **Sample data** (seed SQL) | "No routing rules" | No |
| Admin identity providers | **Sample data** (seed YAML, incl. TODO, localhost, mock) | — | No |
| Admin DQ build health | Missing artefact → neutral zeros | — | No |
| Admin documentation "This deployment" | **Static editorial** with a wrong base domain | "No documents published" (also on read error) | No |

### 5.3 What happens when each dependency fails

| Dependency fails | Public | Internal BI | Admin |
|---|---|---|---|
| Gateway unreachable / `5xx` | **Invented KPIs, bars, random trend** | "No data" (same as empty), cached | Silent loading / stale "live" |
| `403` (not granted or disabled) | **Invented fallback** (a disabled public widget shows fake data) | "No data" | Raw JSON error; "nothing classified" |
| Empty mart | Honest hide (readiness) or wrong labels | **Zeros or "healthy" copy** | 0/0 neutral |
| Token expired | n/a | "No data for the selected filters" | Same |
| Profile/reference `401` | n/a (public proxy allows it) | No regions, codes, no maps, NHDW branding | National-only scope picker |

---

## 6. Presentation recommendations

### 6.1 Exact copy removals and where the methodology goes

**Treatment key**

| Code | Treatment |
|---|---|
| **T** | Widget ⓘ tooltip (DAP-E07) |
| **M** | Page Method & coverage panel |
| **L** | Short legend, column label or scope chip that stays visible |

| # | Remove | Where | Keep visible (L) | Move (T/M) |
|---|---|---|---|---|
| 1 | "NHDW › Disease Surveillance" (and every "NHDW › …") | `Topbar.tsx:70-74` | Page heading | — |
| 2 | "EWARS, notifiable diseases" | `…disease--signal-header.yaml:4` | — | M: "Source: IDSR/EWARS weekly notifiable-disease reports" |
| 3 | "Explore health burden and system readiness across Ethiopia's regions." | `dz-region-map/widget.ts:184` | "Focused on {region}" chip, only when a region is selected | — |
| 4 | Signal card: "Reporting completeness 100%" | `fetchers.py:322-323` | — | M: IDSR feed coverage, 2328 / 2332 woreda-weeks |
| 5 | Signal card: "Expected woreda-weeks 2328 / 2332" | `fetchers.py:330` | — | M: denominator (woredas ever reporting × weeks) |
| 6 | Signal card: "165 vs prior week" (duplicates "▲ 9% vs prior week") | `fetchers.py:326` | One delta: "▲ 9% vs prior week" | T: absolute change |
| 7 | Signal card: "Death reporting completeness" (no value behind it) | `fetchers.py:332` | — | M: "Deaths: IDSR weekly deaths; completeness not measured" |
| 8 | Signal card: "Woreda reliability" (no value behind it) | `fetchers.py:335` | — | M: reliability coverage (currently 0 of 44 woredas, DAP-D05) |
| 9 | Signal card: "Woreda-weeks received · Received / expected 2328 / 2332" | `fetchers.py:341-342` | Value only | M: numerator, denominator, window |
| 10 | Signal card: "Model ears" | `fetchers.py:346-347` | — | M: model display name, champion version, run date |
| 11 | "Where supply pressure concentrates…" | `…resource--supply-stress-geography.yaml:4` | — | T (rm-hotspots): "ranked worst-first, weighted by service volume" |
| 12 | "Act this week, outbreaks vs response stock." | `rm-act-week/widget.yaml:2` + eyebrow `…act-this-week.yaml:4` | Section title "Act this week" once | T: "Outbreaks with 4-week cases and trend vs the prior 4 weeks, against months of stock of each response commodity." Rename columns "Disease" and "Months of stock" |
| 13 | "Regions shaded by composite supply stress…" | `rm-map/widget.ts:43` | Legend with its **real** unit. The query returns `composite_score = drug_stress`, the **percentage of commodities under 3 months of stock (0–100)**, and the other two components are NULL. Do not label it "index 0–3" or describe a weighted composite until the components exist | T: definition of drug stress |
| 14 | "Facilities where DHIS2 reported counts diverge most from EMR records…" | `sv-data-trust-table/widget.ts:52` | Scope chip **only if true**: today the EMR side is a demo table (DAP-D08) | T: agreement = min/max × 100; band thresholds |
| 15 | "Across selected high-priority indicators, EMR-active facilities only" | `sv-agreement-donut/widget.ts:29` | Same chip rule | T: denominator, tolerance, indicator list; fix "vs last quarter" → "vs previous month" |
| 16 | "Comparative reach index. Expected infants are estimated as 3.2%…" | `sv-zero-dose/widget.ts:33` | "(est.)" in the column header | T: "Expected infants = population × 3.2% crude birth rate. Reach = Penta-1 doses per 1,000 expected infants." |
| 17 | "EMR-active, ranked worst-first" | `sv-risk-woredas/widget.ts:49` | **Drop "EMR-active"** (it is DHIS2 data) | T: the formula, once DAP-D07 makes it non-degenerate |
| 18 | "How each region's drop-off splits across the ANC, delivery and postnatal steps…" | `sv-dropoff-region/widget.ts:20` | Axis: "% of cohort lost at each stage" | T: stage definitions |

**Recommended in the same pass** (not requested; listed so the cleanup is consistent):
- the five page subtitles in `Topbar.tsx:23-27`;
- section descriptions for Geographic Risk, Outbreak Operations, Overview Reliability (move its composite note to T) and
  Care Cascades;
- the section names "Signal Header" and "Headline";
- the leads in `rm-stock-heatmap:21` (keep "months of stock" as L), `rm-hotspots:47`, `sv-facility-outliers:31` and
  `sv-flagship-table:55`.

**Never remove:**
- forecast status and run date (`rm-forecast`);
- "Estimated service loss";
- the clinical-audit caveat (`sv-compliance:41`);
- "this week" period labels;
- the "unfiltered" badge.

### 6.2 Branding hierarchy (all surfaces)

| Level | Text | Placement |
|---|---|---|
| Product | **Data Intelligence Platform** | Upper-left identity block on every surface (public header, BI/admin/workshop sidebar, dbt-docs bar, Keycloak brand) |
| Attribution | **Powered by Palladium** | Small line directly beneath the product name, **once per surface**. Not in the strip, footer or newsroom |
| Surface | Internal BI · Admin · Workshop · Data lineage | Second line in staff apps; middle of the `<title>` |
| Deployment context | Country only ("Ethiopia" / "Zambia"); the ministry as **data source**, if retained (DAP-Q04) | Public hero strip, footer ("Data: Ministry of Health, {country}"), BI "All {country}" filter label |
| Mark | One agreed product mark (DAP-Q04) | Identity block (36–40 px), favicon, Keycloak logo |

**Title pattern:** `{Page} · {Surface} · Data Intelligence Platform`. The public title is `Data Intelligence Platform ·
{country}`.

**Profile change:** add `brand: {product, attribution, logo}`, and keep `ministry` as the data owner. Overloading
`ministry` with the company name is what produced "press releases from Palladium".

### 6.3 Strings to replace (user-facing only)

**Shells**
- BI sidebar "NHDW" / "Internal BI"
- footer "NHDW v1.0 · PROD / National Health Data Warehouse"
- splash "NHDW"
- "NHDW Assistant"
- sign-in error title
- `<title>`s of public, internal-BI, admin and workshop
- workshop footer "Community Workshop Portal · NHDW" / "Ministry of Health"

**Public**
- "Request NHDW access"
- dashboards modal "FMoH staff"

**Admin**
- e-mail previews ("Your NHDW access request…", "National Health Data Warehouse", "Ministry of Health · NHDW",
  `https://nhdw.local/…`)
- "Admin › Admin" headings

**Other surfaces**
- dbt-docs "NHDW · Data lineage"
- Keycloak `template.ftl` and `login.ftl` brand lines
- FastAPI titles; these should also be hidden in production (RR-207)

**Hard-coded country**
- "Ethiopia's regions"
- "Of 14 regions"
- "HSTP-II"
- `moh.gov.et` placeholders

### 6.4 Do not rename (technical identifiers)

| Area | Identifiers |
|---|---|
| Keycloak | Realm names (`moh-staff`, `privileged-ops`, `ehia-saml-mock`, `master`); every clientId; client scope `nhdw-flat-roles`; role codes `R-*`; login theme name `nhdw` |
| Browser storage and globals | Session/local storage keys (`nhdw_*_at`, `nhdw.bi.display.*`); globals `window.__nhdw*`; map registration keys `nhdw-regions*` |
| CSS | Class names and keyframes |
| Tool gates | Cookies `nhdw_{tool}_gate`, path `/oauth2gate/*` |
| API and service paths | `/api/*`, `/gw/*`, `/api/proxy/*`; `/health` service names |
| Profiles and environment | Environment variables `NHDW_PROFILE*`; directories `/opt/nhdw-*`; profile keys `et-v3`, `zm-v1`; copy keys and placeholder names |
| Assets | File name `logo-fmoh.png`. Add a new asset; do not rename |
| Data stores | Databases, schemas, marts, buckets; legacy `MINIO_*` / `minio-secrets` |
| Kubernetes and images | Namespace and release `nhdw`; deployment and image names |
| Catalogue | All catalogue ids |
| Third-party | The FAB provider name `keycloak` |

User-facing strings that *display* an identifier should stop displaying it, while the identifier itself stays. Examples:
- "Bearer · privileged-ops";
- "Scanning nhdw-raw manifests…".

### 6.5 Icons (existing in-house sprite only)

**Signal Header**

| Card | Icon |
|---|---|
| Active outbreaks | `i-virus` |
| New cases | `i-trend-up` |
| Case fatality | `i-heart` |
| Highest-risk woreda | `i-pin` |
| Reporting completeness | `i-check-circle` |
| Alarm coverage | `i-pulse` |

Map the icon in the widget, not the SQL.

**Navigation**
- Replace the warning triangle (Disease) with a neutral surveillance icon.
- Replace the upload arrow (Export) with download.
- Give each admin page one distinct icon.
- Add `i-code`.

Avoid icons on composite or estimated metrics that imply precision or certainty.

---

## 7. Implementation plan

Bounded packages, ordered by dependency and impact. Each one is a single reviewable change set. Packages map onto the
release-readiness plan's WP-0/WP-2/WP-8 and refine them; they do not replace them.

| Package | Content | Findings | Prerequisites | Effort | Done when |
|---|---|---|---|---|---|
| **DAP-WP0 · Fail-closed scope** (gateway; pair with release-readiness WP-0 / RR-001) | `widget_data` refuses (or returns a scope stub) when a row-filter dimension cannot be applied; the UI treats locked values as active for hiding; unit test over every fetcher × scoped dimension | DAP-A02, DAP-A05 | None | 0.5–1 d | DAP-A02 acceptance; the anonymous and any-role audit read is closed |
| **DAP-WP1 · Authenticated profile and reference loading + option contracts** | `authFetch` (or a public proxy pass-through) for `/gw/profile*` in all three staff apps, the geometry loader and ReviewModal; filter options from `/api/permissions/filter/{id}/values`; programme separated from disease; one commodity key with a contract test; Period "All" de-duplicated | DAP-F01, DAP-F08, DAP-F16 (period) | None | 1–2 d | 0 × `401` on load; selector, maps, locked labels and admin picker per acceptance; every option returns rows |
| **DAP-WP2 · Honest states, no invented values** | Typed data-hook states; no failure caching; `401` → refresh/sign-in; sanitised `5xx`; remove every fallback dataset and `/api/series`; NULL → "—" with reasons; tri-state statuses; reassuring empty copy removed; Column Governance four states; map no-data style; P(alarm) scaling; model-select guard | DAP-F02, F03, F04, F05, F07, F11, F14 | DAP-WP1 (states are tested with real regions) | 3–5 d | Fault-injection suite: `403` / `502` / empty / expired / NULL each produce their own state; CI grep over bundles clean |
| **DAP-WP3 · Copy, branding and methodology** | §6.1 removals; ⓘ methodology component fed from the catalogue; `brand` profile block; identity block + title pattern on every surface; Keycloak theme keys; remove footer badge and breadcrumb; scope/period chips instead of title stripping; icons; profile committed to git; resolver CI check | DAP-E01–E10, DAP-B01–B08 | DAP-WP1 (staff apps must load the profile); decision DAP-Q04 for the mark | 3–5 d | Text scans per DAP-B02/B03/B05; resolver check green; every requested string absent |
| **DAP-WP4 · Data pipeline fixes** | Build `mart_data_quality` (optional joins); load the reference vocabulary; fix cascade partitioning and ratios; woreda crosswalk; relabel then recompute coverage; metric dictionary; MNCH through dbt or labelled; agreement re-pointed or disclosed; publish the open-data manifest with real titles | DAP-D01, D03, D05, D07, D08, DAP-F12 | Release-readiness WP-1 (marts rebuild window); decision DAP-Q03 | 5–8 d | Each D-finding acceptance; Trino replays per widget equal the dictionary definition |
| **DAP-WP5 · Disease model integrity** | Season-count fix; national alarm on the aggregate; degenerate-output guard in the runner; retrain; gateway-served list of selectable models with reasons; shared model context; caption with model and run | DAP-D02, DAP-F06, DAP-E10 | DAP-WP4 (climate decision) | 2–4 d | DAP-D02 / F06 acceptance |
| **DAP-WP6 · Governance and admin truthfulness** | Classification view/manage split and grants; navigation/API single gate + loader check; capability catalogue served; SQL tool and listing gates; tool registry for gates and tiles; topology authorisation; alert routing wired or labelled; DQ missing-artefact state; identity-provider and documentation placeholders; topology presentation and error states | DAP-A01, A03, A04, A06, DAP-F13, F15, DAP-B09, DAP-E09 | Decisions DAP-Q05, DAP-Q06 | 4–6 d | Each acceptance; persona matrix §8 passes |
| **DAP-WP7 · Filter behaviour** | Pinned-programme visibility; "latest month only" notes instead of hiding; map click behaviour per decision; debounce and abort; assistant registry generation guard | DAP-F09, DAP-F10, DAP-F07 | DAP-WP1; decision DAP-Q02 | 1–2 d | §8 filter combinations pass |

**Order and parallelism.**
- DAP-WP0 and DAP-WP1 run first and in parallel. They touch different code: the gateway versus the three UIs.
- DAP-WP2 follows DAP-WP1.
- DAP-WP3 can start its copy removals immediately; its brand work waits for DAP-WP1 and the logo decision.
- DAP-WP4 and DAP-WP5 are the long data track and depend on the release-readiness rebuild window.
- DAP-WP6 and DAP-WP7 are independent of the data track.

**For a demo**, the minimum is DAP-WP0 to DAP-WP3, plus "Source not connected" states for every widget DAP-WP4 has not
fixed.

---

## 8. Verification checklist

Run on the target build after each package. Every line has an observable outcome.

### 8.1 Roles

| Persona | Check | Expected |
|---|---|---|
| Anonymous | Public home, data, articles | No `{…}` tokens; "Palladium" once (in "Powered by Palladium"); no invented datasets; previews match titles |
| Anonymous | Gateway internal routes | `401`/`403` (RR-001, RR-207) |
| National analyst | All four BI pages | Region menu lists every region by name; 0 × `401`; maps draw |
| Regional user (Oromia) | All pages | One locked "Oromia"; tamper → `403`; no widget computed over other regions (DAP-A02) |
| HIV programme director | Disease, Service | HIV-only rows or an explicit scope notice; never national counts |
| Low-privilege researcher | BI, MLflow, Superset, SQL tool, listings | "No access" page; `403` at MLflow, SQL execute, marts and templates |
| Super-admin | Column Governance | 11 columns, 18 findings; can classify |
| Steward | Column Governance | Can view and classify (test environment only) |
| Security officer | Column Governance | View only; PUT `403` (after DAP-Q05) |
| Ops admin | Health & topology, Alert routing, DQ | Correct labels; no false alerts; DQ states its cause |

### 8.2 Filter combinations

| Combination | Expected |
|---|---|
| Region = each region × every BI page | Request carries `geography=<code>`; values change; no silent hides beyond the documented "latest month only" |
| Period = each option × Disease, Service, Resource | Window applies, or a "not filtered by period" note; one "All periods" entry |
| Programme = each offered option | ≥ 1 row on at least one widget; no duplicates; the MNCH cascade visible for MNCH |
| Commodity = each option (once supply data exists) | ≥ 1 row in the stock heatmap |
| Region + period + programme | One coalesced request wave; final state matches the last selection |
| Detection model = each option | Enabled options pass the acceptance check; disabled options show a reason; KPI strip names the same model |
| Five rapid picks | ≤ 1 completed request per widget; screen and assistant registry equal the last pick |
| Map click (per DAP-Q02) | Behaviour equals copy; a regional user cannot select outside scope |

### 8.3 Failure scenarios (inject in a test environment)

| Scenario | Expected |
|---|---|
| Gateway down | Public: "Data temporarily unavailable", no numbers. BI: "Couldn't load — retry" |
| `403` on a widget | "You don't have access to …" (BI); hidden (public) |
| `502` (missing table) | Error state with a correlation id; no SQL text in the response |
| Empty mart | "Source not connected" or "No data for this period"; never 0 or "healthy" |
| NULL field in a row | "—" with a reason; tri-state status "unknown" |
| Token expired mid-session | Silent refresh, or a sign-in prompt; never "No data for the selected filters" |
| Profile reference unavailable | Selector shows "Regions unavailable — retry"; no fallback country text |
| Classification request held / `403` / `500` / abort | Never "nothing classified" |
| Topology `/cluster` `500` | Error badge with the last good time |
| Open-data manifest missing | "No datasets published yet" |

---

## 9. Open questions and external dependencies

These are only the items that the evidence cannot settle. Details are in §4.6.

1. **DAP-Q01:** where the single-option "All regions" selector was seen. The public page has none.
2. **DAP-Q04:** the product mark; whether the ministry stays as data owner; whether the country appears in staff
   titles.
3. **DAP-Q03:** which source lanes are in demo scope. Ingesting HCMIS, mBrana, climate and MFR facilities needs source
   access or seeds from the data owner.
4. **DAP-Q02:** map click = filter or inspect.
5. **DAP-Q05:** security-officer classification rights.
6. **DAP-Q06:** Backups page: build or remove (depends on RR-102).
7. **DAP-Q07:** treatment of the "Contested" map polygon.
8. **Data owner input for DAP-D06 and DAP-D07:** canonical denominators (population year, facility universe, region
   set) and indicator targets.
9. **Release-readiness decisions D1/D4:** the demo profile and the Control Tower planning basis. They gate the Control
   Tower rows of this review.

---

## Summary

**Confirmed blockers for a customer demo.**

| Blocker | Findings |
|---|---|
| Profile and reference data fetched without the token: one defect, many symptoms (single-option geography selector, region codes, maps unable to draw, "NHDW" branding, national-only admin scope picker) | DAP-F01 |
| Scoped users silently receive national data where the mart lacks the scope column | DAP-A02 |
| Invented content on the public page and in fallbacks: catalogue with wrong-file previews, KPI/bar/random-trend fallbacks, benchmark defaults | DAP-F03, DAP-F12 |
| Missing data shown as zeros or "healthy" | DAP-F02 |
| Health metrics that mean something other than their labels; cascades corrupted by an unloaded vocabulary | DAP-D07, DAP-D03 |
| Disease models whose expected line copies the observations | DAP-D02 |
| Geographic Risk blank because one mart was never built | DAP-D01 |
| Raw tokens and a three-way brand split | DAP-B01, B02, B03, B05, B06 |
| Column Governance: super-admin denied, and states that claim "nothing classified" on failure | DAP-A01, DAP-F05 |

**First package to execute: DAP-WP0 together with DAP-WP1.**
- **DAP-WP0** makes the gateway refuse, rather than drop, a scope it cannot apply, alongside the release-readiness
  audit-route fix.
- **DAP-WP1** makes the three staff apps load profile, reference and map geometry with the user's token, and aligns
  filter option values with the data keys.

Together they take about 2–3 engineer-days and touch separate code. They remove the most visible breakage (the
selector, the maps, the branding source) and the one access-control fail-open, and every later package depends on
them.
