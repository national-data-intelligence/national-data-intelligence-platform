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

**Evidence in the repository.** [`dashboard-review-evidence/`](dashboard-review-evidence/README.md) holds, for every
runtime finding:
- the screenshots, named by finding ID, with how each was produced;
- the measurements, with the read-only commands to re-run them;
- the complete [legacy-identity inventory](dashboard-review-evidence/legacy-identity-inventory.md);
- the [first-frame identity test](dashboard-review-evidence/identity-flash/README.md): a harness, a baseline and frames.

Full raw logs (192 screenshots, 111 videos, 2,531 frames) are retained by the review owner.

---

## 0. Scope and priorities

**The priority is consistent, functioning access points and completion of the product owner's listed feedback.** Every
finding below is tagged:

| Tag | Meaning |
|---|---|
| **[Core]** | Required: it is in the feedback, or it is a confirmed defect that stops an access point from working correctly or consistently. |
| **[Separate]** | Additional architectural, editorial or hardening work. It is listed so it is not lost, but it is **not** part of the feedback delivery and is scheduled only on request (§8.2). |

**Ground rules for the Core work, from the product owner:**

1. **No legacy identity anywhere.** All legacy product identity ("NHDW", "National Health Data Warehouse", the ministry
   as brand, the ministry emblem as product icon) is removed from every access point, in every state, on every country
   profile. The states include:
   - static HTML titles and favicons;
   - loading and sign-in splashes;
   - fallback profile values;
   - login, logout and error pages;
   - session-expiry states;
   - e-mails and API titles.

   See DAP-B10.
2. **No old identity in any rendered frame.** It must not appear before the profile loads, while it loads slowly, or
   after it fails. This is checked from the first rendered frame across cold load, refresh, hard refresh, direct links,
   navigation, slow and failed profile requests, and cached-client updates. See DAP-B11.
3. **"Source not connected" is an honest state, not a delivered feature.** §5 states, widget by widget:
   - which metrics will actually work after the Core fixes;
   - which cannot work until someone decides the scope or supplies data.
4. **Acceptance checks test correct behaviour.** They are not arbitrary percentages or row counts. Model checks test
   what each method is defined to compute. Filter checks test equality with the data actually available to the user.

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
   - **A first-frame test of 116 scenarios found the legacy identity on every first-party access point, from the first
     painted frame (about 20–190 ms).**
     - BI, admin and workshop never show anything else.
     - The public site paints the old identity first, switches only when the profile arrives, and keeps the old
       identity if the profile request fails.
     - "Data Intelligence Platform" is never visible on any first screen.
     - The inventory lists 99 legacy occurrences across 9 access-point groups and 14 UI states (DAP-B10, DAP-B11).

**Demo readiness.** Not ready. The fastest credible path:
- First, preserve the live-only changes in git and rebuild from one tagged commit (§8.0).
- Then fix the plumbing and fail-closed scoping (C1, C2).
- Then one identity from the first frame, the requested copy removals, and honest states (C3, C4, C5).

Data and model fixes (C6, C7) decide which Service and Disease metrics can be shown. §5 lists exactly which metrics will
work and which wait on a scope decision. Resource Management cannot be delivered as a working dashboard without the
supply source.
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
| S1 | Replace visible "NHDW" / "National Health Data Warehouse" | Reproduced | DAP-B03, DAP-B05 | Profile-driven wordmark; replace about 20 hard-coded strings (list in §7.3) |
| S2 | Sidebar footer "NHDW v1.0 · PROD" | Reproduced; **no deployment metadata exists to back it** (mutable `1.0.0` tags, no labels, no version endpoint) | DAP-B04 | Remove it. Show a version only after a build-SHA endpoint exists (RR-004) |
| S3 | Reuse the public page's product icon in the upper-left | Reproduced, **with a caveat**: the public "product icon" is the Ethiopian Ministry of Health emblem (`logo-fmoh.png`, whitened by CSS). No Palladium or product logo exists anywhere in the apps | DAP-B06, DAP-Q04 | Decision needed on the mark; then one asset in every identity block and favicon |
| S4 | Naming, icon, spacing and attribution consistency across access points | Reproduced: inconsistent on all 9 surfaces checked | DAP-B03, DAP-B05, DAP-E08 | One identity block and one title pattern (§7.2) |
| S5 | Do not rename technical identifiers | Request | §7.4 don't-touch list | — |

### 2.3 Disease Surveillance

| # | Comment | Status | Findings | Proposed resolution |
|---|---|---|---|---|
| DS1 | Remove "NHDW › Disease Surveillance" breadcrumb | Reproduced; it is the shared top bar, on **every** BI page | DAP-E01 | Delete it once in `Topbar.tsx` |
| DS2 | Icons for the Signal Header cards | Reproduced: **no icon renders**, because the widget never reads the field; 3 of the gateway's icon names do not exist in the sprite | DAP-E03 | One existing sprite icon per card (§7.1) |
| DS3 | Remove the "EWARS, notifiable diseases" intro | Reproduced | DAP-E02 | Clear the section eyebrow (catalogue seed + reseed) |
| DS4 | Remove the secondary card strings (completeness %, expected woreda-weeks, death reporting completeness, woreda reliability, received/expected, model ids) | Reproduced: 10 strings. Two are labels with **no value behind them**; one count appears twice | DAP-E03 | Card face = label, value, at most one delta |
| DS5 | Which of those stay available in a methodology view | — | DAP-E03, DAP-E07 | Method & coverage popover (§7.1) |
| DS6 | Investigate every empty value in Geographic Risk | Reproduced: the whole widget is blank because one missing data-quality table fails its query (`502` shown as "no data"). Once fixed, readiness stays empty (no supply feed), reliability stays empty (woreda ids do not match across sources), and the map would mis-colour missing data as zero | DAP-D01, DAP-D05, DAP-D06, DAP-F04, DAP-F14 | Build the mart; make reliability optional; show "no data" distinctly |
| DS7 | Remove "Explore health burden and system readiness across Ethiopia's regions." | Reproduced (it also hard-codes "Ethiopia") | DAP-E02 | Delete it |
| DS8 | Test every Detection Model option; only EARS C1 appeared to work | **Partly.** All four return data and render. **None is correct.** EARS only looks right | DAP-D02, DAP-F06 | Fix the season-count bug; withhold failing models with a reason |
| DS9 | Verify model ids, parameters, backend support, prediction coverage, chart contracts | Investigated: all four ids are accepted; each has 23,320 predictions per run (44 woredas × 10 diseases × 53 weeks); all registered as champion v1; the chart contract matches | DAP-D02, DAP-F06 | — |
| DS10 | Unsupported models must not appear as working controls | Reproduced: no gating exists | DAP-F06 | Disable with a tooltip reason until a model passes an acceptance check |
| DS11 | Geography selector issue here too | Reproduced | DAP-F01 | — |

### 2.4 Resource Management

| # | Comment | Status | Findings | Proposed resolution |
|---|---|---|---|---|
| RM1 | Audit every empty KPI and chart | Reproduced: 9 of 11 widgets empty or zero; the supply feed (HCMIS) never landed | DAP-D04, DAP-F02, §6 | "Source not connected" states, never zeros |
| RM2 | Remove "Where supply pressure concentrates…" | Reproduced (catalogue section text) | DAP-E04 | Delete it; weighting note to the tooltip |
| RM3 | Remove "Act this week, outbreaks vs response stock." | Reproduced; the phrase appears **three times** (eyebrow, section title, card title) | DAP-E04 | Card title = section title; eyebrow removed |
| RM4 | Remove "Regions shaded by composite supply stress…" | Reproduced | DAP-E04 | Delete it. Note: the "composite" is really drug stress only (§7.1) |
| RM5 | Do map clicks filter or drill down? | Reproduced *[fixture]*: **neither**. A click updates only the card's own info strip; no request fires and no other widget changes | DAP-F10, DAP-Q02 | Decision: make a click set the page region, or change the copy |
| RM6 | Geography selector and its effect on every widget | Reproduced: picking a region hides 5 of 11 Resource cards; picking a period hides 8 of 11; the map only zooms | DAP-F01, DAP-F09 | Keep cards visible with a "latest month only" note |

### 2.5 Service Performance

| # | Comment | Status | Findings | Proposed resolution |
|---|---|---|---|---|
| SV1 | Audit every empty KPI and chart | Reproduced: four cascades empty; programme filter turns every card to 0; several values mislabelled | DAP-D03, DAP-D07, DAP-F03 | Fix the pipeline; empty states |
| SV2–SV6 | Remove five explanatory strings | All reproduced | DAP-E05 | Delete; keep the scope chip and move the method to a tooltip (§7.1) |
| SV7 | Preserve scope and estimation assumptions in a secondary location | — | DAP-E05, DAP-E07 | "EMR-active" scope chip **only where true**; "3.2% crude birth rate" estimate in the tooltip |
| SV8 | Geography filtering, denominator consistency, cross-source agreement, cascade calculations | Reproduced. Geography narrows correctly. Denominators disagree across the platform (ANC4 55.6% / 83.1% / 57.6%). The EMR side of "agreement" is a seeded demo table, not the EMR pipeline. The cascade maths divides every step by HIV tests and multiplies across programmes | DAP-D03, DAP-D07, DAP-D08 | §6.3 |

