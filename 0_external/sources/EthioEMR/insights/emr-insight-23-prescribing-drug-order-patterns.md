# EMR Insight 23 — Prescribing & Drug-Order Patterns

> **Source:** OpenMRS / EthioEMR **only** (single-source). **Domain:** Pharmacy.

## The question
Which **drugs are prescribed most often**, how many **drug orders are written per encounter**, and what share of encounters show a **polypharmacy signal** (≥5 concurrent medications)? This is the prescribing-behaviour and medication-safety view, plus the pharmacy demand picture from the EMR alone.

## Why it matters / stakeholder
- **Primary stakeholder:** Pharmacy lead / drug & therapeutics committee; facility quality lead; warehouse owner forecasting medication demand.
- **Decision it drives:** Formulary management and stock forecasting, identification of irrational or excessive prescribing, polypharmacy review for at-risk patients (esp. elderly), and antimicrobial-stewardship targeting.
- **Standard / framework:** WHO/INRUD rational-use-of-medicines prescribing indicators (average drugs per encounter, % generic, % antibiotic), and the polypharmacy patient-safety definition (≥5 concurrent medicines).

## Metric definition
- **Numerator(s):** count of unvoided drug orders per drug; count of drug orders per encounter; count of encounters with ≥5 distinct active drug orders.
- **Denominator(s):** distinct encounters (→ drugs/encounter), total drug orders (→ mix share), distinct patients (→ polypharmacy patient rate).
- **Formulae:** `avg_drugs_per_encounter = drug_orders / distinct_encounters`; `polypharmacy_rate = encounters_with_ge5 / distinct_encounters`; `drug_mix_share = orders_for_drug / all_drug_orders`.
- **Grain:** drug-order line (`orders` / `drug_order` row). Roll up to encounter / patient / drug / month.
- **Dimensions to slice by:** drug, sex, age band, location, ordering encounter type, `date_activated` (month).

## OpenMRS source (tables & key fields)
- `orders` (766) — supertype; filter `order_type.name = 'Drug Order'` (324 such orders). Fields: `order_id`, `patient_id`, `encounter_id`, `concept_id`, `date_activated`, `voided`.
- `drug_order` (**29 rows — thin**) — subtype: `order_id`, `drug_inventory_id`, `dose`, `dose_units`, `frequency`, `route`, `duration`, `duration_units`, `quantity`, `quantity_units`, `drug_non_coded`.
- `drug` (1,714) — drug catalogue; `drug_order.drug_inventory_id → drug.drug_id` for the drug name (`drug.name`). For uncoded prescriptions use `drug_order.drug_non_coded`.
- `order_group` (764) — orders placed together (an encounter's prescription set).
- `concept_name` — to label the order's `concept_id` when no `drug` row exists.

## API access
- **REST:** `GET /openmrs/ws/rest/v1/order?orderType={drugOrderUuid}&v=full` returns `drug`, `dose`, `frequency`, `route`, `quantity`; per-patient `/order?patient={uuid}`.
- **FHIR R4:** `GET /openmrs/ws/fhir2/R4/MedicationRequest?patient={uuid}` and `?status=active`; `MedicationRequest.medicationReference → Medication`. Counting active `MedicationRequest` per patient gives polypharmacy natively.
- **Reporting/SQL:** SQL below, or an Indicator dataset grouped by drug.

## Method (how to compute)
1. **Drug mix:** join `orders`(Drug Order) → `drug_order` → `drug`; count per `drug_id`/name; compute share.
2. **Drugs per encounter:** count drug orders grouped by `encounter_id`, then average; distribution gives the polypharmacy tail.
3. **Polypharmacy:** flag encounters (or patients within a window) with `COUNT(DISTINCT drug) >= 5`.
4. Slice by sex/age (`person`), location, and `date_activated` month.

```sql
-- Most-ordered drugs (mix share)
SELECT
  COALESCE(d.name, do2.drug_non_coded, cn.name)        AS drug_label,
  COUNT(*)                                              AS orders_n,
  COUNT(DISTINCT o.patient_id)                          AS patients_n,
  ROUND(100 * COUNT(*) / SUM(COUNT(*)) OVER (), 1)      AS mix_pct
FROM orders o
JOIN order_type ot ON ot.order_type_id = o.order_type_id AND ot.name = 'Drug Order'
LEFT JOIN drug_order do2 ON do2.order_id = o.order_id
LEFT JOIN drug d        ON d.drug_id = do2.drug_inventory_id
LEFT JOIN concept_name cn
       ON cn.concept_id = o.concept_id
      AND cn.locale = 'en' AND cn.concept_name_type = 'FULLY_SPECIFIED'
WHERE o.voided = 0
GROUP BY drug_label
ORDER BY orders_n DESC;
```

```sql
-- Drugs per encounter + polypharmacy signal
WITH per_enc AS (
  SELECT o.encounter_id, COUNT(*) AS n_drugs
  FROM orders o
  JOIN order_type ot ON ot.order_type_id = o.order_type_id AND ot.name = 'Drug Order'
  WHERE o.voided = 0 AND o.encounter_id IS NOT NULL
  GROUP BY o.encounter_id
)
SELECT
  COUNT(*)                                              AS encounters_with_drugs,
  ROUND(AVG(n_drugs), 2)                                AS avg_drugs_per_encounter,
  MAX(n_drugs)                                          AS max_drugs,
  ROUND(100 * SUM(n_drugs >= 5) / COUNT(*), 1)          AS polypharmacy_pct
FROM per_enc;
```

## Caveats with THIS dataset
**GENERATED data — the prescribing model is structurally valid but near-empty in this seed.** Reference `../EMR-DATA-UNDERSTANDING.md`.
- **`drug_order` has only 29 rows** (against 324 Drug Order rows in `orders` and 766 orders total). The drug-name / dose / frequency detail is therefore almost absent — most Drug Order supertype rows have no `drug_order` subtype row, so drug labels fall back to `concept_id`. **Any prescribing number computed now is statistically empty**; report the method, not the figures.
- Observed `avg_drugs_per_encounter ≈ 1.1` (max 6) on the order supertype — plausible-looking but driven by a handful of synthetic rows; do **not** publish a polypharmacy rate from this seed.
- The 1,714-row `drug` catalogue is real and reusable (the join `drug_order.drug_inventory_id → drug.drug_id` is correct), but it is barely referenced by orders yet.
- No prescription edits/discontinuations (`date_changed` NULL, `voided=0`), so duration/active-window logic cannot be validated here.
- **This insight is expected to populate properly once the real hardened distro replaces the placeholder seed** (see `../DISTRO-SWAP.md`). The structure is the deliverable now.

## Follow-on questions
1. After the distro swap, what are the top-N drugs by volume, the WHO/INRUD average-drugs-per-encounter and %-antibiotic indicators, and how do they compare to national rational-use targets?
2. Which patients (especially 50+, the largest age band here) carry ≥5 concurrent active medications and warrant a medication review?
3. Can drug orders be linked to diagnoses (encounter `obs`/diagnoses) to surface treatment-guideline adherence per condition?
