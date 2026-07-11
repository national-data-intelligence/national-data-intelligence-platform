-- MLflow Tracking + Model Registry — backing store.
--
-- MLflow needs:
--   1. A relational database for experiments/runs/registered_models metadata
--   2. An artifact store (we use the existing MinIO data lake)
--
-- We host (1) in the existing postgres-vault engine as a separate schema +
-- user. Matches the "one engine, many databases" principle from
-- 3_storage/postgres/README.md and avoids spinning up a second PG.
--
-- Idempotent.

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mlflow') THEN
        CREATE ROLE mlflow WITH LOGIN PASSWORD :'mlflow_password';
    ELSE
        ALTER ROLE mlflow WITH PASSWORD :'mlflow_password';
    END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS mlflow_metadata AUTHORIZATION mlflow;
GRANT ALL PRIVILEGES ON SCHEMA mlflow_metadata TO mlflow;
ALTER DEFAULT PRIVILEGES FOR USER mlflow IN SCHEMA mlflow_metadata
    GRANT SELECT ON TABLES TO bi_reader;