### 2.6 Admin

| # | Comment | Status | Findings | Proposed resolution |
|---|---|---|---|---|
| AD1 | Review "Cluster Activity" (no defect named) | Investigated. No page has this name; it maps to **Health & topology**. Every number matched kubectl, metrics-server and Prometheus at the same moment. **No data defect.** Presentation and error-state weaknesses only | DAP-E09, DAP-F13 | Label fixes; explicit stale and error states |
| AD2 | Column Governance shows `403 missing capability: manage_classification` | Reproduced for super-admin and root | DAP-A01 | Split read from write; least-privilege grants |
| AD3 | Do not remove the check or grant broad permissions | Respected | DAP-A01 | — |
| AD4 | Distinguish loading / denied / failure / loaded-empty | Reproduced: **"nothing classified" shows while loading, on 403, on 500 and on network failure** | DAP-F05 | Four explicit states |
| AD5 | Unauthorised users get an appropriate interface; stewards can complete the workflow | Partly. Stewards and ops admins see everything and have the controls (not saved). Super-admin sees a page it cannot use. The security officer can call the API but cannot see the page | DAP-A01, DAP-Q05 | One gate for navigation and API |
| AD6 | Audit suspected dummy data throughout Admin | Reproduced (§7.2): sample alert recipients that nothing reads; placeholder identity providers marked "active"; a hard-coded `127.0.0.1` base domain; "0/0 · 0.0s" build health from a missing artefact | DAP-B09, DAP-F12, DAP-F15 | §6.4 |

### 2.7 Cross-cutting patterns (section 4 of the brief)

| # | Pattern | Result | Findings |
|### 2.8 Revision requirements (second round of product-owner feedback)

| # | Requirement | Where addressed |
|---|---|---|
| V1 | Priority is consistent, functioning access points and the listed feedback; keep other work separate unless needed to fix a confirmed defect | §0, [Core]/[Separate] tag on every finding, §8.1 vs §8.2 |
| V2 | Remove all legacy product wording and branding across every access point, state and profile | DAP-B10; [inventory](dashboard-review-evidence/legacy-identity-inventory.md) (99 rows) |
| V3 | No old identity may flash before the profile loads; verify from the first rendered frame across all load paths | DAP-B11; [harness, baseline and frames](dashboard-review-evidence/identity-flash/README.md) |
| V4 | "Source not connected" is not completion; say which metrics will work and which need a scope decision | §5 |
| V5 | Replace arbitrary model and filter thresholds with checks of correct behaviour | DAP-D01, D02, D03, D05, F06, F07, F08, F13, F14; §9 |
| V6 | Accessible evidence paths for the runtime findings | `Evidence:` line on each runtime finding → [`dashboard-review-evidence/`](dashboard-review-evidence/README.md) |

---|---|---|---|
| X1 | Empty metrics: trace source → render | Done for every mounted widget on Overview, Disease, Resource, Service and the public portal (§6) | DAP-D01…D08, DAP-F02 |
| X2 | Filters: option source, scope, request effect, global/local, combinations, races, null-vs-zero maps | Done (§4.2) | DAP-F01, F07–F11, A02 |
| X3 | Static and fallback data classification | Done (§6) | DAP-F03, DAP-F12, DAP-D07 |
| X4 | Copy, branding, interaction | Done (§7) | DAP-B*, DAP-E*, DAP-F16 |

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

### 3.9 Identity in every rendered frame (first-frame test, 116 scenarios)

| Access point | Scenarios run | Result today | Evidence |
|---|---|---|---|
| Public | 12 | LEGACY in 11 (switches to "Palladium" only when the profile loads; stays legacy on slow or failed profile); 404 CLEAN | [frames](dashboard-review-evidence/identity-flash/frames/public-cold-first-frames-bundled-legacy.jpg) |
| Internal BI | 16 | LEGACY in 15; target never shown; 404 CLEAN | [frame](dashboard-review-evidence/identity-flash/frames/internal-bi-cold-final-shell.jpg) |
| Admin | 16 | LEGACY in 15; 404 CLEAN | [frame](dashboard-review-evidence/identity-flash/frames/admin-cold-final-shell.jpg) |
| Workshop | 16 | LEGACY in 15; 404 CLEAN | [frame](dashboard-review-evidence/identity-flash/frames/workshop-cold-final-shell.jpg) |
| Keycloak (2 realms) | 10 | LEGACY in 8; 404 CLEAN in 2 | [frame](dashboard-review-evidence/identity-flash/frames/keycloak-moh-staff-login.jpg) |
| dbt-docs | 7 | LEGACY in 6; 1 BLOCKED | [frame](dashboard-review-evidence/identity-flash/frames/dbt-docs-cold.jpg) |
| Tool gates (5) | 39 | FLASH 9 (the Keycloak page during sign-in); CLEAN 30 (stock tool UI, 404s) | [baseline](dashboard-review-evidence/identity-flash/README.md) |

Total: 116 scenarios (70 LEGACY, 9 FLASH, 36 CLEAN, 1 BLOCKED). The 404s are CLEAN only because they show no identity at all
(raw JSON or a stock page).

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

**DAP-A01 · S2 · [Core] · Column Governance: super-admin denied; read gated on write.**
- **Evidence:** [`DAP-A01-column-governance-superadmin-403.jpg`](dashboard-review-evidence/screens/DAP-A01-column-governance-superadmin-403.jpg), [`DAP-A01-column-governance-ops-admin-ok.jpg`](dashboard-review-evidence/screens/DAP-A01-column-governance-ops-admin-ok.jpg) · [index](dashboard-review-evidence/README.md)
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

**DAP-A02 · S1 · [Core] · A scoped user's scope is dropped when the data has no matching column (fails open).**
- **Evidence:** [`DAP-A02-hiv-director-disease-national-rows.jpg`](dashboard-review-evidence/screens/DAP-A02-hiv-director-disease-national-rows.jpg) · [index](dashboard-review-evidence/README.md)
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

**DAP-A03 · S2 · [Core] · SQL tool and listings lack capability checks.**
- **Evidence:** measurements table (DAP-A03) · [index](dashboard-review-evidence/README.md)
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

**DAP-A04 · S2 · [Core] · Tool tiles and tool gates disagree.**
- **Evidence:** [`DAP-A04-researcher-mlflow.jpg`](dashboard-review-evidence/screens/DAP-A04-researcher-mlflow.jpg), [`DAP-A04-researcher-superset.jpg`](dashboard-review-evidence/screens/DAP-A04-researcher-superset.jpg) · [index](dashboard-review-evidence/README.md)
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

**DAP-A05 · S2 · [Core] · Audit log readable by every role (and anonymously).**
- **Evidence:** release-readiness RR-001 · [index](dashboard-review-evidence/README.md)
- Re-confirmed: steward.ops gets `200` on `/gw/audit/events`.
- Tracked as **RR-001**; fix there.

**DAP-A06 · S3 · [Separate] · Minor governance gaps.**
- **Evidence:** code and screenshots in the evidence index · [index](dashboard-review-evidence/README.md)
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

**DAP-F01 · S2 · [Core] · Staff apps load profile, reference and map data without the user's token (one root cause, many symptoms).**
- **Evidence:** [`DAP-F01-bi-region-selector-all-areas.jpg`](dashboard-review-evidence/screens/DAP-F01-bi-region-selector-all-areas.jpg), [`DAP-F01-bi-disease-as-deployed.jpg`](dashboard-review-evidence/screens/DAP-F01-bi-disease-as-deployed.jpg), [`DAP-F01-bi-disease-with-token-simulated.jpg`](dashboard-review-evidence/screens/DAP-F01-bi-disease-with-token-simulated.jpg), [`DAP-F01-bi-locked-chip-raw-code-OR.jpg`](dashboard-review-evidence/screens/DAP-F01-bi-locked-chip-raw-code-OR.jpg), [`DAP-F01-map-geometry-401-fixture.jpg`](dashboard-review-evidence/screens/DAP-F01-map-geometry-401-fixture.jpg) · [index](dashboard-review-evidence/README.md)
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

**DAP-F02 · S1 · [Core] · Missing data rendered as zero or as good news.**
- **Evidence:** [`DAP-F02-resource-zeros.jpg`](dashboard-review-evidence/screens/DAP-F02-resource-zeros.jpg), [`DAP-F02-service-programme-MNCH-zeros.jpg`](dashboard-review-evidence/screens/DAP-F02-service-programme-MNCH-zeros.jpg) · [index](dashboard-review-evidence/README.md)
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

