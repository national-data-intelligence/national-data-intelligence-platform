# Internal BI → Service Performance

*Part of the NHDW Dashboard Presentation Guide — see [README.md](README.md). Read
[general.md](general.md) first. Metric formulas: [metric-glossary.md](metric-glossary.md).
Data provenance: [data-sources.md](data-sources.md).*

Catalog: `.../catalog/pages/internal-bi--service.yaml` + the four
`sections/internal-bi--service--*.yaml` files.

---

## Page overview

- **What it is.** The **quality-of-care and access** view — how well flagship
  programme indicators are attained, where patients drop out of care cascades,
  which woredas are highest-risk, whether children are reached, and whether the
  data reported to DHIS2 agrees with what the EMR recorded.
- **The story.** *Here are the headline service KPIs; here's flagship-programme
  attainment; here's where the care cascades leak (HIV/TB/MNCH/NCD) and which
  woredas are riskiest; here are the unreached children; and here's how much to
  trust the numbers (reported vs recorded).*
- **Audience.** Programme directors (HIV/TB/MNCH/NCD/EPI), quality-of-care leads,
  M&E officers.
- **Decisions it supports.** Which programme/step to strengthen; which regions
  leak patients; which woredas need targeted support; whether reported data is
  reliable enough to act on.
- **One-line takeaway.** *"Coverage, leakage, equity, and trust in one page — and
  it checks its own numbers against the EMR."*
- **Filters:** region, period, programme.

Sections: **Headline** → **Flagship Attainment** → **Care Cascades & Leakage** →
**Reported vs Recorded**.

---

## Section: Headline

*`internal-bi--service--topline.yaml`, eyebrow "Quality, access, trust". Widget:
`sv-topline-kpis` (full width).*

- **Purpose.** Four service headline tiles.
- **Questions answered.** What's average coverage? How complete is reporting? How
  many facilities report? How many indicators are tracked?
- **Message.** "The service scoreboard in four numbers."

### Widget: Service topline KPIs (`sv-topline-kpis`)

- **Data source.** `bi_hmis.mart_hmis_indicator_coverage`. `data_class` = `DC.PRO`.
- **Fields (4 tiles).** **Avg Coverage** (avg `coverage_pct` across indicators),
  **Reporting Completeness** (`100·Σ facilities_reporting ÷ Σ facilities_expected`),
  **Facilities Reporting** (monthly average over the window), **Indicators Tracked**
  (distinct indicators). target/delta are honest-null.
- **Filters / period / geo.** Supports region, programme, period. **Genuinely
  windowed** — aggregates over all months in the selected period (not a
  latest-month collapse). "Facilities Reporting" is a **monthly average**, not a
  sum (a sum would double-count facilities across months).
- **Common misinterpretations.** "Avg Coverage" is an unweighted average across
  the tracked indicators, not a population-weighted national coverage.
- **Talking point.** "These react to the period filter for real — average over the
  window, not a snapshot."

---

## Section: Flagship Attainment

*`internal-bi--service--flagship-attainment.yaml`. Widget: `sv-flagship-table`
(8 cols, 3 rows).*

- **Purpose.** Per-indicator attainment against a target band, with a data-quality
  confidence flag.
- **Interpretation.** current_pct vs the status band; confidence tells you how much
  reporting backs the number.
- **Questions answered.** Which flagship indicators are on track / at risk, and how
  trustworthy is each?
- **Message.** "Attainment with a confidence rating — not just a number, but how
  much to believe it."

### Widget: Flagship Attainment (`sv-flagship-table`)

- **Data source.** `bi_hmis.mart_hmis_indicator_coverage`. `data_class` = `DC.PRO`.
- **Fields.** indicator, programme, **current_pct**, target_pct (`NULL`), **status**,
  **completeness_pct**, timeliness_pct (`NULL`), mapping_status ("In registry"),
  **confidence_status**.
- **Calculation.** current_pct = avg `coverage_pct` over all months in the window;
  completeness_pct = `100·Σ facilities_reporting ÷ Σ facilities_expected`. **status**
  bands: `≥80` on_track, `≥60` watch, else at_risk. **confidence** bands from
  completeness: `≥90` High, `≥70` Medium, else Low. Top 12.
- **Filters / period / geo.** Supports region, programme, period (genuinely
  windowed — averaged over the window, not latest-month).
- **Assumptions / limitations.** `target_pct` and `timeliness_pct` are **honest
  NULL** — no targets or timeliness signal in the feed (the honesty rule forbids
  invented targets), so `status` is computed from **current attainment bands**, not
  from a target gap. mapping_status is a constant "In registry".
