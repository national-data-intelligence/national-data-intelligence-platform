# Metric glossary

*Part of the NHDW Dashboard Presentation Guide — see [README.md](README.md).*

Every metric is defined **once** here. Each entry is grounded in the gateway
`fetchers.py` SQL and/or the dbt mart that produces the column. Where the exact
statistical method lives upstream in the mart and isn't fully visible in the
fetcher, the entry says so and is marked **_requires confirmation_**.

**Two rules that apply to every metric below (stated once):**
- **Zero-denominator handling.** Every ratio divides through `NULLIF(denominator,
  0)` (or a `CASE … > 0`), so a zero denominator yields **`NULL`** (an empty cell),
  never a fake 0 or 100 and never an error.
- **Refresh cadence.** Each metric is recomputed **on every widget fetch** by
  running its SQL against the marts through Trino. The marts themselves rebuild
  only when the dbt pipeline runs; the demo is a fixed snapshot whose data **ends
  mid-2026**. Production auto-refresh cadence is **_requires confirmation_**.

Colour logic follows the shared semantics in [general.md §6](general.md): soft
green = good, amber = watch, muted red = alert (reserved), blue = info.

---

## A. Disease surveillance

### New cases (weekly / "New Cases · 7D")
- **Definition.** Confirmed IDSR cases in a week (or the latest reported week).
- **Numerator / formula.** `SUM(new_cases)`; `new_cases` per row = sum of the
  DHIS2 `IDSR-<disease>-C` (confirmed) data-element value for that woreda × disease
  × week. Denominator: none (a count).
- **Unit.** Count of cases. **Grain.** woreda × disease × ISO week.
- **Inclusion/exclusion.** Confirmed cases only (the `-C` element), priority
  notifiable diseases.
- **Aggregation.** Sum. **Comparison period.** "· 7D" tiles compare the latest
  week vs the prior week (▲/▼ %).
- **Missing values.** `COALESCE(…, 0)` — a non-reporting woreda-week contributes 0.
- **Colour/trend.** Rising = `watch`, flat/falling = `good` (on the KPI strip).
- **Source fields.** `bi_idsr.mart_idsr_disease_weekly.new_cases`.
- **Why it matters / example.** The core surveillance volume. "New Cases · 7D =
  340, ▲ 12% vs prior week" = cases up week-on-week.

### Deaths (weekly)
- **Definition.** IDSR deaths in a week. `SUM(deaths)` from the `IDSR-<disease>-D`
  element. Count; no denominator. Feeds CFR. Source
  `mart_idsr_disease_weekly.deaths`.

### Case Fatality Rate (CFR)
- **Definition.** Share of cases that died, over a window.
- **Formula.** `100 · deaths ÷ cases`. On the KPI strip: `100 · deaths(28d) ÷
  cases(28d)` ("Case Fatality · 30D", 1 dp). On the map/tables: latest-week
  `100·deaths_7d ÷ cases_7d`.
- **Unit.** Percent. **Aggregation.** Ratio of sums over the window.
- **Zero-denominator.** `NULLIF(cases, 0)` → NULL when no cases.
- **Why it matters / example.** Severity signal. "CFR 30D = 1.8%" = 18 deaths per
  1,000 cases in the last 4 weeks.

### Burden incidence per 100k (`burden_incidence_100k` / `incidence_100k`)
- **Definition.** Disease case burden normalised to population.
- **Formula.** `1e5 · (12-week cases) ÷ population`. Region version uses the
  region population (`bi_facility.mart_health_workforce`); woreda version uses the
  real woreda population (`bi_idsr.mart_ml_disease_input.population`, from DHIS2
  POP-TOTAL).
- **Unit.** Cases per 100,000 people over 12 weeks. **Window is fixed at 84 days**
  regardless of the period filter size.
- **Zero-denominator / missing.** `NULLIF(population, 0)` → NULL where no
  population denominator exists.
- **Why it matters / example.** Compares regions/woredas fairly by size. "Gambella
  120 /100k vs Oromia 8 /100k" = far higher per-capita burden in Gambella.

