# Community EWARS Malaria Early-Warning

A community-contributed climate-driven early-warning model (Negative-Binomial
GLM) forecasting weekly malaria case counts and alarm probability per woreda,
adapted from the platform EWARS-lite model. **Currently under review.**

## Contents
- `model/` — the runner package (read by the graduation integration on
  approval): `manifest.yaml`, `train.py`, `feature_spec.yaml`, `params.yaml`,
  `model_card.md`, `requirements.txt`. Registry name: `community_ewars_malaria`.
- `predict.py` — standalone batch-inference helper.
- `analysis.ipynb` — exploratory notebook.

## Data
Reads `bi_idsr.mart_ml_disease_input` (cases + lagged climate drivers +
region fixed effects per woreda × disease × ISO-week). No PHI.

## Status
Submitted for review from the workshop; awaiting a data steward to open the
project, run the notebook, and approve. On approval the model integrates into
the shared catalogue exactly like the platform models.
