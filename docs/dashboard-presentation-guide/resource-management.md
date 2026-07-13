# Internal BI → Resource Management

*Part of the NHDW Dashboard Presentation Guide — see [README.md](README.md). Read
[general.md](general.md) first. Metric formulas: [metric-glossary.md](metric-glossary.md).
Data provenance: [data-sources.md](data-sources.md).*

Catalog: `.../catalog/pages/internal-bi--resource.yaml` + the four
`sections/internal-bi--resource--*.yaml` files.

---

## Page overview

- **What it is.** The **commodity / supply-chain** command view — stockout risk,
  where supply is stressed geographically, commodity-level detail (wastage,
  cold-chain), and how stockouts translate into missed services.
- **The story.** *Here's the national stockout headline; here's where supply is
  stressed on the map and which regions are worst; here's the commodity-level
  detail (waste, cold-chain safety); and here's the human cost — services missed
  and days-to-stockout.*
- **Audience.** EPSS / logistics leadership, programme supply officers, planners.
- **Decisions it supports.** Which commodities are about to run out and where;
  where to reallocate; which stockouts are hurting services.
- **One-line takeaway.** *"From 'how many months of stock' to 'how many services
  that stockout costs' — the supply story with a service consequence."*
- **Filters:** region, period, programme, **commodity**. Commodity is a plain UI
  narrowing filter (no user is scoped by commodity), applied only where a mart
  has a `commodity_name` column.

> **Grain reality (say once).** HCMIS stock lives at **EPSS hubs** (warehouses),
> not facilities. National marts aggregate across all hubs; **regional** supply is
> obtained by allocating a hub's stock/consumption to the regions it serves via a
> catchment weighting (so all 14 regions are covered and nothing is
> double-counted). There is **no honest facility-level supply cut**.

Sections: **Stockout Headline** → **Supply Stress Geography** → **Commodity
Detail** → **Stockout Impact on Service**.

---

## Section: Stockout Headline

*`internal-bi--resource--stockout-headline.yaml`, eyebrow "Commodity availability".
Widgets: `rm-hero` (5 cols, 3 rows), `rm-statboard` (7 cols, 3 rows).*

- **Purpose.** The at-a-glance current supply state.
- **Interpretation.** rm-hero = the "how bad is it" callout; rm-statboard = the
  four supporting numbers.
- **Questions answered.** How many commodities are at risk / stocked out right
  now? What's average months-of-stock? How much waste?
- **Message.** "Current state — a snapshot, not a trend."

### Widget: Stockout Watch (`rm-hero`)

- **Data source.** `bi_supply.mart_resource_allocation` (month × commodity,
  national) + a subselect on `bi_supply.mart_supply_region_stock`. `data_class` =
  `DC.STK`.
- **Fields.** commodities_at_risk (`mos<3`), commodity_region_pairs (`mos<3`),
  already_stockout (`mos<1`), urgent_items (`mos<1`), and **honest NULLs**:
  value_at_risk_etb, services_exposed, estimated_service_disruption.
- **Calculation.** All at the **latest month**. "at risk" = `mos < 3` months of
  stock; "stockout/urgent" = `mos < 1`.
