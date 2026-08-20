/*
    mart_ct_plan_stats — one row per planning period: the plan-level KPI +
    savings summary the EPSS optimizer computed (units/legs/runs/facilities/fill
    and the km + cost + vehicles saved versus a naive one-truck-per-facility
    baseline). Reproduces plan.ts's PERIOD_STATS + (for the current period)
    SUMMARY + BASELINE. The gateway serves the requested period's row as
    `summary` + `baseline` (and the whole set as `periodStats`). Grain: period.
    Schema: bi_supply.
*/
WITH period AS (
    SELECT h.period_id, s.*
    FROM {{ source('nhdw_vault_raw', 'hub_hcmis_dispatch_period') }} h
    JOIN {{ source('nhdw_vault_business', 'v_sat_hcmis_dispatch_period_current') }} s
        USING (hk_hcmis_dispatch_period)
)
SELECT
    period_id,
    label,
    sort_order::int                     AS sort_order,
    movements::int                      AS movements,
    units::bigint                       AS units,
    runs::int                           AS runs,
    facilities::int                     AS facilities,
    avg_fill::numeric                   AS avg_fill,
    overflow_legs::int                  AS overflow_legs,
    min_months::int                     AS min_months,
    max_months::int                     AS max_months,
    uncovered_needs::int                AS uncovered_needs,
    at_risk_facilities::int             AS at_risk_facilities,
    optimized_km::bigint                AS optimized_km,
    baseline_km::bigint                 AS baseline_km,
    km_saved::bigint                    AS km_saved,
    km_saved_pct::int                   AS km_saved_pct,
    optimized_cost::bigint              AS optimized_cost,
    baseline_cost::bigint               AS baseline_cost,
    cost_saved::bigint                  AS cost_saved,
    cost_saved_pct::int                 AS cost_saved_pct,
    vehicles_used::int                  AS vehicles_used,
    naive_vehicles::int                 AS naive_vehicles,
    vehicles_saved::int                 AS vehicles_saved
FROM period
