-- Programme demo data — realistic-shape rows used by the per-programme
-- detail components in Internal BI. Idempotent: TRUNCATE + INSERT lets
-- us re-seed cleanly.
--
-- The single source table is region_code × program_code × period_month
-- × metric → numeric value. Per-programme views project it into the
-- shapes individual components want.

CREATE SCHEMA IF NOT EXISTS bi_programme;

CREATE TABLE IF NOT EXISTS bi_facility.programme_metrics (
    region_code   text NOT NULL,
    program_code  text NOT NULL,            -- HIV | TB | MALARIA | EPI | MNCH
    period_month  text NOT NULL,            -- YYYY-MM
    metric        text NOT NULL,
    value         numeric NOT NULL,
    PRIMARY KEY (region_code, program_code, period_month, metric)
);

TRUNCATE TABLE bi_facility.programme_metrics;

INSERT INTO bi_facility.programme_metrics(region_code, program_code, period_month, metric, value)
VALUES
  -- ─── HIV cascade by region (latest quarter) ─────────────────────────
  ('OR','HIV','2026-Q1','diagnosed', 226400), ('OR','HIV','2026-Q1','on_treatment', 203800), ('OR','HIV','2026-Q1','suppressed', 181000),
  ('AM','HIV','2026-Q1','diagnosed', 154700), ('AM','HIV','2026-Q1','on_treatment', 138900), ('AM','HIV','2026-Q1','suppressed', 124100),
  ('AA','HIV','2026-Q1','diagnosed', 71500),  ('AA','HIV','2026-Q1','on_treatment', 67200),  ('AA','HIV','2026-Q1','suppressed', 60800),
  ('SO','HIV','2026-Q1','diagnosed', 38200),  ('SO','HIV','2026-Q1','on_treatment', 32600),  ('SO','HIV','2026-Q1','suppressed', 27400),
  ('TI','HIV','2026-Q1','diagnosed', 47900),  ('TI','HIV','2026-Q1','on_treatment', 42100),  ('TI','HIV','2026-Q1','suppressed', 36700),
  ('SI','HIV','2026-Q1','diagnosed', 41200),  ('SI','HIV','2026-Q1','on_treatment', 37800),  ('SI','HIV','2026-Q1','suppressed', 33100),
  ('SE','HIV','2026-Q1','diagnosed', 32600),  ('SE','HIV','2026-Q1','on_treatment', 28700),  ('SE','HIV','2026-Q1','suppressed', 25300),

  -- HIV incidence trend (per region per quarter, last 4 quarters)
  ('OR','HIV','2025-Q2','new_diagnoses', 14200),
  ('OR','HIV','2025-Q3','new_diagnoses', 15100),
  ('OR','HIV','2025-Q4','new_diagnoses', 14700),
  ('OR','HIV','2026-Q1','new_diagnoses', 15300),
  ('AM','HIV','2025-Q2','new_diagnoses', 9100),
  ('AM','HIV','2025-Q3','new_diagnoses', 9700),
  ('AM','HIV','2025-Q4','new_diagnoses', 9900),
  ('AM','HIV','2026-Q1','new_diagnoses', 10400),

  -- ─── TB cascade ────────────────────────────────────────────────────
  ('OR','TB','2026-Q1','notified', 24600), ('OR','TB','2026-Q1','on_treatment', 22100), ('OR','TB','2026-Q1','treatment_success', 19800),
  ('AM','TB','2026-Q1','notified', 16200), ('AM','TB','2026-Q1','on_treatment', 14700), ('AM','TB','2026-Q1','treatment_success', 13200),
  ('AA','TB','2026-Q1','notified', 6100),  ('AA','TB','2026-Q1','on_treatment', 5800),  ('AA','TB','2026-Q1','treatment_success', 5400),
  ('SO','TB','2026-Q1','notified', 4900),  ('SO','TB','2026-Q1','on_treatment', 4300),  ('SO','TB','2026-Q1','treatment_success', 3700),
  ('TI','TB','2026-Q1','notified', 5800),  ('TI','TB','2026-Q1','on_treatment', 5200),  ('TI','TB','2026-Q1','treatment_success', 4600),
  ('SI','TB','2026-Q1','notified', 4400),  ('SI','TB','2026-Q1','on_treatment', 3900),  ('SI','TB','2026-Q1','treatment_success', 3500),

  ('OR','TB','2026-Q1','mdr_cases', 412),
  ('AM','TB','2026-Q1','mdr_cases', 287),
  ('AA','TB','2026-Q1','mdr_cases', 96),
  ('SO','TB','2026-Q1','mdr_cases', 134),

  -- ─── Malaria ────────────────────────────────────────────────────────
  ('OR','MALARIA','2026-Q1','suspected', 412600), ('OR','MALARIA','2026-Q1','tested', 388200), ('OR','MALARIA','2026-Q1','confirmed', 87400),
  ('AM','MALARIA','2026-Q1','suspected', 278100), ('AM','MALARIA','2026-Q1','tested', 261400), ('AM','MALARIA','2026-Q1','confirmed', 52300),
  ('GA','MALARIA','2026-Q1','suspected', 81200),  ('GA','MALARIA','2026-Q1','tested', 76900),  ('GA','MALARIA','2026-Q1','confirmed', 31700),
  ('BE','MALARIA','2026-Q1','suspected', 64300),  ('BE','MALARIA','2026-Q1','tested', 60800),  ('BE','MALARIA','2026-Q1','confirmed', 24100),
  ('AF','MALARIA','2026-Q1','suspected', 47200),  ('AF','MALARIA','2026-Q1','tested', 44600),  ('AF','MALARIA','2026-Q1','confirmed', 18900),
  ('SO','MALARIA','2026-Q1','suspected', 81900),  ('SO','MALARIA','2026-Q1','tested', 76200),  ('SO','MALARIA','2026-Q1','confirmed', 34800),

  -- malaria seasonality (monthly count of confirmed)
  ('OR','MALARIA','2025-10','confirmed', 32100),
  ('OR','MALARIA','2025-11','confirmed', 36400),
  ('OR','MALARIA','2025-12','confirmed', 41200),
  ('OR','MALARIA','2026-01','confirmed', 29800),
  ('OR','MALARIA','2026-02','confirmed', 28100),
  ('OR','MALARIA','2026-03','confirmed', 29500),

  -- ─── EPI (immunization coverage %) ─────────────────────────────────
  ('OR','EPI','2026-Q1','dpt3_coverage_pct',   89), ('OR','EPI','2026-Q1','measles_coverage_pct', 85), ('OR','EPI','2026-Q1','bcg_coverage_pct',     91),
  ('AM','EPI','2026-Q1','dpt3_coverage_pct',   86), ('AM','EPI','2026-Q1','measles_coverage_pct', 82), ('AM','EPI','2026-Q1','bcg_coverage_pct',     89),
  ('AA','EPI','2026-Q1','dpt3_coverage_pct',   94), ('AA','EPI','2026-Q1','measles_coverage_pct', 93), ('AA','EPI','2026-Q1','bcg_coverage_pct',     96),
  ('SO','EPI','2026-Q1','dpt3_coverage_pct',   71), ('SO','EPI','2026-Q1','measles_coverage_pct', 68), ('SO','EPI','2026-Q1','bcg_coverage_pct',     74),
  ('AF','EPI','2026-Q1','dpt3_coverage_pct',   74), ('AF','EPI','2026-Q1','measles_coverage_pct', 70), ('AF','EPI','2026-Q1','bcg_coverage_pct',     78),
  ('TI','EPI','2026-Q1','dpt3_coverage_pct',   83), ('TI','EPI','2026-Q1','measles_coverage_pct', 79), ('TI','EPI','2026-Q1','bcg_coverage_pct',     86),
  ('GA','EPI','2026-Q1','dpt3_coverage_pct',   77), ('GA','EPI','2026-Q1','measles_coverage_pct', 72), ('GA','EPI','2026-Q1','bcg_coverage_pct',     81),
  ('SI','EPI','2026-Q1','dpt3_coverage_pct',   88), ('SI','EPI','2026-Q1','measles_coverage_pct', 84), ('SI','EPI','2026-Q1','bcg_coverage_pct',     90),

  -- ─── MNCH ───────────────────────────────────────────────────────────
  ('OR','MNCH','2026-Q1','anc4_coverage_pct',         62), ('OR','MNCH','2026-Q1','skilled_birth_pct',   58), ('OR','MNCH','2026-Q1','postnatal_pct',  46),
  ('AM','MNCH','2026-Q1','anc4_coverage_pct',         57), ('AM','MNCH','2026-Q1','skilled_birth_pct',   52), ('AM','MNCH','2026-Q1','postnatal_pct',  41),
  ('AA','MNCH','2026-Q1','anc4_coverage_pct',         79), ('AA','MNCH','2026-Q1','skilled_birth_pct',   84), ('AA','MNCH','2026-Q1','postnatal_pct',  68),
  ('SO','MNCH','2026-Q1','anc4_coverage_pct',         34), ('SO','MNCH','2026-Q1','skilled_birth_pct',   28), ('SO','MNCH','2026-Q1','postnatal_pct',  21),
  ('TI','MNCH','2026-Q1','anc4_coverage_pct',         58), ('TI','MNCH','2026-Q1','skilled_birth_pct',   51), ('TI','MNCH','2026-Q1','postnatal_pct',  39),
  ('AF','MNCH','2026-Q1','anc4_coverage_pct',         38), ('AF','MNCH','2026-Q1','skilled_birth_pct',   31), ('AF','MNCH','2026-Q1','postnatal_pct',  24),
  ('SI','MNCH','2026-Q1','anc4_coverage_pct',         61), ('SI','MNCH','2026-Q1','skilled_birth_pct',   56), ('SI','MNCH','2026-Q1','postnatal_pct',  44);

