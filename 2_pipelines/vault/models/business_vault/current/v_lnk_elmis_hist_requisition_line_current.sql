/*
    v_lnk_elmis_hist_requisition_line_current — the current edge of each eLMIS R&R line:
    latest lnk_elmis_hist_requisition_line row per source_line_item_id (the driving key).

    Why: the link's hash covers (line, requisition, product), so a source re-statement
    that moves a line to another product adds a second row for the same source line.
    Marts must read one edge per source line — see v_lnk_elmis_hist_requisition_current.
*/
{{ config(materialized='view', schema='nhdw_vault_business') }}

SELECT DISTINCT ON (source_line_item_id) *
FROM {{ ref('lnk_elmis_hist_requisition_line') }}
ORDER BY source_line_item_id, load_ts DESC, hk_elmis_hist_requisition_line
