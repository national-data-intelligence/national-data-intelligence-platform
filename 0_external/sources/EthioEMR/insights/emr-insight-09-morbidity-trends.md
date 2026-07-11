# EMR Insight 09 — Morbidity Trends Over Time

> **Source:** OpenMRS / EthioEMR only (single-source). **Domain:** Morbidity.

## The question
**Which conditions are rising or falling over time?** For each leading diagnosis, how does its monthly count (and its share of total morbidity) move month-over-month across the 2023-06 → present span?

## Why it matters / stakeholder
- **Primary stakeholder:** Disease-surveillance / IDSR officer and the clinical director.
- **Decision it drives:** Early detection of emerging outbreaks or seasonal surges, proactive commodity restocking ahead of a rising condition, and de-prioritizing conditions in decline.
- **Standard / framework:** WHO IDSR trend monitoring and threshold/alert logic; HMIS time-series of leading causes; classic epidemiological-curve analysis.

## Metric definition
- **Numerator:** monthly count of a diagnosis concept.
- **Denominator:** total diagnoses that month (for share-of-morbidity trend) or distinct patients.
- **Formula:** `mom_change(dx,m) = count(dx,m) − count(dx,m−1)`; `share(dx,m) = count(dx,m) / total_dx(m)`; optionally a 3-month moving average to de-noise.
- **Grain:** one row per `diagnosis concept × month`.
- **Dimensions to slice by:** location, age band, sex, certainty, ICD-10 chapter.

## OpenMRS source (tables & key fields)
- `encounter_diagnosis` — `diagnosis_coded` (concept_id, all 2,144 populated), `encounter_id`, `patient_id`, `dx_rank`, `certainty`, `voided`.
- `encounter` — `encounter_datetime` supplies the **time axis** (join `encounter_diagnosis.encounter_id → encounter.encounter_id`). Note `encounter_diagnosis` itself has no clinical date column you should rely on; use the parent encounter's datetime.
- `concept_name` — decode (`locale='en'`, `concept_name_type='FULLY_SPECIFIED'`); aggregate on `concept_id` (duplicate-name gotcha).
- Span 2023-06-10 → "yesterday"; `date_created` reliable, `date_changed` NULL.

## API access
- **REST:** there is no direct "diagnosis trend" endpoint — pull diagnoses with their encounter datetime via `GET /openmrs/ws/rest/v1/encounter?fromdate=...&todate=...&v=custom:(encounterDatetime,diagnoses:(diagnosis,rank))` and bucket by month, or use SQL.
- **FHIR R4:** `GET /openmrs/ws/fhir2/R4/Condition?recorded-date=ge2023-06-01&_count=200` and paginate; bucket `Condition.recordedDate` by month client-side.
- **Reporting/SQL:** the month×concept pivot below is the canonical route.

## Method (how to compute)
1. Join `encounter_diagnosis` to `encounter` to obtain `encounter_datetime`; derive `ym = DATE_FORMAT(...,'%Y-%m')`.
2. Group by `diagnosis_coded × ym`; count diagnoses; attach one name.
3. Compute month-over-month delta and share-of-month using window functions (`LAG`, `SUM() OVER (PARTITION BY ym)`).
4. For a focused trend, restrict to the top-N concepts from Insight 08, then plot each as a line; optionally apply a 3-month moving average.
5. Drop or flag the trailing partial month (rolling window ends "yesterday").

```sql
-- Monthly trend for the top diagnoses, with MoM delta and share-of-month
WITH dx AS (
  SELECT  d.diagnosis_coded                          AS concept_id,
          DATE_FORMAT(e.encounter_datetime,'%Y-%m')  AS ym,
          COUNT(*)                                   AS dx_count
  FROM        encounter_diagnosis d
  JOIN        encounter e ON e.encounter_id = d.encounter_id
  WHERE       d.voided = 0
  GROUP BY    d.diagnosis_coded, ym
)
SELECT  dx.ym,
        dx.concept_id,
        ANY_VALUE(cn.name)                                            AS diagnosis,
        dx.dx_count,
        dx.dx_count - LAG(dx.dx_count) OVER (PARTITION BY dx.concept_id ORDER BY dx.ym) AS mom_delta,
        ROUND(100 * dx.dx_count / SUM(dx.dx_count) OVER (PARTITION BY dx.ym), 2)        AS pct_of_month
FROM        dx
JOIN        concept_name cn
       ON   cn.concept_id = dx.concept_id
      AND   cn.locale = 'en'
      AND   cn.concept_name_type = 'FULLY_SPECIFIED'
GROUP BY    dx.ym, dx.concept_id, dx.dx_count
ORDER BY    dx.concept_id, dx.ym;
```

```sql
-- 3-month moving average for one concept (de-noised trend line)
WITH m AS (
  SELECT  DATE_FORMAT(e.encounter_datetime,'%Y-%m') AS ym, COUNT(*) AS c
  FROM    encounter_diagnosis d
  JOIN    encounter e ON e.encounter_id = d.encounter_id
  WHERE   d.voided = 0
    AND   d.diagnosis_coded = :concept_id          -- e.g. the URI concept
  GROUP BY ym
)
SELECT ym, c,
       ROUND(AVG(c) OVER (ORDER BY ym ROWS BETWEEN 2 PRECEDING AND CURRENT ROW),2) AS ma3
FROM   m ORDER BY ym;
```

## Caveats with THIS dataset
- **No real trends exist here.** With only 2,144 diagnoses spread thinly over 36 months, each condition averages a handful per month; the month-to-month wobble is **sampling noise from the generator, not epidemiology.** Do not infer "Pneumonia is rising." The deliverable is the *trend method* (month×concept, MoM delta, moving average), which will run unchanged on the real distro. See `../EMR-DATA-UNDERSTANDING.md`.
- **Synthetic data** — structure real and warehouse-ready, content generated; no record updates or voids.
- **Low counts → unstable shares.** Share-of-month and MoM% are volatile at these volumes; require a minimum monthly base (e.g. ≥5) before drawing a line, and prefer moving averages.
- **Trailing partial month** is always incomplete (rolling end date) — exclude from trend conclusions.
- **Concept fragmentation** (e.g. "Gastritis" vs "Acute Gastritis") splits a true trend across concepts; roll up to ICD-10 chapter for a stable signal.
- **Diagnosis date = parent encounter datetime**; `encounter_diagnosis` has no independent reliable clinical date.

## Follow-on questions
- Once on real data: build IDSR-style **alert thresholds** (e.g. count exceeding mean + 2·SD of the prior N weeks) per priority condition.
- Seasonal decomposition of respiratory and diarrheal diagnoses against the rainy season (link Insight 07).
- Are rising conditions **geographically concentrated** (outbreak signal) — diagnosis × location × month?
- Cohort view: incidence of new diagnoses per 1,000 active patients per month (EMR-internal denominator only — single-source).
