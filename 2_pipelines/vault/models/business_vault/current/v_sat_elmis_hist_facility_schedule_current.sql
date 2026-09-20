/*
    v_sat_elmis_hist_facility_schedule_current — latest sat_elmis_hist_facility_schedule per hk_elmis_hist_facility_schedule.
    See v_sat_openlmis_facility_current for the insert-only rationale.
*/
{{ config(materialized='view', schema='nhdw_vault_business') }}

SELECT DISTINCT ON (hk_elmis_hist_facility_schedule) *
FROM {{ ref('sat_elmis_hist_facility_schedule') }}
ORDER BY hk_elmis_hist_facility_schedule, load_ts DESC