- **Common misinterpretations.** "on_track/at_risk" here is derived from the
  **absolute attainment band** (≥80 etc.), **not** from distance to an official
  target (there isn't one loaded).
- **Talking points.** "Every attainment row carries a confidence flag driven by
  reporting completeness — a high number on thin reporting is flagged Low." /
  "We don't show targets we don't have."
- **Likely questions.** *"What's the target?"* No official targets are loaded;
  status uses attainment bands. **_Requires confirmation_** — whether HSDIP/
  programme targets should replace the band logic here (the public dashboard does
  carry HSDIP targets; this internal table does not).

---

## Section: Care Cascades & Leakage

*`internal-bi--service--care-cascades.yaml`. Widgets: four funnels
`sv-cascade-hiv|tb|mnch|ncd` (3 cols each), `sv-continuity-mnch` (7 cols),
`sv-dropoff-region` (5 cols), `sv-risk-woredas` (full width), `sv-zero-dose`
(full width).*

- **Purpose.** Show where patients fall out of the care continuum, by programme
  and by region, plus woreda risk and unreached children.
- **Interpretation.** Each funnel step is a % of the entry step; the biggest drop
  is the leakage point. The region drop-off and risk-woreda widgets localise it.
- **Questions answered.** Where do we lose patients in each programme? Which
  regions/woredas leak most? Where are the unreached children?
- **Message.** "Coverage hides leakage — the funnels expose exactly where care
  breaks down."

### Widgets: Care cascade funnels (`sv-cascade-hiv`, `-tb`, `-mnch`, `-ncd`)

- **Data source.** `bi_service.mart_programme_cascade` (programme **hard-locked**
  per widget: HIV, TB, MNCH, NCD respectively). `data_class` = `DC.PRO`.
- **Fields.** stage, **pct** (step value ÷ the first step's value × 100; step 1 =
  100%).
- **The steps (from the mart).**
  - HIV: HIV-TEST → HIV-POS → HIV-ART-NEW → HIV-VL-SUPP
  - TB: TB-NOTIF → TB-TX-NEW → TB-TX-SUCC (3-step)
  - MNCH: ANC1 → ANC4 → SBA → PNC1
  - NCD (HEARTS): HTN-SCRN → HTN-DX → HTN-TX → HTN-CTRL
- **Filters / period / geo.** Supports region; **programme is locked** (the widget
  *is* the programme view). **Period is year-grain** — sub-year windows collapse to
  the anchor year; `last_24mo` spans two years (see [general.md §4](general.md)).
- **Calculation subtlety (important for credibility).** Steps carry a
  **measurement kind** so percentages aren't summed like counts: `flow` indicators
  are annually summed; `stock` indicators are averaged over months; `cohort_pct`
  indicators are converted to an effective count = pct × the previous step's value
  ("of those who reached the previous step, X% achieved this one"). This fixed a
  real monotonicity bug where a percentage step exceeded 100%.
- **Common misinterpretations.** Each bar is **relative to the entry step**, not an
  absolute coverage of the whole population.
- **Talking point.** "The funnel is monotonic because we respect each indicator's
  measurement kind — a suppression % isn't added like a case count."

> **Provenance note for the next two widgets.** `sv-continuity-mnch` and
> `sv-dropoff-region` read `bi_programme.mnch_coverage_v` — a **seeded program-demo
> view** (defined in `3_storage/postgres/init/03_program_demo.sql` over a
> hand-seeded `bi_facility.programme_metrics` table, region × quarter), **not** a
> pipeline-built mart. Their numbers are illustrative demo values, unlike the
> other service widgets which read real pipeline marts. This is deliberate
> (program-demo state is always seeded directly). Present them as "the MNCH
> continuum view" without implying they are freshly pipeline-derived.

### Widget: Maternal & Newborn Continuity of Care (`sv-continuity-mnch`)

- **Data source.** `bi_programme.mnch_coverage_v` (seeded program-demo view — see
  note above). `data_class` = `DC.PRO`.
- **Fields.** stage (ANC4+ → Skilled birth → Postnatal care), retention_pct, scope
  ("EMR-active").
- **Calculation.** Averages of `anc4`, `skilled_birth`, `postnatal` across the
  scoped rows.
- **Filters / geo.** Supports region (`region_code`).
- **Common misinterpretations.** Scope label "EMR-active" — this is the MNCH
  continuum as seen in the programme coverage view.

### Widget: Drop-off Composition by Region (`sv-dropoff-region`)

- **Data source.** `bi_programme.mnch_coverage_v`.
- **Fields (per region).** anc_dropout_pct (`100 − anc4`), delivery_gap_pct
  (`anc4 − skilled_birth`), pnc_gap_pct (`skilled_birth − postnatal`),
  total_dropoff_pct (`100 − postnatal`). Sorted by total drop-off desc.
- **Filters / geo.** Supports region.
- **Common misinterpretations.** The three gaps decompose the total drop-off into
  stage-to-stage losses; they are gaps in the MNCH continuum, not mortality.

### Widget: Highest-Risk Woredas by Composite Score (`sv-risk-woredas`)

- **Data source.** `bi_hmis.mart_hmis_indicator_coverage`. `data_class` = `DC.PRO`.
- **Fields.** woreda, region, coverage_gap_pct, stockout_days (`NULL`),
  reporting_completeness_pct, **risk_score**, **risk_band**.
- **Calculation.** `risk_score = 0.6·coverage_gap + 0.4·(100 − completeness)`;
  bands: `≥15` High, `≥8` Medium, else Low (thresholds anchored to DHIS2
  reporting-rate norms). Averaged over the window. Top 12.
- **Filters / period / geo.** Supports region, programme, period (genuinely
  windowed).
- **Assumptions / limitations.** `stockout_days` is **honest NULL** (supply is
  region-grain, not woreda). Woreda display names resolved from the DHIS2 org tree.
- **Common misinterpretations.** Risk here blends **coverage gap + reporting
  incompleteness**, not clinical outcomes.

### Widget: Zero-dose children × vaccine last mile (`sv-zero-dose`)

- **Data source.** `bi_hmis.mart_epi_zero_dose` (region × year). `data_class` =
  `DC.PRO`.
- **Fields.** region_id, year_id, expected_infants, penta1_annualized,
  **reach_index**, mbrana_zero_stock_pct, **hotspot**.
- **Calculation.** Three feeds only a warehouse holds together: DHIS2 immunization
  (PENTA1 doses), DHIS2 population (expected_infants = population × **3.2% CBR**, a
  labelled estimate), and mBrana cold-chain (share of USSD stock logs at zero in
  the last 90 days). **reach_index** = annualized Penta-1 doses per 1,000 expected
  infants (a **comparative** index across regions, not absolute coverage).
  **hotspot** = bottom-tercile reach **AND** mBrana zero-stock ≥ 15%. Latest year
  only. Top 14 (hotspots first, lowest reach first).
- **Filters / geo.** Supports region.
- **Assumptions / limitations.** The demo's seeded HMIS service volumes are
  demo-scale while population is population-scale, so an **absolute** zero-dose
  count would misleadingly read ~98% everywhere — hence reach_index is a
  *comparative* measure answering "**where** are the unreached children". 3.2% is
  Ethiopia's crude birth rate, used as a labelled estimate.
- **Common misinterpretations.** reach_index is **not** a coverage percentage;
  compare regions to each other, not to 100%.
- **Talking points.** "This is a three-source join — immunization, population, and
  last-mile stock — answering 'where are the children we're missing, and can the
  cold chain even reach them?'" / "We deliberately avoid a fake absolute number."

---

## Section: Reported vs Recorded

*`internal-bi--service--reported-vs-recorded.yaml`. Widgets: `sv-agreement-donut`
(4 cols), `sv-data-trust-table` (8 cols).*

- **Purpose.** Cross-check what facilities **reported** to DHIS2 against what the
  **EMR recorded** — a data-integrity signal.
- **Interpretation.** High agreement = trustworthy reporting; low agreement =
  investigate.
- **Questions answered.** Do the numbers reported up the chain match the source
  records? Where do they diverge?
- **Message.** "The warehouse checks its own inputs — reported vs recorded, at the
  region level."

### Widget: Agreement Overview (`sv-agreement-donut`)

- **Data source.** `bi_service.mart_reported_vs_recorded`. `data_class` = `DC.PRO`.
- **Fields.** overall_agreement_pct, agree_pct (share ≥80), moderate_pct (50–80),
  low_pct (<50), delta_pp (vs prior month).
- **Filters / period / geo.** Supports region, period (month grain); computed at
  the latest month with a prior-month delta.
- **Common misinterpretations.** Agreement is a **per-reporting-facility rate**
  comparison (normalised intensity), not a raw volume match.

### Widget: Facility Data-Trust Signals (`sv-data-trust-table`)

- **Data source.** `bi_service.mart_reported_vs_recorded`. `data_class` = `DC.PRO`.
- **Fields.** facility (region name), indicator (`observation vs indicator`),
  agreement_ratio_pct, expected_dhis2 (per-facility rate), actual_emr (per-facility
  rate), difference, **severity** (`<60` Alert, `<80` Watch, else OK).
- **Calculation.** Agreement averaged per region × indicator × observation over the
  window. Region display names from `bi_public.public_region_reference`. Worst
  agreement first. Top 10.
- **Filters / period / geo.** Supports region, period (genuinely windowed).
- **Assumptions / limitations (important honesty note).** **Grain is REGION, not
  facility** — the demo EMR facilities aren't in the DHIS2 org tree, so a
  facility-level join would be fabrication. Both sides are normalised to a
  **per-reporting-facility monthly rate** before comparison (raw totals are
  incomparable: DHIS2 covers every facility, the demo EMR ~30 fixtures). Only
  like-for-like event pairs are mapped: ANC visit→ANC1, Penta3→PENTA3, HIV
  test→HIV-TEST, Malaria RDT→MAL-RDT, Blood pressure→HTN-SCRN. TB is deliberately
  **unmapped** (screening vs notification aren't comparable).
- **Common misinterpretations.** The "facility" column is actually a **region**;
  a low agreement is a signal to investigate, not proof of error.
- **Talking points.** "We compare intensity per reporting facility, not raw
  volume — otherwise a 30-facility EMR vs a full-region DHIS2 count would fake 0.2%
  agreement." / "TB is left out on purpose — comparing screening to notification
  manufactures disagreement."
- **Likely questions.** *"Why region, not facility?"* The demo EMR facilities
  don't exist in the DHIS2 org tree; region is the honest common grain.
