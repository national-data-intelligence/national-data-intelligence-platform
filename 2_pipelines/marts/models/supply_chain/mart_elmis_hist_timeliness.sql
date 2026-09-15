/*
    mart_elmis_hist_timeliness — facility reporting timeliness per month ×
    programme (legacy eLMIS v2 history).

    A requisition is "on time" when created within 15 days of its reporting
    period's end (P1 baseline: median lag 9 days, 79.8% ≤ 15d nationally).
    Grain month × programme (~140 rows).
*/
{{ config(materialized='table') }}

SELECT
    to_char(per.period_start::date, 'YYYY-MM')     AS month_id,
    per.period_start::date                          AS period_start,
    prog.name                                       AS programme_name,
    count(*)                                        AS requisitions,
    count(*) FILTER (WHERE rs.requisition_created_at::timestamp
                           <= per.period_end::timestamp + interval '15 days')
                                                    AS on_time_requisitions,
    round(100.0 * count(*) FILTER (WHERE rs.requisition_created_at::timestamp
                           <= per.period_end::timestamp + interval '15 days')
          / NULLIF(count(*), 0), 1)                 AS on_time_pct,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY
        EXTRACT(EPOCH FROM rs.requisition_created_at::timestamp
                         - per.period_end::timestamp) / 86400.0)::numeric, 1)
                                                    AS median_lag_days
FROM {{ source('nhdw_vault_raw', 'lnk_elmis_hist_requisition') }} lnk
JOIN {{ source('nhdw_vault_business', 'v_sat_elmis_hist_requisition_current') }} rs
    USING (hk_elmis_hist_requisition)
JOIN {{ source('nhdw_vault_business', 'v_sat_elmis_hist_programme_current') }} prog
    USING (hk_elmis_hist_programme)
JOIN {{ source('nhdw_vault_business', 'v_sat_elmis_hist_period_current') }} per
    USING (hk_elmis_hist_period)
WHERE rs.requisition_created_at IS NOT NULL
GROUP BY 1, 2, 3
