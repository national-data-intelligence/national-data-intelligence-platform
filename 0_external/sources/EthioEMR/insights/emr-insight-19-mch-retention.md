# EMR Insight 19 — MCH / Maternal Program Retention

> **Source:** OpenMRS / EthioEMR **only** (single-source). **Domain:** MCH.

## The question
Of mothers enrolled in the **MCH – Mother Services** program, how many remain active versus exited, and what does retention/continuity look like over time — by enrolment cohort and by time-since-enrolment?

## Why it matters / stakeholder
- **Primary stakeholder:** MCH/RMNCH coordinator; maternal-health program manager.
- **Decision it drives:** Whether mothers stay engaged across the maternal continuum (pregnancy → delivery → postnatal). Falling retention flags defaulter-tracing needs and gaps in postnatal follow-up.
- **Standard / framework:** Continuity-of-care / retention-in-care framing analogous to the PEPFAR/WHO retention cascade — share of an enrolment cohort still active at N months after enrolment. For MCH this maps onto the antenatal→postnatal continuum.

## Metric definition
- **Numerator / denominator / formula:**
  - *Active retention:* enrolments with `date_completed IS NULL` / total enrolments.
  - *Cohort retention:* of women enrolled in month M, share still active (or active for ≥N months) — `date_completed IS NULL OR date_completed >= date_enrolled + N months`.
  - *Median time on program:* median of `DATEDIFF(COALESCE(date_completed,CURDATE()), date_enrolled)`.
- **Grain:** patient_program (enrolment episode), aggregated by enrolment cohort month.
- **Dimensions to slice by:** enrolment cohort month, age band, location, status.

## OpenMRS source (tables & key fields)
- `patient_program` — `patient_id`, `program_id`, `date_enrolled`, `date_completed`, `location_id`, `voided`.
- `program` — `name = 'MCH - Mother Services'`.
- `person` — `gender`, `birthdate` (mothers expected female — see caveat).
- `encounter` (type ANC and others) — optional, to measure *activity* between enrolment and completion as a continuity signal.

## API access
- **REST:** `GET /openmrs/ws/rest/v1/programenrollment?patient={uuid}` for each woman's MCH enrolment dates; program metadata via `/program`.
- **FHIR R4:** `GET /openmrs/ws/fhir2/R4/EpisodeOfCare?patient={uuid}` (if mapped); encounters via `/Encounter?subject={uuid}`.
- **Reporting/SQL:** Cohort Builder enrolled-in-program cohort with date bounds, or SQL below.

## Method (how to compute)
1. Filter `patient_program` to the MCH program, exclude voided.
2. Active vs exited split via `date_completed`.
3. Build enrolment-cohort retention: group by `DATE_FORMAT(date_enrolled,'%Y-%m')`; within each cohort compute share still active and share retained ≥N months.
4. Compute median time-on-program. Optionally cross-check with encounter activity to flag "active but no encounters" (silent attrition).

```sql
-- Status overview + median days on program
SELECT
  SUM(date_completed IS NULL)                       AS active,
  SUM(date_completed IS NOT NULL)                   AS exited,
  ROUND(AVG(DATEDIFF(COALESCE(date_completed,CURDATE()), date_enrolled))) AS avg_days_on_pgm
FROM patient_program pp
JOIN program p ON pp.program_id=p.program_id AND p.name='MCH - Mother Services'
WHERE pp.voided=0;

-- Enrolment-cohort retention (share still active, share retained >=3 months)
SELECT
  DATE_FORMAT(date_enrolled,'%Y-%m')                AS cohort_month,
  COUNT(*)                                          AS enrolled,
  SUM(date_completed IS NULL)                       AS still_active,
  SUM(date_completed IS NULL
      OR date_completed >= DATE_ADD(date_enrolled, INTERVAL 3 MONTH)) AS retained_3m,
  ROUND(100*SUM(date_completed IS NULL OR
        date_completed >= DATE_ADD(date_enrolled, INTERVAL 3 MONTH))/COUNT(*),1) AS pct_retained_3m
FROM patient_program pp
JOIN program p ON pp.program_id=p.program_id AND p.name='MCH - Mother Services'
WHERE pp.voided=0
GROUP BY cohort_month
ORDER BY cohort_month;

-- Silent attrition: active enrolments with no encounter in last 90 days
SELECT COUNT(*) AS active_no_recent_encounter
FROM patient_program pp
JOIN program p ON pp.program_id=p.program_id AND p.name='MCH - Mother Services'
WHERE pp.voided=0 AND pp.date_completed IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM encounter e
    WHERE e.patient_id=pp.patient_id AND e.voided=0
      AND e.encounter_datetime >= DATE_SUB(CURDATE(), INTERVAL 90 DAY));
```

**Live numbers (current snapshot):** MCH – Mother Services = **406 enrolments**, **276 active**, **130 exited**.

## Caveats with THIS dataset
- **GENERATED data** — structure/keys/method REAL and reusable; counts synthetic. See `../EMR-DATA-UNDERSTANDING.md`.
- **Sex anomaly:** MCH enrolments include **184 male and 222 female** persons. Real maternal enrolees must be female — this is a generator artifact. For production, filter `person.gender='F'`; here it documents a data-quality check the warehouse should enforce.
- **No within-program states/outcomes** (`patient_state` empty), so retention is inferred only from `date_completed` and (optionally) encounter recency — there is no explicit ANC→delivery→PNC stage progression to follow.
- `date_changed` is NULL, so retention is reconstructed from enrolment/exit dates only; no event history of status changes.
- Single-source: retention here is *program continuity*, not population-level service coverage.

## Follow-on questions
- After filtering to female enrolees, how does 3-month and 6-month cohort retention trend month over month?
- How much "silent attrition" exists — active enrolments with no recent encounter activity?
- Does ANC4+ completeness (Insight 18) predict longer MCH retention?
