# Community Malaria Outbreak-Risk

A community-contributed early-warning model that flags anomalous weekly malaria
counts per woreda, adapted from the platform Farrington detector.

## Contents
- `model/` — the runner package (the graduation integration reads this):
  `manifest.yaml`, `train.py`, `feature_spec.yaml`, `params.yaml`,
  `model_card.md`, `requirements.txt`. Registry name: `community_malaria_risk`.
- `predict.py` — standalone batch-inference helper (load the @champion pyfunc
  from MLflow and score the feature query).
- `analysis.ipynb` — exploratory notebook the reviewer can run in a project lab.

## Data
Reads `bi_idsr.mart_ml_disease_input` (per woreda × disease × ISO-week: cases +
climate drivers). No PHI — the mart is already de-identified upstream.

## How it graduates
Submitted for review from the workshop; on data-steward approval the project
becomes public and `model/` is integrated into the shared model catalogue
(MLflow @champion + a `model_deployment` row + a first batch of predictions),
after which it is maintained by the nightly `ml_batch_predict` DAG.