-- ─── ingestion: submission funnel — real numbers per source per status ──
CREATE TABLE IF NOT EXISTS bi_facility.submission_funnel (
    period_day text NOT NULL,
    source     text NOT NULL,
    status     text NOT NULL,
    rows       int  NOT NULL,
    PRIMARY KEY (period_day, source, status)
);
TRUNCATE bi_facility.submission_funnel;
INSERT INTO bi_facility.submission_funnel VALUES
  ('2026-06-08', 'HMIS',  'accepted', 14302),
  ('2026-06-08', 'HMIS',  'rejected',   318),
  ('2026-06-08', 'Stock', 'accepted',  9281),
  ('2026-06-08', 'Stock', 'rejected',    71),
  ('2026-06-08', 'EPI',   'accepted',   612),
  ('2026-06-08', 'EPI',   'rejected',    38);

-- ─── stock-out: facility × program × commodity, current status ──────
CREATE TABLE IF NOT EXISTS bi_facility.stock_status (
    facility    text NOT NULL,
    region_code text NOT NULL,
    program_code text NOT NULL,
    drug        text NOT NULL,
    on_hand     int  NOT NULL,
    reorder_at  int  NOT NULL,
    status      text NOT NULL,
    PRIMARY KEY (facility, drug)
);
TRUNCATE bi_facility.stock_status;
INSERT INTO bi_facility.stock_status VALUES
  ('Adama Hospital',        'OR', 'HIV',     'TDF/3TC/DTG',      12,  200, 'critical'),
  ('Hawassa Health Centre', 'SI', 'TB',      'RHZE',              4,   60, 'critical'),
  ('Tigray General',        'TI', 'MALARIA', 'Artemether-LU',    88,  100, 'warning'),
  ('Gambela Referral',      'GA', 'HIV',     'Cotrimoxazole',    41,  120, 'warning'),
  ('Bahir Dar PHCU',        'AM', 'HIV',     'Cotrimoxazole',   165,  120, 'ok'),
  ('Jimma Hospital',        'OR', 'TB',      'RHZE',             29,   60, 'critical'),
  ('Dire Dawa General',     'DD', 'MALARIA', 'Artemether-LU',    72,   80, 'warning'),
  ('Mekele General',        'TI', 'EPI',     'Measles MR',      210,  150, 'ok');

