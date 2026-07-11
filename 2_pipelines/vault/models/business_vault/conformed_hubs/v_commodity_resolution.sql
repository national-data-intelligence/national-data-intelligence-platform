/*
    v_commodity_resolution — first-pass MDM for commodities, and the
    AutomateDV stage for hub_commodity_conformed + lnk_same_as_commodity.

    Strategy (v0 — exact-normalised-name match):
        Normalise name (lowercase, strip punctuation) → conformed_bk =
        the norm_name. Anything sharing a normalised name collapses to
        the same conformed entity.

    Same caveat as v_facility_resolution: fuzzy/trigram matching is a
    follow-up. GS1 codes or ATC codes are the proper bridge.

    Sources (read via the v_sat_*_current views — one identity row per
    source record, never one per historical name):
        HCMIS commodity_product
        mBrana mflowussd_commodities

    Stage columns (AutomateDV contract — hashes are pre-computed here):
        hk_commodity_conformed   hub PK   = hash(conformed_bk)
        hk_source_commodity      link FK  = the source hub's own hash key
        hk_same_as_commodity     link PK  = hash(source_system,
                                                 hex(hk_source_commodity),
                                                 hex(hk_commodity_conformed))
    source_system MUST stay a PK-hash input: source hubs hash unqualified
    BKs, so the overlapping integer BK spaces (HCMIS product_id vs mBrana
    commodity_id, both 1..34) produce IDENTICAL hk_source_commodity values
    — hashing only the participant keys collides the two systems' edges
    for every same-named commodity (34 live collisions today).
*/
{{ config(materialized='view', schema='nhdw_vault_business') }}

WITH hcmis AS (
    SELECT
        sat.hk_hcmis_commodity AS source_hk,
        'HCMIS' AS source_system,
        sat.name AS source_name,
        sat.description AS source_description,
        LOWER(REGEXP_REPLACE(COALESCE(sat.name,''), '[^a-zA-Z0-9 ]', '', 'g')) AS norm_name,
        sat.load_ts
    FROM {{ ref('v_sat_hcmis_commodity_current') }} sat
),
mbrana AS (
    SELECT
        sat.hk_mbrana_commodity AS source_hk,
        'mBrana' AS source_system,
        sat.commodity_name AS source_name,
        sat.commodity_code AS source_description,
        LOWER(REGEXP_REPLACE(COALESCE(sat.commodity_name,''), '[^a-zA-Z0-9 ]', '', 'g')) AS norm_name,
        sat.load_ts
    FROM {{ ref('v_sat_mbrana_commodity_current') }} sat
),
resolved AS (
    SELECT
        source_hk AS hk_source_commodity,
        source_system,
        source_name,
        source_description,
        norm_name,
        norm_name AS conformed_bk,
        load_ts
    FROM (
        SELECT * FROM hcmis UNION ALL SELECT * FROM mbrana
    ) all_src
    WHERE norm_name <> ''
),
keyed AS (
    SELECT
        resolved.*,
        {{ automate_dv.hash(columns=['conformed_bk'], alias='hk_commodity_conformed') }},
        'BV.commodity_resolution' AS record_source
    FROM resolved
)
SELECT
    keyed.*,
    {{ automate_dv.hash(columns=['source_system',
                                 "encode(hk_source_commodity, 'hex')",
                                 "encode(hk_commodity_conformed, 'hex')"],
                        alias='hk_same_as_commodity') }}
FROM keyed
