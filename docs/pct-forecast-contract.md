# PCT forecast contract (M0)

The agreement every PCT forecast must satisfy before it can drive a position, a
recommendation or a promotion. It governs `elmis_consumption_forecast` (and any
challenger) on the Zambia eLMIS archive. Decided 2026-09-21; changes need a new
entry in `docs/decisions/2026-09-21-pct-product-phase.md`, not a silent edit.

**Why it exists.** A code-level review found the registered model had no recorded
accuracy (its "MASE 0.977" was printed during training but never logged to
MLflow), trained on dispensed quantity rather than demand, ignored stockouts,
produced a one-month Gaussian band rather than quantiles, and could not be
monitored after deployment. This contract fixes the terms before the model is
touched.

## 1. Target
- **Forecast target = `adjusted_demand`** from `bi_supply.mart_pct_demand_month`:
  eLMIS's own stockout-adjusted consumption (`normalized_consumption`), dispensed
  quantity only where that is NULL. One definition of demand across the platform.
- **Series** = facility × tracer product (programmes summed), monthly.
- **Stockout-censored months** (`demand_censored`) stay in training as observed
  floors but are **excluded from scoring** — their actual is not true demand.
- **Skipped / missing months are gaps, not closed up**: time advances through a gap
  without an observation; nothing is imputed as zero.

## 2. Scope (census: `bundle/seed-pack/app/ml/elmis_consumption_forecast/eda/census.sql`)
| Group | Series | Share of demand volume |
|---|---|---|
| Eligible — smooth | 2,189 | 58.7% |
| Eligible — erratic | 1,280 | 28.5% |
| Eligible — intermittent | 4,101 | 3.1% |
| Eligible — lumpy | 1,848 | 6.0% |
| Excluded — fewer than 6 training months | 12,162 | 3.7% |
| Excluded — no non-zero demand | 7,622 | 0.04% |
Eligible = ≥ 6 observed months before the holdout month and ≥ 1 non-zero demand.
Intermittency by Syntetos–Boylan (ADI 1.32, CV² 0.49). Excluded series are listed,
never silently dropped; their planning basis stays eLMIS AMC.

## 3. Time
- `as_of_month`: the last month the forecast may see. `target_month`: the month it
  predicts. `horizon` = months between them (H1 = the next month).
- **Only H1 is produced and claimed.** H2/H3 are shown as "not produced".
- Frozen training cutoff for the final evaluation: as_of 2018-07.
- Demo anchor ("today"): as_of 2018-08 → target 2018-09. Never `now()`.

## 4. Uncertainty
- **P10 / P50 / P90** from the empirical distribution of H1 errors in the fold
  ledger (§6), per demand class, added to the point forecast and clipped at 0
  (a split-conformal style interval). Nominal P10–P90 coverage = 80%.
- The old Gaussian ±1.96σ band is retired; it is never relabelled as quantiles.

## 5. Storage
- The shared prediction table (`ops_ml.ml_predictions`, used by every forecaster) is
  **unchanged**. The contract keys travel in its `attrs`: `facility_code`,
  `product_code`, `as_of_month`, `target_month`, `horizon`, `p10`, `p50`, `p90`,
  `demand_class`, `method`.
- `bi_supply.mart_pct_forecast` unpacks them into columns keyed by run × facility ×
  product × as_of × target × horizon, reading only the latest run.
- Schema: `bundle/seed-pack/app/ml/elmis_consumption_forecast/forecast_contract.yaml`.

## 6. Evaluation
- **Expanding-window fold ledger**, H1: as_of 2018-02 → 2018-06 (5 tuning folds,
  targets 2018-03 → 2018-07); **final holdout as_of 2018-07 → target 2018-08,
  touched once** and recorded in the ledger.
- **Comparators (feasible with 12 months):** naïve-last; trailing 3-month mean (the
  AMC analogue); damped Holt; Croston / SBA / TSB for intermittent and lumpy series.
  No seasonal-naïve: no prior year exists.
- **Predeclared champion rule:** the candidate is promoted only if, on the tuning
  folds AND the holdout, it beats both naïve-last and trailing-3 on WAPE at H1, with
  |bias| ≤ 10% and P10–P90 coverage between 70% and 90%. Otherwise **AMC stays the
  planning basis** and the surface says so.

## 7. Metrics (logged inside the MLflow run, per fold and holdout)
WAPE (primary) and MAE; MASE and RMSSE with a **training-only** scale (the earlier
pooled "MASE" is retired — if kept it is named `relative_mae_vs_naive1`); signed and
cumulative bias; P10 and P90 pinball loss; P10–P90 coverage and mean width; counts
of series, observations, demand volume, excluded and censored series. Every metric
is broken down by demand class, programme, province and facility type. Operational:
stockout-risk recall, false-alert rate, forecast-vs-AMC planning delta. **Pooled MAPE
is never used for selection** (zero demand makes it meaningless).

## 8. Decision policy
- P50 = expected demand. **P90 for critical tracers** (the Global Fund S8 categories:
  HIV antiretrovirals, HIV diagnostics, malaria diagnostics).
- **How they are applied (clarified by decision #28, measured on the holdout):** order
  sizes use **P50** as the monthly rate in eLMIS's max/min policy; **lumpy series stay
  on eLMIS AMC** (P50 under-covered their volume by 45%). **P90 is the one-month
  stockout-risk test** for critical tracers (stock below P90 = at risk before the next
  delivery) — it is never multiplied into an order: as a sizing rate it would have
  raised August 2018 replenishment from 2.78M to 7.07M units.
- If the champion rule fails, or a series is excluded, the position stays on eLMIS
  AMC, labelled.
- Every approved plan line snapshots the forecast run, quantile policy, inputs and
  rationale, so a rebuilt mart cannot change what was approved.

## 9. Delivery (proof required before any forecast reaches a surface)
package → runner → MLflow run (metrics INSIDE the run) → registered version + alias →
Airflow batch inference → `ops_ml` → `mart_pct_forecast` refresh → PCT widgets.
Known gaps to close with the platform owner: CI does not rebuild the runner or ship
model packages (`seed-ml.sh`, with `--retrain` when a champion exists); batch
inference is scheduled by clock, not by data availability; nothing refreshes a
forecast-consuming mart after predictions land; promotion writes an MLflow alias and
a gateway audit event, not `ops_artifact.promotion_log`.

## What the demo may say
"We evaluated transparent short-history demand-forecasting methods on the Zambia
eLMIS archive. The selected method is used only where it beats predeclared baselines
on rolling-origin backtests without unacceptable bias or miscalibration." Accuracy
shown is **historical backtest performance** — never observed accuracy for the
forecast months.
