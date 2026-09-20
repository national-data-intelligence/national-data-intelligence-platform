/*
    v_sat_elmis_hist_product_category_current — latest sat_elmis_hist_product_category per hk_elmis_hist_product_category.
    See v_sat_openlmis_facility_current for the insert-only rationale.
*/
{{ config(materialized='view', schema='nhdw_vault_business') }}

SELECT DISTINCT ON (hk_elmis_hist_product_category) *
FROM {{ ref('sat_elmis_hist_product_category') }}
ORDER BY hk_elmis_hist_product_category, load_ts DESC