**DAP-F03 · S1 · [Core] · Fabricated fallback content on failure.**
- **Evidence:** measurements table (DAP-F03) · [index](dashboard-review-evidence/README.md)
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

**DAP-F04 · S2 · [Core] · Errors shown as "no data" and cached for the session.**
- **Evidence:** [`DAP-F04-D01-geographic-risk-502-as-no-data.jpg`](dashboard-review-evidence/screens/DAP-F04-D01-geographic-risk-502-as-no-data.jpg) · [index](dashboard-review-evidence/README.md)
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

**DAP-F05 · S2 · [Core] · Column Governance shows "nothing classified" when it does not know.**
- **Evidence:** [`DAP-F05-classified-loading-simulated.jpg`](dashboard-review-evidence/screens/DAP-F05-classified-loading-simulated.jpg), [`DAP-F05-classified-403-simulated.jpg`](dashboard-review-evidence/screens/DAP-F05-classified-403-simulated.jpg), [`DAP-F05-classified-500-simulated.jpg`](dashboard-review-evidence/screens/DAP-F05-classified-500-simulated.jpg), [`DAP-F05-classified-abort-simulated.jpg`](dashboard-review-evidence/screens/DAP-F05-classified-abort-simulated.jpg), [`DAP-F05-classified-empty200-simulated.jpg`](dashboard-review-evidence/screens/DAP-F05-classified-empty200-simulated.jpg), [`DAP-F05-review-500-simulated.jpg`](dashboard-review-evidence/screens/DAP-F05-review-500-simulated.jpg) · [index](dashboard-review-evidence/README.md)
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

**DAP-F06 · S2 · [Core] · Detection-model selector offers models that are broken, and the rest of the page ignores the choice.**
- **Evidence:** [`DAP-D02-signal-ears.jpg`](dashboard-review-evidence/screens/DAP-D02-signal-ears.jpg), [`DAP-D02-signal-ewars-csd.jpg`](dashboard-review-evidence/screens/DAP-D02-signal-ewars-csd.jpg) · [index](dashboard-review-evidence/README.md)
- **Observed [PO][repro]:**
  - All four options are selectable and all three model defects in DAP-D02 render as if valid.
  - The KPI strip, map and woreda table never send a model and always show EARS ("Model ears").
  - The selection resets on redraw.
  - The chart caption does not name the model.
- **Resolution:**
  - Serve the list of selectable models from the gateway. A model is offered only when its latest run passed that
    method's own behaviour checks (DAP-D02), and its inputs exist:
    - same-week-of-previous-years methods need the same week in earlier years;
    - EWARS-CSD needs climate inputs.
  - Otherwise the option is disabled, with the method's own reason, e.g. "Withheld: no earlier years of this week to
    compare against" or "Withheld: no climate data".
  - Either share the choice across the page, or label the other widgets with the fixed model.
  - Put the model name and run date in the caption.
- **Acceptance:**
  - Every enabled option's latest run passed the DAP-D02 behaviour checks, and the gateway refuses to offer one that
    did not.
  - Every disabled option shows its method-specific reason.
  - The KPI strip names the same model as the chart.

**DAP-F07 · S3 · [Core] · Model select can display a stale chart.**
- **Evidence:** [`DAP-F07-model-select-stale-chart-simulated-delay.jpg`](dashboard-review-evidence/screens/DAP-F07-model-select-stale-chart-simulated-delay.jpg), [`DAP-F07-farrington-baseline.jpg`](dashboard-review-evidence/screens/DAP-F07-farrington-baseline.jpg) · [index](dashboard-review-evidence/README.md)
- **Observed [repro]:** with Farrington delayed, picking Seasonal-naive leaves the select on "Seasonal-naive" over the
  Farrington series. The assistant's copy of widget data can also keep stale rows.
- **Cause:** `dz-signal-chart/widget.ts:63-87` has no request guard. `PageRenderer.ts:136` records without a
  generation check.
- **Resolution:** a per-widget sequence guard or AbortController; record only the current generation.
- **Acceptance:** a delayed earlier response never replaces the newer selection on screen or in the assistant registry.
- Note: global filter changes are already safe on screen; this was tested.

**DAP-F08 · S2 · [Core] · Filter option values do not match the data keys.**
- **Evidence:** measurements table (DAP-F08) · [index](dashboard-review-evidence/README.md)
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
  - For each filter on each page, the offered option values are **exactly** the distinct key values present in that
    page's data within the user's permitted scope. This is a set-equality test against `SELECT DISTINCT` under the
    same scope.
  - Each label appears once.
  - Selecting any option sends that key unchanged.

**DAP-F09 · S2 · [Core] · Filters hide the widgets the user asked about.**
- **Evidence:** [`DAP-F09-service-MNCH-cascades-hidden.jpg`](dashboard-review-evidence/screens/DAP-F09-service-MNCH-cascades-hidden.jpg), [`DAP-F09-resource-period-hides-8.jpg`](dashboard-review-evidence/screens/DAP-F09-resource-period-hides-8.jpg) · [index](dashboard-review-evidence/README.md)
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

**DAP-F10 · S3 · [Core] · Map clicks neither filter nor drill down.**
- **Evidence:** [`DAP-F10-F11-resource-map-click-fixture.jpg`](dashboard-review-evidence/screens/DAP-F10-F11-resource-map-click-fixture.jpg), [`DAP-F10-disease-map-click-fixture.jpg`](dashboard-review-evidence/screens/DAP-F10-disease-map-click-fixture.jpg) · [index](dashboard-review-evidence/README.md)
- **Observed [PO][fixture]:**
  - Resource map: a click updates only the card's own info strip. No request; chips unchanged.
  - Disease map: a click loads only a sparkline, although the section copy promises "worst-affected woredas".
- The `filterBus.ts` contract ("a map click sets geography") is not implemented: no widget calls `bus.set`.
- **Resolution:** owner decision (DAP-Q02).
  - Either a click sets the page Region for national users, and never outside a scoped user's allowed values;
  - or the copy says "click to inspect".
- **Acceptance:** the behaviour matches the copy. If filtering, clicking Amhara sets the chip and the woreda table
  refetches with `geography=AM`.

**DAP-F11 · S3 · [Core] · Maps draw missing data as zero.**
- **Evidence:** [`DAP-F10-F11-resource-map-click-fixture.jpg`](dashboard-review-evidence/screens/DAP-F10-F11-resource-map-click-fixture.jpg) · [index](dashboard-review-evidence/README.md)
- **Observed [fixture]:** a region with no data, a NULL region and a genuine zero share the lightest colour. The NULL
  region reads "Composite 0.0", "Low burden", "P(alarm) 0%".
- **Cause:** `_shared/charts.ts` `valFor` defaults to 0; `?? 0` in `rm-map` and `dz-region-map`.
- **Resolution:** a distinct no-data style; "No data" in the tooltip and ranking; exclude missing regions from the scale
  and the ranks.
- **Acceptance:** in the fixture, null and absent regions render grey with "No data", and a zero renders the zero colour
  with "0".

**DAP-F12 · S1 · [Core] · Public open-data catalogue is invented, and its previews show the wrong files.**
- **Evidence:** [`DAP-F12-public-open-data.jpg`](dashboard-review-evidence/screens/DAP-F12-public-open-data.jpg) · [index](dashboard-review-evidence/README.md)
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

**DAP-F13 · S3 · [Core] · Health & topology: error states and two weak signals.**
- **Evidence:** [`DAP-E09-health-topology.jpg`](dashboard-review-evidence/screens/DAP-E09-health-topology.jpg) · [index](dashboard-review-evidence/README.md)
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
  - The error count for a node equals an independent count of error-level log lines for that workload over the same
    window, excluding the log store's own query logs.

**DAP-F14 · S2 · [Core] · Probability shown as "1%" instead of 100%.**
- **Evidence:** [`DAP-F14-woreda-table-palarm-1pct.jpg`](dashboard-review-evidence/screens/DAP-F14-woreda-table-palarm-1pct.jpg) · [index](dashboard-review-evidence/README.md)
- **Observed [repro]:** the woreda table and the Overview act-first table print P(alarm) 1.000 as "1%" and 0.707 as
  "0.707%". The ≥60 alert colour can never fire.
- **Cause:** `_shared/charts.ts:242` appends "%" without scaling.
- **Resolution:** display probability × 100 as a percentage.
- **Acceptance:**
  - A unit test over 0, 0.5 and 1.0 renders "0%", "50%" and "100%".
  - The alert colour applies to the same values the action-priority rule treats as an alarm.

**DAP-F15 · S2 · [Core] · Admin operational pages present placeholders or stale state as working.**
- **Evidence:** [`DAP-F15-alert-routing.jpg`](dashboard-review-evidence/screens/DAP-F15-alert-routing.jpg), [`DAP-F15-quality-lineage.jpg`](dashboard-review-evidence/screens/DAP-F15-quality-lineage.jpg), [`DAP-F15-models-datasets.jpg`](dashboard-review-evidence/screens/DAP-F15-models-datasets.jpg) · [index](dashboard-review-evidence/README.md)
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

