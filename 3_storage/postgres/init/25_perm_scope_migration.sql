-- 25_perm_scope_migration.sql — Permission-model transition, PHASE 1 (SAFE, ADDITIVE).
--
-- This file is purely ADDITIVE. It does NOT drop, rewrite, or change the
-- behaviour of any existing table. It lays the foundation for consolidating
-- value-scoping into ONE principal-level (dimension-keyed) entitlement:
--
--   1. ops_perm.role_scope — role-level DEFAULT data scope, keyed by
--      (role_id, dimension, value). Same dimension vocabulary as
--      ops_identity.user_scope.kind so the two compose in the resolver later.
--      Phase 1 only SEEDS this table (see load_security_seed.upsert_role_scope);
--      the resolver / OPA enforcement still runs off role_global_filter /
--      role_widget_filter + user_scope exactly as before.
--
--   2. Widen ops_identity.user_scope.kind to admit 'artifact_tier' and
--      'workshop_group' — the two dimensions that today live only in
--      role_widget_filter (workshop::ws-artifact-grid) and have no user_scope
--      home. Doing it here (not by editing 05_ops_schemas.sql in place) keeps
--      05 as the cold-boot definition and this file as the migration overlay.
--
-- ─────────────────────────────────────────────────────────────────────────
-- PHASE 2 (SUPERVISED — NOT DONE HERE, pending):
--   * enforcement consolidation — rewrite the resolver
--     (permissions.py _resolve_page_filters / _resolve_widget_filters /
--     filter_values / check_widget_access) + OPA scope push to derive the
--     filter bar and the row_filter from role_scope ∪ user_scope;
--   * DROP TABLE ops_perm.role_widget_filter, then ops_perm.role_global_filter,
--     and remove the Axis B/D dual-write from load_security_seed.py + the
--     global_filters / widget_filters blocks from role_grants.yaml;
--   * archive the retired DDL/grants out of 17_perm_schemas.sql.
-- Until then role_global_filter / role_widget_filter STAY and are dual-written.
-- ─────────────────────────────────────────────────────────────────────────
--
-- Idempotent throughout (IF NOT EXISTS + guarded ALTER + guarded GRANT) so it
-- is safe on a cold-boot init (runs after 17_perm_schemas.sql) and on a warm
-- re-run against an existing cluster.

\connect nhdw_ops


-- ─── role_scope: role-level default data scope (Phase-1 additive) ─────────
-- allowed_values semantics differ from role_global_filter: role_scope is a
-- POSITIVE entitlement — each row is one (dimension, value) the role may see.
-- A dimension with NO row = unrestricted (wildcard) for that dimension.
-- managed_by mirrors the provenance pattern: 'seed' rows belong to the YAML
-- loader (add/edit/remove honoured), 'runtime' rows are never touched by it.
CREATE TABLE IF NOT EXISTS ops_perm.role_scope (
    role_id    int  NOT NULL REFERENCES ops_perm.role (id) ON DELETE CASCADE,
    dimension  text NOT NULL CHECK (dimension IN
                  ('geography','programme','facility','artifact_tier','workshop_group')),
    value      text NOT NULL,
    managed_by text NOT NULL DEFAULT 'runtime',
    PRIMARY KEY (role_id, dimension, value)
);
COMMENT ON TABLE ops_perm.role_scope IS
    'Role-level DEFAULT data scope: one (dimension,value) row per thing the role '
    'may see (a dimension with no row = unrestricted). Same dimension vocabulary '
    'as ops_identity.user_scope.kind so role defaults ∪ per-user scope compose in '
    'the resolver. PHASE 1: seeded only; enforcement consolidation is Phase 2.';


-- ─── Widen user_scope.kind to admit artifact_tier / workshop_group ────────
-- 05_ops_schemas.sql defines the inline CHECK (auto-named user_scope_kind_check)
-- as kind IN (geography, programme, facility, mart). Add the two Phase-2 dims
-- here as a guarded DROP/ADD so warm re-runs never error and 05 stays the
-- cold-boot definition. Guard: only re-create when the current CHECK does not
-- already permit 'artifact_tier'.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'ops_identity.user_scope'::regclass
          AND conname  = 'user_scope_kind_check'
          AND pg_get_constraintdef(oid) LIKE '%artifact_tier%'
    ) THEN
        ALTER TABLE ops_identity.user_scope
            DROP CONSTRAINT IF EXISTS user_scope_kind_check;
        ALTER TABLE ops_identity.user_scope
            ADD CONSTRAINT user_scope_kind_check
            CHECK (kind IN ('geography','programme','facility',
                            'artifact_tier','workshop_group'));
    END IF;
END $$;


-- ─── Grants for the gateway/reader/writer roles ───────────────────────────
-- Mirrors the guarded grant DO-block in 17_perm_schemas.sql. ops_gateway +
-- ops_writer get full CRUD (the Phase-2 role editor + the seed loader write it);
-- ops_reader gets SELECT. (17's ALTER DEFAULT PRIVILEGES already covers SELECT
-- for future tables, but we grant explicitly so the intent is self-documenting
-- and correct even if this file is applied standalone.)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_gateway') THEN
        GRANT USAGE ON SCHEMA ops_perm TO ops_gateway, ops_reader;
        GRANT SELECT ON ops_perm.role_scope TO ops_reader;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ops_perm.role_scope TO ops_gateway;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_writer') THEN
        GRANT USAGE ON SCHEMA ops_perm TO ops_writer;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ops_perm.role_scope TO ops_writer;
    END IF;
END $$;
