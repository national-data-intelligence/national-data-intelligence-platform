-- 32_permission_store.sql — normalized, REUSABLE data-access permissions.
--
-- Task #88 Phase 2. Today each bundle/roles/r-*.yaml embeds its own permission
-- tuples and 7_security/opa/scripts/compile.py emits one `allow` rule per tuple;
-- a permission shared by N roles is copy-pasted N times and there is no
-- permission entity (unlike widgets/dashboards/capabilities, already M:N).
--
-- This makes a `permission` the reusable unit (one row per distinct allow-rule
-- tuple) and `role_permission` the M:N link — textbook RBAC, and it maps 1:1 onto
-- the tuple compile.py already consumes, so NO policy semantics change: the seed
-- populates these from the role YAMLs (deduped), compile.py then sources them from
-- the DB, and the emitted rego must match the YAML-sourced rego byte-for-byte
-- before cutover (equivalence gate). Runs after 17_perm_schemas.sql (ops_perm.role).
-- Idempotent.

-- ── permission: one row per distinct allow-rule tuple ───────────────────────
CREATE TABLE IF NOT EXISTS ops_perm.permission (
    id            serial      PRIMARY KEY,
    code          text        UNIQUE,                       -- optional human handle, e.g. 'prg-agg-read-cat'
    subject       text        NOT NULL CHECK (subject IN ('PT','HP','FAC','PRD','PRG')),
    members       text        NOT NULL DEFAULT 'scoped' CHECK (members IN ('all','scoped','self')),
    granularity   text        NOT NULL CHECK (granularity IN ('raw','aggregate','deidentified')),
    verbs         text[]      NOT NULL,                      -- ['read','export','schedule',...]
    purposes      text[]      NOT NULL DEFAULT '{public-health}',
    data_classes  text[]      NOT NULL DEFAULT '{}',         -- empty = any (matches current YAML data_class:[])
    sensitivity   text[]      NOT NULL DEFAULT '{}',         -- empty = default only
    description   text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    -- IDENTITY of a permission is the WHOLE tuple → makes the seed dedup idempotent:
    -- a tuple shared by 3 roles inserts ONCE, then 3 role_permission links.
    CONSTRAINT uq_permission_tuple
        UNIQUE (subject, members, granularity, verbs, purposes, data_classes, sensitivity)
);
COMMENT ON TABLE ops_perm.permission IS
    'Reusable data-access permission = one OPA allow-rule tuple (subject/members/'
    'granularity/verbs/purposes/data_classes/sensitivity). compile.py sources these '
    'from the DB to emit per-role rego; the tuple UNIQUE dedups shared permissions.';

-- ── role_permission: M:N (a permission may be granted to many roles) ─────────
CREATE TABLE IF NOT EXISTS ops_perm.role_permission (
    role_id       int  NOT NULL REFERENCES ops_perm.role (id)       ON DELETE CASCADE,
    permission_id int  NOT NULL REFERENCES ops_perm.permission (id) ON DELETE CASCADE,
    -- Preserves the role's YAML declaration order so compile.py re-emits the
    -- CURRENT policies/*.rego byte-for-byte (the equivalence gate) — the emitted
    -- allow rules are order-independent semantically, but keeping order makes the
    -- DB→rego cutover a zero-diff, offline-provable change.
    ordering      int  NOT NULL DEFAULT 0,
    -- 'seed' rows are re-derived from the role YAMLs each boot; 'runtime' rows are
    -- created by an admin via perm_admin and MUST survive re-seed (same convention
    -- as ops_perm.role_scope / the retired plugin role_widget rows).
    managed_by    text NOT NULL DEFAULT 'seed' CHECK (managed_by IN ('seed','runtime')),
    granted_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX IF NOT EXISTS ix_role_permission_permission ON ops_perm.role_permission (permission_id);
COMMENT ON TABLE ops_perm.role_permission IS
    'Grants a reusable ops_perm.permission to a role (M:N). One permission row → '
    'many roles, eliminating the per-role tuple duplication.';

-- ── runtime write-grants for the admin editor (perm_admin.py) ────────────────
-- Same guarded DO-block pattern as 23_perm_admin_grants.sql. The seed loader
-- connects as the DB superuser, so it needs no grant; only the gateway's runtime
-- permission CRUD does.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_gateway') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON ops_perm.permission      TO ops_gateway;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ops_perm.role_permission TO ops_gateway;
        GRANT USAGE, SELECT ON SEQUENCE ops_perm.permission_id_seq       TO ops_gateway;
    END IF;
END $$;
