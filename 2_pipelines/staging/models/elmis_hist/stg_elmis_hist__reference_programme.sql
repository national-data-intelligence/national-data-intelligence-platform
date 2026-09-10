{{ config(materialized='view') }}

-- Legacy eLMIS v2 history (Zambia pattern-preserving dump) — see
-- 1_external/sources/OpenLMIS/HISTORICAL-DUMP-ANALYSIS.md. Source-aware:
-- elmis_hist entities are NEVER conflated with the v3 demo's openlmis ones.

WITH src AS (
    SELECT
        code,
        name,
        active
    FROM {{ source('raw', 'elmis_hist__reference_programme') }}
),

hashed AS (
    SELECT *,
        {{ source_record_hash(['code', 'name', 'active']) }} AS source_record_hash
    FROM src
),

deduped AS (
    SELECT *,
        row_number() OVER (PARTITION BY code ORDER BY source_record_hash) AS rn
    FROM hashed
)

SELECT
    code, name, active,
    now64() AS load_ts,
    source_record_hash
FROM deduped
WHERE rn = 1