### Alarm probability — P(alarm) (`alarm_prob` / `p_alarm`)
- **Definition.** The forecasting model's estimated probability that a woreda ×
  disease is in **aberration** this week.
- **Source.** `ops_ml.ml_predictions.alarm_prob` from the latest **successful**
  run of the selected model (default `ears`; also `outbreak`, `seasonal`,
  `ewars_lite`). Region/woreda values take the **max** across the relevant grain
  (any woreda in alarm ⇒ the region-week is flagged).
- **Unit.** Probability 0–1 (often shown as a %). **Aggregation.** Max within grain
  for the model's latest ISO week.
- **Action bands (act-first widget).** `≥0.8` → Immediate, `≥0.5` → This week,
  else Monitor.
- **Why it matters / example.** Prioritises attention. "P(alarm) 0.86 for Measles
  in Woreda X" = high model-estimated aberration risk — investigate.
- **Limitation.** A probability of aberration, **not** a confirmed outbreak or a
  case count. Method detail lives in the ML models — **_requires confirmation_**
  of the exact model math per model id.

### Model band outputs — endemic mean, alarm threshold, 95% CI, alarm flag
- **Definition.** The signal chart's expected band. `pred_cases_mean` with
  `pred_cases_lwr95`/`pred_cases_upr95` (95% prediction interval), `endemic_mean`
  (baseline expectation), `alarm_threshold` (the level above which a week flags),
  `alarm_flag` (0/1). Woreda forecasts are **summed** to disease×week; flag/prob
  take the **max**.
- **Source.** `ml_predictions` via Trino `ops` catalog. **Unit.** Cases (band),
  0/1 (flag). **Interpretation.** Observed line above the threshold / upper band =
  aberration.

