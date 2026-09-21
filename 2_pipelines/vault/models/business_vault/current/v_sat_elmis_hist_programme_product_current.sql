/*
    v_sat_elmis_hist_programme_product_current — latest sat_elmis_hist_programme_product per hk_elmis_hist_programme_product.
    See v_sat_openlmis_facility_current for the insert-only rationale.
*/
{{ config(materialized='view', schema='nhdw_vault_business') }}

SELECT DISTINCT ON (hk_elmis_hist_programme_product) *
FROM {{ ref('sat_elmis_hist_programme_product') }}
ORDER BY hk_elmis_hist_programme_product, load_ts DESC