**DAP-F16 · S3 · [Core] · Labels, counts and links that contradict the data.**
- **Evidence:** [`DAP-F16-kpi-strip-clipped.jpg`](dashboard-review-evidence/screens/DAP-F16-kpi-strip-clipped.jpg), [`DAP-F16-workshop-public-site-link.jpg`](dashboard-review-evidence/screens/DAP-F16-workshop-public-site-link.jpg) · [index](dashboard-review-evidence/README.md)
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

**DAP-F17 · S2 (at deploy time) · [Core] · Control Tower repository UI and live gateway are incompatible.**
- **Evidence:** code only · [index](dashboard-review-evidence/README.md)
- **Observed [code]:** the repository `KpiCards.tsx` needs `kpis[].month`, which the live `ct.py` omits. Shipping the
  UI before the gateway turns all four stock-health cards to "no data".
- **Resolution:** deploy the gateway first, or both together (RR-004).
- **Acceptance:** a build of the repository UI against the deployed gateway renders values.

### 4.3 Data availability and correctness (D)

**DAP-D01 · S1 · [Core] · Data-quality mart never built: Geographic Risk and Source Pulse blank.**
- **Evidence:** [`DAP-F04-D01-geographic-risk-502-as-no-data.jpg`](dashboard-review-evidence/screens/DAP-F04-D01-geographic-risk-502-as-no-data.jpg) · [index](dashboard-review-evidence/README.md)
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
- **Acceptance:**
  - `dz-region-map` returns `200` with exactly one row for every region that has surveillance data in the window
    (equal to `count(DISTINCT region_id)` in the surveillance mart for the same filters).
  - Regions without data are drawn as "No data".
  - The side card shows numeric P(alarm), cases and CFR.
  - Source pulse renders a row for every source the data-quality mart tracks.
  - With the reliability input missing, the map still renders and reliability reads "not available".

**DAP-D02 · S1 · [Core] · Disease detection models produce degenerate output.**
- **Evidence:** [`DAP-D02-signal-ears.jpg`](dashboard-review-evidence/screens/DAP-D02-signal-ears.jpg), [`DAP-D02-signal-farrington.jpg`](dashboard-review-evidence/screens/DAP-D02-signal-farrington.jpg), [`DAP-D02-signal-seasonal.jpg`](dashboard-review-evidence/screens/DAP-D02-signal-seasonal.jpg), [`DAP-D02-signal-ewars-csd.jpg`](dashboard-review-evidence/screens/DAP-D02-signal-ewars-csd.jpg) · [index](dashboard-review-evidence/README.md)
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
  - Base each method on what it is defined to use:
    - same-week methods use only the same ISO week in **earlier** years, and report "insufficient history" when none
      exists;
    - the rolling method uses only the weeks **before** the target week.
  - Compute the national alarm on the aggregated series, or plot "woredas in alarm" separately.
  - Add behaviour tests to the model packages, and have the runner refuse to publish a run that fails them (below).
  - Retrain.
  - Until then, the models are withheld per DAP-F06.
- **Acceptance (behaviour, not thresholds):**
  - **No look-ahead.** Changing the observed count of week *t* leaves the expected value for week *t* (and earlier)
    unchanged, for every method. This is a unit test on a fixture series.
  - **Known answers:**
    - on a constant series, the expected value equals the constant and nothing is flagged;
    - on a series with one injected spike, the spike week is flagged and the baseline weeks are not;
    - for seasonal, a series with a repeating yearly pattern is reproduced, with no step at the year boundary.
  - **Missing history is a state, not a value.** A week whose method has no qualifying history returns "insufficient
    history", and the chart shows a gap with that reason.
  - **Alarm consistency.** The national alarm flag for a week is true exactly when the aggregated observed count
    exceeds the aggregated threshold plotted for that week (unit test on the fetcher).
  - **Runner gate.** A run that fails any of these tests is not published.

**DAP-D03 · S1 · [Core] · Reference vocabulary never loaded: every service metric is programme `OTHER`, and the cascades are arithmetically corrupt.**
- **Evidence:** [`DAP-D03-D07-service-page.jpg`](dashboard-review-evidence/screens/DAP-D03-D07-service-page.jpg) · [index](dashboard-review-evidence/README.md)
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
  - Every DHIS2 element's `programme_id` equals the programme the reference vocabulary assigns to it (a join test
    over all elements, no exceptions).
  - Each cascade step is computed within its own programme.
  - A step defined as a subset of its predecessor never exceeds it.
  - Retention divides by the same programme's entry step. This is a fixture test with hand-computed answers, e.g.
    ANC4/ANC1 = 103,053 / 178,938 = 57.6% for OR 2025.
  - The HIV director sees HIV rows.
  - The brief names the programme it actually computed.

**DAP-D04 · S2 · [Core] · Supply (HCMIS), mBrana and climate sources never landed.**
- **Evidence:** [`DAP-D04-disease-full-climate.jpg`](dashboard-review-evidence/screens/DAP-D04-disease-full-climate.jpg), [`DAP-F02-resource-zeros.jpg`](dashboard-review-evidence/screens/DAP-F02-resource-zeros.jpg) · [index](dashboard-review-evidence/README.md)
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

**DAP-D05 · S2 · [Core] · Woreda identifiers do not match across sources.**
- **Evidence:** measurements table · [index](dashboard-review-evidence/README.md)
- **Observed [repro]:** surveillance woredas use synthetic ids (`WOR-AA-…`), the HMIS data uses DHIS2 ids. They share
  0 of 44 ids while all 44 names match, so woreda reliability is NULL everywhere.
- **Resolution:** join through a governed master-data woreda crosswalk.
- **Acceptance:**
  - Every surveillance woreda with a crosswalk entry shows reliability.
  - Every woreda without an entry is listed with its reason and shows "not available".
  - The number of woredas with reliability equals the number of crosswalk matches.

**DAP-D06 · S3 · [Separate] · Plausibility check needed on woreda incidence.**
- **Evidence:** Trino replay · [index](dashboard-review-evidence/README.md)
- Up to 5,229.9 per 100,000 over 12 weeks (Nedjo Rural), against a regional maximum of 69.6.
- `[hyp]` The woreda population denominators do not fit the demo case volumes.
- **Acceptance:** documented denominators and a plausibility range before any figure is cited.

**DAP-D07 · S1 · [Core] · Metric semantics: labels do not describe the numbers.**
- **Evidence:** [`DAP-D03-D07-service-page.jpg`](dashboard-review-evidence/screens/DAP-D03-D07-service-page.jpg), [`DAP-D07-overview.jpg`](dashboard-review-evidence/screens/DAP-D07-overview.jpg) · [index](dashboard-review-evidence/README.md)
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

**DAP-D08 · S2 · [Core] · Values that bypass the pipeline are labelled as observed.**
- **Evidence:** code and SQL (see index) · [index](dashboard-review-evidence/README.md)
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

**DAP-B01 · S2 · [Core] · Raw template tokens on the public page.**
- **Evidence:** [`DAP-B01-B02-public-home.jpg`](dashboard-review-evidence/screens/DAP-B01-B02-public-home.jpg) · [index](dashboard-review-evidence/README.md)
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

**DAP-B02 · S2 · [Core] · Public branding hierarchy.**
- **Evidence:** [`DAP-B01-B02-public-home.jpg`](dashboard-review-evidence/screens/DAP-B01-B02-public-home.jpg) · [index](dashboard-review-evidence/README.md)
- **Observed [PO][repro]:** "Palladium" appears 6 times: header wordmark, header tag, strip, footer brand, footer owner,
  and "official press releases from Palladium". That last one is a false attribution; the Zambian profile would say
  "from the Palladium".
- "Data Intelligence Platform" appears once, in the footer.
- **Cause:** the rebrand overloaded the profile's `ministry.*` and `platform.abbr` fields with the company name.
- **Resolution:**
  - A separate `brand` block in the profile (product, attribution, logo).
  - `ministry` stays the data owner.
  - Apply the hierarchy in §7.2.
- **Acceptance:**
  - A text scan of the public home finds "Palladium" exactly once, inside "Powered by Palladium", directly beneath
    "Data Intelligence Platform" in the header.
  - The newsroom names the ministry.

**DAP-B03 · S2 · [Core] · Staff apps and backends show "NHDW", "National Health Data Warehouse", "FMoH Ethiopia".**
- **Evidence:** [`internal-bi-cold-final-shell.jpg`](dashboard-review-evidence/identity-flash/frames/internal-bi-cold-final-shell.jpg), [`admin-cold-final-shell.jpg`](dashboard-review-evidence/identity-flash/frames/admin-cold-final-shell.jpg), [`workshop-cold-final-shell.jpg`](dashboard-review-evidence/identity-flash/frames/workshop-cold-final-shell.jpg) · [index](dashboard-review-evidence/README.md)
- **Observed [repro]:**
  - Sidebar wordmark "NHDW".
  - Page titles "NHDW Internal BI · Federal Ministry of Health · Ethiopia" and "NHDW Workshop · … · FMoH Ethiopia".
  - Splash "NHDW", "NHDW Assistant", "Request NHDW access".
  - Admin e-mail previews "National Health Data Warehouse".
  - dbt-docs bar "NHDW · Data lineage".
  - FastAPI titles "NHDW …" on public `/docs`.
  - Hard-coded "Ethiopia's regions" and "Of 14 regions".
