# EMR Insight 04 — Service Intensity (Encounters per Visit, Obs per Encounter)

> **Source:** OpenMRS / EthioEMR **only** (single-source). **Domain:** Operations.

## The question
How **deep** is each patient interaction? On average, how many **encounters per visit** (steps in a visit's workflow) and how many **observations per encounter** (documented clinical data points) does the facility generate? This proxies clinical workload depth and documentation completeness, distinct from raw volume.

## Why it matters / stakeholder
- **Primary stakeholder:** Medical Director; M&E / data-quality officer; EMR/HIS administrator.
- **Decision it drives:** A rising encounters-per-visit can mean richer multi-step care or workflow fragmentation; obs-per-encounter is a documentation-completeness signal that drives data-quality remediation and clinician training. Intensity also informs realistic staffing-time estimates (volume alone understates load).
- **Standard / framework:** Health-information-system data-completeness / documentation-density metrics; service-intensity component of workload analysis.

## Metric definition
- **Numerator / denominator / formula:**
  - `enc_per_visit = COUNT(encounter) / COUNT(DISTINCT visit)`.
  - `obs_per_encounter = COUNT(obs) / COUNT(DISTINCT encounter)`.
  - Report mean **and** distribution (median, p90) — averages hide skew.
- **Grain:** ratio metrics over visit and encounter; distribution at the per-visit / per-encounter level.
- **Dimensions to slice by:** `visit_type` (OPD vs IPD), `encounter_type`, `location_id`, time, provider.

## OpenMRS source (tables & key fields)
- `visit` — `visit_id` (denominator for enc/visit).
- `encounter` — `encounter_id`, `visit_id`, `encounter_type` (numerator for enc/visit; denominator for obs/enc).
- `obs` — `obs_id`, `encounter_id`, `concept_id`, `value_*`, `voided` (numerator for obs/enc). Obs are the actual recorded clinical findings/values.
- Watch grouped obs: an `obs` row may have `obs_group_id` (a parent obs). Counting all rows counts members; for "questions answered" you may exclude rows that are themselves group containers.

## API access
- **REST:** `/openmrs/ws/rest/v1/encounter?visit=<uuid>` to list a visit's encounters; `/openmrs/ws/rest/v1/obs?encounter=<uuid>` or `/openmrs/ws/rest/v1/encounter/<uuid>?v=full` (obs inline).
- **FHIR R4:** `/openmrs/ws/fhir2/R4/Observation?encounter=<id>` ; `/openmrs/ws/fhir2/R4/Encounter?_revinclude=Observation:encounter`.
- **Reporting/SQL:** aggregate ratios are cheapest in SQL (below).

## Method (how to compute)
1. Count encounters grouped by visit → distribution of enc/visit.
2. Count obs grouped by encounter → distribution of obs/enc.
3. Report mean, median, p90; slice by visit_type and encounter_type.

```sql
-- Headline ratios
SELECT (SELECT COUNT(*) FROM encounter WHERE voided=0)
        / (SELECT COUNT(DISTINCT visit_id) FROM encounter WHERE voided=0)   AS enc_per_visit,
       (SELECT COUNT(*) FROM obs WHERE voided=0)
        / (SELECT COUNT(DISTINCT encounter_id) FROM obs WHERE voided=0)      AS obs_per_encounter;

-- Distribution of encounters per visit
SELECT enc_in_visit, COUNT(*) AS num_visits
FROM (
  SELECT visit_id, COUNT(*) AS enc_in_visit
  FROM   encounter WHERE voided=0 AND visit_id IS NOT NULL
  GROUP  BY visit_id
) t
GROUP BY enc_in_visit ORDER BY enc_in_visit;

-- Obs density per encounter_type (LEFT JOIN keeps the dangling type 241)
SELECT COALESCE(et.name, CONCAT('MISSING#', e.encounter_type)) AS encounter_type,
       COUNT(DISTINCT e.encounter_id)                          AS encounters,
       COUNT(o.obs_id)                                         AS obs,
       ROUND(COUNT(o.obs_id)/COUNT(DISTINCT e.encounter_id),2) AS obs_per_enc
FROM   encounter e
LEFT   JOIN encounter_type et ON et.encounter_type_id = e.encounter_type
LEFT   JOIN obs o            ON o.encounter_id = e.encounter_id AND o.voided = 0
WHERE  e.voided = 0
GROUP  BY encounter_type
ORDER  BY encounters DESC;
```

Observed (live DB): **~2.0 encounters/visit** (26,773 enc / 13,418 visits) and **~7.2 obs/encounter** (193,388 obs / 26,773 enc).

## Caveats with THIS dataset
- **Both ratios are near-constant by construction** — the generator emits a fixed template (~2 encounters per visit, ~7 obs each). Treat the *ratios and the join logic* as the deliverable; the tight, low-variance distribution is a synthetic artifact and will look very different on real clinical data (which is right-skewed: many light visits, a few heavy ones).
- **Use LEFT JOIN to `encounter_type`** — `encounter_type = 241` (4,470 encounters, 16.7%) is a dangling FK with no catalog row; an INNER JOIN silently drops these and biases obs-per-encounter.
- Only **5 encounter types carry obs** (Lab Order, ANC, Triage, Consultation, ART Refill) plus the orphan 241; the 226-row `encounter_type` catalog is mostly unused — do not expect per-type richness.
- Near-zero voids and no record updates (`date_changed` all NULL) mean documentation-completeness trends are flat — you cannot study real data-entry behaviour here.
- See `../EMR-DATA-UNDERSTANDING.md`.

## Follow-on questions
- Does intensity differ **OPD vs IPD** once real LOS data exists (IPD should accrue more encounters/obs per visit)?
- Which **obs concepts** dominate the per-encounter count (vitals vs diagnoses vs labs)?
- Is high obs/encounter correlated with specific **providers** — a documentation-quality or workload signal? (→ Insight 05)
