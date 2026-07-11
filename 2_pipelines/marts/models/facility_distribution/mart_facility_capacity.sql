/*
    mart_facility_capacity — one row per facility, point-in-time.

    Combines:
      - MFR Location (preferred): GPS, ownership, type, status
      - MFR Organization fallback (Phase-1 seed has only Organizations)
      - DHIS2 OU path → region / zone / woreda derivation
      - HCMIS reporting heartbeat: facilities report stock through their
        HCMIS *environment* (sat_hcmis_facility.environment_id — the
        stock-event link has no facility FK), so the heartbeat is the max
        stock-event date of the facility's environment → online flag.

    facility_tier is the FAC-<region>-<tier>-<hash> code token
    (HP/HC/PHC/MC/PH/GH/SH/DS) — the contract the gateway fetchers
    (rm-hotspots/rm-map/rm-facilities) filter on. Never substitute the
    MFR display name here.

    Business-vault reads:
      - Every satellite goes through the v_sat_*_current views (sats are
        insert-only; raw-sat joins duplicate rows once history accumulates).
      - Cross-source facility identity (the FAC-… slug buried in HCMIS
        descriptions / MFR identifier JSON) comes from
        v_facility_resolution — the single owner of that decode — instead
        of a per-mart SUBSTRING regex. The DHIS2 leg keeps its own code
        tokens: the OU code IS the conformed facility_id, and the
        tier/region tokens are this mart's output contract.

    Consumed by:
      - All dashboards' choropleths (point overlays)
      - BI Resource §3 facility-tier composition
      - Admin → Topology side panel (facility metadata lookup)
*/
WITH dhis2 AS (
    SELECT
        sat.code AS facility_id,
        sat.name AS dhis2_name,
        sat.path AS dhis2_path,
        SPLIT_PART(sat.code, '-', 2) AS region_id,
        SPLIT_PART(sat.code, '-', 3) AS tier_id,
        sat.opening_date
    FROM {{ source('nhdw_vault_business', 'v_sat_dhis2_org_unit_current') }} sat
    WHERE sat.code LIKE 'FAC-%'
),
mfr_org_fac AS (
    SELECT
        r.facility_id,
        sat.telecom AS telecom,
        sat.part_of_reference
    FROM {{ source('nhdw_vault_business', 'v_sat_mfr_organization_current') }} sat
    JOIN {{ source('nhdw_vault_business', 'v_facility_resolution') }} r
        ON  r.hk_source_facility = sat.hk_mfr_organization
        AND r.source_system      = 'MFR.organization'
),
mfr_loc AS (
    SELECT
        r.facility_id,
        sat.longitude,
        sat.latitude,
        sat.status     AS mfr_status,
        sat.facility_type_display AS mfr_type
    FROM {{ source('nhdw_vault_business', 'v_sat_mfr_facility_current') }} sat
    JOIN {{ source('nhdw_vault_business', 'v_facility_resolution') }} r
        ON  r.hk_source_facility = sat.hk_mfr_facility
        AND r.source_system      = 'MFR.location'
),
-- Last stock-event date per HCMIS environment. Aggregated FIRST (19 envs)
-- so the env→facility fan-out below never multiplies link rows.
env_heartbeat AS (
    SELECT
        he.environment_id,
        MAX(d.full_date::date) AS last_reporting_date
    FROM {{ source('nhdw_vault_raw', 'lnk_hcmis_stock_event') }} lnk
    JOIN {{ source('nhdw_vault_raw', 'hub_hcmis_environment') }} he
        USING (hk_hcmis_environment)
    JOIN {{ source('nhdw_vault_business', 'v_sat_hcmis_date_current') }} d
        USING (hk_hcmis_date)
    GROUP BY 1
),
hcmis_heartbeat AS (
    SELECT
        r.facility_id,
        MAX(eh.last_reporting_date) AS last_reporting_date
    FROM {{ source('nhdw_vault_business', 'v_sat_hcmis_facility_current') }} sat
    JOIN {{ source('nhdw_vault_business', 'v_facility_resolution') }} r
        ON  r.hk_source_facility = sat.hk_hcmis_facility
        AND r.source_system      = 'HCMIS'
    JOIN env_heartbeat eh USING (environment_id)
    GROUP BY 1
)
SELECT
    d.facility_id,
    d.tier_id AS facility_tier,
    d.region_id,
    d.dhis2_path,
    COALESCE(mloc.mfr_status, 'unknown') AS status,
    mloc.longitude,
    mloc.latitude,
    morg.telecom,
    morg.part_of_reference,
    hb.last_reporting_date,
    d.opening_date,
    CASE WHEN hb.last_reporting_date >= (CURRENT_DATE - INTERVAL '60 days')
         THEN 'online' ELSE 'silent' END AS reporting_status
FROM dhis2 d
LEFT JOIN mfr_loc       mloc USING (facility_id)
LEFT JOIN mfr_org_fac   morg USING (facility_id)
LEFT JOIN hcmis_heartbeat hb USING (facility_id)
