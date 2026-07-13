# Internal BI → Disease Surveillance

*Part of the NHDW Dashboard Presentation Guide — see [README.md](README.md). Read
[general.md](general.md) first. Metric formulas: [metric-glossary.md](metric-glossary.md).
Data provenance: [data-sources.md](data-sources.md).*

Catalog: `.../catalog/pages/internal-bi--disease.yaml` + the five
`sections/internal-bi--disease--*.yaml` files.

---

## Page overview

- **What it is.** An **EWARS-style** (Early-Warning Alert & Response)
  surveillance workbench for notifiable diseases, blending **observed weekly IDSR
  data** (through DHIS2) with **live machine-learning forecasts** (from the model
  registry) to flag aberrations before they become outbreaks.
- **The story.** *Here is this week's signal (cases, alarms, fatality, riskiest
  woreda); here is the geography of burden vs readiness; here are the active
  outbreaks; here is the anomaly curve vs the model's expected band; and here is
  the climate that may be driving it.*
- **Audience.** National epidemiologists, the Public Health Emergency
  Management / EWARS team, programme surveillance officers.
- **Decisions it supports.** Which disease and which woreda to investigate this
  week; whether an aberration is genuine (observed above the model's expected
  band); whether climate is a plausible driver.
- **One-line takeaway.** *"Observed surveillance and a forecasting model in one
  view — the model doesn't replace the epidemiologist, it points them at the
  right woreda."*
- **Filters:** region, period, programme. A server-side **`model`** param (default
  `ears`; options `ears`, `outbreak`, `seasonal`, `ewars_lite`) selects which
  forecast model feeds the alarm columns.

Sections: **Signal Header** → **Geographic Risk** → **Outbreak Operations** →
**Anomaly & Trend** → **Climate Drivers**.

> **Data lineage note (say once).** IDSR is reported *through* DHIS2 as weekly
> aggregate data values (`IDSR-<disease>-C` = confirmed cases, `IDSR-<disease>-D`
> = deaths) at woreda level. The ML columns come from the latest **successful**
> run in `ops_ml.ml_predictions` (a training run that wrote no predictions is
> skipped), joined by `(woreda_uid, disease_code)`.

---

## Section: Signal Header

*`internal-bi--disease--signal-header.yaml`, eyebrow "EWARS · notifiable
diseases". Widget: `dz-kpi-strip` (full width).*

- **Purpose.** A six-tile "what does this week look like" strip.
- **Interpretation.** Left-to-right escalation cues; the fatality and highest-risk
  tiles are the ones to act on.
- **Questions answered.** How many outbreaks are active? Are cases rising? Is the
  disease deadly right now? Which woreda is riskiest? Is the reporting complete
  enough to believe it?
- **Message.** "One glance = this week's surveillance headline."

### Widget: Disease KPI strip (`dz-kpi-strip`)

- **Data source.** `bi_idsr.mart_idsr_disease_weekly` + `bi_idsr.mart_idsr_outbreaks`
  + latest `ml_predictions` run. `data_class` = `DC.PRO`.
- **The six tiles (all real — nothing fabricated):**
  1. **Active Outbreaks** — `count(*)` of outbreaks with `status='active'`.
     Footnote = reporting completeness %.
  2. **New Cases · 7D** — cases in the latest week; delta = ▲/▼ % vs the prior
     week; footnote = observed / expected woreda-weeks. Colour: `watch` if rising,
     `good` if not.
  3. **Case Fatality · 30D** — `100·deaths(28d) ÷ cases(28d)`, 1 dp.
  4. **Highest-Risk Woreda** — the woreda with the max model alarm prob in the
     latest run; subtitle shows `P(alarm) <x>%`.
  5. **Reporting Completeness** — `100·observed ÷ expected woreda-weeks`.
  6. **Alarm Coverage** — % of in-scope woredas the model actually evaluated in
     its latest week (footnote names the model).
- **Filters / period / geo.** Supports region, programme, period.
- **Assumptions / limitations.** "Completeness" here = observed woreda-weeks ÷
  (distinct woredas × distinct weeks) — a structural expectation, not a facility
  roster. IDSR-Timeliness and Lab-Confirmation tiles from the reference design are
  **deliberately omitted** (no timeliness/lab feed exists — real-or-empty).
- **Common misinterpretations.** "New Cases · 7D" is the **latest data week**, not
  the last 7 calendar days from today.
- **Talking points.** "Every tile is sourced — where a signal doesn't exist (lab
  confirmation, timeliness) we removed the tile rather than fake it."
- **Likely questions.** *"What's Alarm Coverage?"* The share of your woredas the
  model scored this week — low coverage means treat the alarms cautiously.

---

## Section: Geographic Risk

*`internal-bi--disease--geographic-risk.yaml`. Widget: `dz-region-map` (full
width, 4 rows tall).*

