-- 23_perm_admin_grants.sql — runtime write-grants on the permission catalog.
--
-- Replaces 23_widget_plugins.sql (the runtime-plugin substrate, retired
-- 2026-07-06 → _archive/2026-07-06/runtime-plugin-system/). Those same three
-- GRANTs are now load-bearing for a DIFFERENT feature: the admin "Roles and
-- Permissions" editor (routes/perm_admin.py) writes ops_perm.widget /
-- page_widget / role_widget at runtime when an admin edits a role's grants.
-- Kept here (idempotent, guarded — mirrors the ops_perm grant DO-block pattern)
-- so a cold boot grants them without the retired plugin schema.
--
-- ops_perm lives in nhdw_ops, and every init file starts a FRESH psql session
-- against POSTGRES_DB (nhdw_vault) — a \connect in an earlier file does not
-- carry over. Without this line the GRANTs run against the wrong database and
-- fail with 'schema "ops_perm" does not exist', which aborts postgres init.
\connect nhdw_ops

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_gateway') THEN
        GRANT INSERT, UPDATE, DELETE ON ops_perm.widget       TO ops_gateway;
        GRANT INSERT, UPDATE, DELETE ON ops_perm.page_widget  TO ops_gateway;
        GRANT INSERT, UPDATE, DELETE ON ops_perm.role_widget  TO ops_gateway;
    END IF;
END $$;
