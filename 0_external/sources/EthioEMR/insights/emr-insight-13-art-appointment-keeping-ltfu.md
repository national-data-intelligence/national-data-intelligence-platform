# EMR Insight 13 — ART Appointment-Keeping & Defaulter / LTFU Detection

> **Source:** OpenMRS / EthioEMR **only** (single-source). **Domain:** HIV.

## The question
Which patients on ART are **missing their refill appointments** or have a **treatment gap** large enough to flag them as **defaulters** or **lost-to-follow-up (LTFU)**? By measuring the gap between consecutive **ART Refill** encounters, who is at risk of an **interruption in treatment (IIT)** and should be traced?

## Why it matters / stakeholder
- **Primary stakeholder:** HIV program coordinator / adherence & retention officer; the case manager who runs the defaulter-tracing list.
- **Decision it drives:** Generates the **actionable tracing worklist** — who to call/visit this week. Directly affects retention (the 2nd 95) and downstream viral suppression (the 3rd 95).
- **Standard / framework:** WHO/PEPFAR **IIT (interruption in treatment)** definition — a patient is in interruption when **>28 days late** for a scheduled refill/appointment; **LTFU** is conventionally a gap of **≥90 days** with no contact. (PEPFAR **TX_ML** captures those who interrupted.)

## Metric definition
- **Missed appointment / late:** gap between consecutive ART Refill encounters (or between last refill and "today") exceeds the expected refill interval + grace (e.g. **>28 days late**).
- **Defaulter / IIT:** late by the IIT threshold (>28 days past expected return).
- **LTFU:** no ART Refill encounter for **≥90 days** and still flagged active (`date_completed IS NULL`).
- **Numerator/denominator:** `LTFU rate = (active patients with last-refill gap ≥90d) / (active ART patients)`.
- **Grain:** patient (current status) and patient-gap (each inter-refill interval, for distribution analysis).
- **Dimensions to slice by:** sex, age band, days-overdue band (1–28 / 29–89 / 90+), enrolment cohort, time.

## OpenMRS source (tables & key fields)
- `encounter` + `encounter_type` — **"ART Refill"** (encounter_type_id **21**; **4,349 encounters**, **2,139 distinct patients**). `encounter_datetime` is the refill date; the **ordered sequence per patient** yields the gaps.
- `patient_program` — `program_id=1` (HIV), `date_completed IS NULL` to scope the *active* denominator.
- `person` — `gender`, `birthdate` for disaggregation.
- **Expected-interval source:** ideally the *next-appointment* date is stored as an `obs` (a "Return visit date" concept) or in `encounter`'s scheduling — **but in this dataset only numeric lab obs exist** (no appointment-date obs). So the expected interval must be **assumed** (e.g. 30/60/90-day refill) or **inferred** from the patient's own median inter-refill gap.
- **EMPTY:** `patient_state` (0 rows) — no recorded "LTFU" state; the flag is **derived** entirely from refill-gap arithmetic.

## API access
- **REST:** `GET /openmrs/ws/rest/v1/encounter?patient={uuid}&encounterType={artRefillUuid}&v=custom:(encounterDatetime)` then diff consecutive datetimes client-side. The KenyaEMR/Appointment modules may expose `/openmrs/ws/rest/v1/appointmentscheduling/appointment` if scheduling is used.
- **FHIR R4:** `GET /openmrs/ws/fhir2/R4/Encounter?type={artRefill}&patient={id}&_sort=date`; if an Appointment resource is populated, `GET /openmrs/ws/fhir2/R4/Appointment?patient={id}&status=noshow`.
- **Reporting/SQL:** the gap/LTFU computation is a window-function job — run in SQL or a Reporting cohort ("active HIV with no ART Refill in last 90 days"), materialised daily for the tracing list.

## Method (how to compute)
1. For each patient, order ART Refill encounters by `encounter_datetime`; compute the **gap to the previous refill** with `LAG()`.
2. Compute **days since last refill** as `DATEDIFF(reporting_date, MAX(encounter_datetime))` per patient.
3. Classify: `≤28` on-time, `29–89` late/IIT-risk, `≥90` LTFU.
4. Restrict the LTFU/defaulter list to **active** HIV enrolees (`date_completed IS NULL`) — otherwise you flag patients who legitimately exited.
5. Disaggregate counts by sex/age band; export the patient-level overdue list for tracing.

```sql
-- (a) Inter-refill gap distribution (per patient, consecutive refills)
WITH refills AS (
  SELECT e.patient_id,
         e.encounter_datetime AS dt,
         LAG(e.encounter_datetime) OVER (
            PARTITION BY e.patient_id ORDER BY e.encounter_datetime) AS prev_dt
  FROM encounter e
  JOIN encounter_type et ON e.encounter_type = et.encounter_type_id
  WHERE et.name = 'ART Refill'
)
SELECT patient_id, dt, DATEDIFF(dt, prev_dt) AS gap_days
FROM refills
WHERE prev_dt IS NOT NULL
ORDER BY gap_days DESC;

-- (b) Current LTFU / defaulter worklist (active HIV patients, by days overdue)
WITH last_refill AS (
  SELECT e.patient_id, MAX(e.encounter_datetime) AS last_dt
  FROM encounter e
  JOIN encounter_type et ON e.encounter_type = et.encounter_type_id
  WHERE et.name = 'ART Refill'
  GROUP BY e.patient_id
)
SELECT lr.patient_id,
       lr.last_dt,
       DATEDIFF(CURDATE(), lr.last_dt) AS days_since_refill,
       CASE
         WHEN DATEDIFF(CURDATE(), lr.last_dt) >= 90 THEN 'LTFU'
         WHEN DATEDIFF(CURDATE(), lr.last_dt) >  28 THEN 'IIT / late'
         ELSE 'on-time'
       END AS status
FROM last_refill lr
JOIN patient_program pp
     ON pp.patient_id = lr.patient_id
    AND pp.program_id = 1
    AND pp.date_completed IS NULL          -- active only
ORDER BY days_since_refill DESC;
```

## Caveats with THIS dataset
- **No scheduled next-appointment date.** Only numeric lab obs exist — there is **no "Return visit date" obs** to define "late". The IIT/LTFU thresholds here are **assumed against a fixed refill interval** (or the patient's own median gap), not against a recorded appointment. This is the single biggest interpretive caveat; flag it on every tracing report.
- **Care-state table empty.** `patient_state` (0 rows) means LTFU is **fully derived** from refill gaps — no recorded state corroborates it. Logic is reusable on real KenyaEMR data; numbers here are synthetic.
- **Refills not constrained to HIV enrolees.** 2,139 patients have refills vs 470 HIV-enrolled (`../EMR-DATA-UNDERSTANDING.md` §0). The active-only filter (step 4) is essential or the LTFU list balloons with non-HIV refill records.
- **Synthetic timing.** Refill datetimes are generated, so gap distributions are artefacts — but the windowing method is production-grade. Refill dates span **2023-06-10 → 2026-06-10**; use a fixed reporting date, not `CURDATE()`, for reproducibility.
- **No voids/updates** (`voided=0`, `date_changed` NULL everywhere) — so no cancelled-appointment noise, but also no record of a corrected/back-dated visit.

## Follow-on questions
- Of LTFU-flagged patients, how many later **return** (silent re-engagement) — i.e. what is the true vs apparent IIT rate?
- Do patients with frequent late refills also show **higher viral load / non-suppression** (link Insight 14)?
- Which **age-sex strata** default most (e.g. young men) to target differentiated service-delivery models?
