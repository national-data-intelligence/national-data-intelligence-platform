# EMR Insight 22 — Diagnostic Test Utilization Mix

> **Source:** OpenMRS / EthioEMR **only** (single-source). **Domain:** Lab.

## The question
Which laboratory and diagnostic tests are **ordered and resulted most often**, what is the test **volume per patient and per encounter**, and how does the test mix shift by sex, age band and time? This is the lab-operations "what are we actually doing" view — it sizes lab workload and reveals the dominant diagnostic pathways.

## Why it matters / stakeholder
- **Primary stakeholder:** Laboratory manager and facility operations / supply-chain lead; warehouse owner forecasting reagent demand and lab-module load.
- **Decision it drives:** Reagent and consumable forecasting, staffing of lab benches, identification of over- or under-ordered tests, and capacity planning for the analytes that dominate volume.
- **Standard / framework:** WHO Essential Diagnostics List (EDL) alignment, lab-utilisation / test-per-visit operational KPIs. Not a single HMIS indicator — an operational mix metric.

## Metric definition
- **Numerator(s):** (a) count of unvoided **orders** per test concept; (b) count of unvoided **resulted obs** per test concept.
- **Denominator(s):** distinct patients (→ tests/patient), distinct encounters (→ tests/encounter), or total order volume (→ % mix share).
- **Formulae:** `mix_share = orders_for_test / all_test_orders`; `tests_per_patient = resulted_obs / distinct_patients`; `order_to_result_ratio = resulted_obs / orders` per concept.
- **Grain:** order line (`orders` row) and result (`obs` row). Roll up to concept / month / patient.
- **Dimensions to slice by:** test concept, sex, age band, location, ordering encounter type, `date_activated` (orders) / `obs_datetime` (results) by month.

## OpenMRS source (tables & key fields)
- `orders` (766 rows) — supertype; `order_id`, `patient_id`, `encounter_id`, `concept_id`, `order_type_id`, `date_activated`, `voided`.
- `order_type` — `name` = **Test Order (404)** / Drug Order (324) / Procedure Order (38). Filter to Test Order (and optionally Procedure Order) for diagnostics.
- `test_order` (409 rows) — subtype detail (`order_id`, specimen/laterality where populated).
- `order_group` (764) — groups orders placed together in one encounter (panel ordering).
- `obs` — the **result** side; join `obs.concept_id` for resulted volume. Most-resulted analytes: CD4% (~38.7k), Red blood cells (~38.7k), then ESR/Hematocrit/WBC/Haemoglobin/Platelets/Glucose/Cholesterol/HIV-VL (~19k each).
- `concept_name` — decode (`locale='en'`, `FULLY_SPECIFIED`). Aggregate on `concept_id` (duplicate names exist: CD4% / "CD4% Test", RBC / "RED BLOOD CELLS COUNT").

## API access
- **REST:** `GET /openmrs/ws/rest/v1/order?orderType={testOrderUuid}&v=full`; per-patient `/order?patient={uuid}`. Order-frequency reporting via the Reporting REST resource.
- **FHIR R4:** `GET /openmrs/ws/fhir2/R4/ServiceRequest?code={code}` for ordered tests; `GET /openmrs/ws/fhir2/R4/Observation?category=laboratory` for results. `ServiceRequest` vs `Observation` counts give the order-to-result ratio natively.
- **Reporting/SQL:** SQL below, or a Cohort/Indicator dataset grouped by test concept.

## Method (how to compute)
1. **Ordered mix:** count `orders` joined to `order_type='Test Order'`, grouped by `concept_id`; compute each concept's share of all test orders.
2. **Resulted mix:** count `obs` grouped by `concept_id`; this is the realised lab workload.
3. **Order-to-result ratio:** join ordered vs resulted per concept (low ratio ⇒ ordered but not resulted, or resulted without an order record).
4. **Volume per patient/encounter:** divide resulted obs by `COUNT(DISTINCT patient_id)` and by `COUNT(DISTINCT encounter_id)`.
5. Slice by sex/age (`person`) and month.

```sql
-- Ordered test mix (top tests by order volume)
SELECT
  o.concept_id,
  ANY_VALUE(cn.name)                                  AS test_name,
  COUNT(*)                                             AS orders_n,
  COUNT(DISTINCT o.patient_id)                         AS patients_n,
  ROUND(COUNT(*) / COUNT(DISTINCT o.patient_id), 2)    AS orders_per_patient,
  ROUND(100 * COUNT(*) / SUM(COUNT(*)) OVER (), 1)     AS mix_pct
FROM orders o
JOIN order_type ot ON ot.order_type_id = o.order_type_id AND ot.name = 'Test Order'
JOIN concept_name cn
  ON cn.concept_id = o.concept_id
 AND cn.locale = 'en' AND cn.concept_name_type = 'FULLY_SPECIFIED'
WHERE o.voided = 0
GROUP BY o.concept_id
ORDER BY orders_n DESC;
```

```sql
-- Resulted volume + tests per patient (result side)
SELECT
  o.concept_id,
  ANY_VALUE(cn.name)                                   AS test_name,
  COUNT(*)                                              AS results_n,
  COUNT(DISTINCT o.person_id)                           AS patients_n,
  ROUND(COUNT(*) / COUNT(DISTINCT o.person_id), 1)      AS results_per_patient
FROM obs o
JOIN concept_name cn
  ON cn.concept_id = o.concept_id
 AND cn.locale = 'en' AND cn.concept_name_type = 'FULLY_SPECIFIED'
WHERE o.voided = 0 AND o.value_numeric IS NOT NULL
GROUP BY o.concept_id
ORDER BY results_n DESC;
```

## Caveats with THIS dataset
**GENERATED data — structure, joins and method are real and reusable; volumes are synthetic.** Reference `../EMR-DATA-UNDERSTANDING.md`.
- **Order side is thin and decoupled from the result side.** There are only ~404 Test Orders against ~193k resulted obs — the seed populated results far more heavily than orders, so `order-to-result ratio` is not meaningful yet (most results have no matching order row). Report the two sides separately for now.
- **Only 10 distinct lab concepts dominate the resulted data**, each ~19k obs (CD4% and RBC ~38.7k because their duplicate-named concepts already collapse onto one `concept_id`). The real diagnostic catalogue (top *ordered* concepts include CBC, Serum creatinine, LFTs, reticulocyte count, stool O&C) is wider than the resulted set — the mix will broaden with the real distro.
- Duplicate concept names: always aggregate on `concept_id`. Slicing by name double-counts.
- `date_changed` NULL and `voided=0` throughout (10 voided orders only) — no re-order / cancellation history to model.

## Follow-on questions
1. With the real distro, what is the test-per-visit rate by service point (OPD vs IPD), and which tests are routinely co-ordered as de-facto panels (via `order_group`)?
2. What is the order-to-result turnaround (time from `date_activated` to `obs_datetime`) per analyte, once orders and results are properly linked?
3. Which high-volume tests have no corresponding EDL / formulary entry, indicating catalogue cleanup needs before warehouse modelling?
