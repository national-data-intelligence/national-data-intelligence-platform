/*
    mart_data_quality — source × period × geography × quality-dimension.

    One row per (source, period, region/woreda) carrying up to three
    quality dimensions, unioned across ALL SIX ingested sources so the
    Admin → Quality & lineage "Source pulse" covers the whole pipeline:

      • completeness — did the expected records / reports arrive?
      • timeliness   — did they arrive within the reporting deadline?
                       (left NULL where no deadline contract exists yet)
      • validity     — did values pass basic sanity (non-negative, in
                       range, recognised code / identifier)?

    Vault convention (why the FROMs below look mixed): hubs + links are read
    from nhdw_vault_raw (business keys + fact edges), but every SATELLITE
    attribute is read from its business-vault v_*_current view. Raw sats are
    insert-only — a changed record lands as a NEW row for the same hash key —
    so joining the raw sat would SUM/COUNT the same event once per historical
    version. The v_*_current views (SELECT DISTINCT ON (hk) … latest) expose
    the same columns as their raw sat, so only the FROM changes, not the SELECT.

    Per-source derivation (real data only — no fabrication; a dimension
    is NULL where the source carries no honest signal for it yet):

      DHIS2         mart_hmis_indicator_coverage — facilities reporting
                    vs expected  → completeness.
      HCMIS         stock events (raw link + business-vault current sat) —
                    item coverage → completeness; SOH ≥ 0 → validity.
      mBrana        USSD stock logs (raw link + business-vault current sat)
                    — facilities logging vs the registered USSD facility
                    base → completeness; quantity ≥ 0 → validity.
      EthioEMR      encounters (raw hub + business-vault current sat) —
                    facility-reference presence → completeness; recognised
                    FHIR status → validity.
      MFR           organizations (raw hub + business-vault current sat) —
                    share mapped to a national FAC-id → completeness;
                    non-empty name → validity.
      EWARS/Climate mart_idsr_disease_weekly — weekly notifiable-disease
                    signal volume (reports_received). completeness/validity
                    stay NULL because no reporting-deadline / expected-report
                    contract is wired for this row yet — NOT because a source
                    is un-ingested.

    CLIMATE honesty note: weather IS a directly-ingested source
    (nhdw-raw/climate/… lands via the climate ingestor → hub_climate_week +
    v_sat_climate_week_current in the vault). The earlier "no direct ingest"
    framing was wrong and is not repeated here. This mart's EWARS/Climate row
    currently carries only the IDSR disease-surveillance case volume; the
    meteorological driver is available in the vault for a future
    completeness/validity signal but is not folded into this row yet.

    Source labels are clean, human-facing names (the raw '!'-prefixed
    record_source convention stays in the vault, not here).

    Consumed by:
      • Admin → Quality & lineage (source pulse, dimension scorecard)
      • Internal BI → Service Performance §3 outliers / compliance
      • Public dashboard → header completeness ticker
*/
WITH dhis2 AS (
    SELECT
        'DHIS2'::text                           AS source,
        month_id                                AS period_id,
        region_id,
        woreda_uid,
        AVG(coverage_pct)                       AS completeness_pct,
        NULL::numeric                           AS timeliness_pct,
        NULL::numeric                           AS validity_pct,
        SUM(facilities_reporting)::bigint       AS reports_received,
        SUM(facilities_expected)::bigint        AS reports_expected
    FROM {{ ref('mart_hmis_indicator_coverage') }}
    GROUP BY 1,2,3,4
),
hcmis AS (
    -- completeness = ITEM CATALOGUE COVERAGE: distinct items with ≥1 stock
    -- event this month over the registered item base (hub_hcmis_item).
    -- Numerator ⊆ denominator ⇒ bounded [0,100]. (The previous
    -- items÷environments ratio compared two unrelated cardinalities and
    -- produced 178.9% — caught by the dbt expression_is_true test.)
    SELECT
        'HCMIS'::text                           AS source,
        TO_CHAR(d.full_date::date,'YYYY-MM')     AS period_id,
        NULL::text                              AS region_id,
        NULL::text                              AS woreda_uid,
        100.0 * COUNT(DISTINCT lnk.hk_hcmis_item)::numeric
              / GREATEST((SELECT COUNT(*) FROM {{ source('nhdw_vault_raw', 'hub_hcmis_item') }}), 1) AS completeness_pct,
        NULL::numeric                           AS timeliness_pct,
        100.0 * COUNT(*) FILTER (WHERE sat.soh >= 0)::numeric
              / GREATEST(COUNT(*), 1)           AS validity_pct,
        COUNT(*)::bigint                        AS reports_received,
        -- expected stays NULL: received counts stock EVENTS; the item
        -- catalogue is a different unit (it only bounds completeness_pct).
        NULL::bigint                            AS reports_expected
    FROM {{ source('nhdw_vault_raw', 'lnk_hcmis_stock_event') }} lnk
    JOIN {{ source('nhdw_vault_business', 'v_sat_hcmis_stock_event_current') }} sat USING (hk_hcmis_stock_event)
    JOIN {{ source('nhdw_vault_business', 'v_sat_hcmis_date_current') }} d USING (hk_hcmis_date)
    GROUP BY 1,2
),
mbrana AS (
    -- USSD stock-on-hand logs. completeness = share of the registered USSD
    -- facility base that logged ≥1 event this period; validity = quantity ≥ 0.
    SELECT
        'mBrana'::text                          AS source,
        SUBSTRING(sat.date::text FROM 1 FOR 7)   AS period_id,      -- 'YYYY-MM'
        NULL::text                              AS region_id,
        NULL::text                              AS woreda_uid,
        100.0 * COUNT(DISTINCT lnk.hk_mbrana_ussd_facility)::numeric
              / GREATEST((SELECT COUNT(*)
                            FROM {{ source('nhdw_vault_raw', 'hub_mbrana_ussd_facility') }}), 1)
                                                AS completeness_pct,
        NULL::numeric                           AS timeliness_pct,
        100.0 * COUNT(*) FILTER (WHERE sat.quantity >= 0)::numeric
              / GREATEST(COUNT(*), 1)           AS validity_pct,
        COUNT(*)::bigint                        AS reports_received,
        NULL::bigint                            AS reports_expected
    FROM {{ source('nhdw_vault_raw', 'lnk_mbrana_stock_event') }} lnk
    JOIN {{ source('nhdw_vault_business', 'v_sat_mbrana_stock_event_current') }} sat USING (hk_mbrana_stock_event)
    WHERE sat.date::text ~ '^[0-9]{4}-[0-9]{2}'
    GROUP BY 1,2
),
ethioemr AS (
    -- FHIR encounters. completeness = share carrying a service-provider
    -- (facility) reference; validity = a recognised FHIR encounter status.
    SELECT
        'EthioEMR'::text                        AS source,
        TO_CHAR(enc.period_start::timestamp, 'YYYY-MM') AS period_id,
        SUBSTRING(enc.service_provider_reference FROM 'FAC-([A-Z]{2})-') AS region_id,
        NULL::text                              AS woreda_uid,
        100.0 * COUNT(*) FILTER (WHERE enc.service_provider_reference IS NOT NULL)::numeric
              / GREATEST(COUNT(*), 1)           AS completeness_pct,
        NULL::numeric                           AS timeliness_pct,
        100.0 * COUNT(*) FILTER (WHERE enc.status IN
                 ('planned','arrived','triaged','in-progress','onleave',
                  'finished','cancelled','entered-in-error','unknown'))::numeric
              / GREATEST(COUNT(*), 1)           AS validity_pct,
        COUNT(*)::bigint                        AS reports_received,
        NULL::bigint                            AS reports_expected
    FROM (
        SELECT sat.period_start, sat.service_provider_reference, sat.status
        FROM {{ source('nhdw_vault_raw', 'hub_ethioemr_encounter') }} h
        JOIN {{ source('nhdw_vault_business', 'v_sat_ethioemr_encounter_current') }} sat
            USING (hk_ethioemr_encounter)
        WHERE sat.period_start IS NOT NULL
    ) enc
    GROUP BY 1,2,3
),
mfr AS (
    -- Facility registry (Phase-1 seed carries Organizations). completeness =
    -- share mapped to a national FAC-id; validity = a non-empty name.
    SELECT
        'MFR'::text                             AS source,
        NULL::text                              AS period_id,      -- reference data, point-in-time
        SUBSTRING(o.identifier FROM 'FAC-([A-Z]{2})-') AS region_id,
        NULL::text                              AS woreda_uid,
        100.0 * COUNT(*) FILTER (WHERE o.identifier ~ 'FAC-[A-Z]{2}-')::numeric
              / GREATEST(COUNT(*), 1)           AS completeness_pct,
        NULL::numeric                           AS timeliness_pct,
        100.0 * COUNT(*) FILTER (WHERE o.name IS NOT NULL AND o.name <> '')::numeric
              / GREATEST(COUNT(*), 1)           AS validity_pct,
        COUNT(*)::bigint                        AS reports_received,
        NULL::bigint                            AS reports_expected
    FROM (
        SELECT sat.identifier::text AS identifier, sat.name
        FROM {{ source('nhdw_vault_raw', 'hub_mfr_organization') }} h
        JOIN {{ source('nhdw_vault_business', 'v_sat_mfr_organization_current') }} sat
            USING (hk_mfr_organization)
    ) o
    GROUP BY 1,3
),
ewars AS (
    -- Weekly notifiable-disease surveillance signal (IDSR/EWARS). We expose
    -- the honest case volume; completeness/validity stay NULL because no
    -- reporting-deadline / expected-report contract is wired for this row
    -- yet (climate weather is separately, directly ingested — see header).
    SELECT
        'EWARS/Climate'::text                   AS source,
        iso_week                                AS period_id,
        region_id                               AS region_id,
        woreda_uid                              AS woreda_uid,
        NULL::numeric                           AS completeness_pct,
        NULL::numeric                           AS timeliness_pct,
        NULL::numeric                           AS validity_pct,
        SUM(new_cases)::bigint                   AS reports_received,
        NULL::bigint                            AS reports_expected
    FROM {{ ref('mart_idsr_disease_weekly') }}
    GROUP BY 1,2,3,4
),
unioned AS (
    SELECT * FROM dhis2
    UNION ALL SELECT * FROM hcmis
    UNION ALL SELECT * FROM mbrana
    UNION ALL SELECT * FROM ethioemr
    UNION ALL SELECT * FROM mfr
    UNION ALL SELECT * FROM ewars
)

-- Timeliness wiring (DQ batch 2): each source's reporting deadline comes from
-- the governed reporting_deadlines seed (cadence 'none' = no deadline, e.g.
-- the immutable eLMIS archive). timeliness_pct itself stays NULL until a
-- source carries PER-REPORT arrival timestamps — the current loads are bulk
-- snapshots (one load_ts instant), and computing "% on time" from them would
-- fabricate a number. Live ingest-freshness IS monitored: the DQ detector
-- raises stale_ingest incidents against the dq_threshold SLAs.
SELECT
    u.*,
    dl.cadence              AS deadline_cadence,
    dl.deadline_offset_days AS deadline_offset_days,
    dl.grace_hours          AS deadline_grace_hours
FROM unioned u
LEFT JOIN {{ ref('reporting_deadlines') }} dl
       ON dl.source_key = CASE u.source WHEN 'EWARS/Climate' THEN 'Climate' ELSE u.source END
