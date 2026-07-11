# ml-runner — the one execution primitive for NHDW model code

Image: `nhdw/ml-runner:dev` (local k3d) / `nhdw-registry:5500/nhdw/ml-runner:v1` (manifests).
Built from this directory; see the master list in `bundle/scripts/build-images.sh`.

There is exactly **one** way model code executes in NHDW: an ephemeral Job
running this CLI. Seed models at boot, the weekly Airflow `ml_batch_predict`
DAG, the gateway's retrain endpoint, and ad-hoc CSV predictions from the
workshop all spawn the same image with different args. Community code is
never resident — it runs in a throwaway pod and dies.

The runner **owns all infrastructure I/O** (Postgres, MLflow, MinIO).
A model package only ever sees a `DataFrame` in and hands a `DataFrame`
back — it never receives credentials. The package contract is documented
in `bundle/seeds/ml/_template/` (the annotated reference package).

## CLI

```
runner.py train <package-ref> [--alias champion] [--run-label L] [--trigger manual]
runner.py predict-batch <model_name> [--params '{}'] [--alias champion] [--trigger schedule]
runner.py predict-adhoc <model_name> --input <minio uri csv> --output <minio uri csv>
```

### `train <package-ref>`

`<package-ref>` is either
* `minio://nhdw-artifacts/ml-packages/<name>/<vN>/` — an object **prefix**
  holding the package files (or exactly one `.tar.gz`, the gateway-upload
  shape), or
* a mounted directory, e.g. `/seed/<name>` (the boot path mounts
  `bundle/seeds/ml` at `/seed`).

Steps: fetch package → layered pip install of `requirements.txt` extras
(baked libs → `/wheels` delta with `--no-index` → **loud** network fallback)
→ run `feature_spec.yaml`'s `input.query` against the warehouse → validate
against `input.signature` → `train.py:train(df, params)` returns an
`mlflow.pyfunc.PythonModel` → one direct predict (batch packages must emit
the flat forecast schema **at train time**) → log pyfunc + signature to
experiment `/models/<name>` → register a new version → set alias
(`@champion` by default — the seed path; `--alias ''` skips) → log the
**reference feature profile** (`drift/reference_profile.json`, per-column
quantiles + histograms of the training frame — the B4 drift baseline) → and
log the package files under `package/` so later batch runs are
self-contained → write an `ops_ml.ml_run` row (`mlflow_run_id`,
`reference_profile_uri`, row_count, latency).

`train.py`'s classes are pickled **by value** (cloudpickle), so the logged
model reloads anywhere without the package source.

### `predict-batch <model_name>`

Resolves `models:/<name>@champion` → downloads `package/feature_spec.yaml`
+ `package/params.yaml` from the champion version's MLflow run → runs the
feature query against the warehouse → `predict(df, params)` (CLI `--params`
JSON overrides the package defaults; delivered via the MLflow params
mechanism — scalars declared in `params.yaml` form the signature's params
schema) → validates the output against the **unified flat forecast schema**
(`ops_ml.ml_predictions` C1 columns; `alarm_flag` is *derived* here as
`alarm_prob >= 0.5`, `disease NULL → ''`, unknown extra columns fold into
`attrs` jsonb) → `DELETE WHERE run_id` **then** insert (idempotent re-runs)
→ closes the `ml_run` row with status/row_count/latency.

Scheduling: the Airflow DAG iterates `ops_ml.model_deployment` rows
(`enabled AND deployment_kind='batch'`) and runs one of these per row.
Scheduling a model = INSERT a row (seed rows: `bundle/seeds/ml/deployments.yaml`).

### `predict-adhoc <model_name> --input … --output …`

Staged CSV in MinIO → validated against the registered model's input
signature → `predict` → result CSV uploaded to the `--output` URI →
`ml_run` row (`on_demand`). Nothing is written to `ops_ml.ml_predictions`.
This is the backend for the gateway's async `POST /api/ml/<name>/predict`
job flow and the workshop CSV-upload page.

## Env contract

All values come from existing k8s secrets/config — **no new secret material**.
Names match what the retired ml CronJobs already used.

| Var | Default | Source |
|---|---|---|
| `MLFLOW_TRACKING_URI` (alias `MLFLOW_URL`) | `http://mlflow.nhdw.svc.cluster.local:5000` | plain env |
| `MLFLOW_S3_ENDPOINT_URL` | `http://minio-datalake.nhdw.svc.cluster.local:9000` | plain env |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | — | `mlflow-secrets` (`S3_ACCESS_KEY`/`S3_SECRET_KEY`) |
| `AWS_DEFAULT_REGION` | `et-addis-1` | plain env |
| `MINIO_ENDPOINT` / `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | fall back to the three MLflow S3 vars | optional override when package/adhoc I/O needs a different MinIO principal |
| `OPS_PG_HOST` / `OPS_PG_PORT` | `postgres-vault.nhdw.svc.cluster.local` / `5432` | plain env |
| `OPS_PG_USER` / `OPS_PG_DB` | `vault_admin` / `nhdw_ops` | plain env |
| `VAULT_ADMIN_PASSWORD` | — (required) | `postgres-vault-secrets` (`POSTGRES_PASSWORD`) |
| `MARTS_PG_HOST/PORT/USER/PASSWORD` | the `OPS_PG_*` values | plain env |
| `MARTS_PG_DB` | `nhdw_vault` | plain env |
| `NHDW_WHEELS_DIR` | `/wheels` | plain env |

## Layout

```
runner.py           CLI (train / predict-batch / predict-adhoc)
lib/db.py           Postgres: feature queries, ml_run lifecycle,
                    flat-schema DELETE+INSERT writer
lib/mlflow_io.py    tracking / registry / aliases / run artifacts
lib/minio_io.py     minio:// URI download/upload + package-prefix fetch
lib/package.py      package parse + contract checks + layered pip + train import
lib/profile.py      reference feature profile (B4 drift baseline)
lib/schemas.py      input-signature, model-signature and flat-output validation
Dockerfile          python:3.12-slim + pinned science stack (mlflow 2.18.0
                    matching the server)
```

## Local smoke

```sh
docker build -t nhdw/ml-runner:dev 2_pipelines/ml/runner
docker run --rm nhdw/ml-runner:dev --help
docker run --rm nhdw/ml-runner:dev train --help
```

In-cluster, Jobs are created by the bootstrap seed step, the Airflow DAG, and
the gateway — never by hand-rolled manifests per model.
