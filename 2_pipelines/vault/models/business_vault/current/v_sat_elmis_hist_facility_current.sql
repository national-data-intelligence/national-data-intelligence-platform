/*
    v_sat_elmis_hist_facility_current — latest sat_elmis_hist_facility per hk_elmis_hist_facility.
    See v_sat_openlmis_facility_current for the insert-only rationale.
*/
{{ config(materialized='view', schema='nhdw_vault_business') }}

SELECT DISTINCT ON (hk_elmis_hist_facility) *
FROM {{ ref('sat_elmis_hist_facility') }}
ORDER BY hk_elmis_hist_facility, load_ts DESC