- **Cause:** static `index.html` titles and literals. The profile could not reach the staff apps anyway (DAP-F01).
- **Resolution:** after DAP-F01, read every title and brand string from the profile, with the title pattern in §7.2.
- **Acceptance:**
  - No "NHDW", "National Health Data Warehouse", "Federal Ministry" or "FMoH" in any user-facing text or `<title>` on
    the audited hosts.
  - With `zm-v1` active, no "Ethiopia", "14 regions" or "woreda" on BI pages.

**DAP-B04 · S3 · [Core] · Sidebar footer "NHDW v1.0 · PROD" has no backing.**
- **Evidence:** [`internal-bi-cold-final-shell.jpg`](dashboard-review-evidence/identity-flash/frames/internal-bi-cold-final-shell.jpg) · [index](dashboard-review-evidence/README.md)
- **Observed [PO][repro]:** hard-coded at `internal-bi/ui/src/sections/Sidebar.tsx:77-81`. Nothing backs it: every
  image is the mutable `1.0.0`, there are no image labels, no version or environment variable, and `/health` has no
  version field.
- **Resolution:** remove it. Reintroduce it only from a build-SHA / environment endpoint (RR-004).
- **Acceptance:** the sidebar contains no version, environment or "NHDW" text.

**DAP-B05 · S3 · [Core] · Keycloak login shows three identities.**
- **Evidence:** [`DAP-B05-keycloak-login.jpg`](dashboard-review-evidence/screens/DAP-B05-keycloak-login.jpg), [`keycloak-moh-staff-login.jpg`](dashboard-review-evidence/identity-flash/frames/keycloak-moh-staff-login.jpg) · [index](dashboard-review-evidence/README.md)
- **Observed [repro]:** "Sign in to Palladium" (realm display name set by hand on the live system; the seed still says
  "Ethiopia NHDW") + "National Health Data Warehouse" + "Federal Ministry of Health · Ethiopia" + the ministry emblem
  + "you@moh.gov.et".
- **Files:** `7_security/keycloak/themes/nhdw/login/template.ftl:8,18-20,53`, `login.ftl:5,13`,
  `7_security/keycloak/scripts/setup-keycloak.py:874-877`.
- **Resolution:** theme strings come from message keys set by the seed. Keep the theme name `nhdw`.
- **Acceptance:** the login page shows "Data Intelligence Platform" and "Powered by Palladium", with no "National Health
  Data Warehouse" and no "Federal Ministry". A reseed does not change it.

**DAP-B06 · S2 · [Core] · The "product icon" is the Ethiopian Ministry of Health emblem.**
- **Evidence:** [`public-cold-first-frames-bundled-legacy.jpg`](dashboard-review-evidence/identity-flash/frames/public-cold-first-frames-bundled-legacy.jpg) · [index](dashboard-review-evidence/README.md)
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

**DAP-B07 · S2 · [Core] · Brand and profile source of truth live outside git; two "active profile" pointers disagree.**
- **Evidence:** code and host-file diff · [index](dashboard-review-evidence/README.md)
- **Observed [repro]:**
  - `/opt/nhdw-state/ACTIVE` = `et-v3` and wins; `/opt/nhdw-profiles/ACTIVE` = `zm-v1`. Deleting the first flips the
    deployment to Zambia.
  - Repository and host profiles differ.
- **Resolution:** commit the profile; keep one pointer (RR-011).
- **Acceptance:** `diff -r bundle/profiles /opt/nhdw-profiles` is empty, and exactly one ACTIVE file exists.

**DAP-B08 · S3 · [Core] · Title clean-up deletes scope and period.**
- **Evidence:** code only · [index](dashboard-review-evidence/README.md)
- **Observed [code]:** `PageRenderer.ts:305-311` strips trailing parentheses. "Maternal & Newborn Continuity of Care
  **(EMR-active)**" loses its scope; "Disease Snapshot **(This Week)**" loses its period.
- **Resolution:** explicit `scope` / `period` catalogue fields, rendered as chips.
- **Acceptance:** both chips are visible on their cards.

**DAP-B09 · S2 · [Core] · Admin shows placeholder configuration as real.**
- **Evidence:** [`DAP-B09-sso-identity-placeholders.jpg`](dashboard-review-evidence/screens/DAP-B09-sso-identity-placeholders.jpg), [`DAP-B09-documentation-base-domain.jpg`](dashboard-review-evidence/screens/DAP-B09-documentation-base-domain.jpg), [`DAP-B09-mdm-mixed-profiles.jpg`](dashboard-review-evidence/screens/DAP-B09-mdm-mixed-profiles.jpg) · [index](dashboard-review-evidence/README.md)
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

**DAP-B10 · S1 · [Core] · Legacy product identity appears on every access point, in every state, on every profile.**
- **Evidence:** [legacy-identity inventory](dashboard-review-evidence/legacy-identity-inventory.md) (99 rows, LB-001…LB-152) · [first-frame frames](dashboard-review-evidence/identity-flash/README.md)
- **Observed [repro]:** the legacy identity ("NHDW", "National Health Data Warehouse", "Federal Ministry of Health" /
  "FMoH" as brand, the `logo-fmoh.png` emblem as product icon) appears in each of these states:

  | State | What is shown |
  |---|---|
  | Static HTML | `<title>` and favicon of public, internal BI, admin, workshop and dbt-docs. No code ever sets `document.title` |
  | Loading / sign-in splash | "NHDW / Signing you in…" (BI, admin, workshop), on every load and every token renewal |
  | Bundled fallback profile | Public: "NHDW", "Federal Ministry of Health · Ethiopia", Amharic lines, emblem. Staff apps: "NHDW" / "National Health Data Warehouse". Gateway fallback manifest: "NHDW" |
  | Authenticated shell | Sidebar "NHDW", "NHDW v1.0 · PROD / National Health Data Warehouse", "NHDW ›", "NHDW Assistant", workshop footer "… · NHDW / Ministry of Health" |
  | Login, logout, expired, error (Keycloak) | Emblem + "National Health Data Warehouse" + "Federal Ministry of Health · Ethiopia" on login, auth error, logout confirm, "Page has expired", "Cookie not found", reset and OTP pages, both realms |
  | Sign-in failure | `<title>` "Sign-in didn't complete: NHDW" (three apps) |
  | Session expiry | Splash "NHDW", then the Keycloak page above (there is no app-specific expiry screen) |
  | Public modals | "Request NHDW access", "FMoH staff", "FMoH data use agreement", "FMoH IT team", `@moh.gov.et` placeholder |
  | E-mails | "Your NHDW access is ready", "access to the Ethiopia National Health Data Warehouse", "[NHDW alert]", admin previews with `nhdw.local`, Keycloak sender "Ethiopia NHDW" |
  | API docs | "NHDW Gateway", "NHDW — Public Dashboard", "NHDW Internal BI / Admin / Workshop", "NHDW tool-gate · …" (publicly reachable) |
  | Export / report files | Citation line "NHDW · {mart} · exported by …" |
  | dbt-docs | Title and top bar "NHDW · Data lineage" |
  | Profiles in git | Repository profiles still say NHDW / (Federal) Ministry of Health, so a deploy from git restores them |

- **Every profile is affected.** All of the above is hard-coded or bundled, so the Zambia profile shows the same legacy
  identity. 20 further items hard-code Ethiopian context and would show on Zambia, including:
  - the public `<title>`;
  - the emblem, through the bundled merge;
  - the Articles intro;
  - the Fayda access form;
  - "All Ethiopia (national)";
  - the Keycloak footer;
  - the onboarding e-mail;
  - newsroom articles not filtered by profile.

  See the inventory, §5 of that file.
- **Cause [code]:** identity is written in five places that never consult the profile:
  - static `index.html`;
  - splash components;
  - bundled defaults;
  - Keycloak theme literals;
  - e-mail and API strings.

  In addition, the staff apps cannot read the profile at all (DAP-F01).
- **Resolution (Core):**
  1. **The bundled identity in every app is the target identity:** "Data Intelligence Platform", "Powered by Palladium",
     the new mark. It is country-neutral and used in `index.html`, the splash, the auth-error title, the shell
     fallback and the public `BUNDLED`.
  2. The profile adds only deployment context (country), never product identity.
  3. Keycloak theme and seed strings, realm display names and client names use the target identity.
  4. E-mail templates and API titles likewise.
  5. Ship the new mark under a **new file name** (browsers cache favicons).
  6. Commit the agreed profiles.
  7. Scope newsroom articles by profile.
  8. Technical identifiers stay (§7.4).