-- ─── per-programme views ─────────────────────────────────────────────
CREATE OR REPLACE VIEW bi_programme.hiv_cascade_v AS
WITH q AS (
  SELECT region_code, metric, SUM(value) AS v
  FROM bi_facility.programme_metrics
  WHERE program_code = 'HIV' AND period_month = '2026-Q1'
    AND metric IN ('diagnosed','on_treatment','suppressed')
  GROUP BY region_code, metric
)
SELECT region_code,
       SUM(v) FILTER (WHERE metric = 'diagnosed')      AS diagnosed,
       SUM(v) FILTER (WHERE metric = 'on_treatment')   AS on_treatment,
       SUM(v) FILTER (WHERE metric = 'suppressed')     AS suppressed
FROM q
GROUP BY region_code;

CREATE OR REPLACE VIEW bi_programme.hiv_cascade_total_v AS
SELECT 'Diagnosed'         AS stage, SUM(diagnosed)    AS n FROM bi_programme.hiv_cascade_v UNION ALL
SELECT 'On treatment',           SUM(on_treatment)            FROM bi_programme.hiv_cascade_v UNION ALL
SELECT 'Virally suppressed',     SUM(suppressed)              FROM bi_programme.hiv_cascade_v;

CREATE OR REPLACE VIEW bi_programme.hiv_incidence_trend_v AS
SELECT period_month AS period, region_code, SUM(value)::int AS new_diagnoses
FROM bi_facility.programme_metrics
WHERE program_code = 'HIV' AND metric = 'new_diagnoses'
GROUP BY period_month, region_code
ORDER BY period_month;

