/*
    mart_ct_movements — one row per EPSS dispatch movement line (which hub
    supplies which facility, of which commodity, on which run, in which period).
    Reproduces plan.ts's MOVEMENTS array field-for-field, with types cast from
    the all-string raw surface here (downstream typing per the vault contract).

    Joins the movement hub+sat to the link (for the hub/facility/period edges),
    decodes the facility's region → region_id (OPA geo scoping), and conforms
    commodity_key → commodity_reference for programme_id. why_json carries the
    nested demand-signal breakdown for the movement detail panel. Grain: movement.
    Backs ct-movement (network + rail) and ct-kpis. Schema: bi_supply.
*/
WITH mv AS (
    SELECT h.movement_id, s.*
    FROM {{ source('nhdw_vault_raw', 'hub_hcmis_dispatch') }} h
    JOIN {{ source('nhdw_vault_business', 'v_sat_hcmis_dispatch_current') }} s
        USING (hk_hcmis_dispatch)
),
edge AS (
    SELECT lnk.hk_hcmis_dispatch,
           fh.hub_id  AS from_hub_id,
           fac.node_id AS to_node_id,
           fac.region  AS region,
           per.period_id
    FROM {{ source('nhdw_vault_raw', 'lnk_hcmis_dispatch') }} lnk
    JOIN {{ source('nhdw_vault_raw', 'hub_hcmis_dispatch_hub') }} fh
        USING (hk_hcmis_dispatch_hub)
    JOIN {{ source('nhdw_vault_raw', 'hub_hcmis_dispatch_period') }} per
        USING (hk_hcmis_dispatch_period)
    JOIN (
        SELECT hf.hk_hcmis_dispatch_facility, hf.node_id, fs.region
        FROM {{ source('nhdw_vault_raw', 'hub_hcmis_dispatch_facility') }} hf
        JOIN {{ source('nhdw_vault_business', 'v_sat_hcmis_dispatch_facility_current') }} fs
            USING (hk_hcmis_dispatch_facility)
    ) fac USING (hk_hcmis_dispatch_facility)
)
SELECT
    mv.movement_id,
    edge.period_id,
    edge.from_hub_id,
    edge.to_node_id,
    edge.region,
    CASE edge.region
        WHEN 'Tigray' THEN 'TI' WHEN 'Afar' THEN 'AF' WHEN 'Amhara' THEN 'AM'
        WHEN 'Oromia' THEN 'OR' WHEN 'Somali' THEN 'SO' WHEN 'Benishangul-Gumuz' THEN 'BG'
        WHEN 'Central Ethiopia' THEN 'CE' WHEN 'South Ethiopia' THEN 'SE'
        WHEN 'South West Ethiopia' THEN 'SW' WHEN 'Gambela' THEN 'GA' WHEN 'Gambella' THEN 'GA'
        WHEN 'Harari' THEN 'HA' WHEN 'Addis Ababa' THEN 'AA' WHEN 'Dire Dawa' THEN 'DD'
        WHEN 'Sidama' THEN 'SI' ELSE NULL END AS region_id,
    mv.drug,
    mv.drug_short,
    mv.commodity_key,
    cr.programme_id,
    mv.units::int                       AS units,
    mv.amc::int                         AS amc,
    mv.mos::numeric                     AS mos,
    mv.days_to_stockout::int            AS days_to_stockout,
    mv.priority::int                    AS priority,
    mv.lane_km::int                     AS lane_km,
    mv.cost_units::int                  AS cost_units,
    mv.sequence_index::int              AS sequence_index,
    mv.vehicle_run_id,
    mv.fill_rate::numeric               AS fill_rate,
    mv.nearest_hub_id,
    mv.alt_hub_id,
    mv.reason,
    mv.assign_delta_km::int             AS assign_delta_km,
    mv.assign_delta_cost::int           AS assign_delta_cost,
    mv.baseline_hub_id,
    mv.baseline_km::int                 AS baseline_km,
    mv.planned::boolean                 AS planned,
    mv.repaired::boolean                AS repaired,
    mv.capped::boolean                  AS capped,
    mv.why_json
FROM mv
JOIN edge USING (hk_hcmis_dispatch)
LEFT JOIN {{ ref('commodity_reference') }} cr ON cr.commodity_id = mv.commodity_key
