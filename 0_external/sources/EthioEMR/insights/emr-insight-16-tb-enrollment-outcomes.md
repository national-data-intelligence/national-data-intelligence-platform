# EMR Insight 16 — TB Enrollment & Treatment Outcomes

> **Source:** OpenMRS / EthioEMR **only** (single-source). **Domain:** TB.

## The question
How many patients are enrolled in the TB program, how many are still on treatment versus exited, and — to the extent the data allows — what is the treatment-outcome breakdown of a TB enrolment cohort (cured / completed / died / lost-to-follow-up / failed)?

## Why it matters / stakeholder
- **Primary stakeholder:** TB program coordinator / NTP (National TB Programme) M&E officer; facility TB focal person.
- **Decision it drives:** Whether the facility is retaining TB patients to the end of their regimen, where patients are dropping off, and whether the treatment-success rate clears the WHO 90% target. Feeds the quarterly TB cohort report and resupply forecasting.
- **Standard / framework:** WHO TB treatment-outcome cohort. Standard mutually-exclusive categories: **Cured, Treatment completed, Died, Treatment failed, Lost to follow-up (LTFU), Not evaluated**. Treatment success = cured + completed. Cohorts are analysed by registration quarter, evaluated ~12 months later.

## Metric definition
- **Numerator / denominator / formula:**
  - *Enrolment:* count of `patient_program` rows where `program.name = 'TB'`.
  - *Active (on treatment):* `date_completed IS NULL`.
  - *Exited cohort:* `date_completed IS NOT NULL`.
  - *Treatment success rate (best achievable here):* exited-and-completed / total registered in the cohort window. **NB:** see caveat — true WHO outcome split is not recordable in this dataset.
- **Grain:** patient_program (one enrolment episode). A patient may have >1 TB enrolment over time.
- **Dimensions to slice by:** registration quarter (`date_enrolled`), age band & sex (`person.birthdate`, `person.gender`), enrolment status, location (`location_id`).

## OpenMRS source (tables & key fields)
- `patient_program` — `patient_program_id`, `patient_id`, `program_id`, `date_enrolled` (start), `date_completed` (exit; NULL = active), `outcome_concept_id` (NULL in this data), `location_id`, `voided`.
- `program` — `program_id`, `name` (filter `'TB'`).
- `program_workflow` / `program_workflow_state` / `patient_state` — **all EMPTY (0 rows)**. These are where formal stage/outcome states would live.
- `person` — `gender`, `birthdate` for demographics.

## API access
- **REST:** `GET /openmrs/ws/rest/v1/programenrollment?patient={uuid}` ; program metadata `GET /openmrs/ws/rest/v1/program`. Enrolment carries `dateEnrolled`, `dateCompleted`, `states[]` (empty here).
- **FHIR R4:** no first-class Program resource. Closest proxy is `GET /openmrs/ws/fhir2/R4/EpisodeOfCare?patient={uuid}` if mapped; otherwise use REST/SQL for program data.
- **Reporting/SQL:** KenyaEMR Reporting module cohort definitions, or direct SQL below.

## Method (how to compute)
1. Join `patient_program` to `program` on `program_id`, filter `name='TB'`, exclude voided.
2. Bucket each enrolment by `date_completed IS NULL` (active) vs not (exited).
3. Group by registration quarter for a cohort view; compute success proxy = exited / registered.
4. Slice by age/sex via `person`.

```sql
-- TB enrolment status overview
SELECT
  CASE WHEN pp.date_completed IS NULL THEN 'On treatment (active)'
       ELSE 'Exited (date_completed set)' END AS status,
  COUNT(*) AS enrolments
FROM patient_program pp
JOIN program p ON pp.program_id = p.program_id AND p.name = 'TB'
WHERE pp.voided = 0
GROUP BY status;

-- Registration-quarter cohort with completion proxy
SELECT
  YEAR(pp.date_enrolled)               AS yr,
  QUARTER(pp.date_enrolled)            AS qtr,
  COUNT(*)                             AS registered,
  SUM(pp.date_completed IS NOT NULL)   AS exited,
  ROUND(100 * SUM(pp.date_completed IS NOT NULL)/COUNT(*),1) AS pct_exited
FROM patient_program pp
JOIN program p ON pp.program_id = p.program_id AND p.name = 'TB'
WHERE pp.voided = 0
GROUP BY yr, qtr
ORDER BY yr, qtr;

-- Age/sex slice of active patients
SELECT pe.gender,
       FLOOR(DATEDIFF(CURDATE(), pe.birthdate)/365.25) AS age,
       COUNT(*) AS active
FROM patient_program pp
JOIN program p  ON pp.program_id = p.program_id AND p.name='TB'
JOIN person  pe ON pp.patient_id = pe.person_id
WHERE pp.voided=0 AND pp.date_completed IS NULL
GROUP BY pe.gender, age;
```

**Live numbers (current snapshot):** TB program = **485 enrolments**, **334 active**, **151 exited**. `date_enrolled` spans **2023-06-10 → 2026-06-01**.

## Caveats with THIS dataset
- **GENERATED data** — structure, keys and method are REAL and reusable; the content is synthetic. Reference `../EMR-DATA-UNDERSTANDING.md`.
- **No WHO outcome categories.** `program_workflow`, `program_workflow_state`, and `patient_state` are **empty**, and `outcome_concept_id` is NULL. So you **cannot** distinguish cured / died / LTFU / failed — only **active vs date_completed**. "Exited" lumps every outcome together. This is the headline limitation; the rich outcome split will arrive with the real hardened distro.
- **No record updates/voids beyond 10 voided orders;** `date_changed` is NULL, so you cannot track when an enrolment status changed, only the final state.
- A 12-month cohort evaluation window cannot be fully exercised because completion dates are synthetic and not regimen-anchored.

## Follow-on questions
- Once `patient_state` is populated, what is the true treatment-success rate by quarter and how does LTFU trend?
- What share of TB enrolments are also HIV-enrolled (→ Insight 17)?
- What is the median time from `date_enrolled` to `date_completed`, and does it match the expected 6-month regimen?
