# Internal BI → Overview

*Part of the NHDW Dashboard Presentation Guide — see [README.md](README.md). Read
[general.md](general.md) first for shared filter/colour/period rules. Metric
formulas are in [metric-glossary.md](metric-glossary.md); data provenance in
[data-sources.md](data-sources.md).*

Catalog: `6_access-points/dashboards/internal-bi/catalog/pages/internal-bi--overview.yaml`
and the four `sections/internal-bi--overview--*.yaml` files.

---

## Page overview

- **What it is.** The single-screen morning read for a national decision-maker.
  It answers "what needs my attention across the whole system today?" by pulling
  one or two signals from each of the four domains (disease, supply, service,
  data trust) into a cross-domain summary.
- **The story.** *Here is the one action to take first, here is the scale of the
  system you're running, here is which regions are most/least reliable, here are
  the woredas to act on, and here is whether you can trust today's data.*
- **Audience.** Policy-makers / Ministry leadership (the "Policy-Maker persona"
  the Decision Brief is explicitly built for), plus programme directors who want
  a portfolio view before drilling into a specific page.
- **Decisions it supports.** Where to direct the first response this week; which
  regions need support; whether the underlying reporting is trustworthy enough to
  act on.
- **One-line takeaway.** *"Only a national warehouse can write this brief — it
  puts an outbreak next to the stock that would answer it, and tells you whether
  to believe the numbers."*
- **Filters:** region only (the overview is intentionally simple; period /
  programme filters live on the detail pages).

Sections top-to-bottom: **Headline** → **National Reliability Headline** →
**Where to Act Now** → **System Trust at a Glance**.

---

## Section: Headline

*Catalog: `internal-bi--overview--headline.yaml`. Widgets: `ov-brief` (full
width), `ov-benchmarks` (full width).*

- **Purpose.** Lead with the single most important cross-domain decision, then
  ground the viewer in the scale of the system.
- **How to interpret.** Read the Decision Brief top-to-bottom (it is ordered by
  priority); read the benchmark cards as "the denominator of everything below".
- **Questions it answers.** What is the top action today? How big is the system
  (facilities, population, regions, districts)?
- **Presentation message.** "Start here. This is the executive summary the rest
  of the page justifies."

### Widget: Decision Brief (`ov-brief`)

- **Title / kind.** "Decision Brief" — a custom table widget.
- **Purpose & business meaning.** A five-line cross-domain morning brief, each
  line from a different mart family, that only the warehouse can assemble. It is
  the flagship "why integrate the data" artifact.
- **Data source.** Bound to `bi_supply.mart_supply_outbreak_response`, but the
  SQL is a **5-way `UNION`** that reaches across five marts (see the narrative
  deep-dive in §"The Decision Brief narrative" below). `data_class` = `DC.CAT`
  (national/aggregate context, no row-scope).
- **Fields shown.** Three columns: **Area** (Act now / Surveillance / Supply /
  Data trust / Service), **Decision signal** (the sentence), **Priority** (a
  single muted severity pill).
- **Filters / aggregation / period / geo.** `reactsTo: []` — the brief is a
  national digest and does **not** react to the filter bar. National grain.
- **Interpretation.** Each pill colour: `stockout`/`critical` → red (alert),
  `tight` → amber (watch), `ok` → green (good), `info` → neutral. The top row
  ("Act now") is the single highest-priority action.
- **Limitations.** National only; does not narrow to a region. Lines only appear
  when their headline is non-null (a domain with no signal is silently omitted).
- **Common misinterpretations.** (1) It is *not* a live ticker — it reflects the
  seeded data's latest state. (2) The "Act now" line is chosen by an `act_score`
  ranking, not by raw case count alone (a smaller outbreak with a stocked-out
  treatment can outrank a bigger one that is well supplied).
- **Talking points.** "This one table is the elevator pitch for the whole
  warehouse: line 1 joins disease surveillance to drug stock across two different
  source systems." / "Minimal colour by design — one subtle pill, no dashboard
  Christmas tree."
- **Likely questions.**
  - *"Is this hard-coded?"* No — every line is a live query over a real mart;
    see the exact SQL in §narrative.
  - *"Why did line X not appear?"* Its source query returned null (e.g. no active
    outbreaks) — the brief drops empty lines rather than pad them.

### Widget: National benchmarks (`ov-benchmarks`)

- **Title / kind.** Rendered as 4 headline stat cards (`kind: kpi`).
- **Purpose.** Establish system scale: **Facilities**, **Population**,
  **Regions**, **Woredas covered**.
