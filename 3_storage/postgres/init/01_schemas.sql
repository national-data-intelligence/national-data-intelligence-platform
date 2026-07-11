-- Schemas inside the nhdw_vault database. Three for the
-- staging→vault→business pipeline, four bi_* schemas for the marts that
-- 2_pipelines/marts/ (dbt) populates:
--
--   nhdw_landing         PSA — PG-side mirror of CH stg_* views.
--                        Bridge job (2_pipelines/vault/bridge/) does
--                        TRUNCATE + COPY per source on each run.
--   nhdw_vault_raw       AutomateDV-managed hubs / links / sats, 1:1 with
--                        source business keys.
--   nhdw_vault_business  Conformed hubs, same-as links, derived sats.
--
--   bi_facility          Facility-domain marts (counts, distribution).
--   bi_supply            Supply-chain marts (stock availability, stock-outs).
--   bi_epi               EPI / vaccine-coverage marts.
--   bi_public            k-anonymised projections fed to the Public
--                        Dashboard. All views here enforce k >= 5 via
--                        HAVING in the model SQL.
--
-- The dbt marts project (vault_writer role) materialises models into the
-- bi_* schemas. The bi_reader role gets USAGE + SELECT on whatever lands
-- there via ALTER DEFAULT PRIVILEGES below — so a fresh `dbt build` is
-- immediately readable by R-CONS-ANA / R-DEC dashboards and by the
-- public-dashboard service account, without re-granting per-model.
--
-- Idempotent.

-- pg_trgm — used by business-vault fuzzy-name matching (same-as links).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

CREATE SCHEMA IF NOT EXISTS nhdw_landing
    AUTHORIZATION vault_admin;
COMMENT ON SCHEMA nhdw_landing IS
    'Persistent Staging Area. PG-side copy of nhdw_staging.stg_* from ClickHouse, refreshed by the bridge job on each vault run.';

CREATE SCHEMA IF NOT EXISTS nhdw_vault_raw
    AUTHORIZATION vault_admin;
COMMENT ON SCHEMA nhdw_vault_raw IS
    'Raw Data Vault — hubs/links/sats faithful to source business keys. AutomateDV-managed.';

CREATE SCHEMA IF NOT EXISTS nhdw_vault_business
    AUTHORIZATION vault_admin;
COMMENT ON SCHEMA nhdw_vault_business IS
    'Business Vault — conformed hubs, same-as links, derived/computed sats. AutomateDV-managed.';

-- ---------- bi_* marts schemas (populated by 2_pipelines/marts/ dbt) ----

CREATE SCHEMA IF NOT EXISTS bi_facility AUTHORIZATION vault_writer;
COMMENT ON SCHEMA bi_facility IS
    'Marts — facility-domain (counts, distribution). Populated by 2_pipelines/marts/.';

CREATE SCHEMA IF NOT EXISTS bi_supply   AUTHORIZATION vault_writer;
COMMENT ON SCHEMA bi_supply IS
    'Marts — supply-chain (stock availability, stock-outs). Populated by 2_pipelines/marts/.';

CREATE SCHEMA IF NOT EXISTS bi_epi      AUTHORIZATION vault_writer;
COMMENT ON SCHEMA bi_epi IS
    'Marts — EPI / vaccine coverage. Populated by 2_pipelines/marts/.';

CREATE SCHEMA IF NOT EXISTS bi_public   AUTHORIZATION vault_writer;
COMMENT ON SCHEMA bi_public IS
    'Marts — k-anonymised projections (k>=5) consumed by the Public Dashboard. Populated by 2_pipelines/marts/.';

-- Phase 3.4: staging schema for marts pending governance approval.
-- Models tagged `+schema: bi_staging` in dbt_project.yml land here; they
-- are NOT visible to dashboard readers (bi_reader gets USAGE only,
-- intentionally without SELECT defaults). The `marts_promote` DAG copies
-- the view definition into the appropriate production schema after a
-- governance click.
CREATE SCHEMA IF NOT EXISTS bi_staging AUTHORIZATION vault_writer;
COMMENT ON SCHEMA bi_staging IS
    'Marts pending governance approval. Populated by 2_pipelines/marts/; promoted to bi_<domain> by 5_orchestrator/dags/marts_promote.py.';
GRANT USAGE ON SCHEMA bi_staging TO bi_reader;
-- DELIBERATELY no ALTER DEFAULT PRIVILEGES for bi_reader on bi_staging —
-- a steward must promote before readers can see.

GRANT USAGE ON SCHEMA bi_facility, bi_supply, bi_epi, bi_public TO bi_reader;

