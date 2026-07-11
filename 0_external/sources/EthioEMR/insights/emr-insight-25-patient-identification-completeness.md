# EMR Insight 25 — Patient Identification & Record Completeness

> **Source:** OpenMRS / EthioEMR **only** (single-source). **Domain:** Data Quality.

## The question
How **complete and trustworthy is patient identification** in the EMR? Specifically: what share of patients carry a **National ID / Fayda Health ID** (the cross-source linkage key), is the **MRN** present and well-formed for every patient, and what are the **missing-field rates** for core registry fields (birthdate, sex, address, contact)? This is the interoperability-readiness and data-quality view — the gate that determines whether EMR records can be linked into the warehouse at all.

## Why it matters / stakeholder
- **Primary stakeholder:** Data-warehouse / interoperability lead, HIS data-quality officer, and the national Health-ID (Fayda) integration team.
- **Decision it drives:** Whether patient-level record linkage across sources is feasible; where to target a registration-data-cleaning campaign; whether the EMR is ready to publish a master patient index.
- **Standard / framework:** WHO HMIS data-quality dimensions (**completeness**, validity/consistency), MPI / patient-matching best practice, and Ethiopia's **Fayda national digital ID** as the cross-system patient key.

## Metric definition
- **Numerator(s):** patients with a non-null, well-formed value for each identifier/field (National ID, MRN, birthdate, gender, current address, phone).
- **Denominator:** all unvoided **patients** (3,000).
- **Formulae:** `national_id_coverage = patients_with_national_id / total_patients`; `mrn_format_valid = patients_with_MRN_matching_pattern / total_patients`; per-field `completeness = non_null / total`.
- **Grain:** patient.
- **Dimensions to slice by:** registration month (`date_created`), region, age band, sex.

## OpenMRS source (tables & key fields)
- `patient` (3,000) — the population; `patient.voided = 0`.
- `patient_identifier` — `patient_id`, `identifier`, `identifier_type`, `preferred`, `voided`.
- `patient_identifier_type` — `name`: **"OpenMRS Identification Number"** (the MRN, 3,000 rows, all patients, `preferred=1`, format `MRN00000001`) and **"National ID"** (1,813 rows, format `ET` + 12 digits, e.g. `ET716017224649`).
- `person` — `birthdate`, `gender` completeness.
- `person_address` (SCD2; use `voided=0`) — current-address completeness.
- `person_attribute` + `person_attribute_type` — Telephone contact (298), Email (87), etc. for contactability completeness.

## API access
- **REST:** `GET /openmrs/ws/rest/v1/patient/{uuid}?v=full` returns all `identifiers`; `GET /patientidentifiertype` lists types. Bulk: `GET /openmrs/ws/rest/v1/patient?identifier=ET*`.
- **FHIR R4:** `GET /openmrs/ws/fhir2/R4/Patient?identifier={system}|{value}` — `Patient.identifier` carries both MRN and National ID with their systems; the natural interoperability surface for an MPI.
- **Reporting/SQL:** SQL below, or a data-quality dataset in the Reporting module.

## Method (how to compute)
1. Take all unvoided patients as the denominator.
2. **National ID coverage:** left-join `patient_identifier` filtered to type "National ID" (`voided=0`); count patients with a match; optionally validate the `^ET[0-9]{12}$` pattern.
3. **MRN integrity:** confirm every patient has a "OpenMRS Identification Number" and it matches `^MRN[0-9]{8}$`; flag duplicates by counting `identifier` occurrences.
4. **Field completeness:** per-field non-null counts on `person` / current `person_address` / phone attribute.
5. Slice coverage by `date_created` month and region to find where gaps cluster.

```sql
-- Identifier coverage + MRN integrity, one row summary
SELECT
  COUNT(*)                                                       AS patients,
  SUM(nid.identifier IS NOT NULL)                                AS has_national_id,
  ROUND(100*SUM(nid.identifier IS NOT NULL)/COUNT(*),1)          AS national_id_pct,
  SUM(nid.identifier REGEXP '^ET[0-9]{12}$')                     AS national_id_wellformed,
  SUM(mrn.identifier IS NOT NULL)                                AS has_mrn,
  SUM(mrn.identifier REGEXP '^MRN[0-9]{8}$')                     AS mrn_wellformed
FROM patient pt
LEFT JOIN (
  SELECT pi.patient_id, pi.identifier
  FROM patient_identifier pi
  JOIN patient_identifier_type t ON t.patient_identifier_type_id = pi.identifier_type
  WHERE t.name = 'National ID' AND pi.voided = 0
) nid ON nid.patient_id = pt.patient_id
LEFT JOIN (
  SELECT pi.patient_id, pi.identifier
  FROM patient_identifier pi
  JOIN patient_identifier_type t ON t.patient_identifier_type_id = pi.identifier_type
  WHERE t.name = 'OpenMRS Identification Number' AND pi.voided = 0
) mrn ON mrn.patient_id = pt.patient_id
WHERE pt.voided = 0;
```

```sql
-- Duplicate-identifier check (MPI integrity)
SELECT identifier, COUNT(*) n
FROM patient_identifier
WHERE voided = 0
GROUP BY identifier
HAVING n > 1;
```

```sql
-- Core-field completeness
SELECT
  ROUND(100*SUM(p.birthdate IS NOT NULL)/COUNT(*),1)            AS birthdate_pct,
  ROUND(100*SUM(p.gender IN ('M','F'))/COUNT(*),1)             AS gender_pct,
  ROUND(100*SUM(a.person_id IS NOT NULL)/COUNT(*),1)           AS current_address_pct
FROM patient pt
JOIN person p ON p.person_id = pt.patient_id
LEFT JOIN person_address a ON a.person_id = pt.patient_id AND a.voided = 0
WHERE pt.voided = 0;
```

## Caveats with THIS dataset
**GENERATED data — but the headline identification finding is a REAL, structural finding worth surfacing.** Reference `../EMR-DATA-UNDERSTANDING.md`.
- **The 40 % National-ID gap is the genuine, reusable finding.** Only **1,813 of 3,000 patients (≈60.4 %) carry a National ID**; **1,187 (≈39.6 %) have none**. Because the National ID / Fayda is the cross-source linkage key, ~40 % of EMR patients **cannot be deterministically linked** to other sources today. This is structural (how the data was built), not a random synthetic glitch, and should be raised to the interoperability team.
- **MRN is fully present and well-formed:** every patient has `MRN########`, `preferred=1`. Verify uniqueness (no duplicates observed) before trusting it as an internal primary key.
- Core demographic fields (birthdate, gender) and current address are well-populated in this seed; contact attributes (phone ~298, email ~87) are sparse — contactability completeness is low.
- `person_address` is SCD2; count current rows only (`voided=0`) when measuring address completeness.
- No record updates/voids of substance (`date_changed` NULL; `voided=0`), so there is no identifier-correction or merge history to assess yet — real MPI duplicate/merge dynamics will only appear with production data.

## Follow-on questions
1. Among the ~40 % without a National ID, do the gaps cluster by region, age band, or registration period — i.e. where should the Fayda back-capture campaign focus?
2. After linkage, how many EMR patients deterministically match the same person in other sources via National ID, and how many require probabilistic matching on name+DOB+sex?
3. What is the duplicate-patient (suspected-merge) rate inside the EMR itself, detectable from near-identical name/DOB/sex with distinct MRNs?
