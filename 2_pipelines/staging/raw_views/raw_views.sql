-- Raw external views over MinIO Parquet, one per canonical source object.
--
-- These are *not* the staging models — those live in 2_pipelines/staging/
-- as dbt views named `stg_<source>__<object>`. The raw views below are the
-- read-side surface that the dbt source('raw', ...) declarations resolve to.
--
-- Why pre-create them here (instead of letting dbt build s3() calls inline):
--   1. ad-hoc inspection — analysts can SELECT * FROM nhdw_staging.raw_*
--      without a dbt compile step.
--   2. Schema drift detection — a missing parquet partition surfaces here at
--      bootstrap, not deep in a dbt model.
--   3. One pass through the s3 catalogue: dbt source refs become simple
--      one-to-one mappings.
--
-- Naming convention:
--     raw_<source>__<object>     ← double underscore between source and object
--
-- Credentials: NONE in SQL — every s3() call uses the server-side
-- `nhdw_minio` named collection (mounted into ClickHouse from the
-- clickhouse-named-collections Secret), so no orchestration ever injects
-- credentials into this file.
--
-- Applied by scripts/apply_raw_views.py (the ch-raw-views Job), which makes
-- the surface RESILIENT in-cluster: absent lake tables become empty typed
-- views; columns the ingestor dropped (all-NULL in source) are NULL-patched.

USE nhdw_staging;

-- ╭─ DHIS2 ──────────────────────────────────────────────────────────────────╮
CREATE OR REPLACE VIEW raw_dhis2__data_value_sets AS
    SELECT * FROM s3(nhdw_minio, url = 'http://minio-datalake.nhdw.svc.cluster.local:9000/nhdw-raw/dhis2/data_value_sets/**/*.parquet', format = 'Parquet');

CREATE OR REPLACE VIEW raw_dhis2__organisation_units AS
    SELECT * FROM s3(nhdw_minio, url = 'http://minio-datalake.nhdw.svc.cluster.local:9000/nhdw-raw/dhis2/organisation_units/**/*.parquet', format = 'Parquet');

CREATE OR REPLACE VIEW raw_dhis2__data_elements AS
    SELECT * FROM s3(nhdw_minio, url = 'http://minio-datalake.nhdw.svc.cluster.local:9000/nhdw-raw/dhis2/data_elements/**/*.parquet', format = 'Parquet');

CREATE OR REPLACE VIEW raw_dhis2__data_sets AS
    SELECT * FROM s3(nhdw_minio, url = 'http://minio-datalake.nhdw.svc.cluster.local:9000/nhdw-raw/dhis2/data_sets/**/*.parquet', format = 'Parquet');

CREATE OR REPLACE VIEW raw_dhis2__category_combos AS
    SELECT * FROM s3(nhdw_minio, url = 'http://minio-datalake.nhdw.svc.cluster.local:9000/nhdw-raw/dhis2/category_combos/**/*.parquet', format = 'Parquet');

CREATE OR REPLACE VIEW raw_dhis2__category_option_combos AS
    SELECT * FROM s3(nhdw_minio, url = 'http://minio-datalake.nhdw.svc.cluster.local:9000/nhdw-raw/dhis2/category_option_combos/**/*.parquet', format = 'Parquet');

-- ╭─ EthioEMR (FHIR R4) ────────────────────────────────────────────────────╮
CREATE OR REPLACE VIEW raw_ethioemr__patient AS
    SELECT * FROM s3(nhdw_minio, url = 'http://minio-datalake.nhdw.svc.cluster.local:9000/nhdw-raw/ethioemr/patient/**/*.parquet', format = 'Parquet');

CREATE OR REPLACE VIEW raw_ethioemr__encounter AS
    SELECT * FROM s3(nhdw_minio, url = 'http://minio-datalake.nhdw.svc.cluster.local:9000/nhdw-raw/ethioemr/encounter/**/*.parquet', format = 'Parquet');

CREATE OR REPLACE VIEW raw_ethioemr__observation AS
    SELECT * FROM s3(nhdw_minio, url = 'http://minio-datalake.nhdw.svc.cluster.local:9000/nhdw-raw/ethioemr/observation/**/*.parquet', format = 'Parquet');

-- ╭─ HCMIS WDM ─────────────────────────────────────────────────────────────╮
CREATE OR REPLACE VIEW raw_hcmiswdm__fact_dailyrecord AS
    SELECT * FROM s3(nhdw_minio, url = 'http://minio-datalake.nhdw.svc.cluster.local:9000/nhdw-raw/hcmiswdm/fact_dailyrecord/**/*.parquet', format = 'Parquet');

CREATE OR REPLACE VIEW raw_hcmiswdm__fact_inventory AS
    SELECT * FROM s3(nhdw_minio, url = 'http://minio-datalake.nhdw.svc.cluster.local:9000/nhdw-raw/hcmiswdm/fact_inventory/**/*.parquet', format = 'Parquet');

