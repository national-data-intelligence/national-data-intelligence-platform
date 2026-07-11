# Community malaria outbreak-risk detector (Farrington-style)

> **Community-contributed model.** Submitted through the NHDW workshop as the
> project *"Community Malaria Outbreak-Risk"* and graduated to the shared
> catalogue after data-steward review. Registry name: `community_malaria_risk`.
> Method adapted from the platform Farrington detector against the same
> `bi_idsr.mart_ml_disease_input` mart.

## What it predicts
For every (woreda × disease × ISO-week) it estimates the expected endemic count
and flags weeks whose observed count exceeds a Farrington-style threshold. It is
tuned to be more robust to seasonal noise than plain EARS via a week-window
baseline pool and a Poisson over-dispersion floor.

## Inputs
`bi_idsr.mart_ml_disease_input`: weekly `cases` per `woreda_uid × disease_code`
(zero-filled densified grid). Case counts only; climate is ignored.

## Method
- **Baseline pool** = counts from the same ISO-week **±2 weeks** in the **prior
  years** of the series → `mean`, sample `sd`.
- **Over-dispersion spread** = `max(sd, sqrt(mean))` (Farrington variance floor).
- **Threshold** = `mean + z · spread` (default `z = 2`; `z` is overridable at
  predict time).
- **outbreak_z** = `(observed − mean) / spread`.
- **alarm_prob** = `clip((observed − mean) / (2·z·spread), 0, 1)`. The platform
  derives **alarm_flag** = `alarm_prob ≥ 0.5` — the package does not emit it.
- `pred_cases_sd` carries `spread`; `endemic_sd` carries the raw sample sd; the
  spread is also in `attrs.spread`.
- No winsorizing and no percentile thresholds — a Gaussian z-channel with a
  Poisson floor, matching the flat-schema convention.
- Extras (`observed_cases`, `baseline_kind`, `spread`, `n_baseline`, `z`) are
  folded into the `attrs` jsonb column by the runner.

## One-year-history fallback (IMPORTANT)
Same as the rest of the disease family — two **explicit** branches selected per
series by ISO-year count:

- **Multi-year branch** (`≥ min_history_years`, default 2): same-ISO-week ±2 in
  prior years. Self-activates once seed history is extended.
- **Fallback branch** (`< min_history_years`): rolling **preceding-8-week
  window** (`mart_idsr_outbreaks` convention). The active branch is in
  `attrs.baseline_kind` (`same-week-multi-year` | `rolling-8w-fallback`).

Empty baselines (first weeks of a series) degrade to the observed value with a
Poisson spread and `alarm_prob = 0`.

## Limitations
- A detector, not a climate-lead forecaster (use `ewars_lite` for that).
- In the demo's single-year regime the multi-year "prior years" pool is empty,
  so it runs on the rolling-8-week fallback; behaviour strengthens materially
  once multiple years of history are seeded.
