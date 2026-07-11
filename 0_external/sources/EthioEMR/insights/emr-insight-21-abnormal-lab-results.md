# EMR Insight 21 — Abnormal Lab Result Detection

> **Source:** OpenMRS / EthioEMR **only** (single-source). **Domain:** Lab.

## The question
What proportion of numeric laboratory results fall **outside their reference range** (abnormal / critical), and how does that abnormal-rate break down by test, sex, age band and time? This is the clinical-quality and result-flagging view: how many results would trigger a clinician alert, and which analytes drive the abnormal signal?

## Why it matters / stakeholder
- **Primary stakeholder:** Laboratory quality manager and clinical lead; data-warehouse owner validating that result-level reference ranges are usable downstream.
- **Decision it drives:** Whether automated critical-value flagging can be driven off EMR data; identifies analytes whose ranges are mis-configured (and thus produce false alerts); prioritises analytes for clinician review.
- **Standard / framework:** ISO 15189 (medical-lab competence), CLSI C28-A3 (reference-interval definition), and the general "critical-value notification" patient-safety practice. Not an HMIS aggregate indicator — it is a result-quality metric.

## Metric definition
- **Numerator:** count of unvoided numeric obs whose `value_numeric` is **below `low_normal`** or **above `hi_normal`** for that observation's stored reference range (critical = below `low_critical` / above `hi_critical`).
- **Denominator:** count of unvoided numeric obs **that carry a reference-range row** (only results with a comparable range can be classified).
- **Formula:** `abnormal_rate = abnormal_obs / obs_with_range`.
- **Grain:** one row = one `obs` (a single result value). Roll up to concept / month / patient.
- **Dimensions to slice by:** test concept, sex, age band, location, `obs_datetime` (month), and flag class (low / high / critical-low / critical-high / normal).

## OpenMRS source (tables & key fields)
- `obs` — `obs_id`, `concept_id`, `value_numeric`, `obs_datetime`, `person_id`, `encounter_id`, `voided`. All 193,388 lab obs are **numeric** (coded/text/drug branches are empty; `obs_group_id` unused).
- `obs_reference_range` — **keyed by `obs_id`** (NOT concept_id): `low_normal`, `hi_normal`, `low_critical`, `hi_critical`, `low_absolute`, `hi_absolute`. 3,819 rows → only ~2 % of obs carry a stored range. This is the snapshot of the range that applied when the result was entered.
- `concept_name` — decode the analyte: `JOIN concept_name cn ON obs.concept_id=cn.concept_id AND cn.locale='en' AND cn.concept_name_type='FULLY_SPECIFIED'`. Note **duplicate concept names** (CD4% / "CD4% Test", Red blood cells / "RED BLOOD CELLS COUNT") — aggregate on `concept_id`, not on name.
- `person` for sex/age dimensions.

## API access
- **REST:** `GET /openmrs/ws/rest/v1/obs?concept={uuid}&v=full` returns `value`, `referenceRange` (when present) and `interpretation`. Per-patient: `/openmrs/ws/rest/v1/obs?patient={uuid}`.
- **FHIR R4:** `GET /openmrs/ws/fhir2/R4/Observation?code={loinc-or-system}|{code}` — FHIR `Observation.referenceRange.{low,high}` and `Observation.interpretation` (H/L/HH/LL) carry the flag natively. This is the cleanest interop path for abnormal-flagging.
- **Reporting/SQL:** direct SQL below, or a SQL-dataset definition in the Reporting module.

## Method (how to compute)
1. Restrict to unvoided numeric obs that have a reference-range row (`JOIN obs_reference_range r ON r.obs_id=o.obs_id`).
2. Classify each obs: critical-high if `value_numeric > hi_critical`, critical-low if `< low_critical`, else high/low against `hi_normal`/`low_normal`, else normal. Treat NULL bounds as "no test on that side".
3. Aggregate counts and rate per concept; slice by sex/age/month.
4. **Sanitise impossible values first** (see caveats) — exclude `value_numeric < 0` for analytes that cannot be negative, otherwise they masquerade as "critical-low".

```sql
SELECT
  o.concept_id,
  ANY_VALUE(cn.name)                                    AS test_name,
  COUNT(*)                                               AS results_with_range,
  SUM(o.value_numeric > r.hi_normal)                    AS high_n,
  SUM(o.value_numeric < r.low_normal)                   AS low_n,
  SUM(r.hi_critical IS NOT NULL
      AND o.value_numeric > r.hi_critical)              AS crit_high_n,
  SUM(r.low_critical IS NOT NULL
      AND o.value_numeric < r.low_critical)             AS crit_low_n,
  ROUND(100 * SUM(o.value_numeric > r.hi_normal
                  OR o.value_numeric < r.low_normal)
            / COUNT(*), 1)                              AS abnormal_pct
FROM obs o
JOIN obs_reference_range r ON r.obs_id = o.obs_id
JOIN concept_name cn
  ON cn.concept_id = o.concept_id
 AND cn.locale = 'en'
 AND cn.concept_name_type = 'FULLY_SPECIFIED'
WHERE o.voided = 0
  AND o.value_numeric IS NOT NULL
  AND o.value_numeric >= 0          -- drop impossible negatives (generator artifact)
GROUP BY o.concept_id
ORDER BY results_with_range DESC;
```

Add `JOIN person p ON p.person_id=o.person_id` and group by `p.gender` / age band, or `DATE_FORMAT(o.obs_datetime,'%Y-%m')`, to slice.

## Caveats with THIS dataset
**GENERATED data — the method is real and reusable; the abnormal-rate *number* is currently meaningless.** Reference `../EMR-DATA-UNDERSTANDING.md`.
- **Negative results are generator artifacts and dominate the abnormal signal.** ~10 % of **Erythrocyte sedimentation rate** (1,953 / 19,494) and ~10 % of **HIV viral load** (1,967 / 19,226) values are **negative**, which is biologically impossible. Left unfiltered they all flag as critical-low and swamp the metric. The `WHERE value_numeric >= 0` guard above is mandatory for this dataset.
- **Range coverage is ~2 %.** Only 3,819 of 193,388 obs carry a `obs_reference_range` row, and the stored bounds are themselves synthetic/noisy (observed `hi_normal` values run up to ~1,497 and many `low_normal` = 0). The denominator is small and the bounds are not clinically authoritative — do not publish a real "X % abnormal" figure yet.
- `obs_reference_range` is per-**obs** (a point-in-time snapshot), not per-concept. Do not assume one range per analyte; aggregate carefully.
- All obs are numeric in this load; there is no qualitative (positive/negative coded) lab pathway to model yet.
- No record updates/voids of substance (`date_changed` NULL everywhere; `voided=0`), so no result-correction history to reconcile.

## Follow-on questions
1. Once the real distro replaces this seed, what is the genuine critical-value rate per analyte, and what is the median time from result entry to a clinician acknowledging the flag?
2. Are abnormal-rate patterns concentrated in specific patients (recurrent abnormals = chronic-disease cohort) versus spread evenly — i.e. can we derive a chronic-care candidate list from lab data alone?
3. Do stored `obs_reference_range` bounds agree with the concept's configured `concept_numeric` normal range, and where they diverge, which is authoritative for the warehouse?
