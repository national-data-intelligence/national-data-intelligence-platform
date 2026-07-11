# EMR Insight 08 — Leading Causes of Morbidity (Top Diagnoses)

> **Source:** OpenMRS / EthioEMR only (single-source). **Domain:** Morbidity.

## The question
**What are the leading causes of morbidity** captured in this EMR — i.e. the top diagnoses driving outpatient visits? This is the OPD morbidity profile / "top-10 leading causes" view.

## Why it matters / stakeholder
- **Primary stakeholder:** Clinical/medical director and the disease-surveillance / HMIS officer.
- **Decision it drives:** Essential-drug and commodity forecasting, clinician training priorities, case-management protocol focus, and surveillance flagging of priority conditions.
- **Standard / framework:** Ethiopian HMIS **"Top 10 Leading Causes of Outpatient Morbidity"** report; WHO IDSR (Integrated Disease Surveillance & Response); diagnoses are ICD-10/ICD-11 codeable.

## Metric definition
- **Numerator:** count of diagnoses for a given condition (concept), typically counting *new/primary* diagnoses.
- **Denominator:** total diagnoses (for share of morbidity), or distinct patients (for case prevalence).
- **Formula:** `morbidity_share(dx) = diagnoses(dx) / total_diagnoses`; rank descending for the top-N.
- **Grain:** one row per diagnosis concept (roll-up), or per concept × period for trend (see Insight 09).
- **Dimensions to slice by:** `dx_rank` (primary vs. secondary), `certainty` (confirmed vs. presumed), patient gender/age band, location, ICD-10 chapter.

## OpenMRS source (tables & key fields)
- **Diagnoses live in `encounter_diagnosis` (2,144 rows), NOT in `obs`.** Columns: `diagnosis_coded` (concept_id, populated on all 2,144), `diagnosis_non_coded` (NULL here), `certainty` ('CONFIRMED' on 1,815, rest NULL/PRESUMED), `dx_rank` (1 = primary on 1,191), `encounter_id`, `patient_id`, `voided`.
- **Decode the name:** `JOIN concept_name cn ON encounter_diagnosis.diagnosis_coded = cn.concept_id AND cn.locale='en' AND cn.concept_name_type='FULLY_SPECIFIED'`.
- **ICD mapping:** `concept_reference_map` → `concept_reference_term` → `concept_reference_source` (ICD-10/ICD-11/CIEL; 247k maps across 62 systems).
- `encounter` for date/location context; `person` for age/gender.
- **GOTCHA:** some concepts have duplicate FULLY_SPECIFIED names (e.g. "CD4%"/"CD4% Test") — **aggregate on `concept_id`, then attach one name** (e.g. `MIN(cn.name)` / `ANY_VALUE`).

## API access
- **REST:** `GET /openmrs/ws/rest/v1/encounter?v=custom:(diagnoses:(diagnosis,certainty,rank))` per encounter; the diagnosis concept is at `diagnoses.diagnosis.coded`. For concept detail/mappings: `GET /openmrs/ws/rest/v1/concept/{uuid}?v=custom:(uuid,display,mappings)`.
- **FHIR R4:** `GET /openmrs/ws/fhir2/R4/Condition?recorded-date=ge2024-01-01` — `Condition.code.coding` carries the coded diagnosis (with ICD/CIEL system URIs); `Condition.subject` the patient.
- **Reporting/SQL:** aggregate top-N directly in SQL (below) — the canonical approach for this report.

## Method (how to compute)
1. Filter `encounter_diagnosis` to non-voided rows; optionally restrict to `dx_rank = 1` (primary) for the classic leading-cause report.
2. Group by `diagnosis_coded` (the concept_id) — **never** group by name (duplicate-name gotcha).
3. Attach one FULLY_SPECIFIED English name per concept.
4. Count diagnoses and distinct patients; compute share of total; rank descending; take top-N (10/20).
5. (Optional) attach the ICD-10 code via the reference-map join for HMIS alignment.

