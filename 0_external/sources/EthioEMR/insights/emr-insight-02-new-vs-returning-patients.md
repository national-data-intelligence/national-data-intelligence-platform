# EMR Insight 02 — New vs Returning Patients

> **Source:** OpenMRS / EthioEMR **only** (single-source). **Domain:** Operations.

## The question
Of the patients seen in a given period, how many are **new** (first-ever visit to this facility = acquisition) versus **returning** (a repeat visit)? How fast is the cumulative patient panel growing?

## Why it matters / stakeholder
- **Primary stakeholder:** Facility manager; program coordinators; District Health Office.
- **Decision it drives:** Distinguishes demand from *new* clients (outreach reach, catchment penetration) from continuity-of-care load (retention). A site that is "busy" purely on returns has different staffing and follow-up needs than one acquiring many new patients.
- **Standard / framework:** Patient-panel / acquisition-and-retention analytics; aligns with HMIS "new vs repeat" visit reporting and program enrolment growth.

## Metric definition
- **Numerator / denominator / formula:**
  - For each patient, `first_visit_date = MIN(date_started)` across their visits.
  - A period's **new patients** = patients whose `first_visit_date` falls in that period.
  - **Returning patients in period** = distinct patients with a visit in the period AND `first_visit_date < period_start`.
  - `new_share = new_patients / active_patients_in_period`.
  - `cumulative_panel(t) = COUNT(DISTINCT patient_id WHERE first_visit_date <= t)`.
- **Grain:** patient (first-visit attribution), rolled to month.
- **Dimensions to slice by:** time, `location_id`, visit_type of the first visit, identifier coverage (has National ID / Fayda vs MRN-only).

## OpenMRS source (tables & key fields)
- `visit` — `patient_id`, `date_started` (drives first-visit detection).
- `patient` / `person` — the canonical patient list (3,000 patients; `patient_id = person_id`).
- `patient_identifier` + `patient_identifier_type` — MRN `MRN00000001` (all 3,000) and National ID `ET`+12 digits (1,813 patients = Health ID/Fayda linkage) for slicing acquisition by ID type.
- Optionally `person.date_created` as an alternate "registration" watermark, but first **visit** is the truer acquisition event.

## API access
- **REST:** `/openmrs/ws/rest/v1/patient?q=...` for lookups; `/openmrs/ws/rest/v1/visit?patient=<uuid>&v=custom:(startDatetime)` to get a patient's visit history. No native "new vs returning" endpoint — aggregate in SQL/Reporting.
- **FHIR R4:** `/openmrs/ws/fhir2/R4/Patient` (registration), `/openmrs/ws/fhir2/R4/Encounter?patient=<id>` for per-patient history.
- **Reporting/SQL:** SQL below is the practical path; the Reporting module can express it as a cohort with a date-of-first-visit attribute.

## Method (how to compute)
1. Compute each patient's first-ever visit date (CTE).
2. Tag every visit row as `new` if its month equals the patient's first-visit month, else `returning`.
3. Aggregate per month; derive new-share and a running cumulative panel.

```sql
WITH first_visit AS (
  SELECT patient_id, MIN(date_started) AS first_dt
  FROM   visit
  GROUP  BY patient_id
)
-- New vs returning patients per month
SELECT  DATE_FORMAT(v.date_started, '%Y-%m')                         AS month,
        COUNT(DISTINCT CASE WHEN DATE_FORMAT(fv.first_dt,'%Y-%m')
              = DATE_FORMAT(v.date_started,'%Y-%m')
              THEN v.patient_id END)                                 AS new_patients,
        COUNT(DISTINCT CASE WHEN fv.first_dt < DATE_FORMAT(v.date_started,'%Y-%m-01')
              THEN v.patient_id END)                                 AS returning_patients,
        COUNT(DISTINCT v.patient_id)                                 AS active_patients
FROM    visit v
JOIN    first_visit fv ON fv.patient_id = v.patient_id
GROUP   BY month
ORDER   BY month;

-- Cumulative panel growth (acquisition curve)
WITH first_visit AS (
  SELECT patient_id, MIN(date_started) AS first_dt FROM visit GROUP BY patient_id
)
SELECT DATE_FORMAT(first_dt,'%Y-%m') AS cohort_month,
       COUNT(*)                                                AS newly_acquired,
       SUM(COUNT(*)) OVER (ORDER BY DATE_FORMAT(first_dt,'%Y-%m')) AS cumulative_panel
FROM   first_visit
GROUP  BY cohort_month
ORDER  BY cohort_month;
```

The cumulative panel asymptotes to **3,000 patients** (the closed synthetic population).

## Caveats with THIS dataset
- **"First visit at this facility" ≠ truly new to care.** With a single facility and no inter-facility linkage in this extract, acquisition is facility-scoped. Do not interpret it as a population-level incidence (and never combine with population denominators — single-source rule).
- **Synthetic acquisition curve is an artifact.** New patients drip in at a roughly constant rate against a fixed 3,000-patient pool; the panel growth shape reflects the generator, not real recruitment. Method/structure are trustworthy; the *rate* and *plateau timing* are not.
- The earliest month (2023-06) is left-censored: every patient seen then looks "new" because there is no prior history in the extract.
- 1,813/3,000 patients carry a National ID — useful for slicing, but the 60% coverage is itself synthetic.
- See `../EMR-DATA-UNDERSTANDING.md`.

## Follow-on questions
- What is the **return rate / retention** of a new-patient cohort over the following months?
- Do new patients enter via **OPD or IPD**, and via which encounter type first? (→ Insight 03)
- Does acquisition correlate with **Health ID / Fayda** registration coverage over time?
