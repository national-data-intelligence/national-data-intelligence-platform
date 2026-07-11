# EMR Insight 07 — Temporal Demand Patterns (Day-of-Week, Month, Seasonality)

> **Source:** OpenMRS / EthioEMR only (single-source). **Domain:** Operations.

## The question
**When does demand arrive?** How do encounters distribute by day-of-week, by month, and across the year — i.e. is there a weekly rhythm or a seasonal pattern to service demand that operations should plan around?

## Why it matters / stakeholder
- **Primary stakeholder:** Facility operations manager and the health-office planning unit.
- **Decision it drives:** Roster/shift planning (which weekdays need more clinicians), surge preparedness for seasonal peaks (e.g. rainy-season respiratory/diarrheal demand), and timing of outreach campaigns into low-demand windows.
- **Standard / framework:** Operational demand-forecasting / time-series capacity planning; WHO health-service workload analysis. Aligns with HMIS monthly attendance reporting and is the standard **temporal demand profiling** view.

## Metric definition
- **Numerator:** encounter count within a time bucket (day-of-week, ISO week, month, or calendar date).
- **Denominator:** for day-of-week normalization, the number of that weekday in the span; for a daily-average, the count of active days in the bucket.
- **Formula:** `avg_per_weekday(d) = encounters(d) / occurrences_of_weekday(d)`; `monthly_demand(m) = encounters(m)`.
- **Grain:** one row per calendar date (base grain), rolled up to weekday / month / season.
- **Dimensions to slice by:** location, encounter_type, patient age band, diagnosis category (join `encounter_diagnosis`).

## OpenMRS source (tables & key fields)
- `encounter` — `encounter_datetime` (the demand timestamp), `encounter_id`, `location_id`, `encounter_type`, `voided` (=0).
- `visit` — `date_started` (alternative demand timestamp at the visit grain; note **all visits are open**, `date_stopped IS NULL`).
- `obs.obs_datetime`, `encounter.date_created` (reliable INSERT watermark; `date_changed` NULL everywhere) — secondary timestamps.
- Data spans **2023-06-10 → "yesterday"**, ~20–30 encounters/day every day.

## API access
- **REST:** `GET /openmrs/ws/rest/v1/encounter?fromdate=2024-01-01&todate=2024-12-31&v=custom:(encounterDatetime)` — paginate and bucket client-side, or far better, aggregate in SQL.
- **FHIR R4:** `GET /openmrs/ws/fhir2/R4/Encounter?date=ge2024-01-01&date=le2024-12-31` — `Encounter.period.start` is the demand instant; `_count` + paging for bulk.
- **Reporting/SQL:** direct SQL `GROUP BY` on date parts is the only sane way to compute weekday/month aggregates.

## Method (how to compute)
1. Project `encounter_datetime` to date parts: `DAYOFWEEK`, `DAYNAME`, `YEAR`, `MONTH`, `DATE_FORMAT(...,'%Y-%m')`.
2. Aggregate counts per bucket; for weekday, normalize by the number of occurrences of that weekday to avoid bias from partial months.
3. For seasonality, aggregate by calendar month-of-year across all years and inspect peaks/troughs.
4. (Optional) compute a 7-day or 30-day moving average over the daily series to expose trend vs. noise.

```sql
-- Demand by day-of-week (normalized to average per weekday occurrence)
SELECT  DAYNAME(encounter_datetime)                               AS weekday,
        COUNT(*)                                                  AS encounters,
        COUNT(DISTINCT DATE(encounter_datetime))                  AS distinct_days,
        ROUND(COUNT(*) / COUNT(DISTINCT DATE(encounter_datetime)),2) AS avg_per_day
FROM    encounter
WHERE   voided = 0
GROUP BY DAYOFWEEK(encounter_datetime), DAYNAME(encounter_datetime)
ORDER BY DAYOFWEEK(encounter_datetime);
```

Observed (live DB, 2026-06-11) — note how *flat* it is:

| Weekday | Encounters |
|---|---|
| Sunday | 3,885 |
| Monday | 3,886 |
| Tuesday | 3,819 |
| Wednesday | 3,841 |
| Thursday | 3,872 |
| Friday | 3,763 |
| Saturday | 3,707 |

```sql
-- Monthly demand series (seasonality + trend)
SELECT  DATE_FORMAT(encounter_datetime,'%Y-%m') AS ym,
        COUNT(*)                                AS encounters
FROM    encounter
WHERE   voided = 0
GROUP BY ym
ORDER BY ym;
```

```sql
-- Seasonality: average by month-of-year across all years
SELECT  MONTH(encounter_datetime)            AS mon,
        MONTHNAME(encounter_datetime)        AS month_name,
        COUNT(*)                             AS encounters,
        COUNT(DISTINCT YEAR(encounter_datetime)) AS years_seen,
        ROUND(COUNT(*) / COUNT(DISTINCT YEAR(encounter_datetime)),1) AS avg_per_year
FROM    encounter
WHERE   voided = 0
GROUP BY MONTH(encounter_datetime), MONTHNAME(encounter_datetime)
ORDER BY mon;
```

Monthly totals are likewise near-flat (e.g. 2023-07 = 754, 2023-08 = 770, 2023-09 = 741, 2023-10 = 744, 2023-11 = 743).

## Caveats with THIS dataset
- **The temporal pattern is an ARTIFACT, not real demand.** This is the single most important caveat for this insight. The generator emits a roughly **constant ~20–30 encounters/day, every day including weekends**, so the weekday spread (3,707–3,886, ~5% range) and the monthly series are essentially uniform noise. **There is no real weekly rhythm or seasonality here.** A real EthioEMR would show pronounced weekday peaks (Mon/Tue), near-zero weekends at health posts, and rainy-season (Jun–Sep) morbidity surges. Report the method; do not report these numbers as demand findings.
- **Synthetic data overall** — structure real, content generated. See `../EMR-DATA-UNDERSTANDING.md`.
- **Span ends "yesterday" by construction** (rolling window), so the latest month is always partial — exclude or annotate it in any trend chart.
- **`encounter_datetime` vs `date_created`:** here they track closely, but in production `encounter_datetime` is the clinical event time (use for demand) while `date_created` is the data-entry watermark (use for latency/backlog analysis).
- **No timezone column** on the timestamps; assume facility-local time and document the assumption for the warehouse.

## Follow-on questions
- Once the real distro replaces this data: is there a genuine Monday peak, and how large is the weekend drop at health-post level?
- Do seasonal respiratory/diarrheal diagnoses (join `encounter_diagnosis`) track the Ethiopian rainy season?
- Data-entry latency: distribution of `date_created − encounter_datetime` as a backlog / timeliness KPI.
- Within-week vs. within-month variance by location — which sites are "spiky" and need flexible staffing?
