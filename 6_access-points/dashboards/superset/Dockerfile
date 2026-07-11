# NHDW Superset — Apache Superset + Trino SQLAlchemy driver + our FAB OIDC config.
# Self-service SQL/BI for the trusted analyst set (see superset_config.py header
# for the governance boundary). Single-process demo (no celery/redis).
FROM apache/superset:4.0.2

USER root
# Trino dialect for SQL Lab over the marts catalog + Authlib (FAB's AUTH_OAUTH
# provider — NOT in the base image). The base already ships psycopg2 (its own
# postgres metadata store). Pin trino for SQLAlchemy 1.4 compat.
# Keep cryptography inside Superset's pin (>=42.0.4,<43) — trino/Authlib would
# otherwise pull a newer one and break Superset's pkg_resources check.
RUN pip install --no-cache-dir "trino==0.328.0" "Authlib>=1.3,<2" "cryptography>=42.0.4,<43"

COPY config/superset_config.py  /app/pythonpath/superset_config.py
COPY config/create_trino_db.py  /app/pythonpath/create_trino_db.py
ENV SUPERSET_CONFIG_PATH=/app/pythonpath/superset_config.py

USER superset
