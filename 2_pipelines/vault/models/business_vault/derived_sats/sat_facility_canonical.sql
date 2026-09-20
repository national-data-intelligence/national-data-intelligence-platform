/*
    sat_facility_canonical — the facility GOLDEN RECORD, versioned.

    One row per (conformed facility × canonical revision): the best value for
    each attribute chosen across the master's source records by a FIXED
    per-attribute source priority, with FIELD-LEVEL PROVENANCE (every golden
    value carries the source system it came from). Insert-only: when the
    golden attributes change — a rename lands, a steward decision re-keys a
    record into the cluster, a better source starts carrying a field — a NEW
    revision row is inserted (hashdiff gate); history is never rewritten.

    Attribute authorities (first source that HAS the value wins):
      name       MFR.location > MFR.organization > DHIS2 > HCMIS > mBrana
                 (the registry names facilities; supply systems abbreviate)
      status     MFR.location (registry operational status) > mBrana
      telecom    MFR.organization (FHIR telecom) > mBrana phone
      lat/lng    MFR.location (position) > mBrana GPS
                 — MFR Location is EMPTY in the live corpus (recorded source
                 gap), so mBrana is the live coordinate provider until the
                 replica regenerates with Location.position.
      admin area mBrana (the only source carrying woreda/zone text)

    Downstream: dims/marts can join the CURRENT revision (max load_ts per
    hk) for golden attributes instead of re-deriving per-source precedence
    locally; the *_source columns surface provenance to the UI.
*/
{{ config(
    materialized='incremental',
    on_schema_change='append_new_columns',
    schema='nhdw_vault_business'
) }}

WITH members AS (
    -- every source record in each master's cluster, tagged with the fixed
    -- source rank (lower = more authoritative for name)
    SELECT
        r.hk_facility_conformed,
        r.hk_source_facility,
        r.source_system,
        r.source_name,
        CASE r.source_system
            WHEN 'MFR.location'     THEN 1
            WHEN 'MFR.organization' THEN 2
            WHEN 'DHIS2'            THEN 3
            WHEN 'HCMIS'            THEN 4
            WHEN 'mBrana.dbo'       THEN 5
            ELSE 6 END AS source_rank
    FROM {{ ref('v_facility_resolution') }} r
),
golden_name AS (
    SELECT DISTINCT ON (hk_facility_conformed)
        hk_facility_conformed,
        source_name   AS canonical_name,
        source_system AS name_source
    FROM members
    WHERE COALESCE(source_name, '') <> ''
    ORDER BY hk_facility_conformed, source_rank
),
-- one attribute row per master from each providing source (DISTINCT ON with a
-- deterministic order: a cluster holding several records of one source must
-- not fan the golden join out into duplicate revisions)
mfr_loc_attrs AS (
    SELECT DISTINCT ON (m.hk_facility_conformed)
           m.hk_facility_conformed,
           s.status, s.latitude, s.longitude
    FROM members m
    JOIN {{ ref('v_sat_mfr_facility_current') }} s
      ON s.hk_mfr_facility = m.hk_source_facility
    WHERE m.source_system = 'MFR.location'
    ORDER BY m.hk_facility_conformed, m.hk_source_facility
),
mfr_org_attrs AS (
    SELECT DISTINCT ON (m.hk_facility_conformed)
           m.hk_facility_conformed, s.telecom
    FROM members m
    JOIN {{ ref('v_sat_mfr_organization_current') }} s
      ON s.hk_mfr_organization = m.hk_source_facility
    WHERE m.source_system = 'MFR.organization'
    ORDER BY m.hk_facility_conformed, m.hk_source_facility
),
mbrana_attrs AS (
    SELECT DISTINCT ON (m.hk_facility_conformed)
           m.hk_facility_conformed,
           s.operational_status, s.phone,
           s.latitude, s.longitude, s.woreda, s.zone
    FROM members m
    JOIN {{ ref('v_sat_mbrana_facility_current') }} s
      ON s.hk_mbrana_facility = m.hk_source_facility
    WHERE m.source_system = 'mBrana.dbo'
    ORDER BY m.hk_facility_conformed, m.hk_source_facility
),
golden AS (
    SELECT
        gn.hk_facility_conformed,
        gn.canonical_name,
        gn.name_source,
        COALESCE(ml.status,                mb.operational_status)  AS operational_status,
        CASE WHEN ml.status IS NOT NULL              THEN 'MFR.location'
             WHEN mb.operational_status IS NOT NULL  THEN 'mBrana.dbo' END AS status_source,
        COALESCE(mo.telecom,               mb.phone)               AS telecom,
        CASE WHEN mo.telecom IS NOT NULL             THEN 'MFR.organization'
             WHEN mb.phone IS NOT NULL               THEN 'mBrana.dbo' END AS telecom_source,
        COALESCE(ml.latitude::numeric,     mb.latitude)            AS latitude,
        COALESCE(ml.longitude::numeric,    mb.longitude)           AS longitude,
        CASE WHEN ml.latitude IS NOT NULL            THEN 'MFR.location'
             WHEN mb.latitude IS NOT NULL            THEN 'mBrana.dbo' END AS coord_source,
        mb.woreda,
        mb.zone,
        CASE WHEN mb.woreda IS NOT NULL              THEN 'mBrana.dbo' END AS admin_source
    FROM golden_name gn
    LEFT JOIN mfr_loc_attrs  ml USING (hk_facility_conformed)
    LEFT JOIN mfr_org_attrs  mo USING (hk_facility_conformed)
    LEFT JOIN mbrana_attrs   mb USING (hk_facility_conformed)
),
revisioned AS (
    SELECT
        golden.*,
        md5(
            COALESCE(canonical_name, '')            || '|' ||
            COALESCE(operational_status, '')        || '|' ||
            COALESCE(telecom, '')                   || '|' ||
            COALESCE(latitude::text, '')            || '|' ||
            COALESCE(longitude::text, '')           || '|' ||
            COALESCE(woreda, '')                    || '|' ||
            COALESCE(zone, '')
        ) AS hashdiff,
        CURRENT_TIMESTAMP AS load_ts,
        'BV.facility_canonical' AS record_source
    FROM golden
)
SELECT * FROM revisioned
{% if is_incremental() %}
-- insert-only revision gate against the LATEST revision only (a golden
-- record that changes back to an earlier state gets a fresh revision —
-- comparing against ALL history would silently swallow the change-back)
WHERE NOT EXISTS (
    SELECT 1
    FROM (
        SELECT DISTINCT ON (hk_facility_conformed) hk_facility_conformed, hashdiff
        FROM {{ this }}
        ORDER BY hk_facility_conformed, load_ts DESC
    ) t
    WHERE t.hk_facility_conformed = revisioned.hk_facility_conformed
      AND t.hashdiff = revisioned.hashdiff
)
{% endif %}
