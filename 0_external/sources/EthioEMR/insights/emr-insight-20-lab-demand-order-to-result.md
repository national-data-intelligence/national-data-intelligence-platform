# EMR Insight 20 — Laboratory Demand & Order-to-Result Completeness

> **Source:** OpenMRS / EthioEMR **only** (single-source). **Domain:** Lab.

## The question
How many laboratory tests are ordered, what is the demand mix by test, and what share of lab orders have a result returned — i.e. how complete is the **order → result loop**?

## Why it matters / stakeholder
- **Primary stakeholder:** Laboratory manager; clinical quality / M&E lead.
- **Decision it drives:** Reagent and capacity planning (demand by test) plus detection of a broken result-return loop — orders placed but never resulted indicate sample-rejection, lost specimens, or results not entered into the EMR.
- **Standard / framework:** Laboratory turnaround-time (TAT) and result-completeness quality indicators; the "closed-loop ordering" expectation in CPOE/laboratory accreditation (e.g. ISO 15189 result-reporting completeness).

## Metric definition
- **Numerator / denominator / formula:**
  - *Demand:* count of test orders by ordered concept.
  - *Result-completeness:* test orders with ≥1 matching numeric result obs / non-voided test orders.
  - *TAT (proxy):* `obs.obs_datetime − orders.date_activated` for matched pairs.
- **Grain:** order (`orders`/`test_order`); result obs at obs grain.
- **Dimensions to slice by:** ordered concept (test), order month, ordering encounter/location.

## OpenMRS source (tables & key fields)
- `orders` — supertype (766 rows): `order_id`, `patient_id`, `encounter_id`, `concept_id` (what was ordered), `order_type_id`, `date_activated`, `voided` (10 voided).
- `order_type` — Test Order (404), Drug Order (324), Procedure Order (38).
- `test_order` — extends `orders` for labs (409 rows): `order_id`.
- `order_group` (764) — groups orders placed together.
- `obs` — lab **results** live here as `value_numeric` (all lab obs are numeric). Match `obs.concept_id = orders.concept_id` for the **same patient** (`obs.person_id = orders.patient_id`). No hard order→obs FK in this data.
- `concept_name` — decode concepts: JOIN `concept_id` AND `locale='en'` AND `concept_name_type='FULLY_SPECIFIED'`.

## API access
- **REST:** orders `GET /openmrs/ws/rest/v1/order?patient={uuid}&t=testorder` ; results `GET /openmrs/ws/rest/v1/obs?patient={uuid}&concept={uuid}`.
- **FHIR R4:** orders → `GET /openmrs/ws/fhir2/R4/ServiceRequest?subject={uuid}` ; results → `GET /openmrs/ws/fhir2/R4/Observation?subject={uuid}&category=laboratory`. The FHIR loop is ServiceRequest→Observation (here matched by code+subject, not `basedOn`).
- **Reporting/SQL:** SQL below.

## Method (how to compute)
1. Restrict to lab orders: `orders` JOIN `test_order`, non-voided; decode concept via `concept_name`.
2. Tally demand by concept (the test menu / mix).
3. For each order, check for an existence of a matching numeric obs (same `patient_id`+`concept_id`). Completeness = matched / total.
4. For matched pairs, compute TAT proxy from `date_activated` to `obs_datetime`.

```sql
-- Lab demand mix (top tests)
SELECT cn.name AS test, COUNT(*) AS orders
FROM orders o
JOIN test_order t   ON o.order_id = t.order_id
JOIN concept_name cn ON o.concept_id = cn.concept_id
   AND cn.locale='en' AND cn.concept_name_type='FULLY_SPECIFIED'
WHERE o.voided = 0
GROUP BY cn.name
ORDER BY orders DESC;

-- Order -> result completeness (concept-match heuristic)
SELECT
  COUNT(*) AS test_orders,
  SUM(EXISTS (
    SELECT 1 FROM obs ob
    WHERE ob.person_id = o.patient_id
      AND ob.concept_id = o.concept_id
      AND ob.value_numeric IS NOT NULL
      AND ob.voided = 0)) AS orders_with_result,
  ROUND(100*SUM(EXISTS (
    SELECT 1 FROM obs ob
    WHERE ob.person_id=o.patient_id AND ob.concept_id=o.concept_id
      AND ob.value_numeric IS NOT NULL AND ob.voided=0))/COUNT(*),1) AS pct_resulted
FROM orders o
JOIN test_order t ON o.order_id = t.order_id
WHERE o.voided = 0;

-- TAT proxy (days) for matched pairs
SELECT cn.name AS test,
       ROUND(AVG(DATEDIFF(ob.obs_datetime, o.date_activated)),1) AS avg_tat_days
FROM orders o
JOIN test_order t ON o.order_id=t.order_id
JOIN concept_name cn ON o.concept_id=cn.concept_id
   AND cn.locale='en' AND cn.concept_name_type='FULLY_SPECIFIED'
JOIN obs ob ON ob.person_id=o.patient_id AND ob.concept_id=o.concept_id
   AND ob.value_numeric IS NOT NULL AND ob.voided=0
   AND ob.obs_datetime >= o.date_activated
WHERE o.voided=0
GROUP BY cn.name ORDER BY avg_tat_days DESC;
```

**Live numbers (current snapshot):** 766 orders total — Test 404 / Drug 324 / Procedure 38. Of **399 non-voided test orders, 167 (~42%)** have a concept-matched numeric result. Top demand: White blood cells (161), Complete blood count (75), Serum creatinine (57), Absolute reticulocyte count (38), Liver function tests (34). Orders span **2026-02-03 → 2026-05-04**.

## Caveats with THIS dataset
- **GENERATED data** — structure/keys/method REAL and reusable; counts synthetic. See `../EMR-DATA-UNDERSTANDING.md`.
- **No hard order→result FK.** Completeness is a **concept+patient heuristic**, so numbers are **approximate**: a result obs from a *different* order of the same test for the same patient will falsely count as "resulted," and panel orders (e.g. CBC) whose results are stored under component concepts will falsely count as "not resulted." The ~42% match rate is therefore a method check, not a true completeness rate.
- **Concept-decoding mismatch:** ordered concepts (e.g. "Complete blood count", "Liver function tests") are *panels*, while the 10 numeric result concepts are *components* (WBC, Haemoglobin, Platelets…). Production matching needs a panel→component concept map.
- TAT proxy uses `obs_datetime`; synthetic timestamps are not lab-workflow-anchored, so TAT values are illustrative.
- 10 orders are voided — always filter `voided=0`.

## Follow-on questions
- With a panel→component concept map, what is the true result-completeness per test, and which tests have the worst result-return loop?
- What is the real TAT distribution once result entry timestamps are authentic?
- Do unresulted orders cluster by ordering encounter type or location (pointing to a specific broken workflow)?