- **Data source.** `bi_facility.mart_facility_capacity` joined to
  `bi_facility.mart_health_workforce` for population. `data_class` = `DC.PRF`.
- **Fields / calculation.**
  - *Facilities* = `count(*)` of the facility registry (in scope).
  - *Population* = `sum(population)` over `mart_health_workforce` for the regions
    present in the (region-filtered) facility set, shown in millions (e.g.
    "92.4M" nationally).
  - *Regions* = distinct `region_id`.
  - *Woredas covered* = distinct facility-parent org-units in the DHIS2 path
    ("districts with a facility") — the mart has no woreda column, so the org
    path is the honest woreda signal.
- **Filters / geo.** Supports the region filter; population and woreda counts
  **react to the region filter** (they sum only the in-scope regions, not the
  national total).
- **Assumptions / limitations.** "Woredas covered" counts districts that have at
  least one registered facility — not the total number of administrative woredas.
  Population is the catchment population from the workforce mart.
- **Common misinterpretations.** "Woredas covered" ≠ "all woredas in Ethiopia".
- **Talking points.** "These four numbers are the denominators for everything
  else on the page — and they re-scope when you pick a region."
- **Likely questions.** *"Is population real?"* It comes from the workforce mart
  (DHIS2 POP-TOTAL feeds); nationally it sums to ~92.4M.

---

## Section: National Reliability Headline

*Catalog: `internal-bi--overview--reliability.yaml`. Widget: `ov-reliability-table`
(full width, 2 rows).*

- **Purpose.** Rank regions by a **composite service-reliability score** so
  leadership can see who is strong and who needs support.
- **How to interpret.** Higher composite = more reliable (better coverage,
  better reporting completeness, better commodity readiness). Sort is by
  composite descending.
- **Questions it answers.** Which regions can I trust to deliver and report? Where
  is reliability weakest?
- **Presentation message.** "A single, defensible reliability index per region,
  built from three independent signals."

### Widget: National Service Reliability (`ov-reliability-table`)

- **Purpose & business meaning.** A per-region composite blending service
  coverage, reporting completeness, and commodity readiness into one score.
- **Data source.** `bi_hmis.mart_hmis_indicator_coverage` (coverage +
  completeness) FULL-joined to `bi_supply.mart_supply_region_stock` (readiness).
  `data_class` = `DC.PRO`.
- **Fields shown.** rank, region, **composite_score**, coverage_pct,
  coverage_confidence_pct, commodity_readiness_pct, pop_weight_status.
- **Calculation logic (exact).**
  `composite = 0.40·coverage_pct + 0.35·coverage_confidence_pct + 0.25·commodity_readiness_pct`.
  - *coverage_pct* = avg of indicator coverage over the window's months.
  - *coverage_confidence_pct* = `100·Σ facilities_reporting ÷ Σ facilities_expected`.
  - *commodity_readiness_pct* = % of a region's commodities with `mos ≥ 1` (≥ 1
    month of stock), at the latest supply month.
  - `pop_weight_status` = the literal string **"Unweighted"** (honest label: the
    composite is not population-weighted).
