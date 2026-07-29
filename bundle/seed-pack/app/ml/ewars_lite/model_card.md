# EWARS-lite — climate-driven NB2 GLM early-warning model

## What it predicts
For each (woreda × disease × ISO-week) it forecasts the expected weekly case
count from **lagged climate** and **seasonality**, and estimates the probability
that cases exceed the endemic alarm threshold. It is the climate-**lead** model
of the family — unlike the pure detectors (EARS / Outbreak / Seasonal) it can
anticipate a rise from rainfall/temperature/humidity signals weeks ahead.

It is a deliberately lightweight, fully offline stand-in for WHO's **EWARS-CSD**
(R/INLA Bayesian model, 48–64 GB RAM). It reproduces the climate-early-warning
behaviour with a Negative-Binomial GLM and NB posterior sampling, at a fraction
of the cost.

## Inputs
`bi_idsr.mart_ml_disease_input`: weekly `cases`, region `rainfall_mm`,
`temp_celsius`, `humidity_pct` (broadcast to woreda), and `population` per
`woreda_uid × disease_code`.

## Method
- **Family**: Negative Binomial (NB2), variance `mu + alpha·mu²`. `alpha` is
  estimated by the Cameron-Trivedi auxiliary OLS on a first-pass Poisson fit,
  then the model is refit as `NB(alpha)`.
- **Covariates**: rainfall/temp/humidity **lags 1..nlags** (default 8, built
  within each woreda series); **seasonal harmonics** sin/cos of ISO-week
  (`nharmonics` pairs, default 2); **region fixed effects** (dummy per region).
- **Offset**: `log(population)` **only when population is present and positive
  for the whole training frame**; otherwise **no offset** is used (the model
  then forecasts raw counts). Which path was taken is recorded per row in
  `attrs.use_offset`.
- **Pooling**: one GLM is fit **per disease**, pooling all woredas, with region
  fixed effects — more data per fit and cross-woreda climate signal.
- **Bands**: `n_draws` (default 500) draws from `NB2(mu, alpha)` give
  `pred_cases_mean/sd/median/lwr95/upr95`.
- **Alarm**: `alarm_threshold` comes from the EARS **endemic channel**
  (`endemic_mean + k·endemic_sd`; `k` overridable at predict time);
  `alarm_prob = P(draw > alarm_threshold)`. The platform derives **alarm_flag**
  = `alarm_prob ≥ 0.5` — the package does not emit it. `n_draws` is emitted.
- Extras (`observed_cases`, `mu_glm`, `alpha`, `use_offset`, `glm_kind`,
  `endemic_kind`, `nlags`, `nharmonics`, `k`) are folded into the `attrs` jsonb
  by the runner.

## One-year-history fallback (IMPORTANT)
- The **GLM** needs no multi-year history: harmonics + lagged climate carry the
  seasonal signal from a single year of weekly data.
- The **endemic channel** used for the alarm threshold has the same two
  **explicit** branches as EARS: same-ISO-week-other-years when
  `≥ min_history_years` ISO-years exist, else a **rolling preceding-8-week
  window**. The active branch is in `attrs.endemic_kind`.
- Where the GLM cannot be fit (too few rows, singular design, perfect
  separation) that disease falls back to its **endemic mean** — recorded in
  `attrs.glm_kind` (`nb_glm` | `mean`).

## Limitations
- Not the full Bayesian spatio-temporal EWARS-CSD: no INLA RW1 cyclic time / IID
  space random effects and no DLNM distributed-lag cross-basis — plain climate
  lags stand in for the DLNM.
- Until population is seeded (task #40 / C3) the model runs **without** the
  population offset, so `pred_cases_*` are raw counts, not incidence rates.
- Region climate is broadcast to every woreda of the region, so within-region
  spatial climate variation is not resolved.
