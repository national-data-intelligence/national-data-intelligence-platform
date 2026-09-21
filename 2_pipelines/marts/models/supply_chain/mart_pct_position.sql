{{ config(materialized='table') }}
{#
    PCT projected position — facility × tracer product × programme at the anchor
    month (the latest month in the data: August 2018), on eLMIS AMC
    (bi_supply.mart_pct_position). Descriptive and AMC-based by design: the
    forecast-driven version replaces demand_basis only after the forecast
    contract, backtest and promotion gates pass.

    Policy is explicit on every row:
      target_stock   = max stock months (facility type) × AMC   (order-up-to)
      emergency_level = emergency order point months × AMC
      lead_time_days, review_period_months from seed pct_policy_parameters
      (lead time is an ASSUMPTION — the archive has no lead-time data).
    Replenishment is given EXCLUDING the pipeline (primary, conservative) and
    INCLUDING the assumed pipeline (mart_pct_demand_month.pipeline_assumed — a
    labelled planning assumption, not a measurement).

    AMC is eLMIS's own (one definition): rows without it are flagged, not filled.
    No monetary value: eLMIS prices mix per-unit and per-pack semantics with no
    currency, so a value column would mislead. Packs are rounded only where the
    product's pack size exceeds 1 (elsewhere the dispensing unit is the pack).

    Not in the data, and therefore not modelled: true lead times, OTIF, route
    times, vehicle capacity, expiry, warehouse availability.
#}

WITH params AS (
    SELECT max(value) FILTER (WHERE parameter = 'lead_time_days')       AS lead_time_days,
           max(value) FILTER (WHERE parameter = 'review_period_months') AS review_period_months
    FROM {{ ref('pct_policy_parameters') }}
),

anchor AS (
    SELECT max(month_id) AS month_id FROM {{ ref('mart_pct_demand_month') }}
),

recent AS (
    -- demand in the 3 months ending at the anchor: distinguishes "no demand" from "AMC missing"
    SELECT d.facility_code, d.product_code, d.programme_id, sum(d.adjusted_demand) AS recent_demand
    FROM {{ ref('mart_pct_demand_month') }} d, anchor a
    WHERE d.tracer
      AND d.period_start > (a.month_id || '-01')::date - interval '3 months'
    GROUP BY 1, 2, 3
),

policy AS (
    SELECT h.code AS facility_type_code, s.nominal_max_months AS max_stock_months, s.nominal_eop AS eop_months
    FROM {{ source('nhdw_vault_raw', 'hub_elmis_hist_facility_type') }} h
    JOIN {{ source('nhdw_vault_business', 'v_sat_elmis_hist_facility_type_current') }} s USING (hk_elmis_hist_facility_type)
),

pack AS (
    SELECT h.code AS product_code, s.pack_size
    FROM {{ source('nhdw_vault_raw', 'hub_elmis_hist_product') }} h
    JOIN {{ source('nhdw_vault_business', 'v_sat_elmis_hist_product_current') }} s USING (hk_elmis_hist_product)
),

base AS (
    SELECT d.facility_code, d.facility_type_code, d.product_code, d.product_name,
           d.programme_id, d.programme_name, d.district_code, d.district_name,
           d.region_id, d.region_name, d.month_id AS as_of_month,
           d.stock_in_hand, d.amc, d.pipeline_assumed,
           coalesce(r.recent_demand, 0)          AS recent_demand,
           po.max_stock_months, po.eop_months, pk.pack_size,
           pa.lead_time_days, pa.review_period_months
    FROM {{ ref('mart_pct_demand_month') }} d
    JOIN anchor a ON a.month_id = d.month_id
    LEFT JOIN recent r USING (facility_code, product_code, programme_id)
    LEFT JOIN policy po USING (facility_type_code)
    LEFT JOIN pack   pk USING (product_code)
    CROSS JOIN params pa
    WHERE d.tracer
),

sized AS (
    SELECT b.*,
           b.max_stock_months * b.amc                                   AS target_stock,
           b.eop_months * b.amc                                         AS emergency_level,
           CASE WHEN b.amc > 0 THEN round(b.stock_in_hand / b.amc, 2) END AS months_of_stock,
           CASE
             WHEN b.stock_in_hand IS NULL                               THEN 'unknown'
             WHEN b.stock_in_hand <= 0                                  THEN 'stocked_out'
             WHEN coalesce(b.amc, 0) <= 0 AND b.recent_demand > 0       THEN 'unknown'
             WHEN coalesce(b.amc, 0) <= 0                               THEN 'no_recent_demand'
             WHEN b.stock_in_hand / b.amc < b.eop_months                THEN 'below_eop'
             WHEN b.stock_in_hand / b.amc <= b.max_stock_months         THEN 'within_policy'
             ELSE 'over_max'
           END                                                          AS risk_band,
           (b.stock_in_hand IS NULL)                                    AS flag_missing_stock,
           (coalesce(b.amc, 0) <= 0 AND b.recent_demand > 0)            AS flag_amc_missing,
           (coalesce(b.amc, 0) <= 0 AND b.recent_demand <= 0)           AS flag_no_recent_demand,
           (b.pack_size IS NULL)                                        AS flag_pack_size_missing
    FROM base b
),

need AS (
    SELECT s.*,
           CASE WHEN s.amc > 0 AND s.stock_in_hand IS NOT NULL
                THEN greatest(s.target_stock - greatest(s.stock_in_hand, 0), 0) END AS replenishment_units_excl_pipeline,
           CASE WHEN s.amc > 0 AND s.stock_in_hand IS NOT NULL
                THEN greatest(s.target_stock - greatest(s.stock_in_hand, 0) - coalesce(s.pipeline_assumed, 0), 0) END AS replenishment_units_incl_pipeline,
           CASE WHEN s.amc > 0 AND s.stock_in_hand IS NOT NULL
                THEN greatest(s.stock_in_hand - s.target_stock, 0) END AS surplus_units,
           CASE WHEN s.amc > 0 AND s.stock_in_hand IS NOT NULL
                THEN s.stock_in_hand - s.amc * s.lead_time_days / 30.0 END AS projected_stock_at_lead_time
    FROM sized s
),

district AS (
    SELECT district_code, product_code,
           sum(surplus_units)                     AS district_surplus_units,
           sum(replenishment_units_excl_pipeline) AS district_need_units
    FROM need GROUP BY 1, 2
)

SELECT n.facility_code, n.facility_type_code, n.product_code, n.product_name,
       n.programme_id, n.programme_name, n.district_code, n.district_name,
       n.region_id, n.region_name, n.as_of_month,
       'elmis_amc'::text AS demand_basis,
       n.stock_in_hand, n.amc, n.recent_demand, n.months_of_stock, n.risk_band,
       n.max_stock_months, n.eop_months, n.lead_time_days, n.review_period_months, n.pack_size,
       round(n.target_stock, 2)     AS target_stock,
       round(n.emergency_level, 2)  AS emergency_level,
       round(n.projected_stock_at_lead_time, 2) AS projected_stock_at_lead_time,
       n.pipeline_assumed,
       round(n.replenishment_units_excl_pipeline, 2) AS replenishment_units_excl_pipeline,
       round(n.replenishment_units_incl_pipeline, 2) AS replenishment_units_incl_pipeline,
       CASE WHEN n.pack_size > 1 THEN ceil(n.replenishment_units_excl_pipeline / n.pack_size)
            ELSE ceil(n.replenishment_units_excl_pipeline) END  AS replenishment_packs_excl_pipeline,
       round(n.surplus_units, 2)    AS surplus_units,
       round(d.district_surplus_units, 2) AS district_surplus_units,
       round(d.district_need_units, 2)    AS district_need_units,
       round(least(d.district_surplus_units, d.district_need_units), 2) AS district_redistributable_units,
       n.flag_missing_stock, n.flag_amc_missing, n.flag_no_recent_demand, n.flag_pack_size_missing
FROM need n
LEFT JOIN district d USING (district_code, product_code)
