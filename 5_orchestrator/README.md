# NHDW Orchestrator — Airflow on Kubernetes

Airflow is the orchestrator-of-record for **scheduled ML batch inference**
(contract §C7). It runs in-cluster as one Deployment (scheduler + webserver
containers, LocalExecutor) defined in `1_infrastructure/k8s/base/airflow.yaml`;
metadata lives in the `nhdw_airflow` DB on postgres-vault
(`3_storage/postgres/init/21_airflow_db.sh`). UI (dev overlay):
<https://airflow.127.0.0.1.nip.io> — admin credentials come from the
`airflow-secrets` k8s Secret.

Everything else in the demo is NOT Airflow's job: ingestion + dbt run as k8s
Jobs driven by `bundle/scripts/seed-realistic.sh`. The compose-era Airflow
(13 DAGs shelling out to `docker compose`) is archived at
`_archive/2026-07-03/airflow-compose-era/`.

## DAGs

| DAG | Schedule | What it does |
|---|---|---|
| `ml_batch_predict` | `0 4 * * 1` (weekly) | Reads enabled `deployment_kind='batch'` rows from `ops_ml.model_deployment`, then launches one `nhdw/ml-runner predict-batch <model>` pod per row (dynamic task mapping → KubernetesPodOperator, namespace `nhdw`). |

Scheduling (or pausing) a model is a **data operation**: INSERT/UPDATE its
`ops_ml.model_deployment` row. No manifest or DAG edits.

## Image

`nhdw/airflow` — built from this folder's `Dockerfile`
(`bundle/scripts/build-images.sh` entry `5_orchestrator`). DAGs are baked into
the image (`COPY dags/`), not volume-mounted: changing a DAG = rebuild +
re-import the image and restart the Deployment.

## RBAC

The Deployment runs as ServiceAccount `airflow`
(`base/airflow.yaml`), whose Role allows pod create/get/watch/delete +
pod logs in the `nhdw` namespace — exactly what KubernetesPodOperator needs
(pattern mirrors `base/gateway-rbac.yaml`).

## Trigger / inspect manually

```bash
kubectl -n nhdw exec deploy/airflow -c scheduler -- airflow dags trigger ml_batch_predict
kubectl -n nhdw exec deploy/airflow -c scheduler -- airflow dags list-runs --dag-id ml_batch_predict
```

or use the UI at <https://airflow.127.0.0.1.nip.io>.
