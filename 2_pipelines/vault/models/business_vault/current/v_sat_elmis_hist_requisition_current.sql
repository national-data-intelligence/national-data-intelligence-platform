/*
    v_sat_elmis_hist_requisition_current — latest sat_elmis_hist_requisition per hk_elmis_hist_requisition.
    See v_sat_openlmis_facility_current for the insert-only rationale.
*/
{{ config(materialized='view', schema='nhdw_vault_business') }}

SELECT DISTINCT ON (hk_elmis_hist_requisition) *
FROM {{ ref('sat_elmis_hist_requisition') }}
ORDER BY hk_elmis_hist_requisition, load_ts DESC
