/*
    v_lnk_elmis_hist_requisition_current — the current context (facility x programme x
    period) of each eLMIS requisition: latest lnk_elmis_hist_requisition row per
    hk_elmis_hist_requisition (the driving key).

    Why: the link's hash covers the whole context, so when the source re-states a
    requisition with a different facility/programme/period the insert-only vault keeps
    both rows. Marts must read one context per requisition, or every measure is counted
    once per version (2026-09-22: two source loads → marts at 2x/4x). Same rule as the
    v_sat_*_current views; nothing is removed from the raw vault.
*/
{{ config(materialized='view', schema='nhdw_vault_business') }}

SELECT DISTINCT ON (hk_elmis_hist_requisition) *
FROM {{ ref('lnk_elmis_hist_requisition') }}
ORDER BY hk_elmis_hist_requisition, load_ts DESC, hk_elmis_hist_requisition_ctx