ALTER DEFAULT PRIVILEGES FOR ROLE vault_writer IN SCHEMA bi_facility
    GRANT SELECT ON TABLES TO bi_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE vault_writer IN SCHEMA bi_supply
    GRANT SELECT ON TABLES TO bi_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE vault_writer IN SCHEMA bi_epi
    GRANT SELECT ON TABLES TO bi_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE vault_writer IN SCHEMA bi_public
    GRANT SELECT ON TABLES TO bi_reader;

-- vault_writer's marts dbt build runs under an OpenBao-issued short-TTL
-- child of vault_writer. The dbt post-hook transfers ownership of every
-- new view to vault_admin so the object outlives the lease — that needs
-- vault_writer to be a member of vault_admin. (Membership conveys the
-- right to *transfer* ownership; it does NOT give vault_writer any
-- runtime privileges it wouldn't already have through its own grants,
-- because SET ROLE vault_admin is never invoked at query time.)
GRANT vault_admin TO vault_writer;

-- ---------- submission_inbox (Phase 2 P2.4) ----------------------------
--
-- Replaces the Phase-1 in-memory list in the Submission Portal. Persisting
-- in nhdw_landing keeps the table on the same engine as the rest of the
-- landing surface (single-engine PSA), so the same OpenBao DB role
-- (postgres-vault-landing-writer) can serve it.
--
-- Phase 4 will move the file BYTES to MinIO + a mediator, but the
-- submission *record* stays here as the authoritative producer-side
-- registry of "what was submitted, by whom, when, status".

-- Phase 4.1: fhir_resources — HAPI FHIR backing schema.
-- HAPI manages its own DDL via Hibernate on first boot. We just own the
-- empty schema + a dedicated fhir_writer role that HAPI connects as.
-- vault_admin keeps ownership so HAPI's runtime role doesn't accidentally
-- create objects elsewhere. bi_reader can SELECT for the consent gate's
-- Phase-4 graduation (P4.6 view over fhir_resources.HFJ_RESOURCE).
CREATE SCHEMA IF NOT EXISTS fhir_resources AUTHORIZATION vault_admin;
COMMENT ON SCHEMA fhir_resources IS
    'HAPI FHIR JPA backing schema. Owned by vault_admin; fhir_writer has full DDL/DML.';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fhir_writer') THEN
        CREATE ROLE fhir_writer NOINHERIT LOGIN PASSWORD 'PLACEHOLDER-CYCLE-AFTER-FIRST-BOOT';
    END IF;
END$$;

GRANT USAGE, CREATE ON SCHEMA fhir_resources TO fhir_writer;
ALTER DEFAULT PRIVILEGES FOR ROLE fhir_writer IN SCHEMA fhir_resources
    GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLES TO fhir_writer;
ALTER DEFAULT PRIVILEGES FOR ROLE fhir_writer IN SCHEMA fhir_resources
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO fhir_writer;
GRANT USAGE ON SCHEMA fhir_resources TO bi_reader;

