-- Every reported eLMIS R&R line is counted exactly once in the feature mart.
--
-- 2026-09-22: the eLMIS source was re-stated between two loads; the insert-only
-- vault kept both versions of each line and requisition, and marts that joined the
-- raw links counted every line ~4 times (Σ dispensed 1.57B vs 394M at source).
-- The marts now read the driving-key current views; this test pins the invariant
-- so any join that fans out again fails the build instead of shipping 2x/4x numbers.
--
-- Returns rows when the test FAILS.

WITH src AS (
    SELECT count(*)                                  AS lines,
           coalesce(sum(ls.quantity_dispensed::numeric), 0) AS dispensed
    FROM {{ source('nhdw_vault_business', 'v_lnk_elmis_hist_requisition_line_current') }} l
    JOIN {{ source('nhdw_vault_business', 'v_sat_elmis_hist_requisition_line_current') }} ls
      USING (hk_elmis_hist_requisition_line)
    WHERE COALESCE(ls.skipped::text, 'false') NOT IN ('true', 't', '1')
),
mart AS (
    SELECT coalesce(sum(lines), 0)                   AS lines,
           coalesce(sum(quantity_dispensed), 0)      AS dispensed
    FROM {{ ref('mart_elmis_hist_facility_product_month') }}
)
SELECT 'facility_product_month does not count each reported line once' AS failure,
       src.lines AS source_lines, mart.lines AS mart_lines,
       src.dispensed AS source_dispensed, mart.dispensed AS mart_dispensed
FROM src, mart
WHERE src.lines <> mart.lines OR src.dispensed <> mart.dispensed
