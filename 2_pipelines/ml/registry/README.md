# NHDW ML — registry, batch + on-demand contracts

This folder holds:
- The MLflow tracking server compose (`docker-compose.yml`, `Dockerfile`,
  `.env`) — metadata in PG `nhdw_mlflow`, artifacts in MinIO
  `nhdw-artifacts/mlflow/`.
- The contract every model in `../models/<name>/` must follow.

## Model package layout

```
2_pipelines/ml/models/<model_name>/
├── README.md                 what the model does + provenance + citation
├── driver.py                 implements NhdwModelBase (load/train/predict)
├── feature_spec.yaml         input columns, types, source mart
├── deployment.yaml           declares batch | on-demand + the resource cost
├── inference.py              (batch only) the function called by the DAG
├── serve.py                  (on-demand only) the FastAPI app exposed as a service
├── retrain_dag.py            Airflow DAG: train → eval → register → promote
├── widgets.yaml              which dashboard widgets render this model's output
└── tests/                    unit + golden tests
```

## Two deployment shapes

### Batch model — scheduled inference, persisted output

```
Airflow DAG (cron)
   ↓ trigger
inference.py
   ↓ load model from MLflow (stage=Production)
   ↓ predict()
   ↓ INSERT INTO ops_ml.ml_predictions
   ↓ UPDATE ops_ml.ml_run SET status='success'
Dashboard widget
   ↓ GET /api/ml/<model>/predictions?geography_id=...
   ↓ reads from ops_ml.ml_predictions
```

Required of `inference.py`:
1. Open a `ml_run` row first (status='running').
2. Load the latest Production version of the model from MLflow.
3. Run prediction over the input batch.
4. Bulk-insert into `ops_ml.ml_predictions` with `run_id` set.
5. Finalize the `ml_run` row with status/row_count/latency_ms.
6. On failure, set `status='failed'` + `error_msg`.

### On-demand model — ephemeral runner Job, transient result

There is NO resident serving container (`ml-serving` retired 2026-07-03;
see `_archive/2026-07-03/ml-serving-retired/`). Ad-hoc inference is an
ephemeral `nhdw/ml-runner` Job:

```
Dashboard widget
   ↓ POST /api/ml/<model>/predict {"rows": [...]} (or {"csv": "..."})
   ↓ gateway stages the input CSV to MinIO nhdw-artifacts/ml-adhoc/<job>/
   ↓ gateway creates a runner Job: predict-adhoc <model> --input … --output …
runner Job
   ↓ resolve models:/<model>@champion from MLflow
   ↓ signature-validate the CSV · predict()
   ↓ write the output CSV next to the input · ops_ml.ml_run row
Dashboard widget
   ↓ polls GET /api/ml/jobs/<job_id> until succeeded
   ↓ downloads the result CSV (presigned URL); nothing persisted in
     ops_ml.ml_predictions — the contract for on-demand is precisely that
```

## Choosing which shape

| Question | Batch | On-demand |
|---|---|---|
| Does the output depend on user-provided ad-hoc input? | NO | YES |
| Is one prediction reused by many users? | YES | NO |
| Is the input data huge (entire warehouse)? | YES | NO |
| Is inference latency-sensitive (<2s)? | NO | YES |
| Should the dashboard refresh stale numbers automatically? | YES | N/A |

Common case: outbreak detection / EARS / seasonal models = **batch**.
Per-patient risk scoring or per-query forecast = **on-demand**.

## The `deployment.yaml` declares which

```yaml
# 2_pipelines/ml/models/outbreak/deployment.yaml
deployment_kind: batch        # or on_demand
schedule:        "0 4 * * *"  # batch only — Airflow cron
resource_request:
  cpu:    "500m"
  memory: "1Gi"
mlflow_stage:    Production    # promote from Staging here
widgets:                       # informational — also in widgets.yaml
  - KpiStrip
  - RiskMap
  - AlarmSignal
```

The graduation pathway (#157) reads `deployment.yaml` to know which
lane the model joins after promotion.

## Gateway routes (already live)

```
GET  /api/ml                          list registered models (from MLflow)
GET  /api/ml/{model}/predictions      batch — read from ops_ml.ml_predictions
POST /api/ml/{model}/predict          on-demand — proxy to serve.py
GET  /api/ml/{model}/runs              recent ml_run rows
GET  /api/ml/{model}/registered       MLflow metadata for the model
```

OPA action verbs:
- `read.ml`   on `model_name` → batch + metadata routes
- `predict.ml` on `model_name` → on-demand route

Every call lands in `ops_audit.gateway_log` with `mart_scope=["ml:<model>"]`.

## Tables backing the routes

`ops_ml.ml_run` — one row per run, batch OR on-demand. Tracks status,
start/finish, row count, latency, who triggered it.

`ops_ml.ml_predictions` — batch-only output store. Indexed on
`(model_name, predicted_at)`, `(geography_id, period_id)`, and a GIN
index on the free-form `key` jsonb. The `output` column is jsonb so
each model declares its own schema.
