# nhdw/airflow — Airflow with the NHDW DAG(s) baked in (k8s deployment,
# contract §C7). Deployed by 1_infrastructure/k8s/base/airflow.yaml as a
# scheduler + webserver Deployment (LocalExecutor).
#
# The base image already ships everything the DAGs need — the postgres
# provider (psycopg2) and the cncf-kubernetes provider (KubernetesPodOperator)
# — so this is bake-only: no apt, no pip, no network at runtime.
#
# The compose-era variant of this file installed the Docker CLI so DAGs could
# shell out to `docker compose run` — retired with those DAGs to
# _archive/2026-07-03/airflow-compose-era/.

FROM apache/airflow:2.10.4-python3.12

# --chown: the image runs as the `airflow` user (group root, per the official
# image convention) — root-owned dags would break __pycache__ writes.
COPY --chown=airflow:0 dags/ /opt/airflow/dags/

# Native Keycloak OIDC for the webserver (Tool-SSO C). Read only by the
# webserver from $AIRFLOW_HOME; the scheduler/init ignore it.
COPY --chown=airflow:0 webserver_config.py /opt/airflow/webserver_config.py

# Prove the bake at build time: the providers the DAG imports must resolve,
# the DAG itself must parse, and the OIDC security-manager base class the
# webserver_config extends must be importable (fails the build if the FAB
# provider ever drops it).
RUN python -c "import psycopg2; import airflow.providers.cncf.kubernetes.operators.pod" \
    && python -c "from airflow.providers.fab.auth_manager.security_manager.override import FabAirflowSecurityManagerOverride; import authlib" \
    && python -m compileall -q /opt/airflow/dags /opt/airflow/webserver_config.py
