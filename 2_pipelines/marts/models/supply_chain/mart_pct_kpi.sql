{{ config(materialized='table') }}
{#
    PCT KPI layer — Zambia eLMIS archive (bi_supply.mart_pct_kpi).

    Long format at BASE grain, one row per KPI × month × province × (programme or
    disease/category or band), each carrying its numerator and denominator. There
    are no pre-aggregated national or disease rows: a consumer computes
    sum(numerator) / sum(denominator) under whatever filters are active, so the
    region / programme / period filters stay exact and nothing double-counts
    (national = no region filter; a disease score = its categories pooled, which is
    the Global Fund handbook's step 3).

    Filter columns follow the gateway convention: region_id = eLMIS province zone
    code (identical to the active profile's region codes), programme_id = eLMIS
    programme code, month_id = 'YYYY-MM' (period windows anchor on the latest month
    in the data, so "today" is the archive's last month — never now()).

    Every KPI's full contract (numerator, denominator, formula, grain, source,
    period, target, exclusions, reference, limitation) is the seed
    pct_kpi_definitions; this model implements the rows marked source = this mart.
    SATP and reporting timeliness are NOT recomputed here — their existing marts own
    those definitions.

    osa_s8            Global Fund KPI S8 method (handbook 2023-2028 p.79-80): per
                      product category, facilities with ANY tracer of the category
                      in stock ÷ facilities expected to stock it. Source is eLMIS
                      period-end stock (the handbook's eLMIS data-source amendment),
                      not a visit-day observation. programme_id is NULL: S8 counts a
                      facility once per category across programmes.
    stockout_exposure / stockout_days_rate / mos_band   tracer products
    order_fill        all products; explicitly NOT OTIF

    Reporting schedules: facilities on a weekly schedule (e.g. WEEKLY1) submit
    several reports in one calendar month. fpm_month collapses them to ONE row per
    facility × product × month: stock state (stock_in_hand, amc) from the latest
    report in the month — the period-end position — while stockout occurrence is
    "any report that month" and additive quantities are summed across the month's
    reports, each line capped (approved at the calculated quantity; stockout days at
    reporting days) so data anomalies cannot push a rate past 100%.
#}

WITH province AS (
    SELECT d.code          AS district_code,
           p.code          AS region_id,
           ps.name         AS region_name
    FROM {{ source('nhdw_vault_raw', 'hub_elmis_hist_zone') }} d
    JOIN {{ source('nhdw_vault_business', 'v_sat_elmis_hist_zone_current') }} ds USING (hk_elmis_hist_zone)
    JOIN {{ source('nhdw_vault_raw', 'hub_elmis_hist_zone') }} p ON p.code = ds.parent_zone_code
    JOIN {{ source('nhdw_vault_business', 'v_sat_elmis_hist_zone_current') }} ps ON ps.hk_elmis_hist_zone = p.hk_elmis_hist_zone
    WHERE ds.geographic_level_code = 'District' AND ps.geographic_level_code = 'Province'
),

programme AS (
    SELECT h.code AS programme_id, s.name AS programme_name
    FROM {{ source('nhdw_vault_raw', 'hub_elmis_hist_programme') }} h
    JOIN {{ source('nhdw_vault_business', 'v_sat_elmis_hist_programme_current') }} s USING (hk_elmis_hist_programme)
),

policy AS (
    SELECT h.code AS facility_type_code, s.nominal_max_months, s.nominal_eop
    FROM {{ source('nhdw_vault_raw', 'hub_elmis_hist_facility_type') }} h
    JOIN {{ source('nhdw_vault_business', 'v_sat_elmis_hist_facility_type_current') }} s USING (hk_elmis_hist_facility_type)
),

fpm AS (
    SELECT f.*, pv.region_id, pv.region_name, pg.programme_id
    FROM {{ ref('mart_elmis_hist_facility_product_month') }} f
    JOIN province  pv ON pv.district_code = f.geographic_zone_code
    JOIN programme pg ON pg.programme_name = f.programme_name
),

fpm_month AS (
    SELECT facility_code, facility_type_code, product_code, tracer,
           month_id, (month_id || '-01')::date AS period_start,
           region_id, region_name, programme_id, programme_name,
           (array_agg(stock_in_hand ORDER BY period_start DESC))[1] AS stock_in_hand,
           (array_agg(amc           ORDER BY period_start DESC))[1] AS amc,
           bool_or(stockout_days > 0)                                AS stockout_any,
           sum(least(coalesce(stockout_days, 0), reporting_days)) FILTER (WHERE reporting_days > 0) AS stockout_days,
           sum(reporting_days) FILTER (WHERE reporting_days > 0)     AS reporting_days,
           sum(least(coalesce(quantity_approved, 0), calculated_order_quantity))
               FILTER (WHERE calculated_order_quantity > 0)          AS approved_capped,
           sum(calculated_order_quantity) FILTER (WHERE calculated_order_quantity > 0) AS calculated_order
    FROM fpm
    GROUP BY facility_code, facility_type_code, product_code, tracer, month_id,
             region_id, region_name, programme_id, programme_name
),

-- ── osa_s8: one row per facility × month × category, available if ANY tracer of
--    the category has stock (handbook step 1: no extra point for more than one) ──
osa_facility AS (
    SELECT f.month_id, f.period_start, f.region_id, f.region_name,
           c.gf_disease, c.gf_category, f.facility_code,
           bool_or(coalesce(f.stock_in_hand, 0) > 0) AS available
    FROM fpm_month f
    JOIN {{ ref('pct_gf_tracer_category') }} c ON c.product_code = f.product_code
    GROUP BY 1, 2, 3, 4, 5, 6, 7
),

osa AS (
    SELECT 'osa_s8' AS kpi_code, month_id, period_start, region_id, region_name,
           NULL::text AS programme_id, NULL::text AS programme_name,
           gf_disease AS disease, gf_category AS category,
           count(*) FILTER (WHERE available)::numeric AS numerator,
           count(*)::numeric                          AS denominator,
           90::numeric AS target
    FROM osa_facility
    GROUP BY 2, 3, 4, 5, 8, 9
),

tracer AS (SELECT * FROM fpm_month WHERE tracer),

stockout_exposure AS (
    SELECT 'stockout_exposure', month_id, period_start, region_id, region_name,
           programme_id, programme_name, NULL, NULL,
           count(*) FILTER (WHERE stockout_any)::numeric, count(*)::numeric, NULL::numeric
    FROM tracer
    GROUP BY 2, 3, 4, 5, 6, 7
),

stockout_days_rate AS (
    SELECT 'stockout_days_rate', month_id, period_start, region_id, region_name,
           programme_id, programme_name, NULL, NULL,
           sum(stockout_days), sum(reporting_days), NULL::numeric
    FROM tracer
    WHERE reporting_days > 0
    GROUP BY 2, 3, 4, 5, 6, 7
),

banded AS (
    SELECT t.*,
           CASE
             WHEN t.stock_in_hand IS NULL                    THEN NULL
             WHEN t.stock_in_hand <= 0                       THEN 'stocked_out'
             WHEN t.amc IS NULL OR t.amc <= 0                THEN NULL
             WHEN t.stock_in_hand / t.amc < p.nominal_eop    THEN 'below_eop'
             WHEN t.stock_in_hand / t.amc <= p.nominal_max_months THEN 'within_policy'
             ELSE 'over_max'
           END AS band
    FROM tracer t
    JOIN policy p USING (facility_type_code)
),

band_denominator AS (
    SELECT month_id, region_id, programme_id, count(*)::numeric AS bandable
    FROM banded WHERE band IS NOT NULL
    GROUP BY 1, 2, 3
),

mos_band AS (
    SELECT 'mos_band', b.month_id, b.period_start, b.region_id, b.region_name,
           b.programme_id, b.programme_name, NULL, b.band,
           count(*)::numeric, max(d.bandable), NULL::numeric
    FROM banded b
    JOIN band_denominator d USING (month_id, region_id, programme_id)
    WHERE b.band IS NOT NULL
    GROUP BY 2, 3, 4, 5, 6, 7, 9
),

order_fill AS (
    SELECT 'order_fill', month_id, period_start, region_id, region_name,
           programme_id, programme_name, NULL, NULL,
           sum(approved_capped), sum(calculated_order), NULL::numeric
    FROM fpm_month
    WHERE calculated_order > 0
    GROUP BY 2, 3, 4, 5, 6, 7
),

unioned AS (
    SELECT * FROM osa
    UNION ALL SELECT * FROM stockout_exposure
    UNION ALL SELECT * FROM stockout_days_rate
    UNION ALL SELECT * FROM mos_band
    UNION ALL SELECT * FROM order_fill
)

SELECT u.kpi_code, u.month_id, u.period_start, u.region_id, u.region_name,
       u.programme_id, u.programme_name, u.disease, u.category,
       u.numerator, u.denominator,
       CASE WHEN u.denominator > 0 THEN round(100 * u.numerator / u.denominator, 1) END AS value_pct,
       u.target,
       d.name AS kpi_name
FROM unioned u
JOIN {{ ref('pct_kpi_definitions') }} d USING (kpi_code)
