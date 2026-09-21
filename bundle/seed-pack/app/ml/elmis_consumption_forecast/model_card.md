# elmis_consumption_forecast — v2 (forecast contract)

**Purpose.** One-month-ahead demand forecast per facility × tracer product for PCT
planning on the Zambia eLMIS archive, with calibrated P10/P50/P90. Governed by
`docs/pct-forecast-contract.md`.

**Data.** `bi_supply.mart_pct_demand_month`, tracer products, programmes summed per
facility × product × month. Target = `adjusted_demand` (eLMIS normalized consumption;
dispensed where NULL). Missing months are gaps, never zeros. Stockout-censored months
train as observed floors and are never scored.

**Population.** Eligible series have ≥ 6 observed months up to the forecast origin and
some non-zero demand (census: `eda/census.sql` — 9,418 of 29,202 series at the holdout
cutoff, 96% of demand volume). Excluded series keep eLMIS AMC as their planning basis.

**Method.** Six transparent comparators — naive-last, trailing 3-month mean,
damped Holt, Croston, SBA, TSB — evaluated on an expanding-window fold ledger
(horizon 1; 5 tuning origins; final holdout as_of 2018-07 → 2018-08, touched once).
Per demand class (Syntetos–Boylan) the lowest tuning WAPE is selected: **trailing
3-month mean for smooth, erratic and intermittent series; TSB for lumpy series.
Damped Holt (the v1 model) was evaluated and not selected for any class.**
P10/P50/P90 = the point forecast plus empirical quantiles of scaled tuning errors per
class (scale = the series' mean training demand), clipped at 0.

**Evaluation (logged inside the MLflow run of the registered version).**
Holdout (Aug 2018, 5,967 series): WAPE 0.598 vs naive-last 0.630, trailing-3 0.616 and
eLMIS AMC 0.627; bias −3.0%; P10–P90 coverage 81.0% (nominal 80%). Tuning WAPE 0.573.
MASE 2.23 is high because many histories are nearly flat, which makes their
training-only scale tiny — it is reported, not hidden; pooled RMSSE (23.5) is dominated
by the same series and is not shown on surfaces. The predeclared champion rule
passed (`champion_rule_passed = 1`). These are **historical backtest** results; the
forecast months have no observed accuracy. The same backtest, one row per fold window
(metrics named `backtest_*`), is written to `ops_ml.model_performance` under the
registered version and read by `bi_supply.mart_pct_forecast_accuracy`.

**Limits.** 12 months of history: no seasonality is learnable. Only H1 is produced.
Demand in stockout months is a floor. Comparator parameters are fixed; the fold ledger,
not per-series fitting, decides which method serves each class.

**Serving.** Batch, flat forecast schema; contract keys in `attrs`
(`forecast_contract.yaml`); the Gaussian lwr95/upr95 columns are retired (empty).
`bi_supply.mart_pct_forecast` serves the latest batch run of a version that carries this
backtest, with the version and MLflow run on every row.
**Promotion.** Version 4 was promoted to `@champion` on 2026-09-21 through the gateway's
promote route by an operator (R-OPS-ADM; MLflow alias + gateway audit event), after its logged
`champion_rule_passed = 1`. The route itself does not check the rule; the operator does, from the
run's metrics. Version 1 (the pre-contract damped-Holt model) stays registered; rollback = promote
it again. Because `bi_supply.mart_pct_forecast` serves only versions that carry the contract
backtest, a surface must compare the mart's `model_version` with the live champion and fall back
to eLMIS AMC, labelled, when they differ.

**Owner.** PCT (Abenezer).