- **Filters / geo / period.** Supports programme and commodity. **Period is
  hidden** — this is a current-state snapshot (a rolling window always contains
  the latest month, so it can't change the answer); the widget hides if a period
  is picked. No region column → geography not supported.
- **Limitations.** Monetary value-at-risk and service-exposure are honest NULL (no
  pricing or commodity→service linkage feed at this grain).
- **Common misinterpretations.** "At risk" (`mos<3`) is a warning band, not
  "stocked out"; "stocked out" is `mos<1`.
- **Talking points.** "Two thresholds: under 3 months = watch, under 1 month =
  act now." / "We don't show a birr value — no pricing feed, so we won't invent
  one."

### Widget: Commodity Status & Facility Integrity (`rm-statboard`)

- **Data source.** `bi_supply.mart_resource_allocation` (latest month).
- **Fields (4 tiles).** **Stock Availability** (% commodities with `mos≥3`),
  **Avg Months of Stock** (avg `mos`), **Commodities Stocked Out** (`mos<1`
  count), **Wastage Units** (sum). target/delta/spark are honest-null.
- **Filters / geo / period.** Supports programme, commodity. **Period hidden**
  (current-state).
- **Common misinterpretations.** Availability uses `mos≥3` as "available" — a
  planning buffer standard, not "any stock at all".

---

## Section: Supply Stress Geography

*`internal-bi--resource--supply-stress-geography.yaml`. Widgets: `rm-map` (7 cols),
`rm-hotspots` (5 cols), `rm-stock-heatmap` (full width).*

- **Purpose.** Where supply is stressed, ranked and mapped, plus the full
  commodity × region stock matrix.
- **Interpretation.** Map + hotspots read the same region stress metric; the
  heatmap is the drill-in.
- **Questions answered.** Which regions have the most commodities under stress?
  Which commodity is short in which region?
- **Message.** "The map tells you where; the heatmap tells you what."

### Widget: Supply Stress Map (`rm-map`)

- **Data source.** `bi_supply.mart_supply_region_stock` (latest month).
- **Fields.** region, composite_score = **drug_stress** = % of a region's
  commodities with `mos < 3`; facility_gap & readiness_gap are honest NULL.
- **Filters / geo / period.** Supports region. **Period hidden** (latest-month
  regional stress — current state).
- **Common misinterpretations.** Higher `drug_stress` = worse (more commodities
  stressed).

### Widget: Supply Hotspots (`rm-hotspots`)

- **Data source.** `bi_supply.mart_supply_region_stock` (latest month).
- **Fields.** rank, region, **composite** (= % commodities with `mos<3`),
  exposed_services / service_volume_month / trend all honest NULL.
- **Filters / geo / period.** Supports region. **Period hidden.** Deterministic
  rank (region tiebreak). Top 12.
- **Talking point.** "Same stress metric as the map, ranked — the worst regions
  first."

### Widget: National Stock Distribution (`rm-stock-heatmap`)

*(This is the widget formerly described as the "drug-stock heatmap" — now titled
"National Stock Distribution".)*

- **Data source.** `bi_supply.mart_supply_region_stock` (latest month).
- **Fields.** commodity_name, region_id, **mos** (rounded to 1 dp) — the widget
  pivots these into a commodity (rows) × region (columns) heatmap of months-on-hand.
- **Calculation.** Latest month only; rows with `mos IS NULL` are dropped.
- **Filters / geo / period.** Supports region, programme, commodity, **and period
  (month grain)** — this one *does* react to period because the mart is genuinely
  time-indexed here.
- **Common misinterpretations.** Cells are **months of stock**, not units or a
  percentage. A dark low-MOS cell = short; a light high-MOS cell = well stocked
  (or possibly over-stocked).
- **Talking points.** "The full picture: every tracer commodity against every
  region in one grid." / "Read down a column for a region's weak spots, across a
  row for a commodity's national coverage."

---

## Section: Commodity Detail

*`internal-bi--resource--commodity-detail.yaml`. Widgets: `rm-wastage` (7 cols),
`rm-cold-chain` (5 cols).*

- **Purpose.** Commodity-level efficiency (waste) and vaccine cold-chain safety.
- **Questions answered.** Which commodities are we wasting? Are there cold-chain
  excursions / adverse events?
- **Message.** "Availability isn't the whole story — waste and cold-chain matter."

### Widget: Wastage & Consistency (`rm-wastage`)

- **Data source.** `bi_supply.mart_resource_allocation`.
- **Fields.** commodity, **wastage_score** = `100·wastage_units ÷ received`,
  **use_band** (`≥10` High, `≥3` Moderate, else Low).
- **Filters / geo / period.** Supports programme, commodity, **and period (month
  grain)**. Only commodities with `received > 0`. Top 14 by wastage.
- **Common misinterpretations.** wastage_score is **% of received units wasted**
  (expired + damaged), not absolute units.

### Widget: Cold-Chain & Safety (`rm-cold-chain`)

- **Data source.** `bi_hmis.mart_epi_cold_chain_safety` (latest month, national).
  `data_class` = `DC.CAT`.
- **Fields.** temperature_excursions, linked_aefi_events (both real); affected
  _batches, recipients_exposed, batch_notes are honest NULL.
- **Filters / geo / period.** No geo (national). **Period hidden** (latest-month
  snapshot).
- **Common misinterpretations.** AEFI = Adverse Events Following Immunization;
  "linked" here means counted in the same month, not causally linked to a specific
  excursion.
- **Talking point.** "Excursions and AEFI are real; batch-level detail is honestly
  blank — no batch-level cold-chain feed yet."

---

## Section: Stockout Impact on Service

*`internal-bi--resource--stockout-impact-service.yaml`. Widgets: `rm-stockout-impact`
(7 cols), `rm-forecast` (5 cols), `rm-events` (full width).*

- **Purpose.** Translate stock shortages into **service consequences** and
  forward risk.
- **Interpretation.** Impact table = missed services; forecast = days to stockout;
  events = the actual stockout episodes.
- **Questions answered.** Which stockouts cost the most services? What runs out
  soonest? What stockout episodes actually happened?
- **Message.** "This is the 'so what' — stock numbers become missed appointments."

### Widget: Stockout Impact (`rm-stockout-impact`)

- **Data source.** `bi_supply.mart_stockout_service_impact`. `data_class` =
  `DC.STK`.
- **Fields.** commodity, region, days_out_ytd (12-month), **estimated_missed
  _services** (a derived estimate or NULL), service_disruption_pct; facilities
  _affected & trend are honest NULL.
- **Calculation.** estimated_missed_services ≈ `days_out × (enabled indicator's
  monthly regional volume ÷ 30)` — the commodity→service linkage rides the
  `commodity_reference.enables_indicator` seed; where no linkage exists the value
  is **NULL**, never guessed. Top 10 by estimated missed services.
- **Filters / geo / period.** Supports region, programme. **Snapshot** — fixed
  12-month window inside the mart (period not a widget control here).
- **Common misinterpretations.** "estimated_missed_services" is a **labelled
  estimate** from a linkage assumption, not a counted number of turned-away
  patients.
- **Talking points.** "The one widget that connects a stockout to a service — via
  an explicit, auditable commodity→indicator map." / "Blank estimate = that
  commodity has no service linkage, not zero impact."
- **Likely questions.** *"How reliable is the estimate?"* It's a modelled linkage;
  treat it as directional. **_Requires confirmation_** of the exact per-indicator
  volume basis if pressed (defined in the mart).

### Widget: Days to Stockout Timeline (`rm-forecast`)

- **Data source.** `bi_supply.mart_supply_stockout_forecast`. `data_class` =
  `DC.STK`.
- **Fields.** commodity, **days_left** (`projected_days_remaining`), floor_days
  (0), horizon_days (90).
- **Calculation.** Days-to-stockout = latest on-hand ÷ (12-month AMC per day),
  computed in the mart. The chart shows a 0-line and a 90-day horizon. Soonest 12.
- **Filters / geo / period.** Supports commodity. **Period hidden** — a
  forward-looking single-as-of snapshot (a history window can't change "current
  forecast").
- **Common misinterpretations.** This is a **simple burn-rate projection** (on-hand
  ÷ AMC), not a demand-forecasting model.

### Widget: Recent stockout events (`rm-events`)

- **Data source.** `bi_supply.mart_supply_stockout_events`. `data_class` = `DC.STK`.
- **Fields.** region_id, commodity_name, episode_start_month, months_out, days_out,
  severity, status.
- **Filters / geo / period.** Supports region, programme, commodity, **period**
  (episodes **starting** in the window, `episode_start_month`, month grain). Most
  recent 50.
- **Common misinterpretations.** One row = one stockout **episode** (a run of
  zero-stock), not one day.

> **Note on `rm-act-week`** ("Act this week"): a fetcher exists
> (`bi_supply.mart_supply_outbreak_response`) that joins outbreak pressure to
> response-commodity stock, but it is **not placed** in the current Resource page
> catalog. Its logic instead surfaces as line 1 of the Overview **Decision Brief**
> (see [bi-dashboard.md](bi-dashboard.md#the-decision-brief-narrative-86--per-narrative-block)).