- **Filters / period / geo.** Supports region and period. The **coverage legs are
  genuinely windowed** (averaged over all months in the selected period); the
  supply-readiness leg stays latest-month (it's a current-state signal), so the
  composite still moves with the window through the coverage legs.
- **Assumptions / limitations.** The 0.40/0.35/0.25 weights are a fixed design
  choice (not derived from data). Ties are broken deterministically by region so
  the ranking is stable across refreshes. Limited to 15 rows.
- **Common misinterpretations.** The composite is **unweighted by population** —
  a small region and a large region contribute their raw percentages; don't read
  it as a population-weighted national score.
- **Talking points.** "One number per region, but you can see the three
  ingredients — no black box." / "Weights are explicit: 40% coverage, 35%
  reporting confidence, 25% commodity readiness."
- **Likely questions.**
  - *"Why is region X ranked low?"* Look across the three component columns —
    usually one is dragging (often readiness or completeness).
  - *"Are the weights official?"* No — **_requires confirmation_** whether the
    0.40/0.35/0.25 split maps to a published MoH methodology; in code it is a
    fixed composite.

---

## Section: Where to Act Now

*Catalog: `internal-bi--overview--act-now.yaml`. Widget: `ov-act-first-woredas`
(full width, 2 rows).*

- **Purpose.** Turn the disease model's output into a **prioritised action queue**
  of woredas.
- **How to interpret.** Ranked by model alarm probability; the top rows are where
  to send a team first.
- **Questions it answers.** Which specific districts should get a response this
  week?
- **Presentation message.** "This is the model earning its keep — a ranked
  do-list, not just a chart."

### Widget: Act-First Woredas (`ov-act-first-woredas`)

- **Purpose & business meaning.** The highest-alarm woredas from the latest ML
  forecast run, with a plain-language reason and a priority band.
- **Data source.** `bi_idsr.mart_idsr_disease_weekly` joined to the latest
  successful model run in `ops_ml.ml_predictions` (via Trino's `ops` catalog).
  Default model `ears`. `data_class` = `DC.PRO`.
- **Fields shown.** rank, woreda, region, **p_alarm**, readiness_index
  (`NULL`), reporting_reliability_pct (`NULL`), **evidence** (e.g. "Elevated MAL
  alarm"), **action_priority**.
- **Calculation logic.** For each woreda, take the **max alarm probability across
  diseases** in the model's latest ISO week; rank descending. `action_priority`
  bands: `p_alarm ≥ 0.8` → **Immediate**, `≥ 0.5` → **This week**, else
  **Monitor**. `evidence` = "Elevated `<top disease>` alarm".
- **Filters / period / geo.** Supports region and programme. **Period is
  intentionally unsupported** — the list ranks by the *current* latest-run alarm,
  which a historical window can't change, so it **hides** if you pick a period
  (rather than return an unchanged list and pretend it reacted).
- **Assumptions / limitations.** `readiness_index` and
  `reporting_reliability_pct` are **honest NULL** (no per-woreda readiness/
  reliability mart wired into this widget). Top 8 rows only.
- **Common misinterpretations.** A high `p_alarm` is a **probability of
  aberration**, not a confirmed outbreak or a case count.
- **Talking points.** "The model doesn't just draw a line — it hands you a ranked
  list with a reason and an urgency tier."
- **Likely questions.** *"What's `p_alarm`?"* The model's estimated probability
  that woreda×disease is aberrant this week (0–1). *"Why is period greyed out
  here?"* It's an as-of-now priority list; see [general.md §2](general.md).

---

## Section: System Trust at a Glance

*Catalog: `internal-bi--overview--trust.yaml`. Widgets: `ov-source-pulse` (full
width), then four quarter-width tiles: `ov-trust-completeness`, `ov-trust-mapping`,
`ov-trust-silent`, `ov-disease-snapshot`.*

- **Purpose.** Answer "can I believe today's data?" before anyone acts on it.
- **How to interpret.** Green pulse rows = trustworthy feeds; the four tiles are
  the headline trust KPIs plus a disease snapshot.
- **Questions it answers.** Which source feeds are healthy? How complete is
  reporting? Are facilities on the map? Are any registered facilities silent? What
  is the disease picture this week?
- **Presentation message.** "Trust is a first-class citizen here — the page tells
  you how much to trust itself."

### Widget: Source Pulse (`ov-source-pulse`)

- **Purpose.** Per-**source** trust pulse — "which feeds can I trust today".
- **Data source.** `bi_quality.mart_data_quality` (one row per source × period ×
  geography). `data_class` = `DC.PRO`.
- **Fields.** source, completeness_pct, reports_received, reports_expected,
  latest_period, **status**.
- **Calculation.** `status` from avg completeness graded on the HLR §3.2.4 norms:
  `≥ 90` ok, `80–90` watch, `< 80` poor; a source with no computed metric shows
  **`no_metric`** (honest). Sources covered: DHIS2, HCMIS, mBrana, EthioEMR, MFR
  (EWARS/Climate show no metric where none exists).
- **Filters / geo.** Supports region — a region-scoped user sees *their* region's
  source trust.
- **Common misinterpretations.** `no_metric` ≠ "broken"; it means no completeness
  contract is computed for that source yet.
- **Talking points.** "Six ingested sources, one honest completeness grade each."
- **Likely questions.** *"Why does source X say no_metric?"* No honest
  completeness signal exists for it yet — the warehouse won't guess.

### Tile: Reporting Completeness (`ov-trust-completeness`)

- **Purpose.** Headline reporting-completeness KPI with a 6-week sparkline.
- **Data source.** `bi_idsr.mart_idsr_disease_weekly`.
- **Calculation.** value = share of known woredas reporting in the **latest ISO
  week** (`100·distinct reporting woredas ÷ total known woredas`). Sparkline =
  that share for each of the last 6 ISO weeks; delta = latest vs prior week (in
  percentage points, ▲/▼, coloured good/watch).
- **Supports.** region, programme, period.
- **Common misinterpretation.** This is **surveillance (IDSR weekly) reporting
  completeness**, distinct from the HMIS facility completeness on the Service
  page. Don't conflate the two.

### Tile: Facility Mapping Coverage (`ov-trust-mapping`)

- **Purpose.** % of facilities placed in the DHIS2 org hierarchy.
- **Data source.** `bi_facility.mart_facility_capacity`.
- **Calculation.** `100·count(dhis2_path IS NOT NULL) ÷ count(*)`. (GPS lat/long
  is unpopulated in the demo, so registry-path presence is the honest mapping
  signal.)
- **Geo — HIDDEN under a region filter.** The value is ~100% in every region, so a
  region narrow can't change it; the widget therefore **hides** when a region is
  selected rather than show a byte-identical number.
- **Common misinterpretation.** This is **registry-hierarchy** mapping, not GPS
  geolocation.

### Tile: Active-but-Silent Facilities (`ov-trust-silent`)

- **Purpose.** Count of facilities that are registered/active but **not
  reporting**.
- **Data source.** `bi_facility.mart_facility_capacity`, `reporting_status =
  'silent'`.
- **Calculation.** `count(*) FILTER (reporting_status = 'silent')`. Coloured as a
  negative signal (`delta_good = false`).
- **Supports.** region.
- **Talking point.** "A silent facility is a blind spot — registered but sending
  nothing. This is the count to drive down."

### Tile: Disease Snapshot — This Week (`ov-disease-snapshot`)

- **Purpose.** This-week disease headline: new cases, alert count, and the top
  diseases currently in alarm (with the region where each peaks).
- **Data source.** `bi_idsr.mart_idsr_disease_weekly` + latest `ml_predictions`
  run; region names from `bi_public.public_region_reference`.
- **Fields.** new_cases (summed over the period window), alert_count (diseases
  flagged in the latest model week), top_alerts = up to 3 `[disease, region,
  P(alarm)%]` triples.
- **Supports.** region, programme, period. `new_cases` is genuinely windowed
  (cases within the selected period).
- **Common misinterpretation.** `alert_count` counts **diseases in alarm**, not
  outbreaks or cases.

---

## The Decision Brief narrative (§8.6 — per-narrative-block)

The `ov-brief` widget produces up to five lines from one SQL `UNION` (in
`fetchers.py`, `FETCHERS["ov-brief"]`). Document each line as follows; the pill
severity is what drives the colour.

| # | Area (kind) | Trigger / source | Headline template | Severity logic |
|---|-------------|------------------|-------------------|----------------|
| 1 | **Act now** (`act`) | Top row of `bi_supply.mart_supply_outbreak_response` where `supply_status ∈ (stockout, critical, tight)`, ordered by `act_score` desc | "Act first: `<region>` – `<disease>`, `<cases>` cases/4w; `<commodity>` at `<mos>` months" | = that row's `supply_status` (`stockout`/`critical` → alert, `tight` → watch). Line omitted if no such row. |
| 2 | **Surveillance** (`surveillance`) | `count(*)` of `bi_idsr.mart_idsr_outbreaks` where `status='active'` | "Active outbreaks: `<n>` under response" | `> 5` → critical, `> 0` → tight, else ok |
| 3 | **Supply** (`supply`) | Latest-month `bi_supply.mart_resource_allocation` | "Supply: `<x>`% of consumption volume covered ≥3 months; `<k>` commodities critical" | any `mos<1` → critical, `>3` commodities `mos<3` → tight, else ok |
| 4 | **Data trust** (`trust`) | `bi_hmis.mart_hmis_indicator_coverage` national | "Reporting: `<x>`% national completeness" | `≥90` ok, `≥80` tight, else critical |
| 5 | **Service** (`service`) | Weakest programme in `bi_service.mart_programme_cascade` (latest year) by `min(retention_pct_vs_entry)` | "Weakest cascade: `<programme>` retains `<x>`% of entry cohort" | always `info` |

**Fallback behaviour.** The outer query is `… WHERE headline IS NOT NULL ORDER BY
ord`, so **any line whose sub-query returns null is dropped** — e.g. if there are
no supply-stressed outbreak rows, the "Act now" line disappears and the brief
leads with Surveillance. If everything is null the widget shows its empty state
("No brief available."). **Key detail for supply line 3:** availability is
**consumption-weighted** (`Σ amc where mos≥3 ÷ Σ amc`), so a high-volume drug like
amoxicillin counts more than a low-volume reagent — see
[metric-glossary.md](metric-glossary.md#supply-availability-consumption-weighted).

**Talking points for the brief:** "Five lines, five different source systems,
one query." / "It's self-editing: if a domain has nothing urgent, its line drops
out and the next priority rises to the top." / "Line 1 is the whole thesis —
surveillance + supply in one sentence."