- **Acceptance (observable, every profile):**
  - The first-frame harness (DAP-B11) exits 0 for every host and scenario, run once with `et-v3` and once with `zm-v1`
    active (in a non-shared environment, or a maintenance window).
  - A text scan of every built bundle, `index.html`, Keycloak theme, e-mail template and API title finds no legacy
    pattern outside the don't-rename identifiers.
  - Each rendered e-mail template (approval, alert, Keycloak execute-actions) shows the target identity.
  - Export files cite "Data Intelligence Platform".

**DAP-B11 · S1 · [Core] · The old identity is visible from the first rendered frame.**
- **Evidence:** [first-frame baseline and harness](dashboard-review-evidence/identity-flash/README.md) · frames: [`public-cold-first-frames-bundled-legacy.jpg`](dashboard-review-evidence/identity-flash/frames/public-cold-first-frames-bundled-legacy.jpg), [`public-profile-500-legacy-stays.jpg`](dashboard-review-evidence/identity-flash/frames/public-profile-500-legacy-stays.jpg), [`internal-bi-cold-final-shell.jpg`](dashboard-review-evidence/identity-flash/frames/internal-bi-cold-final-shell.jpg), [`internal-bi-expired-session.jpg`](dashboard-review-evidence/identity-flash/frames/internal-bi-expired-session.jpg)
- **Observed [repro]:** 116 scenarios were sampled on every animation frame (title, favicon, visible text, images),
  with a screencast and video. The scenarios were: cold, SSO, reload, hard reload, deep link, in-app navigation, slow
  profile (5 s), aborted and 500 profile, warm cache, new-asset deploy, failed bundle, expired session, sign-in error,
  forbidden, Keycloak error, 404.

  | Status | Count | Where |
  |---|---|---|
  | LEGACY | 70 | public, internal BI, admin, workshop, both Keycloak realms, dbt-docs (every applicable scenario except 404s) |
  | FLASH | 9 | tool gates (Keycloak page, then the stock tool) |
  | CLEAN | 36 | gated tools after sign-in (30), raw 404s (6) |
  | BLOCKED | 1 | dbt-docs 404 hang (DAP-F19) |

  Counts are taken from the harness's own summary files.

  - The first legacy frame appears at about 20–190 ms.
  - **Public** paints the bundled legacy masthead and switches when the profile arrives (about 250 ms; 5.2 s under a
    slow profile). It **keeps the legacy identity permanently** if the profile request fails.
  - **BI, admin and workshop** never show the target identity.
  - **"Data Intelligence Platform" is not visible on the first screen of any access point.**
- **Cause:** the five sources in DAP-B10, plus the staff apps' unauthenticated profile fetch (DAP-F01).
- **Resolution:** DAP-B10 step 1 is what makes the first frame correct by construction: the static and bundled identity
  *is* the target, so a slow or failed profile can only delay the country context, never show an old identity. Fix
  the cache headers (DAP-F18) so returning clients get the new shell.
- **Acceptance:** `docs/dashboard-review-evidence/identity-flash/harness/run.sh --host all --scenario all` exits **0**
  (every scenario CLEAN). In addition, for public, BI, admin, workshop and Keycloak, the final identity contains
  "Data Intelligence Platform" and "Powered by Palladium". Run per profile, as DAP-B10.

**DAP-F18 · S2 · [Core] · Workshop and dbt-docs pages can be served stale after a deploy.**
- **Evidence:** response headers recorded in the identity-flash timelines · [index](dashboard-review-evidence/README.md)
- **Observed [repro]:**
  - workshop `/` and dbt-docs `/` send no `Cache-Control` (only ETag/Last-Modified), so browsers may reuse the old
    shell (old title, old bundle names that 404 on a new image) for hours to days.
  - `logo-fmoh.png` has no `Cache-Control`.
  - public, BI and admin already send `no-store`.
- **Files:** `6_access-points/dashboards/workshop/app/main.py:203-204`, `dbt-docs/app/main.py:283`.
- **Resolution:** the same `no-cache, no-store, must-revalidate` as the other apps; new mark under a new file name.
- **Acceptance:** both index responses carry `no-store`, and the harness `newasset` and `warm` scenarios are CLEAN.

**DAP-F19 · S3 · [Core] · dbt-docs hangs on an unknown path when signed in.**
- **Evidence:** identity-flash run, dbt-docs `e404` BLOCKED, 3 of 3 runs · [index](dashboard-review-evidence/README.md)
- **Observed [repro]:** an unknown path with a session never finishes loading (> 60 s); without a session it redirects
  to login.
- **Resolution:** return a 404 page.
- **Acceptance:** an unknown path returns a 404 within normal response time.

### 4.5 Requested visual and editorial changes (E)

| ID | Sev | Scope / change | Where | Acceptance |
|---|---|---|---|---|
| DAP-E01 | S3 | [Core]  Remove the "NHDW › {page}" breadcrumb (all BI pages) | `internal-bi/ui/src/sections/Topbar.tsx:70-74` | No breadcrumb on any BI page; heading unchanged |
| DAP-E02 | S3 | [Core]  Disease: remove the "EWARS, notifiable diseases" eyebrow, the "Explore health burden…" line and the duplicate Geographic Risk section description (which also promises an unimplemented woreda drill) | `catalog/sections/internal-bi--disease--signal-header.yaml:4`, `…--geographic-risk.yaml:4`, `widgets/dz-region-map/widget.ts:184` | Strings absent from the live page and from `ops_perm.section` |
| DAP-E03 | S3 | [Core]  Signal Header: remove the 10 secondary strings from card faces; add icons; add a Method & coverage view | `nhdw-gateway/app/fetchers.py:320-347`, `widgets/dz-kpi-strip/widget.ts:25-38` | Card face = label + value + ≤ 1 delta; one icon per card; the popover lists unit, period, denominator, coverage, data-through date, model status |
| DAP-E04 | S3 | [Core]  Resource: remove the three requested strings; collapse "Act this week" repetition | `…--resource--supply-stress-geography.yaml:4`, `widgets/rm-act-week/widget.yaml:2`, `…--resource--act-this-week.yaml:3-4`, `widgets/rm-map/widget.ts:43` | Strings absent; each phrase appears once |
| DAP-E05 | S3 | [Core]  Service: remove the five requested strings; keep scope and estimation basis in chips or tooltips | `sv-data-trust-table/widget.ts:52`, `sv-agreement-donut/widget.ts:29`, `sv-zero-dose/widget.ts:33`, `sv-risk-woredas/widget.ts:49`, `sv-dropoff-region/widget.ts:20` | Strings absent; tooltips carry the method (§7.1) |
| DAP-E06 | S4 | [Separate]  Recommended extension: remove page subtitles that restate the navigation, layout jargon ("Signal Header", "Headline") and narrating leads | `Topbar.tsx:23-27`; catalogue sections; leads listed in §7.1 | Each removed string listed in the PR |
| DAP-E07 | S3 | [Core (minimal: static tooltip text for the requested removals); a catalogue-fed system is Separate]  One shared ⓘ / methodology affordance per widget, fed from the catalogue (the `ops_perm.widget.description` column exists and is unused) | `runtime/PageRenderer.ts:317-323` | Every composite or estimated widget has an ⓘ whose text contains its formula or estimation basis |
| DAP-E08 | S4 | [Separate]  Icons: fix wrong-meaning navigation icons (warning triangle as the permanent Disease icon; upload arrow for Export; the same icon for two admin pages); add the missing `i-code` | sprite `static/assets/icons.html`; Sidebars | No blank icons; one meaning per icon |
| DAP-E09 | S3 | [Separate (no defect named)]  Health & topology presentation: one CPU and one memory figure per node; consistent GiB; real hostname; "avg req/s (5 min, logged routes)"; explain the 116 failed pods (leftover ML jobs) or filter them; remove the stale "#81" note | `routes/topology.py:590-622`, `TopoSummary.tsx:262-392` | One labelled figure per metric; hostname = node name |
| DAP-E10 | S3 | [Separate]  Model outputs: show model name and run date beside each probability; suppress "Immediate" for models that have not passed DAP-D02 (RR-021) | `dz-*`, `ov-act-first-woredas` | Every displayed probability names its model and run; no "Immediate" from a withheld model |

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

## 5. What will actually work

"Source not connected" is an honest state. It is **not** delivery of the feature: a widget that shows it is not working,
and the product owner should see that plainly.

This section classifies every metric by what it will show once the Core packages (§8.1) are done:

| Class | Meaning |
|---|---|
| **Works** | Shows correct real values after the Core fixes. The data exists and no decision is needed |
| **Scope decision** | The source it needs has never been ingested (supply HCMIS, mBrana, climate, MFR facilities). Until someone decides to bring that source in (DAP-Q03) and it is ingested, it can only show "Source not connected" |
| **Data-owner input** | Computable, but a number on it (denominator, target, threshold) must come from the data owner before it can be shown as authoritative |
| **Cannot work with current data** | The method itself needs history that does not exist. It is withheld with its reason (DAP-F06) |