```sql
-- Top leading causes of morbidity (all diagnoses; switch on dx_rank for primary-only)
SELECT  d.diagnosis_coded                                   AS concept_id,
        ANY_VALUE(cn.name)                                  AS diagnosis,
        COUNT(*)                                            AS dx_count,
        COUNT(DISTINCT d.patient_id)                        AS distinct_patients,
        SUM(d.dx_rank = 1)                                  AS as_primary,
        SUM(d.certainty = 'CONFIRMED')                      AS confirmed,
        ROUND(100 * COUNT(*) / SUM(COUNT(*)) OVER (), 2)    AS pct_of_total
FROM        encounter_diagnosis d
JOIN        concept_name cn
       ON   cn.concept_id = d.diagnosis_coded
      AND   cn.locale = 'en'
      AND   cn.concept_name_type = 'FULLY_SPECIFIED'
WHERE       d.voided = 0
GROUP BY    d.diagnosis_coded
ORDER BY    dx_count DESC
LIMIT 20;
```

Observed top diagnoses (live DB):

| Diagnosis | Count |
|---|---|
| Upper Respiratory Infection | 378 |
| Gastritis | 208 |
| Tonsillitis | 111 |
| Allergic rhinitis | 88 |
| Pneumonia | 88 |
| Soft tissue injury | 53 |
| Gastroenteritis | 41 |
| Amoebiasis | 41 |
| Conjunctivitis | 40 |
| Migraine | 36 |
| Urinary tract infection | 35 |
| Cellulitis | 34 |

```sql
-- Attach the ICD-10 code for HMIS alignment
SELECT  d.diagnosis_coded AS concept_id,
        ANY_VALUE(cn.name) AS diagnosis,
        ANY_VALUE(crt.code) AS icd10_code,
        COUNT(*) AS dx_count
FROM        encounter_diagnosis d
JOIN        concept_name cn ON cn.concept_id = d.diagnosis_coded
                           AND cn.locale='en' AND cn.concept_name_type='FULLY_SPECIFIED'
LEFT JOIN   concept_reference_map  crm ON crm.concept_id = d.diagnosis_coded
LEFT JOIN   concept_reference_term crt ON crt.concept_reference_term_id = crm.concept_reference_term_id
LEFT JOIN   concept_reference_source crs ON crs.concept_source_id = crt.concept_source_id
                                        AND crs.name LIKE 'ICD-10%'
WHERE       d.voided = 0
GROUP BY    d.diagnosis_coded
ORDER BY    dx_count DESC
LIMIT 20;
```

## Caveats with THIS dataset
- **The diagnosis MIX is generator-chosen — do NOT read it epidemiologically.** "Upper Respiratory Infection is the top cause of morbidity in Adama" is a **synthetic artifact**, not a finding. The reusable asset is the *method* (decode → group on concept_id → rank → map to ICD). See `../EMR-DATA-UNDERSTANDING.md`.
- **Synthetic data** — schema/keys/relationships real and warehouse-ready; content generated.
- **Duplicate FULLY_SPECIFIED names** exist; grouping on the name would double-count or merge wrongly. Always group on `diagnosis_coded`.
- **Only 2,144 diagnoses across 26,773 encounters** — most encounters carry *no* coded diagnosis (and ~1,189 encounters carry them; see Insight 10). The top-N reflects only diagnosed encounters, so it is **not** a complete morbidity census.
- **Certainty/rank are partially populated** (CONFIRMED on 1,815; rank=1 on 1,191) — decide explicitly whether the report counts presumed and secondary diagnoses.
- **Near-duplicate clinical concepts** (e.g. "Gastritis" vs. "Acute Gastritis", "RHINITIS" vs. "Allergic rhinitis") fragment what a clinician would group — consider an ICD-10-chapter roll-up for a cleaner morbidity profile.

## Follow-on questions
- Top causes by **age band and sex** (e.g. pediatric pneumonia vs. adult gastritis) for targeted protocols.
- Roll up to **ICD-10 chapter** to smooth concept fragmentation and align to HMIS categories.
- Primary-only vs. all-diagnoses leading-cause lists — how different are they?
- Which leading causes are **trending up** month-over-month (handoff to Insight 09)?
- Geographic concentration: are specific causes clustered at particular locations (join Insight 06)?
