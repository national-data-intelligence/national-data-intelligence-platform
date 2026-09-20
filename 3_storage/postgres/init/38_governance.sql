-- 38_governance.sql — DQ observability store (data-layer plan item 4).
--
-- Adds to the nhdw_ops database:
--   1. ops_governance.dq_threshold — the SINGLE home for the SLA/band values
--      that were scattered across the gateway (routes/dq.py SOURCES.sla_hours)
--      and the admin DQ widget (pctTone 90/75, agreement 85/60). Consumers
--      read these rows and fall back to their previous hardcoded defaults when
--      a row is absent, so this table can never take the DQ surface down.
--   2. dq_flag.fingerprint — detector idempotency: one OPEN flag per distinct
--      finding (partial-unique on non-resolved rows, so a resolved finding may
--      legitimately re-open as a new row later).
--
-- Purely additive; safe to re-run (IF NOT EXISTS throughout). On the live
-- cluster this needs a one-time apply (init runs only on fresh PGDATA).
-- Numbered 38: 36 is taken by mdm_decisions_read, 37 by the OpenMetadata DB.
\connect nhdw_ops

CREATE TABLE IF NOT EXISTS ops_governance.dq_threshold (
    scope       text        NOT NULL,   -- 'sla_hours' | 'ui_band' | 'deadline' | future scopes
    key         text        NOT NULL,   -- e.g. source key 'DHIS2', band name 'scorecard_good'
    value       numeric     NOT NULL,
    unit        text        NOT NULL DEFAULT '',
    note        text,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, key)
);

COMMENT ON TABLE ops_governance.dq_threshold IS
    'Central DQ SLA/band config. Absent row => consumer''s coded default (fail-open to previous behaviour).';

-- Seed = today's live values, moved here verbatim so behaviour does not change.
INSERT INTO ops_governance.dq_threshold (scope, key, value, unit, note) VALUES
    ('sla_hours', 'DHIS2',      6,    'hours', 'ingestion freshness SLA (was routes/dq.py)'),
    ('sla_hours', 'EthioEMR',   1,    'hours', 'ingestion freshness SLA (was routes/dq.py)'),
    ('sla_hours', 'HCMIS',      4,    'hours', 'ingestion freshness SLA (was routes/dq.py)'),
    ('sla_hours', 'mBrana',     2,    'hours', 'ingestion freshness SLA (was routes/dq.py)'),
    ('sla_hours', 'eLMIS-hist', 720,  'hours', 'immutable archive lane: re-run on demand'),
    ('sla_hours', 'MFR',        48,   'hours', 'ingestion freshness SLA (was routes/dq.py)'),
    ('sla_hours', 'Climate',    168,  'hours', 'ingestion freshness SLA (was routes/dq.py)'),
    ('ui_band',   'scorecard_good',  90, 'pct', 'admin DQ scorecard green threshold (was pctTone default)'),
    ('ui_band',   'scorecard_watch', 75, 'pct', 'admin DQ scorecard amber threshold (was pctTone default)'),
    ('ui_band',   'agreement_good',  85, 'pct', 'cross-source agreement green (was adm-dq literal)'),
    ('ui_band',   'agreement_watch', 60, 'pct', 'cross-source agreement amber (was adm-dq literal)')
ON CONFLICT (scope, key) DO NOTHING;

-- Detector idempotency on the existing incident table.
ALTER TABLE ops_governance.dq_flag
    ADD COLUMN IF NOT EXISTS fingerprint text;

COMMENT ON COLUMN ops_governance.dq_flag.fingerprint IS
    'Stable hash of (source, table, error_class, key): the detector upserts on it; unique while not resolved.';

CREATE UNIQUE INDEX IF NOT EXISTS dq_flag_fingerprint_open_uq
    ON ops_governance.dq_flag (fingerprint)
    WHERE fingerprint IS NOT NULL AND status <> 'resolved';

-- Governance HISTORY substrate (Abenezer 2026-09-20): incidents are a durable
-- record, not a queue that forgets. Every status transition is appended to
-- dq_flag_event; resolved/updated stamps live on the flag. This history is the
-- raw material for governance KPIs (failure rates per source/layer/rule,
-- time-to-acknowledge/resolve, recurrence) that steer engineering priorities.
ALTER TABLE ops_governance.dq_flag
    ADD COLUMN IF NOT EXISTS updated_at  timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

CREATE TABLE IF NOT EXISTS ops_governance.dq_flag_event (
    id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    flag_id     uuid        NOT NULL,
    at          timestamptz NOT NULL DEFAULT now(),
    actor       text        NOT NULL,          -- 'detector' | kc_sub | 'system'
    from_status text,
    to_status   text        NOT NULL,
    note        text
);
CREATE INDEX IF NOT EXISTS dq_flag_event_flag_idx ON ops_governance.dq_flag_event (flag_id, at);

COMMENT ON TABLE ops_governance.dq_flag_event IS
    'Append-only status-transition history of dq_flag — never deleted; the source for governance KPIs.';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_gateway') THEN
        GRANT SELECT ON ops_governance.dq_threshold TO ops_gateway;
        GRANT SELECT, INSERT, UPDATE ON ops_governance.dq_flag TO ops_gateway;
        GRANT SELECT, INSERT ON ops_governance.dq_flag_event TO ops_gateway;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_reader') THEN
        GRANT SELECT ON ops_governance.dq_threshold, ops_governance.dq_flag_event TO ops_reader;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_writer') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON ops_governance.dq_threshold TO ops_writer;
        GRANT SELECT ON ops_governance.dq_flag_event TO ops_writer;
    END IF;
END$$;