- **Purpose.** Put **burden** (incidence), **readiness** (supply), **reliability**
  (reporting), and **model alarm** on one map + ranked list.
- **Interpretation.** The choropleth reads as burden intensity (orange ramp, not
  red — see [general.md §6](general.md)); the sidebar ranks top regions (or top
  woredas when a single region is in scope) and shows a freshness "data through"
  date and a case sparkline.
- **Questions answered.** Where is the burden highest, and is that region ready
  (stocked) and reliable (reporting)?
- **Message.** "Burden without readiness is the danger zone — high cases, low
  stock."

### Widget: Burden & Readiness Map (`dz-region-map`)

- **Data source.** `bi_idsr.mart_idsr_disease_weekly` for cases; joined to
  `bi_supply.mart_supply_region_stock` (readiness), `bi_quality.mart_data_quality`
  (reliability), `bi_facility.mart_health_workforce` (population), and the latest
  `ml_predictions` run (alarm). `data_class` = `DC.PRO`.
- **Fields (per region).** region, **burden_incidence_100k**, **readiness_pct**,
  **reliability_pct**, **p_alarm**, cases_7d, cfr_pct, data_through.
- **Calculation.**
  - burden = `1e5·(12-week cases) ÷ region population` (real population).
  - readiness = % of tracer commodities with `mos ≥ 1` in the region.
  - reliability = avg reporting completeness (bi_quality).
  - p_alarm = the region's peak forecast alarm in the latest run.
  - cases_7d / cfr_pct = latest reported week.
- **Three shapes off one grant** (no extra widget id): default = one row per
  region; `?spark=1` = the scoped region's weekly case series; `?woreda=1` = one
  row per woreda when exactly one region is in scope (so a regional user gets a
  woreda ranking instead of a meaningless "top-5 of 1").
- **Filters / period / geo.** Supports region, programme, period.
- **Limitations.** Burden uses a 12-week window regardless of the period filter's
  exact size (the incidence CTE is fixed at 84 days). Region-grain readiness (no
  woreda supply).
- **Common misinterpretations.** Colour = burden, **not** alarm; a high-burden
  region can still be well-stocked.
- **Talking points.** "This is the join a single source can't make — cases from
  DHIS2, stock from EPSS, reporting from the quality mart, population from MFR,
  all on one region." / "Click a region and the ranked list pivots to its
  woredas."
- **Likely questions.** *"Is population real?"* Yes, DHIS2 POP-TOTAL via the
  workforce mart.

---

## Section: Outbreak Operations

*`internal-bi--disease--outbreak-operations.yaml`. Widget: `dz-outbreaks-table`
(full width, 2 rows).*

- **Purpose.** The operational list of detected outbreak **episodes**.
- **Interpretation.** Each row is a region×disease episode with declared date,
  duration, totals, CFR, and status (active/contained).
- **Questions answered.** What outbreaks are we managing, how big, how deadly, how
  long?
- **Message.** "These are algorithm-detected episodes, not raw case spikes."

### Widget: Active Outbreaks (`dz-outbreaks-table`)

- **Data source.** `bi_idsr.mart_idsr_outbreaks`. `data_class` = `DC.PRO`.
- **Fields.** id, disease, region, woreda (`NULL`), declared, days, total, new_7d
  (`NULL`), cfr_pct, status, rrt (`NULL`), readiness (`NULL`).
- **How episodes are detected (mart logic).** Weekly region×disease series →
  baseline = **mean + 2·stddev of the preceding 8 weeks** (weeks with < 8 prior
  weeks never flag) → a week is in outbreak when cases exceed
  `GREATEST(baseline, per-disease floor)`; consecutive flagged weeks collapse into
  one episode. `status = 'active'` while the last flagged week is within 14 days
  of the newest surveillance week, else `'contained'`. Per-disease floors (min
  weekly cases before flagging): MAL 30, TB 20, MEN 10, TYPH 10, MEA 10, CHOL 5,
  DENG 10, RELF 10, NNT 3, YF 3.
- **Filters / period / geo.** Supports region; period = outbreaks **declared** in
  the window (`declared_date`).
- **Assumptions / limitations.** Outbreaks are **region-grain** (mart has no
  woreda column) → `woreda`, `new_7d`, `rrt`, `readiness` are **honest NULL**.
- **Common misinterpretations.** "Contained" means the algorithm hasn't seen a
  flagged week in 14 days — not a formally declared end.
- **Talking points.** "Standard aberration detection: 2-sigma over an 8-week
  baseline, with disease-specific floors so a 2-case rare-disease blip doesn't
  cry wolf."
- **Likely questions.** *"Why no RRT / response team column populated?"* No
  response-team feed exists yet — shown as blank, never faked.

---

## Section: Anomaly & Trend

*`internal-bi--disease--anomaly-trend.yaml`. Widgets: `dz-signal-chart` (full
width, 3 rows), `dz-woreda-table` (full width, 2 rows).*

