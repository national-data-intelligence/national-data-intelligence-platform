/*
    v_commodity_resolution — first-pass MDM for commodities, and the
    AutomateDV stage for hub_commodity_conformed + lnk_same_as_commodity.

    Strategy (v1 — governed crosswalk, name-normalisation fallback):
        Each source's NATIVE commodity code resolves through the governed
        reference vocabulary (nhdw_ref.source_to_concept_map):
            HCMIS   → the commodity_id embedded in its description KV string
                      (vocabulary 'HCMIS.commodityId')
            mBrana  → commodity_code (vocabulary 'MBRANA.commodityCode',
                      live-derived supplement)
        The target concept's code IS the canonical norm_name (the PARITY
        RULE in 34_ref_vocab.sql), and unmapped rows fall back to the old
        exact-normalised-name match — so conformed keys are byte-identical
        to the v0 name-match for every mapped row, while new/renamed source
        rows now conform through governed data instead of string luck.
        Stewards change a mapping by superseding a crosswalk row, not SQL.

    MIGRATION NOTE (2026-09-20): replaced the v0 pure-norm_name strategy
    parity-first (candidate view full-row diff vs the deployed view: zero
    differing rows). Fuzzy/trigram matching stays the MDM engine's job
    (match candidates + steward decisions), NOT this view's; ATC codes
    arrive later as additional crosswalk vocabularies.

    BOOT-ORDER CONTRACT: nhdw_ref is seeded at bootstrap step 5.7, before
    this model builds.

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

WITH xwalk AS (
    -- Current crosswalk rows for both commodity vocabularies: not
    -- invalidated, validity window covers today, newest valid_from wins.
    SELECT DISTINCT ON (m.source_vocabulary_id, m.source_code)
        m.source_vocabulary_id,
        m.source_code,
        c.concept_code
    FROM {{ source('ref_vocab', 'source_to_concept_map') }} m
    JOIN {{ source('ref_vocab', 'concept') }} c
      ON c.concept_id = m.target_concept_id
    WHERE m.source_vocabulary_id IN ('HCMIS.commodityId', 'MBRANA.commodityCode')
      AND m.invalid_reason IS NULL
      AND CURRENT_DATE >= m.valid_from
      AND CURRENT_DATE <  m.valid_to
    ORDER BY m.source_vocabulary_id, m.source_code, m.valid_from DESC
),

hcmis AS (
    SELECT
        sat.hk_hcmis_commodity AS source_hk,
        'HCMIS' AS source_system,
        sat.name AS source_name,
        sat.description AS source_description,
        -- native code carried in the description KV string: commodity_id=<CODE> | …
        SUBSTRING(sat.description FROM 'commodity_id=([A-Za-z0-9-]+)') AS native_code,
        'HCMIS.commodityId' AS native_vocabulary,
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
        sat.commodity_code AS native_code,
        'MBRANA.commodityCode' AS native_vocabulary,
        LOWER(REGEXP_REPLACE(COALESCE(sat.commodity_name,''), '[^a-zA-Z0-9 ]', '', 'g')) AS norm_name,
        sat.load_ts
    FROM {{ ref('v_sat_mbrana_commodity_current') }} sat
),
resolved AS (
    SELECT
        all_src.source_hk AS hk_source_commodity,
        all_src.source_system,
        all_src.source_name,
        all_src.source_description,
        all_src.norm_name,
        COALESCE(x.concept_code, all_src.norm_name) AS conformed_bk,
        all_src.load_ts
    FROM (
        SELECT * FROM hcmis UNION ALL SELECT * FROM mbrana
    ) all_src
    LEFT JOIN xwalk x
      ON x.source_vocabulary_id = all_src.native_vocabulary
     AND x.source_code = all_src.native_code
    WHERE all_src.norm_name <> ''
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
