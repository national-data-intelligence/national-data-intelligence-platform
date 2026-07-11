/*
    v_programme_resolution — health-programme conformed.
    Programmes are the top-level disease/service-line groupings:
        HIV, TB, EPI, MNCH, NCD, MALARIA, FP, NUTRITION, OTHER.

    SINGLE SOURCE OF TRUTH for the indicator-code → programme mapping.
    Marts join this view (source_code = indicator_id) instead of
    re-deriving the mapping locally.

    Sources:
      • DHIS2 dataElement: one row per data element (current record).
        Programme derived from the REAL seeded element-code families (see
        data_elements names): dash-prefixed families match on prefix; the
        MNCH/EPI codes carry no family prefix, so they are enumerated.
        Codes outside every family (IDSR-*, PHEM-*, POP-TOTAL) resolve to
        OTHER — consumers with a narrower grain (e.g. HMIS monthly
        coverage excludes IDSR-*) filter codes upstream, not here.
        (The old map keyed on prefixes like MNCH-/NCD-/NUTR- that no
        seeded code ever had — everything but HIV/TB/MAL/FP fell into
        OTHER and the MNCH/NCD cascades were empty.)
      • [Future] DHIS2 dataElementGroup: when the ingestor starts pulling
        groups, each group's code IS the canonical programme_id; this view
        will UNION that source in.
      • [Future] EthioEMR program (OpenMRS `program` table): same — UNION
        in when the hub/sat exists.

    Doubles as the AutomateDV stage for hub_programme_conformed:
    hk_programme_conformed = hash(programme_id) is pre-computed here.
*/
{{ config(materialized='view', schema='nhdw_vault_business') }}

WITH src AS (
    SELECT
        sat.hk_dhis2_data_element AS source_hk,
        'DHIS2.dataElement' AS source_system,
        sat.name AS source_name,
        sat.code AS source_code,
        CASE
            WHEN sat.code LIKE 'HIV-%'  THEN 'HIV'
            WHEN sat.code LIKE 'TB-%'   THEN 'TB'
            WHEN sat.code LIKE 'MAL-%'  THEN 'MALARIA'
            WHEN sat.code LIKE 'FP-%'   THEN 'FP'
            WHEN sat.code LIKE 'HTN-%'  THEN 'NCD'
            WHEN sat.code LIKE 'NUT-%'  THEN 'NUTRITION'
            WHEN sat.code IN ('ANC1','ANC4','ANC4-COV','SBA','SBA-COV','PNC1','MMR')
                                        THEN 'MNCH'
            WHEN sat.code IN ('BCG','MR1','MR2','PENTA1','PENTA3','PENTA3-COV')
                                        THEN 'EPI'
            ELSE 'OTHER' END AS programme_id,
        sat.load_ts
    FROM {{ ref('v_sat_dhis2_data_element_current') }} sat
    WHERE sat.code IS NOT NULL AND sat.code <> ''
)
SELECT
    src.*,
    {{ automate_dv.hash(columns=['programme_id'], alias='hk_programme_conformed') }},
    'BV.programme_resolution' AS record_source
FROM src