-- Phase 3.5: consent revocations — the runtime gate every PHI mart
-- must anti-join against. One row revokes one patient's data for the
-- listed purpose (NULL = blanket revocation). Append-only — Phase 4 will
-- replace with a full FHIR Consent resource backed by HAPI.
CREATE TABLE IF NOT EXISTS nhdw_landing.consent_revocations (
    revocation_id   text        PRIMARY KEY,
    patient_id      text        NOT NULL,            -- Fayda FIN
    purpose         text,                            -- HL7 ActReason or NULL = all
    revoked_at      timestamptz NOT NULL DEFAULT now(),
    revoked_by      text        NOT NULL,            -- KC preferred_username
    note            text,
    -- Phase 4.6: source = 'manual' (direct inserts) or 'fhir-consent'
    -- (pulled from HAPI Consent resources by the consent_extract DAG).
    source          text        NOT NULL DEFAULT 'manual',
    -- Stable handle to the source FHIR resource (Consent/N) so the
    -- extractor can upsert idempotently.
    fhir_consent_id text
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_consent_rev_fhir_id
    ON nhdw_landing.consent_revocations (fhir_consent_id)
    WHERE fhir_consent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_consent_rev_patient
    ON nhdw_landing.consent_revocations (patient_id);
COMMENT ON TABLE nhdw_landing.consent_revocations IS
    'Phase 3.5 PHI gate. Marts touching patient-level data MUST anti-join against this table. Phase 4 replaces with FHIR Consent.';
-- vault_writer + landing-writer can INSERT (record consent decisions);
-- bi_reader needs SELECT to anti-join from marts.
GRANT INSERT, SELECT ON nhdw_landing.consent_revocations TO vault_writer;
GRANT SELECT ON nhdw_landing.consent_revocations TO bi_reader;

-- Phase 3.5 fixture: a minimal patient-level table that stands in for
-- Phase-4 PHI sources (EthioEMR observations, FHIR Patient/Observation,
-- etc.). EXISTS PURELY TO DEMONSTRATE THE CONSENT GATE — it has no
-- real ingest flow and will be removed when actual PHI sources land.
CREATE TABLE IF NOT EXISTS nhdw_landing.demo_patient_phi (
    patient_id      text        NOT NULL,
    encounter_date  date        NOT NULL,
    observation     text        NOT NULL,
    facility_code   text,
    PRIMARY KEY (patient_id, encounter_date, observation)
);
COMMENT ON TABLE nhdw_landing.demo_patient_phi IS
    'Phase 3.5 fixture — demo PHI for the consent gate test. Remove when real PHI sources land in Phase 4.';
GRANT SELECT, INSERT ON nhdw_landing.demo_patient_phi TO vault_writer;
GRANT SELECT ON nhdw_landing.demo_patient_phi TO bi_reader;

CREATE TABLE IF NOT EXISTS nhdw_landing.submission_inbox (
    submission_id            text        PRIMARY KEY,
    dataset_slug             text        NOT NULL,
    filename                 text        NOT NULL,
    size_bytes               bigint      NOT NULL CHECK (size_bytes >= 0),
    content_sha256           text,
    submitted_by             text        NOT NULL,
    submitted_at             timestamptz NOT NULL DEFAULT now(),
    status                   text        NOT NULL DEFAULT 'ACCEPTED-PENDING-INGESTION',
    realm                    text        NOT NULL DEFAULT 'moh-staff',
    role                     text        NOT NULL,
    -- Phase 4.4: OpenHIM transaction id returned by the channel POST.
    openhim_transaction_id   text,
    openhim_response_code    int
);

CREATE INDEX IF NOT EXISTS ix_submission_inbox_user_time
    ON nhdw_landing.submission_inbox (submitted_by, submitted_at DESC);

CREATE INDEX IF NOT EXISTS ix_submission_inbox_dataset_time
    ON nhdw_landing.submission_inbox (dataset_slug, submitted_at DESC);

COMMENT ON TABLE nhdw_landing.submission_inbox IS
    'Producer-side registry of every file submitted via 6_access-points/dashboards/submission-portal/. Phase 4 will route bytes to MinIO + OpenHIM; this table remains the canonical record.';

-- vault_writer (and its OpenBao children — postgres-vault-landing-writer)
-- needs INSERT to record submissions and SELECT to surface "my history"
-- back to each producer.
GRANT SELECT, INSERT ON nhdw_landing.submission_inbox TO vault_writer;

-- ---------- service-user schema grants -------------------------------------
-- Moved here from 00_users (which now only creates the roles) so the schemas
-- referenced below already exist. Roles were created in 00_users.sh; the
-- schemas above in this file. Idempotent.

-- landing_writer: full DDL/DML on nhdw_landing only.
GRANT USAGE, CREATE ON SCHEMA nhdw_landing TO landing_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA nhdw_landing
    GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO landing_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA nhdw_landing
    GRANT USAGE, SELECT ON SEQUENCES TO landing_writer;

-- vault_writer: DDL/DML on the two vault schemas, SELECT on landing.
GRANT USAGE ON SCHEMA nhdw_landing TO vault_writer;
GRANT USAGE, CREATE ON SCHEMA nhdw_vault_raw, nhdw_vault_business TO vault_writer;
ALTER DEFAULT PRIVILEGES FOR USER vault_admin IN SCHEMA nhdw_landing
    GRANT SELECT ON TABLES TO vault_writer;
ALTER DEFAULT PRIVILEGES FOR USER landing_writer IN SCHEMA nhdw_landing
    GRANT SELECT ON TABLES TO vault_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA nhdw_vault_raw
    GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO vault_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA nhdw_vault_business
    GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO vault_writer;

-- bi_reader: read-only on the business vault.
-- dbt (the vault project) creates every nhdw_vault_business table + view as
-- vault_writer, so the default-privilege grant MUST be scoped FOR USER
-- vault_writer — a bare ALTER DEFAULT PRIVILEGES run by vault_admin only
-- covers vault_admin-created objects and silently leaves bi_reader without
-- SELECT on the links/resolution views (breaking the Admin cross-source
-- reconciliation widget). Same FOR USER pattern as vault_writer above.
GRANT USAGE ON SCHEMA nhdw_vault_business TO bi_reader;
ALTER DEFAULT PRIVILEGES FOR USER vault_writer IN SCHEMA nhdw_vault_business
    GRANT SELECT ON TABLES TO bi_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA nhdw_vault_business TO bi_reader;
