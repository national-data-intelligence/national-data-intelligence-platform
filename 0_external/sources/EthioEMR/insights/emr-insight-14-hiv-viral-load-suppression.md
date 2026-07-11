# EMR Insight 14 — HIV Viral-Load Testing Coverage & Suppression

> **Source:** OpenMRS / EthioEMR **only** (single-source). **Domain:** HIV.

## The question
What share of HIV patients have a **viral-load (VL) result on record** (VL testing coverage), and of those tested, what share are **virally suppressed** (<1,000 copies/mL)? This is the operational measurement of the **3rd 95**.

## Why it matters / stakeholder
- **Primary stakeholder:** HIV program coordinator; viral-load / laboratory focal person; PEPFAR M&E.
- **Decision it drives:** Identifies (a) patients **overdue for VL testing** (coverage gap → demand-creation for the lab) and (b) **non-suppressed** patients who need adherence counselling / regimen switch / enhanced follow-up. Suppression is the ultimate proof that treatment is working.
- **Standard / framework:** WHO/PEPFAR **95-95-95** — the **3rd 95**: of those on ART, ≥95% virally suppressed. PEPFAR indicators **TX_PVLS** (VL coverage denominator / suppression numerator). WHO suppression threshold: **<1,000 copies/mL** (some programs use <50 for "undetectable").

## Metric definition
- **VL coverage:** `(active ART patients with ≥1 valid VL result in the last 12 months) / (active ART patients eligible for VL)`.
- **VL suppression (TX_PVLS):** `(patients whose most-recent valid VL < 1,000 copies/mL) / (patients with a valid VL result)`.
- **Numerator/denominator caveat:** **filter out impossible values first** (see Caveats — ~10% of VL values are negative). Use only `value_numeric >= 0`.
- **Grain:** patient (latest VL per patient) for the cascade; obs for the testing-volume trend.
- **Dimensions to slice by:** sex, age band, suppression band (<50 undetectable / 50–999 suppressed / ≥1,000 unsuppressed), time, months-since-last-VL.

## OpenMRS source (tables & key fields)
- `obs` — VL stored as **`value_numeric`** under concept **"HIV viral load"** (concept_id **856**, **19,226 obs**, **2,940 distinct patients**). `obs_datetime` is the result date; `person_id` the patient.
- `concept_name` — decode: `JOIN concept_name cn ON obs.concept_id=cn.concept_id AND cn.locale='en' AND cn.concept_name_type='FULLY_SPECIFIED'`.
- `patient_program` — `program_id=1`, `date_completed IS NULL` for the active-ART denominator.
- `person` — `gender`, `birthdate`.
- **Live profile (uncleaned):** raw VL range **−29,974 → 129,994**. Of 19,226 obs: **1,967 are negative (impossible)** and **17,259 are valid (≥0)**. Among valid, only **173 are <1,000** ⇒ raw "suppression" ≈ **1.0%** — *meaningless* (see Caveats; this is a generator artefact, not clinical reality).

## API access
- **REST:** `GET /openmrs/ws/rest/v1/obs?patient={uuid}&concept={vlConceptUuid}&v=custom:(obsDatetime,value)`; latest-per-patient via `&limit=1&sort=...` client-side.
- **FHIR R4:** `GET /openmrs/ws/fhir2/R4/Observation?patient={id}&code={vlLoincOrCielCode}&_sort=-date`; bulk incremental: `Observation?code={vl}&_lastUpdated=ge{date}`.
- **Reporting/SQL:** TX_PVLS coverage & suppression are best computed in SQL (latest-VL window function) or via Reporting cohort/indicator definitions, materialised monthly.

## Method (how to compute)
1. **Clean first:** restrict to `value_numeric >= 0` — **this is mandatory** before any suppression %.
2. For each patient, take the **most-recent valid VL** within the reporting window (last 12 months).
3. **Coverage:** active ART patients with a valid recent VL ÷ active ART patients.
4. **Suppression:** patients whose latest valid VL `< 1000` ÷ patients with a valid latest VL.
5. Disaggregate by sex/age band and suppression band; trend testing volume monthly.

```sql
-- Latest VALID VL per patient, then coverage + suppression
WITH valid_vl AS (
  SELECT o.person_id, o.value_numeric, o.obs_datetime,
         ROW_NUMBER() OVER (PARTITION BY o.person_id
                            ORDER BY o.obs_datetime DESC) AS rn
  FROM obs o
  WHERE o.concept_id = 856          -- HIV viral load
    AND o.value_numeric >= 0        -- *** drop impossible negatives ***
    AND o.obs_datetime >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
),
latest AS ( SELECT person_id, value_numeric FROM valid_vl WHERE rn = 1 )
SELECT
  (SELECT COUNT(DISTINCT patient_id) FROM patient_program
     WHERE program_id = 1 AND date_completed IS NULL)            AS active_art,
  COUNT(*)                                                       AS patients_with_vl,
  SUM(value_numeric <  1000)                                    AS suppressed,
  ROUND(100 * SUM(value_numeric < 1000) / COUNT(*), 1)         AS suppression_pct,
  SUM(value_numeric <    50)                                   AS undetectable
FROM latest;
```

For coverage, join `latest` back to active enrolees: `coverage = patients_with_vl_among_active / active_art`.

## Caveats with THIS dataset
- **🚨 ~10% of VL values are NEGATIVE (down to −29,974 copies/mL) — biologically impossible.** This is a **data-generator artefact**. **Any suppression % computed without range-filtering is meaningless.** The raw "1% suppressed" figure above is a direct demonstration: it inverts reality and is purely an artefact. **Always filter `value_numeric >= 0`** (and ideally cap at a plausible max) before reporting. *Say this loudly in every VL report off this source.* (`../EMR-DATA-UNDERSTANDING.md` §0.)
- **Suppression numbers are not clinically real** even after cleaning — the synthetic generator did not model true ART response, so the *post-filter* suppression % is still synthetic. What is **real and reusable** is the **method**: clean → latest-per-patient → threshold.
- **VL not linked to real care states.** `patient_state` is empty, so "active ART" is the derived program-date proxy (Insight 12); VL coverage inherits that derivation.
- **VL obs exceed HIV enrolees.** 2,940 patients have VL obs vs 470 HIV-enrolled — anchor the *cascade denominator* on `patient_program`, treating stray VL obs on non-enrolled patients as out-of-cohort.
- **No coded/text results, no obs_group.** All obs are `value_numeric`; there is no qualitative "suppressed/detectable" coded result and no obs grouping — the threshold logic must be applied numerically.

## Follow-on questions
- After cleaning, who are the **non-suppressed (≥1,000)** patients, and do they overlap with the **LTFU/defaulter** list (Insight 13)?
- What is **VL testing coverage by age-sex stratum** — are children / men under-tested?
- How long is the **VL turnaround** (order-to-result) and does delayed testing correlate with non-suppression (link Insight 20)?
