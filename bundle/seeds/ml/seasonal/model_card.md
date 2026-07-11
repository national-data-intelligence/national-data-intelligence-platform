# Seasonal — seasonal-profile expectation channel

## What it predicts
For every (woreda × disease × ISO-week) it estimates the **expected seasonal
level** — the shape of a normal year scaled to the current year's overall
activity — and flags weeks that rise materially above it.

## Inputs
`bi_idsr.mart_ml_disease_input`: weekly `cases` per `woreda_uid × disease_code`.
Case counts only.

## Method
- **Profile** `profile[W]` = mean of prior years' cases at ISO-week `W`.
- **Level ratio** = `clip(mean(current-year cases) / mean(other-years cases),
  0.3, 3)` — rescales the profile to this year's overall activity.
- **Expected** `mu[W] = profile[W] · level_ratio`.
- **Spread** = sd of prior years' cases at week `W`, floored at `sqrt(mu)`.
- **Threshold** = `mu + z · spread` (default `z = 2`; overridable at predict
  time).
- **outbreak_z** = `(observed − mu) / spread`;
  **alarm_prob** = `clip((observed − mu) / (2·z·spread), 0, 1)`. The platform
  derives **alarm_flag** = `alarm_prob ≥ 0.5` — the package does not emit it.
- Extras (`observed_cases`, `baseline_kind`, `profile`, `level_ratio`, `z`) are
  folded into the `attrs` jsonb column by the runner.

## One-year-history fallback (IMPORTANT)
With only one ISO-year there are no prior years to average. The **explicit**
fallback branch builds a **single-year, leave-one-out** profile:

- `profile[i]` = a centred rolling mean (window 5) of the year's own weekly
  cases — the seasonal shape.
- `level_ratio` is computed **leave-one-out** (excluding week `i`) so the
  expectation is never trivially equal to the observed week.
- residual sd of `(cases − profile)` is the spread (Poisson-floored).

The branch is recorded per row in `attrs.baseline_kind`
(`same-week-multi-year` | `single-year-loo-fallback`). The multi-year branch
self-activates per series once ≥ `min_history_years` ISO-years exist.

## Limitations
- Captures seasonality and level, not climate-driven lead time (use
  `ewars_lite`).
- The single-year fallback's profile is a smoother of the same year, so it
  detects sharp local spikes but cannot distinguish a genuinely anomalous
  *season* from the norm until multiple years are seeded.
