# EMR Insight 12 — HIV Treatment Cohort & Active-on-ART

> **Source:** OpenMRS / EthioEMR **only** (single-source). **Domain:** HIV.

## The question
How many patients are **enrolled in the HIV program**, how many are **currently active** versus **exited**, and what is the trend in **ART-refill activity** over time? In PEPFAR terms: what is the **TX_CURR-style** count of patients currently on treatment, and how is the treatment cohort growing or shrinking?

## Why it matters / stakeholder
- **Primary stakeholder:** HIV program coordinator; PEPFAR/Global Fund M&E.
- **Decision it drives:** ARV commodity forecasting (how many patients to keep supplied), site-level performance review, and identifying whether the cohort is growing (good linkage) or leaking (retention problem).
- **Standard / framework:** WHO/PEPFAR **95-95-95** cascade — this insight measures the **2nd 95** (of those diagnosed, the share **on treatment**). The active-on-ART count is the analogue of PEPFAR **TX_CURR** (currently receiving ART). Cohort growth ties to **TX_NEW** (newly initiated).

## Metric definition
- **Enrolled (cumulative):** distinct patients ever in the HIV program. **Live: 470 enrolments.**
- **Active on program (TX_CURR proxy):** HIV enrolments with `date_completed IS NULL`. **Live: 323 active.**
- **Active on ART (refined TX_CURR):** active HIV patients with an **ART Refill encounter in the trailing window** (e.g. last 90–180 days) — the encounter-derived definition (see Caveats: care-state tables are empty).
- **Exited:** HIV enrolments with `date_completed` populated (≈ 147 = 470 − 323; reason not modelled as a workflow state here).
- **Grain:** patient (one HIV enrolment per patient assumed); refill trend at month grain.
- **Dimensions to slice by:** sex, age band, enrolment month/cohort, time-since-enrolment, active/exited status.

## OpenMRS source (tables & key fields)
- `patient_program` — `program_id` (HIV = **1**), `patient_id`, `date_enrolled`, `date_completed` (NULL = active; populated = exited). HIV enrol dates span **2023-06-11 → 2026-06-10**.
- `program` — `program_id` → `name` ('HIV').
- `encounter` + `encounter_type` — **"ART Refill"** (encounter_type_id **21**, **4,349 encounters**, **2,139 distinct patients**) is the refill-activity signal driving the trend and the "active on ART" refinement. `encounter_datetime` is the activity timestamp.
- `person` — `gender`, `birthdate` for disaggregation.
- **EMPTY tables (critical):** `program_workflow`, `program_workflow_state`, `patient_state` all have **0 rows** — so formal HIV care states (On ART / LTFU / Restart / Transferred-out) **cannot** be read from `patient_state`. Status must be **derived** from program dates + ART Refill activity.

## API access
- **REST:** `GET /openmrs/ws/rest/v1/program` (program list); `GET /openmrs/ws/rest/v1/programenrollment?patient={uuid}` (enrolment + completion dates); `GET /openmrs/ws/rest/v1/encounter?patient={uuid}&encounterType={artRefillUuid}` for refill history.
- **FHIR R4:** `GET /openmrs/ws/fhir2/R4/EpisodeOfCare?patient={id}` (program enrolment maps to EpisodeOfCare with period.start/end); `GET /openmrs/ws/fhir2/R4/Encounter?type={artRefill}&date=ge{d}` for refill encounters.
- **Reporting/SQL:** the cohort counts and monthly TX_CURR trend are best computed in SQL / the Reporting module's cohort definitions (active-enrolment + recent-refill cohorts), materialised monthly in the warehouse.

## Method (how to compute)
1. **Cumulative ever-enrolled:** `COUNT(DISTINCT patient_id)` where `program_id=1`.
2. **Active (program-state proxy):** same, restricted to `date_completed IS NULL`.
3. **Active-on-ART (refined):** intersect active enrolees with patients having an **ART Refill** encounter within the trailing N days of the reporting date (N = 90 standard, 180 generous).
4. **Refill activity trend:** count ART Refill encounters (and distinct patients) per month → the treatment-engagement curve.
5. **Cohort/new-initiation trend:** count HIV enrolments by `date_enrolled` month (TX_NEW proxy).

```sql
-- (a) Cohort summary: cumulative, active, exited
SELECT
  COUNT(*)                                   AS ever_enrolled,
  SUM(date_completed IS NULL)                AS active_on_program,   -- TX_CURR proxy
  SUM(date_completed IS NOT NULL)            AS exited
FROM patient_program
WHERE program_id = 1;

-- (b) Refined "active on ART": active enrolee WITH a refill in the last 180 days
SELECT COUNT(DISTINCT pp.patient_id) AS active_on_art
FROM patient_program pp
JOIN encounter e        ON e.patient_id = pp.patient_id
JOIN encounter_type et  ON e.encounter_type = et.encounter_type_id
WHERE pp.program_id = 1
  AND pp.date_completed IS NULL
  AND et.name = 'ART Refill'
  AND e.encounter_datetime >= DATE_SUB(CURDATE(), INTERVAL 180 DAY);

-- (c) Monthly refill-activity trend (TX_CURR engagement curve)
SELECT DATE_FORMAT(e.encounter_datetime, '%Y-%m') AS month,
       COUNT(*)                          AS refill_encounters,
       COUNT(DISTINCT e.patient_id)      AS patients_refilled
FROM encounter e
JOIN encounter_type et ON e.encounter_type = et.encounter_type_id
WHERE et.name = 'ART Refill'
GROUP BY month
ORDER BY month;
```

## Caveats with THIS dataset
- **Care-state cascade is empty — status is DERIVED, not recorded.** `patient_state` has 0 rows, so On-ART / LTFU / Restart are **inferred** from program dates + ART Refill activity. The derivation logic is structurally valid and reusable against a real KenyaEMR instance, but in *this* data no authoritative state confirms it. **State this prominently in any downstream report.**
- **ART Refill encounters exceed HIV enrolees.** 2,139 distinct patients have ART Refill encounters but only 470 are HIV-program-enrolled — the generator did not constrain refills to enrolled HIV patients. For a clean TX_CURR, **anchor on `patient_program` (program_id=1)** and treat refill activity as a refinement, not the cohort definition.
- **Synthetic cohort.** Enrolment/completion dates and refill timestamps are generated (`../EMR-DATA-UNDERSTANDING.md` §0); counts (470/323/147) are real *table* counts but not real epidemiology.
- **No exit-reason granularity.** `date_completed` marks exit but the *reason* (died / transferred-out / LTFU / stopped) is not modelled (no `patient_state`), so TX_CURR-net-of-attrition cannot be decomposed here.

## Follow-on questions
- Of the ~147 exited, how many are recoverable vs true attrition — and can refill gaps (Insight 13) reclassify some "active" as silently LTFU?
- What is the **net cohort change** month over month (TX_NEW in minus exits out)?
- How does active-on-ART break down by **age band and sex** (paediatric vs adult ART, men's engagement gap)?
