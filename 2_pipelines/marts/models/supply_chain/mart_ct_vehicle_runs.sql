/*
    mart_ct_vehicle_runs — one row per EPSS dispatch vehicle run. Reproduces
    plan.ts's VEHICLE_RUNS array: the per-run stop list and the road polyline are
    carried as JSON (stops_json / path_json) so the gateway returns them nested
    exactly as the Control Tower map + dispatch rail expect. Grain: run.
    Backs ct-dispatch (and the selected-run overlay on ct-movement). Schema: bi_supply.
*/
WITH run AS (
    SELECT h.run_id, s.*
    FROM {{ source('nhdw_vault_raw', 'hub_hcmis_dispatch_run') }} h
    JOIN {{ source('nhdw_vault_business', 'v_sat_hcmis_dispatch_run_current') }} s
        USING (hk_hcmis_dispatch_run)
)
SELECT
    run.run_id,
    run.period_id,
    run.vehicle_type,
    run.capacity_units::int             AS capacity_units,
    run.origin_hub_id,
    run.total_road_km::int              AS total_road_km,
    run.total_units::int                AS total_units,
    run.fill_rate::numeric              AS fill_rate,
    run.cost_total::int                 AS cost_total,
    run.cost_per_unit::numeric          AS cost_per_unit,
    run.km_saved_vs_baseline::int       AS km_saved_vs_baseline,
    run.depart,
    run.eta,
    run.status,
    run.stops_json,
    run.path_json
FROM run
