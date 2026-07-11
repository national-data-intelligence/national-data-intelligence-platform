# EMR Insight 11 — Morbidity by Age & Sex

> **Source:** OpenMRS / EthioEMR **only** (single-source). **Domain:** Morbidity.

## The question
What are the leading causes of morbidity (top coded diagnoses), and how do they differ when **disaggregated by standard age band and sex**? Which conditions concentrate in which age-sex strata (e.g. URI in under-5s, gastritis in adults, obstetric/gynae conditions in women of reproductive age)?

This is the canonical HMIS "top-ten diagnoses by age and sex" tabulation — the disaggregation every national morbidity report demands.

## Why it matters / stakeholder
- **Primary stakeholder:** Clinical lead / district epidemiologist; HMIS / M&E officer who compiles the monthly morbidity return.
- **Decision it drives:** Staffing and commodity planning by demographic (paediatric vs adult drug/supply mix), targeting of screening campaigns, and detection of age-sex-specific signal (e.g. a rise in a condition among adolescent girls).
- **Standard / framework:** WHO/Ethiopia HMIS morbidity disaggregation. Standard age bands: **<1, 1–4, 5–14, 15–19, 20–24, 25–49, 50+**, each crossed by **sex (M/F)**. ICD-10 is the underlying classification; OpenMRS diagnoses are CIEL/ICD-coded concepts.

## Metric definition
- **Numerator:** count of coded diagnosis rows (`encounter_diagnosis`) for a given diagnosis concept, within an age-band × sex cell.
- **Denominator (for rate-style views):** distinct patients (or population) in that age-band × sex cell. For the raw morbidity table the count *is* the metric.
- **Formula:** `diagnoses[dx, band, sex] = COUNT(encounter_diagnosis rows)` grouped by diagnosis, age band, sex.
- **Grain:** one row per (diagnosis × age band × sex). Underlying grain is the diagnosis row.
- **Dimensions to slice by:** age band, sex, diagnosis rank (primary vs secondary), certainty (confirmed vs presumed), time (month/quarter of encounter), encounter type.

## OpenMRS source (tables & key fields)
- `encounter_diagnosis` — one row per coded diagnosis: `diagnosis_coded` (concept_id), `dx_rank` (1=primary), `certainty` (CONFIRMED/PRESUMED), `patient_id`, `encounter_id`.
- `concept_name` — decode `diagnosis_coded` → label via `locale='en' AND concept_name_type='FULLY_SPECIFIED'`.
- `person` — `gender` ('M'/'F'), `birthdate` for age.
- `encounter` — `encounter_datetime` (the reference date for age-at-diagnosis), `encounter_type`.
- **Live profile:** `encounter_diagnosis` holds **2,144** coded diagnosis rows. Top causes: Upper Respiratory Infection (378), Gastritis (208), Tonsillitis (111), Pneumonia (88), Allergic rhinitis (88). Population skews **50+ (1,357)** and **15–49 (1,207)**, gender M 1,463 / F 1,598.

## API access
- **REST:** `GET /openmrs/ws/rest/v1/patientdiagnoses?patient={uuid}` or `GET /openmrs/ws/rest/v1/encounter/{uuid}?v=full` (diagnoses nested). Demographics: `GET /openmrs/ws/rest/v1/person/{uuid}`.
- **FHIR R4:** `GET /openmrs/ws/fhir2/R4/Condition?patient={id}` (diagnoses surface as `Condition`); `GET /openmrs/ws/fhir2/R4/Patient/{id}` for `birthDate`/`gender`. Bulk: `Condition?_count=...&_lastUpdated=ge{date}` for incremental pulls.
- **Reporting/SQL:** the morbidity cross-tab is most efficiently built in SQL (below) or via the Reporting module's Cohort/Indicator cross-tabulation. For a warehouse, materialise the SQL nightly.

## Method (how to compute)
1. Join each diagnosis to its encounter (for the reference date) and to `person` (for sex and birthdate).
2. Compute **age at encounter** = `TIMESTAMPDIFF(YEAR, birthdate, encounter_datetime)`; bucket into the standard bands.
3. Decode the diagnosis concept to its fully-specified English name.
4. Group by (diagnosis, age band, sex); rank diagnoses within each stratum to extract the per-cell top-N.
5. Optionally restrict to `dx_rank=1` (primary diagnoses) to avoid double-counting comorbidities — and slice `certainty='CONFIRMED'`.

```sql
SELECT dx_name, sex, age_band, COUNT(*) AS dx_count
FROM (
  SELECT
    cn.name AS dx_name,
    p.gender AS sex,
    CASE
      WHEN TIMESTAMPDIFF(YEAR, p.birthdate, e.encounter_datetime) < 1  THEN '<1'
      WHEN TIMESTAMPDIFF(YEAR, p.birthdate, e.encounter_datetime) < 5  THEN '1-4'
      WHEN TIMESTAMPDIFF(YEAR, p.birthdate, e.encounter_datetime) < 15 THEN '5-14'
      WHEN TIMESTAMPDIFF(YEAR, p.birthdate, e.encounter_datetime) < 20 THEN '15-19'
      WHEN TIMESTAMPDIFF(YEAR, p.birthdate, e.encounter_datetime) < 25 THEN '20-24'
      WHEN TIMESTAMPDIFF(YEAR, p.birthdate, e.encounter_datetime) < 50 THEN '25-49'
      ELSE '50+'
    END AS age_band
  FROM encounter_diagnosis ed
  JOIN encounter e   ON ed.encounter_id = e.encounter_id
  JOIN person   p    ON ed.patient_id   = p.person_id
  JOIN concept_name cn
       ON ed.diagnosis_coded = cn.concept_id
      AND cn.locale = 'en'
      AND cn.concept_name_type = 'FULLY_SPECIFIED'
  WHERE ed.dx_rank = 1          -- primary diagnoses only
) t
GROUP BY dx_name, sex, age_band
ORDER BY dx_count DESC;
```

To get the per-stratum **top-10** (the HMIS layout), wrap the above and apply `ROW_NUMBER() OVER (PARTITION BY age_band, sex ORDER BY dx_count DESC)` and keep `rn <= 10`.

## Caveats with THIS dataset
- **Synthetic clinical content.** The data is *generated* — schema, keys, and method are real and reusable, but the *clinical pattern* (which diagnosis lands in which age-sex cell) is synthetic and should not be read as Ethiopian epidemiology. See `../EMR-DATA-UNDERSTANDING.md` §0.
- **Diagnosis volume is thin.** Only **2,144** coded diagnoses across 3,061 persons, so per-cell counts (diagnosis × band × sex) become small fast — top-10-by-stratum cells will have single-digit counts. Method is structurally valid; numbers are not yet stable.
- **Concept-name duplication.** Some diagnosis concepts carry multiple FULLY_SPECIFIED-equivalent labels (e.g. "Amoebiasis" vs "Amoebiasis, unspecified") — aggregate on `concept_id`, not on the text, for a clean morbidity list.
- **Age skew toward 50+.** The generated population over-represents 50+, so adult-band diagnoses dominate; paediatric bands (<1, 1–4) are sparse.
- **No `dx_rank`/`certainty` cleaning guaranteed** — confirm these fields are populated before filtering; if mostly NULL, drop the filter and count all diagnoses.

## Follow-on questions
- Which diagnoses show the largest **sex disparity** within the same age band (candidate gender-targeted interventions)?
- How does the age-sex morbidity profile **shift over time** (link to Insight 09, morbidity trends)?
- Do specific age-sex strata carry a higher **comorbidity load** (multiple diagnoses per encounter — link to Insight 10)?