### Alarm coverage
- **Definition.** Share of in-scope woredas the model actually scored in its latest
  run. `100 · (distinct woredas evaluated) ÷ (distinct in-scope woredas)`. Unit:
  percent. **Why it matters.** Low coverage ⇒ treat alarms cautiously (the model
  didn't see much of your area).

### IDSR reporting completeness (woreda-weeks)
- **Definition.** Did the expected surveillance reports arrive?
- **Formula.** `100 · (observed woreda-weeks) ÷ (expected woreda-weeks)`, where
  expected = `distinct woredas × distinct ISO weeks` in scope. The overview tile
  variant uses `100 · (distinct woredas reporting a given week) ÷ (total known
  woredas)` per week, with a 6-week sparkline.
- **Unit.** Percent. **Comparison.** Overview tile: latest week vs prior week (pp).
- **Colour.** `good/watch` by whether it rose.
- **Source.** `bi_idsr.mart_idsr_disease_weekly`.
- **Distinguish from HMIS completeness** (below) — different source and grain.

### Active outbreaks (count)
- **Definition.** Number of detected outbreak **episodes** currently active.
- **Formula.** `count(*)` of `bi_idsr.mart_idsr_outbreaks` where `status='active'`.
- **Episode detection (mart).** Region×disease weekly series → baseline = **mean +
  2·stddev of the preceding 8 weeks** → a week flags when cases exceed
  `GREATEST(baseline, per-disease floor)`; consecutive flagged weeks = one episode;
  `status='active'` while the last flag is within 14 days of the newest week, else
  `'contained'`. Floors: MAL 30, TB 20, MEN/TYPH/MEA/DENG/RELF 10, CHOL 5, NNT/YF 3.
- **Why it matters / example.** "6 active outbreaks" = six region×disease episodes
  the aberration algorithm currently flags.

### Outbreak episode metrics (`weeks_active`/days, `cases_total`, `cfr_pct`, `declared_date`)
- **Definition.** Per-episode: duration (`weeks_active`, shown as `×7` days),
  total cases (`SUM(new_cases)` across the episode), CFR (`100·deaths_total ÷
  cases_total`), and the first flagged week (`declared_date`). Source
  `mart_idsr_outbreaks`. Region-grain (woreda/RRT/readiness are honest NULL).

### Rainfall lag correlation & lag weeks
- **Definition.** How strongly rainfall leads cases for a climate-sensitive
  disease, and at what lag. `rainfall_lag_correlation` (−1…1) and `lag_weeks`, taken
  as the latest row per region × disease. Source
  `bi_idsr.mart_idsr_climate_drivers`. **Association, not causation.** Exact
  correlation method is computed in the mart — **_requires confirmation_**.

---

## B. Service performance

### Coverage % (`coverage_pct`) — the base HMIS metric
- **Definition.** Reporting coverage of an HMIS indicator: what share of expected
  facilities reported it.
- **Formula (mart).** `100 · facilities_reporting ÷ facilities_expected` at the
  **region × woreda × indicator × programme × month** grain (`NULL` when expected =
  0). `facilities_reporting` rides the business-vault spine; `facilities_expected`
  = distinct facilities on the spine for that indicator×period.
- **Unit.** Percent. **Source.** `bi_hmis.mart_hmis_indicator_coverage.coverage_pct`.
- **IMPORTANT nuance for presenters.** This measures **reporting coverage**
  (facilities reporting ÷ expected), not a clinical attainment like "ANC4 coverage
  of the population". The widgets that label it "Coverage"/"Attainment" are showing
  how completely the indicator is reported, aggregated two ways (below).

### Avg Coverage (`current_pct` / topline "Avg Coverage")
- **Definition.** Unweighted mean of `coverage_pct` across indicator rows in scope
  (`avg(coverage_pct)`). Used as the flagship-table `current_pct` and the topline
  "Avg Coverage" tile.
- **Status bands.** `≥80` on_track/good, `60–80` watch, `<60` at_risk. **These
  bands are absolute attainment bands, not distance-to-target** (no targets are
  loaded — `target_pct` is honest NULL).
- **Aggregation.** Genuinely windowed (averaged over all months in the period).

### Reporting completeness (HMIS, volume-weighted)
- **Definition.** Share of expected facility-reports that arrived, weighted by
  volume. **Formula.** `100 · Σ facilities_reporting ÷ Σ facilities_expected`
  across the scope. Distinct from **Avg Coverage** only in weighting (sum-of-sums
  vs mean-of-ratios).
- **Confidence bands.** `≥90` High, `70–90` Medium, `<70` Low (drives the
  flagship-table `confidence_status`).
- **Facilities Reporting tile** = `Σ facilities_reporting ÷ distinct months`
  (a **monthly average**, not a sum — a sum would double-count facilities across
  months).

### Cascade retention % vs entry (`retention_pct_vs_entry` / funnel `pct`)
- **Definition.** For a programme funnel, each step as a % of the entry step.
- **Formula.** `100 · value_total ÷ value_total_at_step_1`. Step 1 = 100%.
- **`value_total` derivation (mart) — the credibility detail.** Each step's value
  respects its **measurement kind**: `flow` count elements are annually summed;
  `stock` count elements are averaged over months; `cohort_pct` elements become an
  effective count = `pct × the previous step's value`. This keeps the funnel
  monotonic (a suppression % isn't added like a case count).
- **Grain / period.** Year (`year_id`); sub-year windows collapse to the anchor
  year. Programme hard-locked per funnel.
- **Source.** `bi_service.mart_programme_cascade`. **Steps:** HIV
  (TEST→POS→ART-NEW→VL-SUPP), TB (NOTIF→TX-NEW→TX-SUCC), MNCH
  (ANC1→ANC4→SBA→PNC1), NCD (HTN SCRN→DX→TX→CTRL).
- **Example.** "HIV VL-SUPP at 71%" = 71% of those who entered (tested) reach viral
  suppression, cumulatively.

### MNCH continuum retention (`sv-continuity-mnch`)
- **Definition.** ANC4+ → Skilled birth → Postnatal care retention. Values are the
  averages of `anc4`, `skilled_birth`, `postnatal` from `bi_programme.mnch_coverage_v`.
  Unit: percent. Region-scoped.

### MNCH drop-off gaps (`sv-dropoff-region`)
- **Definition.** Decomposition of MNCH continuum loss per region.
- **Formulas.** anc_dropout = `100 − anc4`; delivery_gap = `anc4 − skilled_birth`;
  pnc_gap = `skilled_birth − postnatal`; total_dropoff = `100 − postnatal`.
- **Unit.** Percentage points. Source `mnch_coverage_v`.

### Woreda risk score & band (`sv-risk-woredas`)
- **Definition.** Composite risk from coverage gap + reporting incompleteness.
- **Formula.** `risk_score = 0.6·coverage_gap + 0.4·(100 − completeness)`, where
  `coverage_gap = 100 − avg(coverage_pct)`. Bands: `≥15` High, `≥8` Medium, else
  Low.
- **Unit.** Index (0–100 scale). `stockout_days` column is honest NULL (supply is
  region-grain). Source `bi_hmis.mart_hmis_indicator_coverage`.

### Zero-dose reach index & hotspot (`sv-zero-dose`)
- **Definition.** A *comparative* measure of where unreached children are.
- **Formula.** `reach_index` = **annualized Penta-1 doses per 1,000 expected
  infants**; `expected_infants` = `population × 3.2%` (Ethiopia CBR, a labelled
  estimate); `mbrana_zero_stock_pct` = share of USSD stock logs at zero in the last
  90 days; **hotspot** = bottom-tercile reach **AND** mBrana zero-stock ≥ 15%.
- **Unit.** Doses per 1,000 expected infants (index). Latest year only.
- **Why comparative.** Demo HMIS volumes are demo-scale while population is
  population-scale, so an absolute zero-dose % would read ~98% everywhere; compare
  regions to each other, **not** to 100%. Source `bi_hmis.mart_epi_zero_dose`.

### Agreement % (reported vs recorded)
- **Definition.** How closely DHIS2-reported and EMR-recorded intensities agree.
- **Formula (mart).** `100 · LEAST(emr_rate, dhis2_rate) ÷ GREATEST(emr_rate,
  dhis2_rate)` — a min/max ratio (0–100), where each side is a **per-reporting-
  facility monthly rate** (raw totals are normalised because the demo EMR covers
  ~30 facilities vs DHIS2's full region). Grain: **region** × indicator × month.
- **Bands.** Donut: agree `≥80`, moderate `50–80`, low `<50`. Table severity:
  `<60` Alert, `60–80` Watch, else OK.
- **Inclusion/exclusion.** Only like-for-like event pairs (ANC visit↔ANC1,
  Penta3↔PENTA3, HIV test↔HIV-TEST, Malaria RDT↔MAL-RDT, Blood pressure↔HTN-SCRN).
  TB deliberately unmapped (screening ≠ notification).
- **Source.** `bi_service.mart_reported_vs_recorded.agreement_pct`.
- **Example.** "Agreement 62%, Watch" = the two feeds diverge; investigate that
  region×indicator.

### Composite service reliability score (overview `ov-reliability-table`)
- **Definition.** Per-region blend of service coverage, reporting completeness, and
  commodity readiness.
- **Formula.** `0.40·coverage_pct + 0.35·coverage_confidence_pct + 0.25·commodity
  _readiness_pct`, where coverage_confidence = volume-weighted completeness and
  readiness = % of a region's commodities with `mos≥1` at the latest supply month.
- **Unit.** Index 0–100. `pop_weight_status` = "Unweighted" (honest label).
- **Weights** are a fixed design choice — **_requires confirmation_** whether they
  match a published MoH methodology.

---

## C. Resource / supply chain

### Months of Stock — MOS (`mos`)
- **Definition.** How many months current stock will last at current consumption.
- **Formula.** National: `soh_eom_avg ÷ amc` (`bi_supply.mart_resource_allocation`).
  Regional: `Σ(weight · hub SOH) ÷ Σ(weight · hub AMC)` catchment-blended across the
  EPSS hubs serving the region (`bi_supply.mart_supply_region_stock`).
- **Unit.** Months. **Thresholds used everywhere:** `<1` stockout/critical, `<3`
  at-risk/tight, `≥3` healthy.
- **Why it matters / example.** "MR vaccine 0.4 MOS in Gambella" = under two weeks
  of stock at current burn rate.

### AMC — Average Monthly Consumption (`amc`)
- **Definition.** 12-month moving average monthly consumption of a commodity.
  Source `amc12` in the HCMIS stock feed. Unit: units/month. Denominator of MOS and
  the days-to-stockout burn rate.

### Stock availability % (`rm-statboard` "Stock Availability")
- **Definition / formula.** `100 · (commodities with mos≥3) ÷ (all commodities)` at
  the latest month. Unit: percent. "Available" uses the **3-month planning buffer**
  standard, not "any stock at all".

### Commodities at risk / stocked out
- **Definition.** Counts at the latest month: **at risk** = `count(mos<3)`,
  **stocked out / urgent** = `count(mos<1)`. Unit: count of commodities.
  `commodity_region_pairs` = the same `mos<3` count over the region×commodity mart.

### Drug stress / regional composite (`rm-map`, `rm-hotspots`)
- **Definition / formula.** Per region, `100 · (commodities with mos<3) ÷ (all
  commodities)` at the latest month. Unit: percent (higher = worse). Latest-month
  snapshot (period hidden).

### Wastage score & units (`rm-wastage`, `rm-statboard`)
- **Definition.** Share of received units wasted. **Formula.** `100 · wastage_units
  ÷ received`, where `wastage_units = expired + damaged`. Bands: `≥10` High, `≥3`
  Moderate, else Low. Unit: percent. Only commodities with `received>0`. Source
  `mart_resource_allocation`.

### Days to stockout (`rm-forecast` `days_left` / `projected_days_remaining`)
- **Definition.** Projected days until a commodity hits zero. **Formula (mart).**
  latest on-hand ÷ (12-month AMC per day). Chart floor = 0, horizon = 90 days.
  Unit: days. A **burn-rate projection**, not a demand model. Source
  `bi_supply.mart_supply_stockout_forecast`.

### Stockout episode metrics (`rm-events`)
- **Definition.** One row per stockout **episode**: `days_out`, `months_out`,
  `severity`, `status`, `episode_start_month`. An episode = a run of zero-stock, not
  one day. Source `bi_supply.mart_supply_stockout_events`.

### Estimated missed services & service disruption % (`rm-stockout-impact`)
- **Definition.** The service cost of a stockout, via an explicit commodity→
  indicator linkage (`commodity_reference.enables_indicator`).
- **Formulas (mart).** `est_missed_services = round((monthly_service_volume ÷ 30) ·
  days_out_12m)`; `service_disruption_pct = 100 · (monthly_volume/30 · days_out_12m)
  ÷ (monthly_volume · 12)` (≈ share of a year's service-days lost). `NULL` where no
  linkage exists (never guessed).
- **Unit.** Services (count estimate) / percent. **A labelled estimate**, not
  counted turn-aways. `days_out_12m` = summed stockout days over 12 months. Exact
  per-indicator volume basis is in the mart — **_requires confirmation_** if pressed.

### Act score, trend ratio, supply status (`rm-act-week` / Decision Brief line 1)
- **Definition.** Ranking of outbreak pressure against response-commodity stock.
- **Formulas (mart `mart_supply_outbreak_response`).**
  - `cases_4w` = new cases in the last 4 ISO weeks per region×disease;
  - `trend_ratio` = `cases_4w ÷ cases_prior_4w` (>1 = growing; NULL if no prior);
  - `supply_status` by MOS: `no_countermeasure` (no mapped commodity),
    `no_stock_data` (mos NULL), `stockout` (mos≤0), `critical` (mos<1), `tight`
    (mos<3), `ok` (≥3);
  - `act_score` = `round(cases_4w · weight)` with weight stockout **3.0**, critical
    **2.0**, tight **1.0**, no_countermeasure/no_stock_data **0.5**, ok **0.25**.
- **Why it matters / example.** A big outbreak with a stocked-out treatment
  outranks a bigger one that's well supplied — the ranking the Decision Brief's "Act
  now" line uses.

### Cold-chain: temperature excursions & AEFI (`rm-cold-chain`)
- **Definition.** Latest-month national counts: `temperature_excursions` (cold-chain
  breaches) and `linked_aefi_events` (Adverse Events Following Immunization).
  Batch-level detail is honest NULL. Source `bi_hmis.mart_epi_cold_chain_safety`.
  "Linked" = same month, not a proven causal link.

### Supply availability (consumption-weighted) {#supply-availability-consumption-weighted}
- **Definition.** Share of **consumption volume** (not commodity count) with ≥3
  months of stock — used in the Decision Brief supply line and national KPIs.
- **Formula.** `100 · Σ(amc where mos≥3) ÷ Σ(amc)` at the latest month. Unit:
  percent. **Why weighted:** an equal-weight commodity average would let a
  low-volume reagent count as much as amoxicillin; weighting by AMC reflects real
  consumption.

---

## D. Data trust & facility base

### Source completeness & status (`ov-source-pulse`, `mart_data_quality`)
- **Definition.** Per **source**, did the expected records/reports arrive?
- **Formula.** `avg(completeness_pct)` with `reports_received`/`reports_expected`;
  `status` = `≥90` ok, `80–90` watch, `<80` poor (HLR §3.2.4 norms); `no_metric`
  where no honest completeness signal exists (EWARS/Climate). Per-source derivation:
  DHIS2 (facilities reporting vs expected), HCMIS (item coverage; SOH≥0 validity),
  mBrana (facilities logging vs registered base), EthioEMR (encounters), MFR
  (registry). Source `bi_quality.mart_data_quality`.

### Facility mapping coverage (`ov-trust-mapping`)
- **Definition / formula.** `100 · count(dhis2_path IS NOT NULL) ÷ count(*)` — share
  of facilities placed in the DHIS2 org hierarchy. Registry-path presence, **not**
  GPS. ~100% in every region (hence hidden under a region filter). Source
  `bi_facility.mart_facility_capacity`.

### Active-but-silent facilities (`ov-trust-silent`)
- **Definition / formula.** `count(*) FILTER (reporting_status='silent')` —
  facilities registered/active but not reporting. Unit: count (negative signal).
  Source `mart_facility_capacity`.

### Benchmarks — facilities, population, regions, woredas covered (`ov-benchmarks`)
- **Facilities** = `count(*)` of the facility registry (in scope). **Population** =
  `Σ population` over `mart_health_workforce` for in-scope regions (shown in
  millions; national ≈ 92.4M). **Regions** = distinct `region_id`. **Woredas
  covered** = distinct facility-parent org-units in the DHIS2 path ("districts with
  a facility" — **not** all administrative woredas). All react to the region filter.

### Workforce density (`rm-workforce`, not currently placed)
- **Definition.** Health workers per 10,000 population (`density_per_10k`), with
  `hcw_total`, `phys`, `nurse`, `hew`. Source `bi_facility.mart_health_workforce`.
  Documented for completeness; the widget is not placed on a current internal-BI
  page.

---

## E. Public-portal & admin metrics

Public KPI tiles (achievement rate vs **HSDIP target**, k≥5 aggregation) are
defined in [public-portal.md](public-portal.md); their reference metadata (labels,
targets, directions) comes from the `public_indicator_reference` seed, and the
national roll-up is facility-reporting-weighted
(`Σ(rate_pct · facilities_reporting) ÷ Σ facilities_reporting`). Admin
topology/health, DQ, and routing metrics are defined in
[admin-dashboard.md](admin-dashboard.md). They are not repeated here to keep each
metric defined once.
