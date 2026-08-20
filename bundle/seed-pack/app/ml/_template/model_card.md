# Model card — <model name>

<!-- ══════════════════════════════════════════════════════════════════════
model_card.md — the plain-language face of your model. REQUIRED.

Audience: a district health officer or an EPHI analyst deciding whether to
trust the number on a widget — not an ML engineer. The gateway serves this
file with the model metadata, and the workshop catalogue renders it.

Keep every section below. Delete the comments, keep the headings.
═══════════════════════════════════════════════════════════════════════ -->

## What it predicts

<!-- One or two sentences, no jargon. Example: "For every woreda and
priority disease, the expected number of weekly cases and the probability
that the current week is the start of an outbreak." -->

Template placeholder: expected weekly cases per (woreda × disease) plus a
0–1 outbreak-alarm probability for the latest reported week.

## Inputs

<!-- Where the data comes from (the mart), the columns actually used, and
the population the model covers. -->

- `bi_idsr.mart_ml_disease_input` — the densified weekly IDSR grid
  (all woredas × priority diseases × all weeks; missing weeks are true
  zeros, not gaps).
- Columns used: `cases` per ISO week. Climate columns (`rainfall_mm`,
  `temp_celsius`, `humidity_pct`) and `population` are available in the
  same mart — this template ignores them; climate-driven models must say
  here which lags they use.
- `population` may be NULL until the DHIS2 population dataSet is ingested;
  this model does not depend on it. Models that use a population offset
  MUST document what happens when it is NULL.

## Method

<!-- A short paragraph, method-level, no equations required. Name the
established technique it is based on. -->

Endemic channel: the baseline for a week is the mean ± sd of the same ISO
week in previous years; the alarm threshold is `mean + k·sd` (k = 3 by
default) and the alarm probability scales the exceedance into 0–1.

## Limitations

<!-- The section reviewers read first. ALWAYS include the history caveat
where applicable. -->

- **One-year-history fallback**: the demo warehouse seeds a single year of
  IDSR history, so the same-week-other-years baseline has no support; the
  model then falls back to a rolling window of the preceding 8 weeks. The
  multi-year branch activates automatically as more history accumulates.
  Until then, alarms reflect *recent-weeks* deviation, not true seasonality.
- Series with fewer than 3 baseline weeks are skipped (no forecast row).
- No spatial smoothing: each woreda is scored independently; sparse woredas
  produce noisy baselines.
- Weekly grain only; reporting delays shift signals by up to one week.

## Output & how to read it

The unified flat forecast schema (`ops_ml.ml_predictions`).
`alarm_prob` risk bands used across all dashboards:
low < 0.2 ≤ watch < 0.5 ≤ elevated < 0.8 ≤ high.
`alarm_flag` is set by the platform at `alarm_prob ≥ 0.5`.

## Provenance & maintenance

<!-- Who built it, on what method/source, who maintains it. -->

- Provenance: `community` (template).
- Method reference: WHO EWARS endemic-channel practice, adapted.
- Maintainer: <team / contact>.
