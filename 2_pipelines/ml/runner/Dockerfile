# nhdw/ml-runner — THE single execution primitive for NHDW model code.
#
# One image, three verbs (runner.py): train / predict-batch / predict-adhoc.
# Ephemeral by design: the Airflow ml_batch_predict DAG and the gateway's
# retrain/predict endpoints spawn a Job from this image; the pod dies when
# the verb finishes. Community code is never resident.
#
# Version pins (contract C4 — do not drift):
#   * mlflow==2.18.0 MATCHES the MLflow server image (2_pipelines/ml/registry)
#     — the old ml-bootstrap image pinned 2.16.2 against a 2.18 server, which
#     is exactly the client/server skew this image kills.
#   * numpy 1.26 / pandas 2.2.3 / statsmodels 0.14.2 / sklearn 1.5.2 are the
#     baked layer of the offline-first dependency contract: package
#     requirements.txt files list only EXTRAS beyond these.
#
# Layered deps at runtime (docs/ml-and-chatbot.md §2.6):
#   baked libs → /wheels delta (pip --no-index --find-links /wheels) →
#   LOUD network fallback. Mount bundle/pip-wheels at /wheels to keep
#   package extras offline.

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# scipy MUST stay <1.15: statsmodels 0.14.2 relies on scipy.stats internals
# removed in 1.15 (model-package smokes fail on 1.15+). Never inline-comment
# inside this continuation — the '#' swallows the rest of the install list.
RUN pip install --no-cache-dir \
        mlflow==2.18.0 \
        statsmodels==0.14.2 \
        scikit-learn==1.5.2 \
        pandas==2.2.3 \
        numpy==1.26.4 \
        scipy==1.14.1 \
        psycopg2-binary==2.9.10 \
        boto3==1.35.36 \
        pyyaml==6.0.2

# /wheels — optional offline wheel cache mount (layer 2 of the deps contract).
# /seed   — optional seed-package mount (train /seed/<name> on the boot path).
RUN mkdir -p /wheels /seed

WORKDIR /app
COPY runner.py /app/runner.py
COPY lib/      /app/lib/

ENV PYTHONPATH=/app
# botocore#3755 (Phase 6 step 0): both launchers (DAGs and the gateway) inherit this default.
ENV BOTO_EXPERIMENTAL__NO_EMPTY_CONTINUE=true
ENTRYPOINT ["python3", "/app/runner.py"]
CMD ["--help"]