CREATE OR REPLACE VIEW raw_hcmiswdm__vaccine_dailyrecord AS
    SELECT * FROM s3(nhdw_minio, url = 'http://minio-datalake.nhdw.svc.cluster.local:9000/nhdw-raw/hcmiswdm/vaccine_dailyrecord/**/*.parquet', format = 'Parquet');

CREATE OR REPLACE VIEW raw_hcmiswdm__vaccine_institution AS
    SELECT * FROM s3(nhdw_minio, url = 'http://minio-datalake.nhdw.svc.cluster.local:9000/nhdw-raw/hcmiswdm/vaccine_institution/**/*.parquet', format = 'Parquet');

CREATE OR REPLACE VIEW raw_hcmiswdm__commodity_product AS
    SELECT * FROM s3(nhdw_minio, url = 'http://minio-datalake.nhdw.svc.cluster.local:9000/nhdw-raw/hcmiswdm/commodity_product/**/*.parquet', format = 'Parquet');

CREATE OR REPLACE VIEW raw_hcmiswdm__dim_date AS
    SELECT * FROM s3(nhdw_minio, url = 'http://minio-datalake.nhdw.svc.cluster.local:9000/nhdw-raw/hcmiswdm/dim_date/**/*.parquet', format = 'Parquet');

CREATE OR REPLACE VIEW raw_hcmiswdm__dim_item AS
    SELECT * FROM s3(nhdw_minio, url = 'http://minio-datalake.nhdw.svc.cluster.local:9000/nhdw-raw/hcmiswdm/dim_item/**/*.parquet', format = 'Parquet');

CREATE OR REPLACE VIEW raw_hcmiswdm__dim_environment AS
    SELECT * FROM s3(nhdw_minio, url = 'http://minio-datalake.nhdw.svc.cluster.local:9000/nhdw-raw/hcmiswdm/dim_environment/**/*.parquet', format = 'Parquet');

CREATE OR REPLACE VIEW raw_hcmiswdm__vaccine_purchaseorder AS
    SELECT * FROM s3(nhdw_minio, url = 'http://minio-datalake.nhdw.svc.cluster.local:9000/nhdw-raw/hcmiswdm/vaccine_purchaseorder/**/*.parquet', format = 'Parquet');

-- ╭─ mBrana (HCMISWCloud) ──────────────────────────────────────────────────╮
CREATE OR REPLACE VIEW raw_mbrana__mflowussd_sohlogs AS
    SELECT * FROM s3(nhdw_minio, url = 'http://minio-datalake.nhdw.svc.cluster.local:9000/nhdw-raw/mbrana/mflowussd_sohlogs/**/*.parquet', format = 'Parquet');

CREATE OR REPLACE VIEW raw_mbrana__mflowussd_institutions AS
    SELECT * FROM s3(nhdw_minio, url = 'http://minio-datalake.nhdw.svc.cluster.local:9000/nhdw-raw/mbrana/mflowussd_institutions/**/*.parquet', format = 'Parquet');

CREATE OR REPLACE VIEW raw_mbrana__mflowussd_commodities AS
    SELECT * FROM s3(nhdw_minio, url = 'http://minio-datalake.nhdw.svc.cluster.local:9000/nhdw-raw/mbrana/mflowussd_commodities/**/*.parquet', format = 'Parquet');

CREATE OR REPLACE VIEW raw_mbrana__dbo_institution AS
    SELECT * FROM s3(nhdw_minio, url = 'http://minio-datalake.nhdw.svc.cluster.local:9000/nhdw-raw/mbrana/dbo_institution/**/*.parquet', format = 'Parquet');

CREATE OR REPLACE VIEW raw_mbrana__dbo_region AS
    SELECT * FROM s3(nhdw_minio, url = 'http://minio-datalake.nhdw.svc.cluster.local:9000/nhdw-raw/mbrana/dbo_region/**/*.parquet', format = 'Parquet');

CREATE OR REPLACE VIEW raw_mbrana__dbo_woreda AS
    SELECT * FROM s3(nhdw_minio, url = 'http://minio-datalake.nhdw.svc.cluster.local:9000/nhdw-raw/mbrana/dbo_woreda/**/*.parquet', format = 'Parquet');

CREATE OR REPLACE VIEW raw_mbrana__dbo_zone AS
    SELECT * FROM s3(nhdw_minio, url = 'http://minio-datalake.nhdw.svc.cluster.local:9000/nhdw-raw/mbrana/dbo_zone/**/*.parquet', format = 'Parquet');

-- ── Climate (weekly meteorological drivers; region × ISO-week) ──────────────
CREATE OR REPLACE VIEW raw_climate__weekly AS
    SELECT * FROM s3(nhdw_minio, url = 'http://minio-datalake.nhdw.svc.cluster.local:9000/nhdw-raw/climate/weekly/**/*.parquet', format = 'Parquet');