### 5.1 Public portal

| Element | Class | Note |
|---|---|---|
| KPI tiles (Penta3, ANC4, SBA, mCPR, TB success, ART VL) | Works | With region count, facility count and data month shown (DAP-D07/D08) |
| U5 stunting tile | Data-owner input | A survey outcome shown monthly; the source and period must be confirmed |
| Coverage by region, 24-month trend | Works | Fallback datasets removed |
| Readiness strip | Scope decision | Needs the supply source |
| Open-data catalogue | Works | Once the manifest is published with real titles (C6) |
| Newsroom | Data-owner input | Seeded mock bulletins must be replaced with approved content (RR-008) |

### 5.2 Internal BI: Overview

| Widget / field | Class | Note |
|---|---|---|
| Brief: outbreaks, reporting, cascade lines | Works | After the vocabulary load (DAP-D03) |
| Brief: supply line | Scope decision | Supply source |
| Benchmarks | Works | — |
| Reliability: reporting columns | Works | Relabelled (DAP-D07) |
| Reliability: commodity readiness | Scope decision | Supply source |
| Source pulse | Works | After the data-quality mart is built (DAP-D01) |
| Act-first woredas: P(alarm) | Works | Only from a model that passes DAP-D02; otherwise withheld |
| Act-first woredas: readiness | Scope decision | Supply source |
| Act-first woredas: reporting | Works | After the woreda crosswalk (DAP-D05) |
| Trust tiles (completeness, mapping, silent) | Works | Definitions corrected (DAP-D07) |
| Disease snapshot | Works | Label or computation matches "this week" |

### 5.3 Internal BI: Disease Surveillance

| Widget / field | Class | Note |
|---|---|---|
| Signal Header cards | Works | Copy and icon changes (DAP-E03) |
| Geographic Risk: burden, P(alarm), cases, CFR, data date | Works | After DAP-D01 |
| Geographic Risk: readiness | Scope decision | Supply source |
| Geographic Risk: reliability | Works | After the woreda crosswalk (DAP-D05) |
| Anomaly & Trend: EARS (rolling-baseline method) | Works | Uses the preceding weeks, which exist |
| Anomaly & Trend: Farrington and Seasonal-naive | **Cannot work with current data** | Both compare a week with the same week in earlier years. The surveillance data covers 53 weeks (2025-W27 to 2026-W27), so no earlier-year baseline exists. Withheld with that reason until longer history is loaded |
| Anomaly & Trend: EWARS-CSD | Scope decision | Needs the climate source |
| Woreda table: P(alarm), cases, incidence | Works | Incidence denominators need data-owner confirmation (DAP-D06) |
| Woreda table: readiness | Scope decision | Supply source |
| Outbreak register | Works | Columns that are always empty (woreda, response team, readiness) are removed or marked not collected |
| Climate drivers and correlation | Scope decision | Climate source |

### 5.4 Internal BI: Resource Management

| Widget / field | Class | Note |
|---|---|---|
| Hero, statboard, forecast, wastage, map, hotspots, stock heatmap, events, stockout impact | **Scope decision** | All read the supply (HCMIS) source, which never landed. **Nine of eleven widgets can only show "Source not connected" until that source is in scope and ingested** |
| Act this week: outbreaks and case trend | Works | — |
| Act this week: stock columns | Scope decision | Supply source |
| Cold chain: excursions, AEFI | Works | Relabelled to the actual month, and "reported" rather than "linked" |
| Cold chain: affected batches, recipients | Scope decision | No source exists; tiles hidden until one does |

### 5.5 Internal BI: Service Performance

| Widget / field | Class | Note |
|---|---|---|
| Topline, flagship table | Works | Values computed from indicator data (DAP-D07) |
| Flagship targets | Data-owner input | Target values (e.g. HSTP-II) must be supplied |
| Flagship timeliness | Data-owner input | No timeliness source is defined for these indicators; confirm one, or remove the column |
| Agreement donut, data-trust table | Works | Once the EMR side reads the EMR pipeline (DAP-D08); until then, labelled demonstration data |
| Cascades (HIV, TB, MNCH, NCD) | Works | After the vocabulary load and cascade maths fix (DAP-D03) |
| MNCH continuity, drop-off by region | Works | Rebuilt from the HMIS data instead of the seed table (DAP-D08) |
| Risk woredas | Works | Reporting component, redefined so the score is not one metric counted twice |
| Risk woredas: stockout days | Scope decision | Supply source |
| Zero-dose: reach | Data-owner input | The population year and birth-rate assumption must be confirmed |
| Zero-dose: hotspot status | Scope decision | mBrana source |

### 5.6 Control Tower and Admin

| Element | Class | Note |
|---|---|---|
| Control Tower page | Data-owner input | Visible only if the demo profile decision allows it (RR-005); numbers correct only after the eLMIS fix (RR-002, RR-003) |
| Admin: Column Governance, Health & topology, MDM, Roles, Users | Works | After C8 |
| Admin: Alert routing | Scope decision | Either wire the rules to the alerting system, or label the page "not connected" |
| Admin: Quality & lineage | Works | After the dbt artefacts and DQ mart are built |
| Admin: SSO & identity | Works | Statuses truthful; real providers need configuring before they show "active" |
| Admin: Documentation | Works | After the docs store is seeded (RR-024) |
| Admin: Backups & DR | Scope decision | No backup job exists to report (DAP-Q06, RR-102) |

**What this means for the feedback.** With the Core packages done:
- **Overview, Service and Disease** work, except the readiness, stock and climate elements and the two
  same-week-history models.
- **Resource Management cannot be delivered as a working dashboard** without the supply source. That is a scope decision
  for the product owner (DAP-Q03), not something the Core fixes can complete.

---

## 6. Data provenance and fallback audit

### 6.1 Origin classes

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

### 6.2 Flagged values

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

### 6.3 What happens when each dependency fails

| Dependency fails | Public | Internal BI | Admin |
|---|---|---|---|
| Gateway unreachable / `5xx` | **Invented KPIs, bars, random trend** | "No data" (same as empty), cached | Silent loading / stale "live" |
| `403` (not granted or disabled) | **Invented fallback** (a disabled public widget shows fake data) | "No data" | Raw JSON error; "nothing classified" |
| Empty mart | Honest hide (readiness) or wrong labels | **Zeros or "healthy" copy** | 0/0 neutral |
| Token expired | n/a | "No data for the selected filters" | Same |
| Profile/reference `401` | n/a (public proxy allows it) | No regions, codes, no maps, NHDW branding | National-only scope picker |

---

## 7. Presentation recommendations

### 7.1 Exact copy removals and where the methodology goes

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

### 7.2 Branding hierarchy (all surfaces)

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

### 7.3 Strings to replace (user-facing only)

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

### 7.4 Do not rename (technical identifiers)

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

### 7.5 Icons (existing in-house sprite only)

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

## 8. Implementation plan

### 8.0 Precondition: one source of truth

The live site was built from a CI-runner working copy, not from git (RR-004, RR-206). Before any Core package ships:
1. The live-only changes are preserved in git. They are captured on the local branch `chore/abeni-preserve-live-only`
   and need owner review.
2. They are merged.
3. Every image is rebuilt from one tagged commit.

Each Core package then ships through that path, and is verified on the live site with §9 before it is reported as done.
Until then, a package's state is reported as "in code only".

### 8.1 Core packages (feedback delivery and access-point defects)

Ordered by dependency and impact. Each one is a single reviewable change set.