CREATE OR REPLACE VIEW bi_programme.tb_cascade_total_v AS
SELECT 'Notified'           AS stage, SUM(value)::int AS n FROM bi_facility.programme_metrics WHERE program_code='TB' AND metric='notified'           UNION ALL
SELECT 'On treatment',                SUM(value)::int        FROM bi_facility.programme_metrics WHERE program_code='TB' AND metric='on_treatment'        UNION ALL
SELECT 'Treatment success',           SUM(value)::int        FROM bi_facility.programme_metrics WHERE program_code='TB' AND metric='treatment_success';

CREATE OR REPLACE VIEW bi_programme.tb_mdr_by_region_v AS
SELECT region_code, SUM(value)::int AS mdr_cases
FROM bi_facility.programme_metrics
WHERE program_code='TB' AND metric='mdr_cases'
GROUP BY region_code ORDER BY mdr_cases DESC;

CREATE OR REPLACE VIEW bi_programme.malaria_by_region_v AS
WITH q AS (
  SELECT region_code, metric, SUM(value) AS v
  FROM bi_facility.programme_metrics
  WHERE program_code='MALARIA' AND period_month='2026-Q1'
  GROUP BY region_code, metric
)
SELECT region_code,
       SUM(v) FILTER (WHERE metric='suspected')::int  AS suspected,
       SUM(v) FILTER (WHERE metric='tested')::int     AS tested,
       SUM(v) FILTER (WHERE metric='confirmed')::int  AS confirmed
FROM q GROUP BY region_code ORDER BY confirmed DESC;

CREATE OR REPLACE VIEW bi_programme.malaria_trend_v AS
SELECT period_month AS period, region_code, SUM(value)::int AS confirmed
FROM bi_facility.programme_metrics
WHERE program_code='MALARIA' AND metric='confirmed'
  AND period_month LIKE '202_-__'
GROUP BY period_month, region_code
ORDER BY period_month;

CREATE OR REPLACE VIEW bi_programme.epi_coverage_v AS
WITH q AS (
  SELECT region_code, metric, AVG(value)::int AS v
  FROM bi_facility.programme_metrics
  WHERE program_code='EPI' AND period_month='2026-Q1'
  GROUP BY region_code, metric
)
SELECT region_code,
       SUM(v) FILTER (WHERE metric='dpt3_coverage_pct')    AS dpt3,
       SUM(v) FILTER (WHERE metric='measles_coverage_pct') AS measles,
       SUM(v) FILTER (WHERE metric='bcg_coverage_pct')     AS bcg
FROM q GROUP BY region_code ORDER BY region_code;

CREATE OR REPLACE VIEW bi_programme.mnch_coverage_v AS
WITH q AS (
  SELECT region_code, metric, AVG(value)::int AS v
  FROM bi_facility.programme_metrics
  WHERE program_code='MNCH' AND period_month='2026-Q1'
  GROUP BY region_code, metric
)
SELECT region_code,
       SUM(v) FILTER (WHERE metric='anc4_coverage_pct')    AS anc4,
       SUM(v) FILTER (WHERE metric='skilled_birth_pct')    AS skilled_birth,
       SUM(v) FILTER (WHERE metric='postnatal_pct')        AS postnatal
FROM q GROUP BY region_code ORDER BY region_code;

CREATE OR REPLACE VIEW bi_facility.submission_funnel_v AS
SELECT source AS label,
       SUM(rows) FILTER (WHERE status='accepted')::int AS accepted,
       SUM(rows) FILTER (WHERE status='rejected')::int AS rejected
FROM bi_facility.submission_funnel
GROUP BY source ORDER BY accepted DESC;

CREATE OR REPLACE VIEW bi_facility.stock_status_v AS
SELECT facility, region_code, program_code, drug, on_hand, reorder_at, status
FROM bi_facility.stock_status
ORDER BY CASE status WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, facility;

-- ─── grants ──────────────────────────────────────────────────────────
GRANT USAGE  ON SCHEMA bi_facility, bi_programme TO bi_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA bi_facility, bi_programme TO bi_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA bi_facility, bi_programme
  GRANT SELECT ON TABLES TO bi_reader;
