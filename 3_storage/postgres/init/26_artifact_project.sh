#!/bin/bash
# 26_artifact_project.sh — project-scoping (Phase 1, ADDITIVE) for the workshop
# artifact catalogue. Adds the "every dataset/model/notebook belongs to a
# project" invariant to ops_artifact.artifact WITHOUT breaking any existing
# path: the new columns are NULLABLE, so today's project-less submits and the
# widget-plugin upload flow (which have no project) keep working unchanged.
#
# Two columns:
#   project_id         → the cross-schema link ops_artifact.artifact →
#                        ops_workspace.project (defined in 22_project.sh). NULL
#                        for plugins / legacy / not-yet-backfilled rows.
#   mlflow_model_name  → the EXPLICIT artifact→MLflow bridge, replacing the
#                        fragile title==registered-model-name fuzzy match in
#                        routes/artifacts.py::_mlflow_for_model. NULL until a
#                        model artifact is bound to its MLflow registered model.
#
# Why a separate numbered migration (not an edit to 05_ops_schemas.sql):
# 05 only runs at initdb time (virgin data dir). Like 11–25, this ships as an
# IDEMPOTENT numbered migration so the SAME file both cold-boots via initdb AND
# can be exec'd into a LIVE postgres-vault pod to bring an existing cluster up
# to date (initdb never re-fires). This mirrors 22_project.sh / 13_graduation.sh.
#
# RESTORE-ORDERING (the load-bearing reason this is also re-exec'd by
# bundle/scripts/seed-app-security.sh): restore-state runs `pg_restore --clean`
# on nhdw_ops from the packed dump. If the packed dump predates these columns,
# --clean DROPS + recreates ops_artifact.artifact WITHOUT project_id /
# mlflow_model_name. Re-exec'ing this migration AFTER restore-state (in
# seed-app-security.sh) idempotently re-adds them, so a packed rebuild never
# silently loses the columns.
#
# Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS + a guarded
# GRANT DO-block (mirrors 17_perm_schemas.sql). No data is written here (project
# rows are user-created / seeded by a later slice; backfill is not this file's
# job).
set -euo pipefail
OPS_DB="${OPS_DB_NAME:-nhdw_ops}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$OPS_DB" <<'SQL'

-- ── columns ───────────────────────────────────────────────────────────────
-- Cross-schema FK ops_artifact → ops_workspace. NULLABLE so plugins/legacy
-- rows and today's project-less submits are unaffected (additive invariant).
ALTER TABLE ops_artifact.artifact
    ADD COLUMN IF NOT EXISTS project_id uuid
    REFERENCES ops_workspace.project (id);

-- Explicit artifact → MLflow registered-model bridge (replaces the title match).
ALTER TABLE ops_artifact.artifact
    ADD COLUMN IF NOT EXISTS mlflow_model_name text;

COMMENT ON COLUMN ops_artifact.artifact.project_id IS
    'B2/B4 project this artifact belongs to (ops_workspace.project.id). '
    'NULLABLE: plugins/legacy/unscoped rows carry no project. The project '
    'invariant is enforced additively — never replaces the tier/workshop_group '
    'visibility ACL, it AND-composes with it.';
COMMENT ON COLUMN ops_artifact.artifact.mlflow_model_name IS
    'For kind=model: the MLflow registered-model name that backs this artifact '
    '(execution key into MLflow/ops_ml). Explicit bridge replacing the fragile '
    'title==registered-model-name fuzzy match. NULL until bound.';

-- ── indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_artifact_project      ON ops_artifact.artifact (project_id);
CREATE INDEX IF NOT EXISTS idx_artifact_kind_project ON ops_artifact.artifact (kind, project_id);

-- ── grants ────────────────────────────────────────────────────────────────
-- The new columns ride the existing table grants, but re-assert them behind a
-- role guard (like 17_perm_schemas.sql) so this file is self-contained and safe
-- to re-exec against a live pod whatever the current grant state. The gateway
-- (ops_gateway) and ops_writer read+write artifact rows; ops_reader reads.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_gateway') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON ops_artifact.artifact TO ops_gateway;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_writer') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON ops_artifact.artifact TO ops_writer;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_reader') THEN
        GRANT SELECT ON ops_artifact.artifact TO ops_reader;
    END IF;
END $$;
SQL

echo "[26_artifact_project] ops_artifact.artifact.project_id + mlflow_model_name ready"
