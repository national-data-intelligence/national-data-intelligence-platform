# EMR Insight 10 — Comorbidity & Multi-Diagnosis Burden

> **Source:** OpenMRS / EthioEMR only (single-source). **Domain:** Morbidity.

## The question
**How concentrated is clinical complexity?** How many diagnoses are recorded per encounter, what fraction of diagnosed encounters carry more than one diagnosis, and which diagnosis **pairs** co-occur most often?

## Why it matters / stakeholder
- **Primary stakeholder:** Clinical director and care-quality / chronic-disease program lead.
- **Decision it drives:** Identifying multi-morbidity case-load (which patients/encounters need integrated management), spotting clinically meaningful disease clusters, and sizing referral / specialist demand.
- **Standard / framework:** Multi-morbidity measurement (count-of-conditions approach, akin to Charlson/Elixhauser comorbidity indices in spirit); WHO integrated people-centred care. This is the standard **comorbidity-burden** view.

## Metric definition
- **Numerator:** for the per-encounter distribution, count of distinct diagnoses on an encounter; for co-occurrence, count of encounters where two given conditions both appear.
- **Denominator:** count of diagnosed encounters (encounters with ≥1 diagnosis), or all encounters.
- **Formula:** `dx_per_encounter = diagnoses(enc)`; `comorbidity_rate = encounters_with_≥2_dx / diagnosed_encounters`; `pair_count(a,b) = encounters where a and b co-occur`.
- **Grain:** one row per encounter (distribution), or one row per unordered diagnosis pair (co-occurrence).
- **Dimensions to slice by:** age band, sex, location, primary vs. secondary rank, ICD-10 chapter.

## OpenMRS source (tables & key fields)
- `encounter_diagnosis` — `encounter_id`, `diagnosis_coded` (concept_id), `dx_rank`, `certainty`, `patient_id`, `voided`. **2,144 rows over 1,189 diagnosed encounters → avg 1.80 diagnoses/diagnosed-encounter.**
- `encounter` — total 26,773; the vast majority carry **no** coded diagnosis.
- `concept_name` — decode (`locale='en'`, `concept_name_type='FULLY_SPECIFIED'`); **aggregate on `concept_id`** (duplicate-name gotcha).
- For a patient-level (rather than encounter-level) comorbidity view, also consider `conditions` (problem list, 199 rows) — distinct from per-visit diagnoses.

## API access
- **REST:** `GET /openmrs/ws/rest/v1/encounter/{uuid}?v=custom:(diagnoses:(diagnosis,rank))` returns all diagnoses on an encounter — count them client-side. No native co-occurrence endpoint.
- **FHIR R4:** `GET /openmrs/ws/fhir2/R4/Condition?encounter={id}` groups conditions by encounter; or pull all `Condition` and group by `Condition.encounter`.
- **Reporting/SQL:** the distribution and the pair self-join below are the canonical route.

## Method (how to compute)
1. **Per-encounter distribution:** group `encounter_diagnosis` by `encounter_id`, count diagnoses, then group by that count.
2. **Comorbidity rate:** share of diagnosed encounters with ≥2 diagnoses.
3. **Co-occurring pairs:** self-join `encounter_diagnosis` to itself on `encounter_id` with `d1.diagnosis_coded < d2.diagnosis_coded` (unordered, no self-pairs, no duplicates); group by the concept pair; attach names with `ANY_VALUE`.

```sql
-- Distribution of diagnoses per (diagnosed) encounter
SELECT  dx_per_enc, COUNT(*) AS encounters
FROM (
  SELECT encounter_id, COUNT(*) AS dx_per_enc
  FROM   encounter_diagnosis
  WHERE  voided = 0
  GROUP BY encounter_id
) t
GROUP BY dx_per_enc
ORDER BY dx_per_enc;
```

Observed (live DB):

| diagnoses on encounter | encounters |
|---|---|
| 1 | 317 |
| 2 | 814 |
| 3 | 33 |
| 4 | 25 |

→ 1,189 diagnosed encounters; **872 (73%) carry ≥2 diagnoses**; mean 1.80 dx/encounter.

```sql
-- Top co-occurring diagnosis pairs
SELECT  ANY_VALUE(cn1.name) AS dx_a,
        ANY_VALUE(cn2.name) AS dx_b,
        COUNT(*)            AS co_occurrences,
        COUNT(DISTINCT d1.patient_id) AS patients
FROM        encounter_diagnosis d1
JOIN        encounter_diagnosis d2
       ON   d1.encounter_id   = d2.encounter_id
      AND   d1.diagnosis_coded < d2.diagnosis_coded     -- unordered, distinct concepts
JOIN        concept_name cn1 ON cn1.concept_id = d1.diagnosis_coded
                            AND cn1.locale='en' AND cn1.concept_name_type='FULLY_SPECIFIED'
JOIN        concept_name cn2 ON cn2.concept_id = d2.diagnosis_coded
                            AND cn2.locale='en' AND cn2.concept_name_type='FULLY_SPECIFIED'
WHERE       d1.voided = 0 AND d2.voided = 0
GROUP BY    d1.diagnosis_coded, d2.diagnosis_coded
ORDER BY    co_occurrences DESC
LIMIT 15;
```

Observed top pairs (live DB):

| Pair | Co-occurrences |
|---|---|
| Amoebiasis + Gastritis | 40 |
| Acute Coryza + Gastritis | 24 |
| Amoebiasis + Conjunctivitis | 16 |
| RHINITIS + Allergic rhinitis | 12 |
| Gastritis + Acute Gastritis | 12 |
| Vulvovaginal candidosis + Urinary tract infection | 9 |
| Gastritis + Conjunctivitis | 8 |

## Caveats with THIS dataset
- **Co-occurrence is generator-chosen, not clinical reality.** "Amoebiasis co-occurs with Gastritis" is a **synthetic artifact** of how the generator paired diagnoses; do not infer real comorbidity clusters. The reusable asset is the *method* (per-encounter distribution + self-join pair counting). See `../EMR-DATA-UNDERSTANDING.md`.
- **Concept-fragmentation contaminates pairs.** Pairs like *RHINITIS + Allergic rhinitis* and *Gastritis + Acute Gastritis* are the **same condition split across two concepts**, not a true comorbidity. Roll up to ICD-10 chapter (or de-duplicate near-synonym concepts) before interpreting pairs.
- **Capped multiplicity.** The per-encounter count tops out at 4 and is dominated by exactly-2 — a generator pattern, not the long right tail real multi-morbidity produces.
- **Encounter-level, not patient-level.** This measures diagnoses co-recorded *in one visit*. True patient comorbidity (conditions accumulated across visits) needs a patient-grain roll-up and/or the `conditions` problem list.
- **Synthetic data** overall; schema/keys real and warehouse-ready; no updates/voids.
- **Duplicate FULLY_SPECIFIED names** — group on `concept_id` pairs, attach names with `ANY_VALUE`/`MIN`.

## Follow-on questions
- **Patient-grain comorbidity index:** distinct conditions per patient over the full history (count-of-conditions / Charlson-style), using `conditions` + `encounter_diagnosis`.
- After ICD-chapter roll-up, which **cross-chapter** clusters persist (e.g. chronic + infectious) — the clinically meaningful comorbidity signal?
- Does comorbidity burden rise with **age band**? (join `person.birthdate`)
- Do high-comorbidity encounters concentrate at particular **locations / encounter types** (referral-load planning; link Insight 06)?
- Network/graph view of the diagnosis co-occurrence matrix to surface communities of co-managed conditions.