- **Purpose.** The flagship "observed vs expected" chart plus a woreda hotspot
  action queue.
- **Interpretation.** Observed line breaking above the model's alarm threshold /
  upper CI band = a genuine aberration; the table ranks woredas to act on.
- **Questions answered.** Is the current rise beyond what the model expects? Which
  woredas are driving it?
- **Message.** "The band is the model's 'normal'; the line breaking out is your
  signal."

### Widget: Signal Detection (`dz-signal-chart`)

- **Data source.** `bi_idsr.mart_ml_disease_input` (observed) joined to the latest
  `ml_predictions` run (forecast band). `data_class` = `DC.PRO`.
- **Fields (per disease × week).** observed, pred_cases_mean, pred_cases_lwr95,
  pred_cases_upr95, endemic_mean, **alarm_threshold**, **alarm_prob**,
  **alarm_flag**.
- **Calculation.** Woreda-grain forecasts are **summed** to disease×week; alarm
  prob/flag take the **max** (any woreda in alarm ⇒ the disease-week is flagged).
- **Filters / period / geo.** Supports region and period. **Programme is honestly
  unsupported** — `mart_ml_disease_input` has no `programme_id` column
  (`disease_code` is its programme axis), so the widget hides if a programme is
  picked.
- **Common misinterpretations.** The band is a **model expectation with a 95% CI**,
  not a confidence interval on the observed data.
- **Talking points.** "Observed line + endemic mean + alarm threshold + 95% band
  + alarm flags — the full EWARS chart, from a real model run."
- **Likely questions.** *"Which model?"* Whatever the `model` param selects
  (default `ears`); the strip's footnote names it.

### Widget: Hotspot Action Queue (`dz-woreda-table`)

- **Data source.** `bi_idsr.mart_idsr_disease_weekly` + `mart_ml_disease_input`
  (population), `bi_hmis.mart_hmis_indicator_coverage` (reliability),
  `bi_supply.mart_supply_region_stock` (readiness), latest `ml_predictions`.
- **Fields.** rank, woreda, region, cases_12w, incidence_100k, cfr_pct, p_alarm,
  readiness, reliability.
- **Calculation.** Ranked by the model's **latest peak alarm probability**
  (cases_12w tiebreak). incidence = `1e5·cases_12w ÷ real woreda population`;
  reliability = woreda HMIS reporting coverage; readiness = its region's commodity
  readiness (supply is region-grain — the finest honest cut). Top 12.
- **Filters / period / geo.** Supports region, programme, period.
- **Limitations.** Readiness is a **regional** value repeated for each woreda in
  the region (no woreda-grain supply). LEFT joins → `NULL` where a signal is
  absent.
- **Common misinterpretations.** Rank is by **alarm probability**, not by case
  count or incidence.

---

## Section: Climate Drivers

*`internal-bi--disease--climate-drivers.yaml`. Widgets: `dz-climate-ts` (7 cols),
`dz-climate-corr` (5 cols).*

- **Purpose.** Show the climate signals (rainfall, temperature, humidity) beside
  cases, and quantify the lagged correlation per disease.
- **Interpretation.** The time series overlays climate and cases; the correlation
  heatmap shows how strongly (and at what lag) climate leads cases for each
  climate-sensitive disease.
- **Questions answered.** Is climate plausibly driving this disease? At what lag?
- **Message.** "Climate context for the vector-borne / water-borne diseases —
  hypothesis support, not proof."

### Widget: Climate Drivers time series (`dz-climate-ts`)

- **Data source.** `bi_idsr.mart_idsr_climate_drivers`. `data_class` = `DC.PRO`.
- **Fields.** iso_week, week_start, region_id, rainfall_mm, temp_celsius,
  humidity_pct, cases (weekly averages of climate; summed cases).
- **Filters / period / geo.** Supports region, programme, period. Up to 2000 rows.
- **Common misinterpretations.** Correlation of the overlaid lines is visual, not
  causal.

### Widget: Climate Lag Correlation (`dz-climate-corr`)

- **Data source.** `bi_idsr.mart_idsr_climate_drivers` (latest row per region ×
  disease).
- **Fields.** region_id, disease_label, **rainfall_lag_correlation**, **lag_weeks**.
- **Calculation.** The most recent computed `rainfall_lag_correlation` and its
  `lag_weeks` per region×disease (the correlation itself is computed upstream in
  the mart).
- **Assumptions / limitations.** Only climate-sensitive diseases carry a
  meaningful value; the correlation and lag are pre-computed in the mart —
  **_requires confirmation_** of the exact statistical method (window, method) if
  a stakeholder asks, as it is set in the mart build, not the fetcher.
- **Common misinterpretations.** A high lag correlation is **association**, not a
  causal claim.
- **Talking point.** "It answers 'rainfall today, cases in how many weeks?' — the
  lag is the operationally useful part."
