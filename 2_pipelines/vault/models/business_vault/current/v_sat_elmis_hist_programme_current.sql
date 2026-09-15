/*
    v_sat_elmis_hist_programme_current — latest sat_elmis_hist_programme per hk_elmis_hist_programme.
    See v_sat_openlmis_facility_current for the insert-only rationale.
*/
{{ config(materialized='view', schema='nhdw_vault_business') }}

SELECT DISTINCT ON (hk_elmis_hist_programme) *
FROM {{ ref('sat_elmis_hist_programme') }}
ORDER BY hk_elmis_hist_programme, load_ts DESC
