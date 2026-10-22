-- ─────────────────────────────────────────────────────────────────────
-- 44_mdm_proposal.sql — MAKER–CHECKER for the MDM decision log.
--
-- Until now a steward's verdict went straight into mdm_match_decision, and
-- the resolution views read that log live: one person's click changed every
-- dashboard on the next read. This file adds the step in between.
--
--   steward proposes ──► the gateway CHECKS the exact change it would make
--   (and pins a fingerprint of what it saw + a validity window) ──► a
--   DIFFERENT person approves ──► only then is the decision row written to
--   mdm_match_decision, in the same transaction as the approval.
--
-- Nothing here is read by the vault: the resolution views keep reading
-- mdm_match_decision only, so an open, declined or expired proposal can never
-- reach a dashboard. With no proposals at all the warehouse is byte-identical
-- to before (the parity contract of 35/36 is untouched).
--
-- Three tables:
--   mdm_change_proposal   one row per proposed change; `status` is the
--                         current step (a workflow row, like access requests)
--   mdm_proposal_event    APPEND-ONLY history of every step, who and when —
--                         the audit trail the console's history stepper reads
--   mdm_candidate_review  a steward's "not sure" / "dismiss" on a suggestion:
--                         neither is a mastering statement, so neither may
--                         touch the decision log. Bitemporal like the log.
-- ─────────────────────────────────────────────────────────────────────

\connect nhdw_ops

CREATE TABLE IF NOT EXISTS ops_governance.mdm_change_proposal (
    proposal_id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    deployment_context     text        NOT NULL DEFAULT 'ET',
    entity_class_code      text        NOT NULL,
    -- link     the source record IS the suggested master   (→ decision 'accept')
    -- distinct the source record is NOT that master         (→ decision 'reject')
    -- restore  undo a current decision                      (→ supersede, no new verdict)
    kind                   text        NOT NULL CHECK (kind IN ('link', 'distinct', 'restore')),
    candidate_id           uuid        REFERENCES ops_governance.mdm_match_candidate(candidate_id),
    restores_decision_id   uuid        REFERENCES ops_governance.mdm_match_decision(decision_id),
    source_system_code     text        NOT NULL,
    source_record_key      text        NOT NULL,
    master_bk              text,
    -- what the proposer saw: score, rule, features, rule threshold, names.
    evidence               jsonb       NOT NULL DEFAULT '{}'::jsonb,
    note                   text,
    proposed_by            text        NOT NULL,           -- kc username
    proposed_at            timestamptz NOT NULL DEFAULT now(),
    -- the check: a fingerprint of the candidate + current decision it was
    -- computed against, and how long it may be approved. Approval re-computes
    -- the fingerprint; any difference means "the records changed — check again".
    check_digest           text,
    checked_at             timestamptz,
    valid_until            timestamptz,
    -- proposed → checked → applied, or check_failed / declined / withdrawn.
    -- "expired" is not stored: it is a checked proposal past valid_until.
    status                 text        NOT NULL DEFAULT 'proposed'
                             CHECK (status IN ('proposed', 'checked', 'check_failed',
                                               'applied', 'declined', 'withdrawn')),
    reviewed_by            text,                           -- the approver / decliner
    reviewed_at            timestamptz,
    review_note            text,
    applied_decision_id    uuid        REFERENCES ops_governance.mdm_match_decision(decision_id),
    CONSTRAINT mdm_proposal_link_has_master  CHECK (kind <> 'link' OR master_bk IS NOT NULL),
    CONSTRAINT mdm_proposal_restore_target   CHECK (kind <> 'restore' OR restores_decision_id IS NOT NULL),
    CONSTRAINT mdm_proposal_candidate_kinds  CHECK (kind = 'restore' OR candidate_id IS NOT NULL),
    CONSTRAINT mdm_proposal_decline_reason   CHECK (status <> 'declined' OR review_note IS NOT NULL),
    -- maker–checker: whoever approved or declined is never the proposer
    CONSTRAINT mdm_proposal_four_eyes        CHECK (reviewed_by IS NULL OR reviewed_by <> proposed_by),
    CONSTRAINT mdm_proposal_applied_link     CHECK (status <> 'applied' OR reviewed_by IS NOT NULL)
);
COMMENT ON TABLE ops_governance.mdm_change_proposal IS
    'Steward-proposed changes to the MDM decision log, waiting for a second '
    'person. Only an approved proposal writes mdm_match_decision (same '
    'transaction); the vault never reads this table.';

