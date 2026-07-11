# EMR Insight 15 — CD4 Immunological Status Distribution

> **Source:** OpenMRS / EthioEMR **only** (single-source). **Domain:** HIV.

## The question
What is the distribution of **CD4 immunological status** across HIV patients, and how many fall into the **advanced HIV disease (AHD)** category that triggers extra screening and prophylaxis? CD4 measures the immune reserve — it stratifies who is immunologically vulnerable.

## Why it matters / stakeholder
- **Primary stakeholder:** HIV clinician / program coordinator; the AHD (advanced HIV disease) package focal person.
- **Decision it drives:** Flags patients needing the **WHO advanced-disease package** — CrAg screening, TB-LAM, cotrimoxazole/fluconazole prophylaxis, intensified follow-up. CD4 trajectory also confirms immune recovery on ART.
- **Standard / framework:** WHO **advanced HIV disease**: CD4 **<200 cells/mm³** (or WHO stage 3/4). CD4 supports the treatment-monitoring leg of the cascade alongside viral load (Insight 14). Standard absolute-count bands: **<50, 50–199, 200–349, 350–499, ≥500 cells/mm³**.

## Metric definition
- **CD4 distribution:** count/share of patients in each CD4 band (using the latest CD4 per patient).
- **AHD prevalence:** `(patients with latest CD4 < 200) / (patients with a CD4 result)`.
- **Grain:** patient (latest CD4) for the distribution; obs for trend.
- **Dimensions to slice by:** sex, age band, CD4 band, time-since-result, on-ART status.

> **IMPORTANT measurement note:** the CD4 concept in *this* dataset is **CD4 *percentage*** ("CD4%" / "CD4% Test"), **not** absolute CD4 count. CD4% bands differ: **CD4% <15%** ≈ advanced disease (analogous to <200 cells/mm³); 15–24% intermediate; ≥25% relatively preserved. Compute against **CD4%**, and only convert/relabel to absolute-count bands if an absolute-CD4 concept is added later.

## OpenMRS source (tables & key fields)
- `obs` — CD4 stored as **`value_numeric`** under concept_id **730**, which carries **DUPLICATE fully-specified names** — both **"CD4%"** and **"CD4% Test"** (each reported 19,376) resolve to the **same `concept_id` 730**. **Aggregate on `concept_id=730`, not on the name**, or you double-count. **Live: 19,376 obs, 2,942 distinct patients, observed range 21–69, mean ≈ 45.2.**
- `concept_name` — decode via `locale='en' AND concept_name_type='FULLY_SPECIFIED'` (expect 2 rows for 730 — pick one).
- `patient_program` — `program_id=1`, `date_completed IS NULL` for the active denominator.
- `person` — `gender`, `birthdate`.
- `obs_reference_range` — carries hi/low normal bounds per concept for abnormal-flagging (3,819 rows overall; confirm coverage for 730 before relying on it — none observed for 730 in spot-check, so use the WHO CD4% bands above).

## API access
- **REST:** `GET /openmrs/ws/rest/v1/obs?patient={uuid}&concept={cd4ConceptUuid}&v=custom:(obsDatetime,value)`; latest-per-patient client-side.
- **FHIR R4:** `GET /openmrs/ws/fhir2/R4/Observation?patient={id}&code={cd4Code}&_sort=-date`; bulk: `Observation?code={cd4}&_lastUpdated=ge{date}`.
- **Reporting/SQL:** band distribution and AHD prevalence via SQL (latest-CD4 window function) or Reporting indicator definitions, materialised monthly.

## Method (how to compute)
1. Filter `obs` to **`concept_id = 730`** (covers both duplicate labels) and `value_numeric` present.
2. Take the **latest CD4% per patient** via `ROW_NUMBER()`.
3. Bucket into CD4% bands (`<15`, `15–24`, `≥25`); compute share per band.
4. **AHD count** = patients with latest CD4% `< 15` (advanced-disease proxy).
5. Disaggregate by sex/age band; optionally trend mean CD4% over time to show immune recovery.

```sql
WITH cd4 AS (
  SELECT o.person_id, o.value_numeric, o.obs_datetime,
         ROW_NUMBER() OVER (PARTITION BY o.person_id
                            ORDER BY o.obs_datetime DESC) AS rn
  FROM obs o
  WHERE o.concept_id = 730           -- CD4% (covers 'CD4%' + 'CD4% Test' duplicate names)
    AND o.value_numeric IS NOT NULL
),
latest AS ( SELECT person_id, value_numeric AS cd4_pct FROM cd4 WHERE rn = 1 )
SELECT
  CASE
    WHEN cd4_pct < 15 THEN '<15% (advanced disease)'
    WHEN cd4_pct < 25 THEN '15-24% (intermediate)'
    ELSE '>=25% (preserved)'
  END AS cd4_band,
  COUNT(*)                                   AS patients,
  ROUND(100 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct_of_tested
FROM latest
GROUP BY cd4_band
ORDER BY MIN(cd4_pct);
```

To disaggregate, join `latest` to `person` for `gender`/age-band and add them to `GROUP BY`.

## Caveats with THIS dataset
- **CD4% not absolute count.** The stored concept is CD4 *percentage* (observed 21–69, mean ~45.2). **Do not apply the <200 cells/mm³ rule to these values** — use CD4% bands. Mislabelling CD4% as absolute count would massively misclassify AHD. (`../EMR-DATA-UNDERSTANDING.md`.)
- **Duplicate concept names on one concept_id.** "CD4%" and "CD4% Test" are two FULLY_SPECIFIED names for **concept_id 730** — **aggregate on `concept_id`**, never on the text, or every patient counts twice.
- **No advanced-disease signal in this data.** Observed CD4% range is **21–69** — i.e. *no value falls below the <15% AHD threshold*. So computed AHD prevalence ≈ **0%** here. This is a **generator artefact** (it sampled only mid/high CD4%), not a clinical finding; the method still surfaces AHD correctly when low values exist.
- **Synthetic values, real method.** CD4% magnitudes are generated; the latest-per-patient banding logic is production-grade and reusable.
- **CD4 obs exceed HIV enrolees** (2,942 patients vs 470 HIV-enrolled) — anchor cohort denominators on `patient_program`; treat stray CD4 obs on non-enrolled patients as out-of-cohort.
- **No reference range for 730** observed in `obs_reference_range`, so abnormal-flagging relies on the WHO CD4% bands rather than stored bounds.

## Follow-on questions
- Do low-CD4 (advanced-disease) patients overlap with the **non-suppressed VL** list (Insight 14) and the **LTFU** list (Insight 13) — the highest-risk triple-flag cohort?
- What is the **CD4% trajectory** per patient over time (immune recovery on ART)?
- Is **advanced disease concentrated** in any age-sex stratum or among late ART initiators?
