# EMR Insight 01 — Patient Volume & Encounter Throughput

> **Source:** OpenMRS / EthioEMR **only** (single-source). **Domain:** Operations.

## The question
How busy is the facility over time? How many **visits**, **encounters**, and **unique patients** does it handle per day, week, and month — and is that volume rising, flat, or falling?

This is the foundational throughput metric every downstream operational question builds on.

## Why it matters / stakeholder
- **Primary stakeholder:** Facility manager / Medical Director; District Health Office (capacity planning).
- **Decision it drives:** Staffing rosters, room/bed allocation, supply forecasting, and whether the site is over- or under-utilised relative to its catchment.
- **Standard / framework:** Ethiopia HMIS service-utilisation reporting; WHO district health-system performance (service output / utilisation rate).

## Metric definition
- **Numerator / denominator / formula:**
  - `visits_per_period   = COUNT(DISTINCT visit_id)` bucketed by period.
  - `encounters_per_period = COUNT(DISTINCT encounter_id)` bucketed by period.
  - `unique_patients_per_period = COUNT(DISTINCT patient_id)`.
  - Trend = period-over-period change, or a rolling 7/30-day moving average.
- **Grain:** counts roll up from `encounter` / `visit`; reporting grain = day → week → month.
- **Dimensions to slice by:** time (day / week / month / year), `location_id`, `visit_type` (OPD vs IPD), `encounter_type`.

## OpenMRS source (tables & key fields)
- `visit` — `visit_id`, `patient_id`, `visit_type_id`, `date_started`, `date_stopped`, `location_id`.
- `encounter` — `encounter_id`, `visit_id`, `patient_id`, `encounter_type`, `encounter_datetime`, `location_id`.
- `patient` / `person` — `patient_id` (= `person_id`, 1:1) for de-duplicated headcounts.
- Use `encounter_datetime` (clinical event time) for throughput; `date_created` exists as a reliable INSERT watermark if you ever need an ingestion-time view.

## API access
- **REST:** `/openmrs/ws/rest/v1/encounter?fromdate=YYYY-MM-DD&todate=YYYY-MM-DD&v=custom:(uuid,encounterDatetime,patient:(uuid))` ; `/openmrs/ws/rest/v1/visit?fromStartDate=...`.
- **FHIR R4:** `/openmrs/ws/fhir2/R4/Encounter?date=ge2025-01-01&date=le2025-01-31` ; `/openmrs/ws/fhir2/R4/Encounter?_summary=count` for fast counts.
- **Reporting/SQL:** best path for aggregates — direct SQL below, or the OpenMRS Reporting module with a SqlCohortDefinition / period indicators.

## Method (how to compute)
1. Pick the period grain (day for ops, month for trend).
2. Bucket encounters by `DATE(encounter_datetime)` and aggregate counts.
3. Compute unique patients per bucket separately (a patient with several encounters counts once).
4. Add a rolling average to smooth noise; compare consecutive periods for the trend.

```sql
-- Monthly throughput trend
SELECT DATE_FORMAT(e.encounter_datetime, '%Y-%m')        AS month,
       COUNT(DISTINCT e.visit_id)                        AS visits,
       COUNT(*)                                          AS encounters,
       COUNT(DISTINCT e.patient_id)                      AS unique_patients,
       ROUND(COUNT(*) / COUNT(DISTINCT e.visit_id), 2)   AS enc_per_visit
FROM   encounter e
WHERE  e.voided = 0
GROUP  BY month
ORDER  BY month;

-- Daily volume with a 7-day moving average of encounters
SELECT d.day, d.enc,
       ROUND(AVG(d.enc) OVER (ORDER BY d.day
             ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 1) AS enc_7day_ma
FROM (
  SELECT DATE(encounter_datetime) AS day, COUNT(*) AS enc
  FROM   encounter WHERE voided = 0
  GROUP  BY DATE(encounter_datetime)
) d
ORDER BY d.day;
```

Observed totals (live DB, 2026-06-11): **13,418 visits · 26,773 encounters · 3,000 patients**; ~2.0 encounters/visit; ~20–30 encounters/day. By year: 2023 ≈ 4,973 (half-year, starts 2023-06-10), 2024 ≈ 8,959, 2025 ≈ 8,923, 2026 ≈ 3,918 (partial).

## Caveats with THIS dataset
- **The numbers are a generator artifact, the method is not.** This is synthetic data emitting a near-constant ~20–30 encounters/day. The *structure* (visit→encounter→patient grain, keys, joins) is real and warehouse-ready; the *demand curve* is not.
- **Do not read seasonality, day-of-week, or holiday effects** — they are flat by construction, not because the facility is steady.
- The apparent 2024→2025 plateau and the low 2026 figure are calendar boundaries (data starts mid-2023, ends "yesterday"), not real utilisation change.
- `voided = 0` everywhere except 10 orders, so the `voided` filter is harmless but keep it for portability to real data.
- See `../EMR-DATA-UNDERSTANDING.md` for the full synthetic-data profile.

## Follow-on questions
- Of this volume, how much is **new vs returning** patients? (→ Insight 02)
- How does the OPD/IPD **case mix** move within the trend? (→ Insight 03)
- Does throughput concentrate on certain **locations or providers**? (→ Insight 05)
