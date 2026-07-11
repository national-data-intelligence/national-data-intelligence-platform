# Community stockout forecast (Holt-Winters days-to-stockout)

> **Community-contributed model — changes requested.** Submitted through the
> NHDW workshop as the project *"Community Stockout Forecast"*; the reviewer
> asked for changes before it can graduate. Registry name (on approval):
> `community_stockout`. Holt-Winters consumption forecast adapted from the
> platform stockout model against `bi_supply.mart_resource_allocation`.

## What it predicts
Per **commodity**, it forecasts next-period consumption and projects how many
days of stock remain before a stockout, with a status label
(`stockout` / `risk` / `watch` / `ok`).

## Inputs
`bi_supply.mart_resource_allocation` (monthly, commodity grain):
`amc` (average monthly consumption), `soh_eom_avg` (end-of-month stock on hand),
`received`, `wastage_units`, `stockout_days`, `mos`. The model uses `amc` as the
consumption series and `soh_eom_avg` as current stock.

## Method
- Order each commodity's monthly `amc` series by `month_id`.
- Fit **Holt-Winters** (additive trend, no seasonal) and forecast next month's
  consumption; **fall back to the series mean** when fewer than `min_months`
  (default 4) points are available (recorded in `attrs.method`).
- `days_remaining = soh_eom_avg / (projected monthly consumption / 30)`.
- `status`: `stockout` if SOH ≤ 0; `risk` if `days_remaining ≤ horizon/2`;
  `watch` if `≤ horizon`; else `ok`.

## Flat-schema mapping
- `disease = ''` (non-disease model); `district = commodity_name`.
- `year`/`week` = ISO year/week of the projection week (last month + horizon).
- `pred_cases_mean/sd/lwr95/median/upr95` = projected-consumption stats.
- `alarm_threshold` = projected consumption (expected demand over the horizon).
- `alarm_prob = clip(1 − days_remaining/horizon_days, 0, 1)` (1.0 if already out
  of stock). The platform derives `alarm_flag` = `alarm_prob ≥ 0.5` — the
  package does not emit it.
- Extras `{soh_now, amc_30d, projected_days_remaining, projected_stockout_date,
  status, method}` are folded into the `attrs` jsonb by the runner.
- `disease = ''` (the ops_ml PK default for non-disease models);
  `endemic_*`, `outbreak_z`, `n_draws` are NULL — not applicable to this model.

## Limitations (facility-proxy caveat — IMPORTANT)
- `mart_resource_allocation` aggregates HCMIS across facilities to a **national
  commodity** grain, so this is a **country-level commodity proxy**, not a
  per-facility stockout forecast. A facility that is stocked out can be masked by
  national averages, and vice-versa. A facility-grain mart is needed for
  operational, site-level stockout alerting.
- Monthly grain + short history means no seasonal term is fitted; the forecast
  is a trend-only projection.
- `amc` is an average rate, not a metered daily draw-down, so the days-remaining
  figure is an estimate of central tendency, not a worst-case runway.
