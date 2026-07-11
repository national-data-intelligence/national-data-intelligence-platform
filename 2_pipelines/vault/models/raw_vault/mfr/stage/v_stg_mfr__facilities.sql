/*
    v_stg_mfr__facilities — staging view for MFR FHIR Location resources
    (each row = one Ethiopian health facility).

    Adds the AutomateDV hash columns + a record_source label. Downstream:
        - hub_mfr_facility    PK = fhir_id
        - sat_mfr_facility    payload = name, status, type, geo, address, telecom, etc.
        - lnk_mfr_facility_partof  fhir_id → parent fhir_id (admin hierarchy)

    `part_of_reference` is a FHIR Reference of the form
    "Organization/<fhir_id>"; parent_fhir_id strips the prefix (NULL when
    absent, so the parent-side hash key is NULL and the AutomateDV link
    macro drops the row from lnk_mfr_facility_partof).

    Note: MFR currently has 0 Location resources in dev (only Organizations
    were seeded in this dev cycle). The model is here so downstream
    pipelines & marts can adopt Locations the moment the MFR ingestor
    starts pulling them.
*/
{{ config(materialized='view') }}
WITH src AS (
    SELECT *,
           NULLIF(REGEXP_REPLACE(COALESCE(part_of_reference, ''), '^.*/', ''), '') AS parent_fhir_id
    FROM {{ source('landing', 'stg_mfr__facilities') }}
)
SELECT *,
       'MFR.facilities' AS record_source,
       {{ automate_dv.hash(columns=['fhir_id'], alias='hk_mfr_facility') }},
       {{ automate_dv.hash(columns=['parent_fhir_id'], alias='hk_mfr_organization') }},
       {{ automate_dv.hash(columns=['fhir_id','parent_fhir_id'], alias='hk_mfr_facility_partof') }},
       {{ automate_dv.hash(columns=sat_hashdiff('mfr_facility'), alias='hd_mfr_facility', is_hashdiff=true) }}
FROM src
