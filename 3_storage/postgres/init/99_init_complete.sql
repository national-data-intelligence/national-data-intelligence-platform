-- ─────────────────────────────────────────────────────────────────────
-- 99_init_complete.sql — the initdb sentinel. MUST SORT LAST.
--
-- Postgres runs /docker-entrypoint-initdb.d ONCE, on an empty volume, and a
-- failing script aborts the sequence — after which the container restarts onto
-- the now-existing volume and never runs the remaining scripts. The database
-- then answers readiness probes while missing every schema from the failure
-- point on. That exact sequence shipped a half-initialized vault when a stale
-- secrets file left SEAWEEDFS_FILER_DB_PASSWORD empty at script 23: scripts
-- 24–43 silently never ran, and the boot only discovered it at the vocabulary
-- seed, hundreds of seconds later.
--
-- This table exists ONLY if every script before it succeeded. The boot's
-- wait-for-postgres step requires it, so "ready" means fully initialized —
-- and a failed init is reported at the wait, naming this sentinel, instead of
-- surfacing as a random missing-schema error downstream.
-- ─────────────────────────────────────────────────────────────────────
\connect nhdw_vault

CREATE TABLE IF NOT EXISTS public.initdb_sentinel (
    completed_at timestamptz NOT NULL DEFAULT now(),
    scripts_note text NOT NULL
);
DELETE FROM public.initdb_sentinel;
INSERT INTO public.initdb_sentinel (scripts_note)
VALUES ('every /docker-entrypoint-initdb.d script before 99 completed');
