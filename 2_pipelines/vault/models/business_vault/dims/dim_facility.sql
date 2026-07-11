/*
    dim_facility — thin dimension view over the conformed facility hub.
    One row per conformed facility. Marts join the spine's
    hk_facility_conformed here instead of re-decoding facility identity
    from raw sats (the copy-pasted regex path this layer replaces).

    facility_name = the resolution row from the most authoritative source
    system (MFR is the registry of record, then DHIS2, then the supply
    systems). facility_id = the conformed BK — the shared FAC-… id for
    facility_id-matched clusters, the normalised name for the (mBrana
    USSD) name-matched fallback.
*/
{{ config(materialized='view', schema='nhdw_vault_business') }}

WITH named AS (
    SELECT DISTINCT ON (hk_facility_conformed)
        hk_facility_conformed,
        source_name,
        source_system
    FROM {{ ref('v_facility_resolution') }}
    ORDER BY hk_facility_conformed,
             CASE source_system
                 WHEN 'MFR.location'     THEN 1
                 WHEN 'MFR.organization' THEN 2
                 WHEN 'DHIS2'            THEN 3
                 WHEN 'HCMIS'            THEN 4
                 WHEN 'mBrana.dbo'       THEN 5
                 ELSE 6 END
),
counted AS (
    SELECT hk_facility_conformed, COUNT(DISTINCT source_system) AS n_source_systems
    FROM {{ ref('v_facility_resolution') }}
    GROUP BY hk_facility_conformed
)
SELECT
    h.hk_facility_conformed,
    h.conformed_bk   AS facility_id,
    n.source_name    AS facility_name,
    n.source_system  AS name_source,
    c.n_source_systems,
    h.load_ts
FROM {{ ref('hub_facility_conformed') }} h
LEFT JOIN named   n USING (hk_facility_conformed)
LEFT JOIN counted c USING (hk_facility_conformed)