-- at most one OPEN proposal per source record, so two stewards cannot race
-- each other into conflicting decisions
CREATE UNIQUE INDEX IF NOT EXISTS uq_mdm_proposal_open
    ON ops_governance.mdm_change_proposal
       (deployment_context, entity_class_code, source_system_code, source_record_key)
    WHERE status IN ('proposed', 'checked');
CREATE INDEX IF NOT EXISTS ix_mdm_proposal_status
    ON ops_governance.mdm_change_proposal (deployment_context, status, proposed_at DESC);
CREATE INDEX IF NOT EXISTS ix_mdm_proposal_proposer
    ON ops_governance.mdm_change_proposal (proposed_by, proposed_at DESC);

CREATE TABLE IF NOT EXISTS ops_governance.mdm_proposal_event (
    event_id     bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    proposal_id  uuid        NOT NULL REFERENCES ops_governance.mdm_change_proposal(proposal_id),
    event        text        NOT NULL CHECK (event IN ('proposed', 'checked', 'check_failed',
                                                       'approved', 'applied', 'declined',
                                                       'withdrawn')),
    actor        text        NOT NULL,                      -- kc username
    at           timestamptz NOT NULL DEFAULT now(),
    detail       jsonb       NOT NULL DEFAULT '{}'::jsonb
);
COMMENT ON TABLE ops_governance.mdm_proposal_event IS
    'Append-only step history of MDM proposals (who did what, when). Never '
    'UPDATE or DELETE.';
CREATE INDEX IF NOT EXISTS ix_mdm_proposal_event_proposal
    ON ops_governance.mdm_proposal_event (proposal_id, at);

CREATE TABLE IF NOT EXISTS ops_governance.mdm_candidate_review (
    review_id      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id   uuid        NOT NULL REFERENCES ops_governance.mdm_match_candidate(candidate_id),
    outcome        text        NOT NULL CHECK (outcome IN ('not_sure', 'dismissed')),
    reviewed_by    text        NOT NULL,
    note           text,
    recorded_from  timestamptz NOT NULL DEFAULT now(),
    recorded_to    timestamptz                              -- NULL = current
);
COMMENT ON TABLE ops_governance.mdm_candidate_review IS
    'A steward''s "not sure" or "dismiss" on a suggestion. Not a mastering '
    'statement, so it never touches mdm_match_decision. Supersede by stamping '
    'recorded_to.';
CREATE UNIQUE INDEX IF NOT EXISTS uq_mdm_candidate_review_current
    ON ops_governance.mdm_candidate_review (candidate_id)
    WHERE recorded_to IS NULL;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_gateway') THEN
        GRANT SELECT, INSERT, UPDATE ON ops_governance.mdm_change_proposal TO ops_gateway;
        -- events are append-only for the console
        GRANT SELECT, INSERT ON ops_governance.mdm_proposal_event TO ops_gateway;
        -- reviews: insert, and supersede by stamping recorded_to only
        GRANT SELECT, INSERT ON ops_governance.mdm_candidate_review TO ops_gateway;
        GRANT UPDATE (recorded_to) ON ops_governance.mdm_candidate_review TO ops_gateway;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_reader') THEN
        GRANT SELECT ON ops_governance.mdm_change_proposal,
                        ops_governance.mdm_proposal_event,
                        ops_governance.mdm_candidate_review TO ops_reader;
    END IF;
END $$;
