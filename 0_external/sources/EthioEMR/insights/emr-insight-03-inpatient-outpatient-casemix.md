# EMR Insight 03 — Inpatient vs Outpatient Case Mix

> **Source:** OpenMRS / EthioEMR **only** (single-source). **Domain:** Operations.

## The question
What is the split of facility activity between **outpatient** and **inpatient** care, by `visit_type`, and how does that mix trend over time? Is the facility primarily an OPD operation, and is the IPD share growing or shrinking?

## Why it matters / stakeholder
- **Primary stakeholder:** Medical Director / facility manager; District planners.
- **Decision it drives:** Bed vs consultation-room capacity, ward staffing, IPD supply and budget allocation. A rising inpatient share signals demand for beds and acute-care resources; a dominant OPD share signals ambulatory throughput pressure.
- **Standard / framework:** Ethiopia HMIS OPD/IPD service-utilisation split; WHO inpatient-vs-outpatient utilisation indicators.

## Metric definition
- **Numerator / denominator / formula:**
  - `op_share = visits(Outpatient) / total_visits`; `ip_share = visits(Inpatient) / total_visits`.
  - Also at encounter grain: encounters by visit_type / total encounters.
  - Trend = OP/IP share per month.
- **Grain:** visit (primary), with an encounter-level cross-check.
- **Dimensions to slice by:** time (month/year), `location_id`, `encounter_type` within each visit_type.

## OpenMRS source (tables & key fields)
- `visit` — `visit_id`, `visit_type_id`, `date_started`, `patient_id`, `location_id`.
- `visit_type` — `visit_type_id`, `name` (the OPD/IPD label).
- `encounter` — join via `encounter.visit_id` to attribute encounters to a visit_type.
- Note `date_stopped` is **NULL on every visit** in this extract — visits are perpetually "open", so length-of-stay / occupancy cannot be derived here.

## API access
- **REST:** `/openmrs/ws/rest/v1/visittype` (catalog); `/openmrs/ws/rest/v1/visit?v=custom:(uuid,visitType:(display),startDatetime)`.
- **FHIR R4:** `/openmrs/ws/fhir2/R4/Encounter?class=IMP` (inpatient) vs `?class=AMB` (ambulatory) — FHIR maps OpenMRS visit class onto the v3-ActCode `class` element.
- **Reporting/SQL:** SQL below; or a Reporting indicator grouped by visit type.

## Method (how to compute)
1. Join `visit` → `visit_type` and count visits per type overall and per month.
2. Compute each type's share of total.
3. Optionally repeat at encounter grain by joining `encounter.visit_id → visit.visit_type_id`.

```sql
-- Overall case-mix split
SELECT vt.name                                        AS visit_type,
       COUNT(*)                                        AS visits,
       ROUND(100 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct_of_visits
FROM   visit v
JOIN   visit_type vt ON vt.visit_type_id = v.visit_type_id
GROUP  BY vt.name
ORDER  BY visits DESC;

-- Monthly OPD/IPD trend (share within each month)
SELECT DATE_FORMAT(v.date_started,'%Y-%m')             AS month,
       SUM(vt.name = 'Outpatient')                     AS outpatient,
       SUM(vt.name = 'Inpatient')                      AS inpatient,
       ROUND(100 * SUM(vt.name='Inpatient') / COUNT(*), 1) AS ip_share_pct
FROM   visit v
JOIN   visit_type vt ON vt.visit_type_id = v.visit_type_id
GROUP  BY month
ORDER  BY month;
```

Observed split (live DB): **Outpatient 11,423 visits (85.1%) · Inpatient 1,995 (14.9%)** of 13,418 total visits.

## Caveats with THIS dataset
- **The ~85/15 OP/IP ratio is a generator constant, not a clinical reality.** It is plausible in shape (OPD-dominant facility) but its stability over time is synthetic. Trust the *method and the OP/IP join*; do not over-read the exact ratio or its monthly steadiness.
- **No length-of-stay / occupancy possible:** every `date_stopped` is NULL (visits never close). You can count IPD *admissions* (visits) but not bed-days or ALOS from this extract.
- Encounter-level case mix is affected by the **dangling `encounter_type = 241`** (4,470 rows, 16.7%) — irrelevant if you classify by `visit_type` (the recommended path), but **use a LEFT JOIN** if you ever drill into `encounter_type`, or those rows vanish silently.
- See `../EMR-DATA-UNDERSTANDING.md`.

## Follow-on questions
- Within IPD visits, how many **encounters per admission** accrue? (→ Insight 04, service intensity)
- Do OPD and IPD draw on **different provider pools**? (→ Insight 05)
- Once real data lands and `date_stopped` is populated, what is the **average length of stay** and bed occupancy?
