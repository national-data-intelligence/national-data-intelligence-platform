# Community Stockout Forecast

A community-contributed Holt-Winters consumption forecast that projects
days-to-stockout per commodity, adapted from the platform stockout model.
**Reviewer requested changes.**

## Contents
- `model/` — the runner package (read by the graduation integration on
  approval): `manifest.yaml`, `train.py`, `feature_spec.yaml`, `params.yaml`,
  `model_card.md`, `requirements.txt`. Registry name: `community_stockout`.
- `predict.py` — standalone batch-inference helper.
- `analysis.ipynb` — exploratory notebook.

## Data
Reads `bi_supply.mart_resource_allocation` (monthly commodity grain: AMC,
stock-on-hand, receipts, wastage, months-of-stock). No PHI.

## Status
Submitted for review; the data steward asked for changes (see the review
verdict) before it can graduate. The owner may address the feedback and
re-submit.
