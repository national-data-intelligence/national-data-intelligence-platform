# EMR Insight 17 — TB/HIV Co-infection Management

> **Source:** OpenMRS / EthioEMR **only** (single-source). **Domain:** TB.

## The question
How many patients are enrolled in **both** the TB and HIV programs (co-infected / co-managed), and what is the co-management coverage — i.e. of TB patients, what share are also in HIV care, and of HIV patients, what share are also in TB care?

## Why it matters / stakeholder
- **Primary stakeholder:** TB/HIV collaborative-activities coordinator; facility ART and TB focal persons.
- **Decision it drives:** Whether the "three I's" and TB/HIV cross-referral are working — every TB patient should be HIV-tested and, if positive, on ART; every HIV patient should be screened for TB. Low co-enrolment overlap flags broken bidirectional referral.
- **Standard / framework:** WHO collaborative TB/HIV activities. Core indicators: **% of TB patients with known HIV status**, **% of HIV-positive TB patients on ART**, **% of PLHIV screened for TB**. Treatment-success in co-infected patients is reported as a distinct cohort.

## Metric definition
- **Numerator / denominator / formula:**
  - *Co-enrolled patients:* distinct `patient_id` present in a TB enrolment **and** an HIV enrolment.
  - *TB→HIV coverage:* co-enrolled / distinct TB-enrolled patients.
  - *HIV→TB coverage:* co-enrolled / distinct HIV-enrolled patients.
  - *Active co-management:* both enrolments have `date_completed IS NULL`.
- **Grain:** patient (distinct `patient_id`), de-duplicated across multiple enrolments.
- **Dimensions to slice by:** age band & sex, enrolment status of each program, registration quarter, location.

## OpenMRS source (tables & key fields)
- `patient_program` — joined to itself **twice on `patient_id`** to detect co-enrolment.
- `program` — `name IN ('TB','HIV')`.
- `person` — `gender`, `birthdate`.
- Workflow/state tables empty (as in Insight 16) — no co-management *states*, only the two enrolment facts.

## API access
- **REST:** `GET /openmrs/ws/rest/v1/programenrollment?patient={uuid}` returns all program enrolments for a patient; intersect TB & HIV client-side.
- **FHIR R4:** `GET /openmrs/ws/fhir2/R4/EpisodeOfCare?patient={uuid}` (if program→episode mapping enabled). Otherwise REST/SQL.
- **Reporting/SQL:** Cohort Builder "composition" cohort (TB cohort AND HIV cohort), or SQL below.

## Method (how to compute)
1. Build the TB enrolment set and HIV enrolment set from `patient_program` + `program`.
2. Self-join on `patient_id` to find the intersection.
3. Use distinct patient counts as denominators (a patient with two TB enrolments counts once).
4. Compute the two coverage ratios; optionally restrict to active-active for current co-management load.

```sql
-- Co-enrolled (ever) patient count
SELECT COUNT(*) AS co_enrolled
FROM (
  SELECT DISTINCT a.patient_id
  FROM patient_program a
  JOIN program pa ON a.program_id = pa.program_id AND pa.name='TB'  AND a.voided=0
  JOIN patient_program b ON a.patient_id = b.patient_id
  JOIN program pb ON b.program_id = pb.program_id AND pb.name='HIV' AND b.voided=0
) x;

-- Coverage ratios
SELECT
  (SELECT COUNT(DISTINCT patient_id) FROM patient_program pp
     JOIN program p ON pp.program_id=p.program_id WHERE p.name='TB'  AND pp.voided=0) AS tb_pts,
  (SELECT COUNT(DISTINCT patient_id) FROM patient_program pp
     JOIN program p ON pp.program_id=p.program_id WHERE p.name='HIV' AND pp.voided=0) AS hiv_pts,
  (SELECT COUNT(*) FROM (
      SELECT DISTINCT a.patient_id
      FROM patient_program a JOIN program pa ON a.program_id=pa.program_id AND pa.name='TB'
      JOIN patient_program b ON a.patient_id=b.patient_id
      JOIN program pb ON b.program_id=pb.program_id AND pb.name='HIV'
      WHERE a.voided=0 AND b.voided=0) y) AS co;

-- Active-active co-management with demographics
SELECT pe.gender, COUNT(DISTINCT a.patient_id) AS active_comanaged
FROM patient_program a
JOIN program pa ON a.program_id=pa.program_id AND pa.name='TB'
JOIN patient_program b ON a.patient_id=b.patient_id
JOIN program pb ON b.program_id=pb.program_id AND pb.name='HIV'
JOIN person pe ON a.patient_id=pe.person_id
WHERE a.voided=0 AND b.voided=0
  AND a.date_completed IS NULL AND b.date_completed IS NULL
GROUP BY pe.gender;
```

**Live numbers (current snapshot):** **71** patients are co-enrolled in TB **and** HIV. Denominators: TB ≈ distinct TB patients, HIV = 470 enrolments / 323 active. So TB→HIV overlap is on the order of ~15% of TB patients here (synthetic).

## Caveats with THIS dataset
- **GENERATED data** — keys and join method REAL and reusable; counts synthetic. See `../EMR-DATA-UNDERSTANDING.md`.
- **Co-enrolment ≠ clinical co-management.** There is no obs/state confirming HIV testing of TB patients or ART start; overlap is inferred purely from dual program membership. WHO indicators (status known, on ART, TB-screened) cannot be computed because the supporting states/obs are absent.
- Synthetic enrolment is assigned roughly independently per program, so the **overlap rate is a generator artifact**, not an epidemiological signal. Use this insight to validate the *method*, not the rate.
- De-duplicate on `patient_id` — a patient may have multiple TB or HIV enrolments; raw enrolment-pair counts would overcount.

## Follow-on questions
- Among co-enrolled patients, does TB enrolment precede or follow HIV enrolment (sequencing via `date_enrolled`)?
- Once `patient_state`/obs arrive: what is ART coverage among HIV-positive TB patients?
- Is treatment-success (Insight 16) lower in the co-infected cohort than in TB-only patients?