| Package | Content | Findings | Prerequisites | Effort | Done when (on the live site) |
|---|---|---|---|---|---|
| **C1 · Fail-closed scope** | `widget_data` refuses, or returns a scope notice, when a row-filter dimension cannot be applied; the UI treats locked values as active; the audit route is closed | DAP-A02, DAP-A05 | 8.0 | 0.5–1 d | DAP-A02 acceptance; anonymous and any-role audit reads refused |
| **C2 · Profile, reference and map loading + option contracts** | Authenticated (or anonymous pass-through) `/gw/profile*` in all three staff apps, the map geometry loader and the admin picker; options from the scoped filter-values API; programme separated from disease; one commodity key; one "All periods" | DAP-F01, DAP-F08, DAP-F16 (period) | 8.0 | 1–2 d | DAP-F01 and DAP-F08 acceptance |
| **C3 · One identity everywhere, from the first frame** | Target identity as the static and bundled identity in every app (titles, favicon under a new file name, splash, auth-error title, shell, public `BUNDLED`); profile supplies country only; breadcrumb and version footer removed; Keycloak theme, seed display names, client names and sender; e-mail templates; API titles; export citation; profiles committed; newsroom scoped by profile; `no-store` on workshop and dbt-docs | DAP-B01–B07, B10, B11, DAP-F18, DAP-E01 | C2; decision DAP-Q04 (the mark) | 3–4 d | Harness exits 0 on every host and scenario, for each profile; text scans clean (DAP-B10) |
| **C4 · Requested copy removals with method preserved** | The 18 removals in §7.1; scope and period chips instead of title stripping; a short static tooltip per affected widget carrying the method it loses | DAP-E02–E05, DAP-E07 (minimal), DAP-B08 | none | 1–2 d | Each string absent from the live page and catalogue; each affected widget's tooltip states its method |
| **C5 · Honest states, no invented values** | Typed data states; no failure caching; expired session → renewal or sign-in prompt; sanitised errors; every fallback dataset and `/api/series` removed; NULL → "—" with reason; tri-state statuses; no reassuring copy over missing data; Column Governance states; map no-data style; probability scaling | DAP-F02–F05, F11, F14, DAP-F12 (fallback part) | C2 | 3–4 d | §9.3 failure scenarios pass; a scan of built bundles finds no fallback datasets |
| **C6 · Data correctness on the listed pages** | Data-quality mart (optional joins); reference vocabulary loaded; cascade maths; woreda crosswalk; coverage relabelled then computed from indicator values; seeded MNCH and EMR inputs rebuilt or disclosed; open-data manifest with real titles | DAP-D01, D03, D05, D07, D08, DAP-F12 | 8.0 + a marts rebuild window (release-readiness WP-1) | 4–6 d | Each finding's behaviour acceptance; §5 "Works after Core fixes" rows render real values |
| **C7 · Disease model integrity** | Methods use only their defined history; "insufficient history" as a state; national alarm on the aggregate; runner refuses runs that fail the behaviour tests; gateway serves the selectable-model list with reasons; model named with run on every model-fed widget; stale-response guard on the select | DAP-D02, DAP-F06, DAP-F07 | C6 (for the climate decision) | 2–3 d | DAP-D02 / F06 / F07 acceptance |
| **C8 · Admin access points truthful and usable** | Classification view/manage split and grants; one gate for navigation and API; enforced capabilities listed in the picker; alert routing wired or labelled "not connected"; DQ missing-artefact state; identity-provider and documentation placeholders; topology error and stale states; SQL tool and listing gates; MLflow gate role check | DAP-A01, A03, A04 (gate fix only), DAP-F13, F15, DAP-B09 | Decisions DAP-Q05, DAP-Q06 | 3–5 d | Each acceptance; the §9.1 personas pass |
| **C9 · Filter behaviour on the listed pages** | Pinned programme visibility; "latest month only" notes instead of hiding; map click per decision; superseded requests aborted | DAP-F09, DAP-F10 | C2; decision DAP-Q02 | 1–2 d | §9.2 passes |
| **C10 · Remaining access-point defects** | Labels and counts that contradict the data; workshop links; export-trail copy; dbt-docs 404; Control Tower deploy order | DAP-F16, DAP-F17, DAP-F19 | 8.0 | 1 d | Each acceptance |

**Order.**
- C1 and C2 run first and in parallel; they touch separate code.
- C3, C4 and C5 follow C2.
- C6 and C7 are the data track and need the rebuild window.
- C8, C9 and C10 are independent of the data track.

### 8.2 Separate work (not part of the feedback delivery; on request)

| Item | Why it is separate |
|---|---|
| DAP-E06: wider copy clean-up (page subtitles, layout jargon, other narrating leads) | Editorial, beyond the listed strings |
| DAP-E08: navigation icon changes | Not requested; no functional defect |
| DAP-E09: Health & topology presentation (single CPU/memory figure, hostname, traffic label) | No defect was named; the data is correct |
| DAP-E10: model name and run beside every probability | Presentation improvement beyond the correctness fix in C7 |
| DAP-A06: minor governance gaps (topology authorisation plane, non-human roles assignable, catalogue gate, background 403s) | Hardening, not an access-point failure; partly overlaps RR-2xx |
| A metric dictionary generated into the docs; a catalogue-fed methodology system; a single tool registry; a served capability catalogue | Architectural improvements; C4/C6/C8 fix the confirmed defects without them |
| DAP-D06: woreda incidence plausibility | Needs data-owner input; no code defect confirmed |
| Debouncing and request coalescing | Performance, not correctness (C9 covers correctness) |

---

## 9. Verification checklist

Run on the **live site** after each package ships (§8.0). A package is reported as "live and tested" only when its
lines below pass, with the evidence attached.

### 9.1 Roles

| Persona | Check | Expected |
|---|---|---|
| Anonymous | Public home, data, articles | No `{…}` tokens; "Palladium" once (in "Powered by Palladium"); no invented datasets; previews match titles |
| Anonymous | Gateway internal routes | `401`/`403` (RR-001, RR-207) |
| National analyst | All four BI pages | Region menu lists every region by name; 0 × `401`; maps draw |
| Regional user (Oromia) | All pages | One locked "Oromia"; tamper → `403`; no widget computed over other regions (DAP-A02) |
| HIV programme director | Disease, Service | HIV-only rows or an explicit scope notice; never national counts |
| Low-privilege researcher | BI, MLflow, Superset, SQL tool, listings | "No access" page; `403` at MLflow, SQL execute, marts and templates |
| Super-admin | Column Governance | Loads the classified columns and review queue; can classify |
| Steward | Column Governance | Can view and classify (test environment only) |
| Security officer | Column Governance | View only; PUT `403` (after DAP-Q05) |
| Ops admin | Health & topology, Alert routing, DQ | Correct labels; no false alerts; DQ states its cause |

### 9.2 Filter combinations

| Combination | Expected |
|---|---|
| Region = each region × every BI page | Request carries `geography=<code>`; values change; no silent hides beyond the documented "latest month only" |
| Period = each option × Disease, Service, Resource | Window applies, or a "not filtered by period" note; one "All periods" entry |
| Programme = each offered option | The option set equals the distinct programme values in the page's data within the user's scope; no duplicate labels; the MNCH cascade visible for MNCH |
| Commodity = each option | The option set equals the distinct commodity keys in the supply data within scope (empty, and the filter hidden, while the supply source is not connected) |
| Region + period + programme | Final state matches the last selection; superseded requests are aborted |
| Detection model = each option | Enabled only if its latest run passed the DAP-D02 behaviour tests; disabled options show their method-specific reason; the KPI strip names the same model |
| Rapid successive picks | The screen and the assistant registry show the result of the last pick only |
| Map click (per DAP-Q02) | Behaviour equals the copy; a regional user cannot select outside their scope |

### 9.3 Failure scenarios (inject in a test environment)

| Scenario | Expected |
|---|---|
| Gateway down | Public: "Data temporarily unavailable", no numbers. BI: "Couldn't load — retry" |
| `403` on a widget | "You don't have access to …" (BI); hidden (public) |
| `502` (missing table) | Error state with a correlation id; no SQL text in the response |
| Empty mart | "Source not connected" or "No data for this period"; never 0 or "healthy" |
| NULL field in a row | "—" with a reason; tri-state status "unknown" |
| Token expired mid-session | Silent renewal, or a sign-in prompt; never "No data for the selected filters" |
| Profile reference unavailable | Selector shows "Regions unavailable — retry"; no fallback country text |
| Classification request held / `403` / `500` / abort | Never "nothing classified" |
| Topology `/cluster` `500` | Error badge with the last good time |
| Open-data manifest missing | "No datasets published yet" |

### 9.4 Identity, from the first rendered frame

| Check | Expected |
|---|---|
| `identity-flash/harness/run.sh --host all --scenario all` with each country profile active | Exit code 0 (every scenario CLEAN) |
| Final identity on public, BI, admin, workshop, Keycloak | Contains "Data Intelligence Platform" and "Powered by Palladium" |
| Slow (5 s) and failed profile requests | Target identity from the first frame; only the country context waits |
| Returning browser after a deploy (`warm`, `newasset`) | Target identity; no stale title or favicon |
| Text scan of built bundles, `index.html`, Keycloak theme, e-mail templates, API titles | No legacy pattern outside the don't-rename identifiers (§7.4) |

---

## 10. Open questions and external dependencies

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

| Legacy product identity in every access point and state, on every profile, visible from the first frame (116 first-frame scenarios: 70 LEGACY, 9 FLASH, 36 CLEAN, 1 BLOCKED) | DAP-B10, DAP-B11 |

**First step: the precondition in §8.0.** Preserve the live-only changes (captured on `chore/abeni-preserve-live-only`),
merge them, and rebuild from one tagged commit, so that what is tested on the site is what is in git.

**First packages: C1 together with C2.**
- **C1** makes the gateway refuse, rather than drop, a scope it cannot apply, and closes the audit route.
- **C2** makes the three staff apps load profile, reference and map geometry correctly, and aligns filter option values
  with the data keys.

They touch separate code, take about 2–3 engineer-days, and unblock C3–C5. **Every package is reported as "in code
only" until it is deployed and passes §9 on the live site.**
