/*
    mart_ct_nodes — the Supply Control Tower map's fixed geography: every EPSS
    hub (warehouse) and every delivery facility (node) in the dispatch plan, one
    row each, discriminated by node_kind. Reproduces plan.ts's WAREHOUSES +
    NODES arrays (the gateway splits this mart back into the two lists).

    region_id conforms the plan's region NAME to the 2-letter code the other
    supply marts use (public_region_reference / epss_hub_catchment), so OPA geo
    scoping (geo_col=region_id) filters CT facilities the same way as the rest of
    bi_supply. Grain: node (hub_id or node_id). Backs ct-movement / ct-dispatch.
*/
WITH hub AS (
    SELECT h.hub_id, s.name, s.short_name, s.zone,
           s.lng, s.lat, s.is_hub, s.vehicles
    FROM {{ source('nhdw_vault_raw', 'hub_hcmis_dispatch_hub') }} h
    JOIN {{ source('nhdw_vault_business', 'v_sat_hcmis_dispatch_hub_current') }} s
        USING (hk_hcmis_dispatch_hub)
),
fac AS (
    SELECT h.node_id, s.name, s.region, s.facility_type,
           s.lng, s.lat, s.line_count, s.store_cap
    FROM {{ source('nhdw_vault_raw', 'hub_hcmis_dispatch_facility') }} h
    JOIN {{ source('nhdw_vault_business', 'v_sat_hcmis_dispatch_facility_current') }} s
        USING (hk_hcmis_dispatch_facility)
)
SELECT
    'hub'::text                        AS node_kind,
    hub.hub_id                         AS node_id,
    hub.name,
    NULL::text                         AS region,
    NULL::text                         AS region_id,
    NULL::text                         AS node_type,
    hub.lng::numeric                   AS lng,
    hub.lat::numeric                   AS lat,
    NULL::int                          AS line_count,
    NULL::int                          AS store_cap,
    hub.short_name,
    hub.zone,
    hub.is_hub::boolean                AS is_hub,
    hub.vehicles::int                  AS vehicles
FROM hub
UNION ALL
SELECT
    'facility'::text                   AS node_kind,
    fac.node_id                        AS node_id,
    fac.name,
    fac.region,
    CASE fac.region
        WHEN 'Tigray' THEN 'TI' WHEN 'Afar' THEN 'AF' WHEN 'Amhara' THEN 'AM'
        WHEN 'Oromia' THEN 'OR' WHEN 'Somali' THEN 'SO' WHEN 'Benishangul-Gumuz' THEN 'BG'
        WHEN 'Central Ethiopia' THEN 'CE' WHEN 'South Ethiopia' THEN 'SE'
        WHEN 'South West Ethiopia' THEN 'SW' WHEN 'Gambela' THEN 'GA' WHEN 'Gambella' THEN 'GA'
        WHEN 'Harari' THEN 'HA' WHEN 'Addis Ababa' THEN 'AA' WHEN 'Dire Dawa' THEN 'DD'
        WHEN 'Sidama' THEN 'SI' ELSE NULL END AS region_id,
    fac.facility_type                  AS node_type,
    fac.lng::numeric                   AS lng,
    fac.lat::numeric                   AS lat,
    fac.line_count::int                AS line_count,
    fac.store_cap::int                 AS store_cap,
    NULL::text                         AS short_name,
    NULL::text                         AS zone,
    NULL::boolean                      AS is_hub,
    NULL::int                          AS vehicles
FROM fac
