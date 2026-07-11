# EMR Insight 24 — Patient Demographic & Catchment Profile

> **Source:** OpenMRS / EthioEMR **only** (single-source). **Domain:** Registry.

## The question
What is the **age–sex structure** of the patient population (the age-sex pyramid), and how are patients **distributed geographically** by registered address? This is the registry / denominator-within-EMR view — it characterises who the facility serves, purely from the EMR's own registration data (no external population denominator).

## Why it matters / stakeholder
- **Primary stakeholder:** Facility manager, M&E officer, and warehouse owner establishing an **EMR-internal denominator** for rates and cohort scoping.
- **Decision it drives:** Service planning (paediatric vs geriatric load), catchment-area understanding, equity analysis, and providing the population base for every patient-rate metric computed *within* the EMR.
- **Standard / framework:** Standard HMIS age-sex disaggregation bands (0–4 / 5–14 / 15–49 / 50+) and the demographic age-sex pyramid. **Single-source rule:** this is the EMR's own catchment; it must NOT be fused with DHIS2 / MFR / census population data — that is a separate multi-source exercise.

## Metric definition
- **Numerator:** count of unique **patients** in each (age band × sex) cell, and per address-region.
- **Denominator:** total patients (for share-of-population), or per-cell for pyramids.
- **Formula:** pyramid cell = `patients(age_band, sex)`; geographic share = `patients_in_region / total_patients`.
- **Grain:** patient (one row per person who is a patient).
- **Dimensions to slice by:** sex, age band (and finer 5-year bands), `state_province` / `county_district` / `city_village`, registration month (`date_created`).

## OpenMRS source (tables & key fields)
- `person` (3,061) — `person_id`, `gender` (M 1,463 / F 1,598), `birthdate` (1936→2026), `dead` (0 for all). Age = `TIMESTAMPDIFF(YEAR, birthdate, CURDATE())`.
- `patient` (3,000) — **filter to this**: `person ⊃ patient`; 61 persons are providers/staff, not patients. Join `patient.patient_id = person.person_id`, `patient.voided = 0`.
- `person_address` (3,043 rows, **VERSIONED / SCD2** — old rows are voided on change): `state_province`, `county_district`, `city_village`, `country`, `address1`, `postal_code` (empty), `voided`, `preferred`. **Use `voided=0` (or `preferred=1`) to get the current address only.** Current fill: country / state_province / county_district / city_village / address1 all populated for 3,000; postal_code empty.
- `person_attribute` (686) via `person_attribute_type` — Telephone (298), Blood Type (132), Email (87), Next of kin, Disability Status (8): optional enrichment, sparse.

## API access
- **REST:** `GET /openmrs/ws/rest/v1/person/{uuid}?v=full` (age, gender, preferredAddress); cohort counts via the Reporting REST resource with age/gender row filters.
- **FHIR R4:** `GET /openmrs/ws/fhir2/R4/Patient?_summary=count`, and `?birthdate=geYYYY-MM-DD&gender=female` etc. for banded counts; `Patient.address` carries state/city.
- **Reporting/SQL:** SQL below, or the Cohort Builder with Age and Gender row-definitions for the pyramid.

## Method (how to compute)
1. Restrict to `patient` (voided=0) joined to `person` — never count the 61 non-patient persons.
2. Derive age from `birthdate` at a fixed as-of date; bucket into HMIS bands.
3. Pivot age band × gender for the pyramid.
4. For geography, join the **current** `person_address` (`voided=0`) and group by region.

```sql
-- Age-sex pyramid (HMIS bands), patients only
SELECT
  CASE
    WHEN TIMESTAMPDIFF(YEAR, p.birthdate, CURDATE()) < 5  THEN '0-4'
    WHEN TIMESTAMPDIFF(YEAR, p.birthdate, CURDATE()) < 15 THEN '5-14'
    WHEN TIMESTAMPDIFF(YEAR, p.birthdate, CURDATE()) < 50 THEN '15-49'
    ELSE '50+'
  END                                AS age_band,
  p.gender,
  COUNT(*)                           AS patients
FROM patient pt
JOIN person p ON p.person_id = pt.patient_id
WHERE pt.voided = 0 AND p.voided = 0 AND p.birthdate IS NOT NULL
GROUP BY age_band, p.gender
ORDER BY FIELD(age_band,'0-4','5-14','15-49','50+'), p.gender;
```

```sql
-- Geographic catchment (current address only)
SELECT a.state_province, a.county_district,
       COUNT(DISTINCT pt.patient_id)                          AS patients,
       ROUND(100 * COUNT(DISTINCT pt.patient_id)
             / (SELECT COUNT(*) FROM patient WHERE voided=0), 1) AS pct
FROM patient pt
JOIN person_address a
  ON a.person_id = pt.patient_id AND a.voided = 0     -- current row only (SCD2)
WHERE pt.voided = 0
GROUP BY a.state_province, a.county_district
ORDER BY patients DESC;
```

## Caveats with THIS dataset
**GENERATED data — schema and method are real and reusable; demographic content is synthetic.** Reference `../EMR-DATA-UNDERSTANDING.md`.
- **`person_address` is versioned (SCD2):** old addresses are kept as `voided=1` rows. Always filter `voided=0` (or `preferred=1`) or you over-count and mix historical with current addresses. The 3,043 rows are not 3,043 distinct patients.
- **Geography is synthetic and uniform.** `state_province` values are generic labels ("Region 1"…"Region 11") spread almost evenly (~244–300 patients each) — not real Ethiopian administrative units, so no meaningful catchment concentration exists yet. Real region/woreda names arrive with the production data.
- **Filter person→patient.** 61 of 3,061 persons are providers/staff; counting `person` instead of `patient` inflates the denominator.
- `postal_code` is empty; `address1` is filled but synthetic. `dead=0` for everyone (no mortality dimension). `date_created` is a reliable registration watermark; `date_changed` is NULL everywhere (so no real address-change history despite the SCD2 structure).
- **Single-source discipline:** this catchment is the EMR's self-reported denominator only. Do not divide by census/MFR/DHIS2 population here — coverage-vs-population is a deliberately separate multi-source insight.

## Follow-on questions
1. Once real addresses load, which woredas/zones dominate the catchment, and does the age-sex pyramid match the expected facility service mix (e.g. ANC-age females, paediatric load)?
2. What is the patient-registration trend over time (`date_created` by month) — is the catchment growing, and in which age groups?
3. How complete are enrichment attributes (phone, blood type, next-of-kin) by region, and does completeness vary with registration recency?
