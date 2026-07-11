/*
    v_facility_resolution — Master facility resolution (v2), and the
    AutomateDV stage for hub_facility_conformed + lnk_same_as_facility.

    Strategy (v2 — facility_id-first, normalised-name fallback):
        1. Extract the shared canonical `facility_id` from each source.
           After the 2026 source regeneration every source carries it:
             • MFR Organization / Location  → identifier JSON, system =
                 "http://moh.gov.et/identifier/facility"
             • DHIS2 OrgUnit                → sat.code (= facility_id)
             • HCMIS Institution            → description (slug fmt)
             • mBrana Institution           → description (master) / town (USSD)
        2. conformed_bk = facility_id when present (deterministic);
           else norm_name (legacy / external partner data).
        3. Cluster rows by conformed_bk → one row in
           hub_facility_conformed; rows bridged via lnk_same_as_facility.

    DHIS2 included now (was excluded in v1): filtered to level-5 nodes
    whose code matches FAC- prefix (= our facilities, not admin tree).

    Reads the v_sat_*_current views (one identity row per source record),
    never the raw sats: a renamed facility must contribute its CURRENT
    name only, not one candidate row per historical name.

    Stage columns (AutomateDV contract — hashes are pre-computed here):
        hk_facility_conformed   hub PK   = hash(conformed_bk)
        hk_source_facility      link FK  = the source hub's own hash key
        hk_same_as_facility     link PK  = hash(source_system,
                                                hex(hk_source_facility),
                                                hex(hk_facility_conformed))
    source_system MUST stay a PK-hash input: source hubs hash unqualified
    BKs, so hubs whose integer BK spaces overlap (HCMIS institution_id vs
    mBrana id — 891 identical hash keys live) can produce IDENTICAL
    hk_source_facility values; hashing only the participant keys would
    collide two systems' edges whenever the names also conform. Same
    rationale as lnk_same_as_commodity (34 live collisions without it).
*/
{{ config(materialized='view', schema='nhdw_vault_business') }}

WITH hcmis AS (
    SELECT
        sat.hk_hcmis_facility AS source_hk,
        'HCMIS' AS source_system,
        sat.name AS source_name,
        NULL::text AS source_code,
        -- First-match slug extraction (NULL when absent). NB: never use
        -- '\b' here — in Postgres ARE '\b' is BACKSPACE, not a word
        -- boundary ('\y' is), so the old NULLIF(REGEXP_REPLACE ...\b...)
        -- silently matched nothing and every row fell back to norm_name.
        SUBSTRING(sat.description FROM 'FAC-[A-Z]{2}-[A-Z]+-[a-f0-9]+') AS facility_id,
        LOWER(REGEXP_REPLACE(COALESCE(sat.name,''), '[^a-zA-Z0-9 ]', '', 'g')) AS norm_name,
        sat.load_ts
    FROM {{ ref('v_sat_hcmis_facility_current') }} sat
),
mbrana_master AS (
    SELECT
        sat.hk_mbrana_facility AS source_hk,
        'mBrana.dbo' AS source_system,
        sat.name AS source_name,
        NULL::text AS source_code,
        SUBSTRING(sat.description FROM 'FAC-[A-Z]{2}-[A-Z]+-[a-f0-9]+') AS facility_id,
        LOWER(REGEXP_REPLACE(COALESCE(sat.name,''), '[^a-zA-Z0-9 ]', '', 'g')) AS norm_name,
        sat.load_ts
    FROM {{ ref('v_sat_mbrana_facility_current') }} sat
),
mbrana_ussd AS (
    -- mBrana USSD sat doesn't carry a `town` column where the facility_id
    -- slug could live, so this source only contributes a norm_name match.
    SELECT
        sat.hk_mbrana_ussd_facility AS source_hk,
        'mBrana.ussd' AS source_system,
        sat.institution_name AS source_name,
        NULL::text AS source_code,
        NULL::text AS facility_id,
        LOWER(REGEXP_REPLACE(COALESCE(sat.institution_name,''),
                              '[^a-zA-Z0-9 ]', '', 'g')) AS norm_name,
        sat.load_ts
    FROM {{ ref('v_sat_mbrana_ussd_facility_current') }} sat
),
dhis2 AS (
    -- DHIS2 OrgUnit code == facility_id for level-5 nodes. Higher-level
    -- nodes (region/zone/woreda) have admin codes (ET-OR, ZON-OR-x,
    -- WOR-OR-y) — those are geography, not facility, so we filter them out.
    SELECT
        sat.hk_dhis2_org_unit AS source_hk,
        'DHIS2' AS source_system,
        sat.name AS source_name,
        sat.code AS source_code,
        CASE WHEN sat.code LIKE 'FAC-%' THEN sat.code ELSE NULL END AS facility_id,
        LOWER(REGEXP_REPLACE(COALESCE(sat.name,''), '[^a-zA-Z0-9 ]', '', 'g')) AS norm_name,
        sat.load_ts
    FROM {{ ref('v_sat_dhis2_org_unit_current') }} sat
),
mfr_loc AS (
    SELECT
        sat.hk_mfr_facility AS source_hk,
        'MFR.location' AS source_system,
        sat.name AS source_name,
        NULL::text AS source_code,
        SUBSTRING(sat.identifier::text FROM 'FAC-[A-Z]{2}-[A-Z]+-[a-f0-9]+') AS facility_id,
        LOWER(REGEXP_REPLACE(COALESCE(sat.name,''), '[^a-zA-Z0-9 ]', '', 'g')) AS norm_name,
        sat.load_ts
    FROM {{ ref('v_sat_mfr_facility_current') }} sat
),
mfr_org AS (
    SELECT
        sat.hk_mfr_organization AS source_hk,
        'MFR.organization' AS source_system,
        sat.name AS source_name,
        NULL::text AS source_code,
        SUBSTRING(sat.identifier::text FROM 'FAC-[A-Z]{2}-[A-Z]+-[a-f0-9]+') AS facility_id,
        LOWER(REGEXP_REPLACE(COALESCE(sat.name,''), '[^a-zA-Z0-9 ]', '', 'g')) AS norm_name,
        sat.load_ts
    FROM {{ ref('v_sat_mfr_organization_current') }} sat
    WHERE sat.identifier::text LIKE '%FAC-%'
),
unioned AS (
    SELECT * FROM hcmis
    UNION ALL SELECT * FROM mbrana_master
    UNION ALL SELECT * FROM mbrana_ussd
    UNION ALL SELECT * FROM dhis2
    UNION ALL SELECT * FROM mfr_loc
    UNION ALL SELECT * FROM mfr_org
),
resolved AS (
    SELECT
        source_hk AS hk_source_facility,
        source_system,
        source_name,
        source_code,
        facility_id,
        norm_name,
        COALESCE(facility_id, norm_name) AS conformed_bk,
        CASE WHEN facility_id IS NOT NULL THEN 'facility_id'
             ELSE 'norm_name' END AS match_strategy,
        load_ts
    FROM unioned
    WHERE COALESCE(facility_id, norm_name) <> ''
),
keyed AS (
    SELECT
        resolved.*,
        {{ automate_dv.hash(columns=['conformed_bk'], alias='hk_facility_conformed') }},
        'BV.facility_resolution' AS record_source
    FROM resolved
)
SELECT
    keyed.*,
    {{ automate_dv.hash(columns=['source_system',
                                 "encode(hk_source_facility, 'hex')",
                                 "encode(hk_facility_conformed, 'hex')"],
                        alias='hk_same_as_facility') }}
FROM keyed
