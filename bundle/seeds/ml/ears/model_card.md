# EARS — endemic-channel aberration detector

## What it predicts
For every (woreda × disease × ISO-week) it estimates the **endemic level** —
the number of cases you would normally expect that week — and flags weeks whose
observed count sits abnormally far above that level (an aberration / possible
outbreak signal).

## Inputs
`bi_idsr.mart_ml_disease_input`: weekly `cases` per `woreda_uid × disease_code`
(zero-filled densified grid), plus region climate and population. EARS itself
uses only the case counts; it ignores climate.

## Method
- **Endemic baseline** = mean and standard deviation of the **same ISO-week in
  the other years** of that series.
- **Threshold** = `endemic_mean + k · endemic_sd` (default `k = 3`; `k` is
  overridable at predict time via the deployment params).
- **outbreak_z** = `(observed − endemic_mean) / endemic_sd`.
- **alarm_prob** = `clip((observed − endemic_mean) / (2·k·endemic_sd), 0, 1)`.
  The platform derives **alarm_flag** = `alarm_prob ≥ 0.5` — the package does
  not emit it.
- The predicted endemic level is also the forecast: `pred_cases_mean =
  endemic_mean`, 95 % band `endemic_mean ± 1.96·endemic_sd`.
- One row per (woreda × disease × ISO-week); extra context (`observed_cases`,
  `baseline_kind`, `n_baseline`, `k`) is folded into the `attrs` jsonb column
  by the runner.

## One-year-history fallback (IMPORTANT)
The demo currently seeds roughly a single ISO-year, so "same week in other
years" has no data. Each series therefore runs one of two **explicit** branches,
chosen automatically by how many ISO-years it actually has:

- **Multi-year branch** (`≥ min_history_years`, default 2): same-ISO-week-
  other-years baseline as above. Activates on its own once seed history is
  extended.
- **Fallback branch** (`< min_history_years`): a **rolling preceding-8-week
  window** (mean + sd of the 8 weeks immediately before the target week — the
  same convention as `mart_idsr_outbreaks`). The active branch is recorded in
  each row's `attrs.baseline_kind` (`same-week-multi-year` |
  `rolling-8w-fallback`).

When even the fallback window is empty (the first weeks of a series), the
baseline degrades gracefully to the observed value with a Poisson sd
`sqrt(max(obs, 1))` and `alarm_prob = 0`.

## Limitations
- A detector, not a climate-driven forecaster — it cannot anticipate outbreaks
  before cases rise. Use `ewars_lite` for climate-lead early warning.
- With only rolling-8-week baselines (demo data), a sustained real rise inflates
  its own baseline and can be under-flagged; multi-year baselines are stronger.
- `endemic_sd` is floored at `sqrt(mean)` when the sample is too small to
  estimate dispersion, to avoid divide-by-zero alarms.
