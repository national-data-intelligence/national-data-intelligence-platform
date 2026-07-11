# EMR Insight 06 — Service-Delivery-Point (Location) Utilization

> **Source:** OpenMRS / EthioEMR only (single-source). **Domain:** Operations.

## The question
Across the network of service-delivery points captured in this EMR, **which facilities and health posts carry the clinical workload?** Concretely: how are the 26,773 encounters distributed across the 80 locations (health posts, health centers, clinics, drug stores) in the `location` table, and where are the high- and low-volume sites?

## Why it matters / stakeholder
- **Primary stakeholder:** District / woreda health-office operations lead and the EMR program manager.
- **Decision it drives:** Staffing and supply allocation, supportive-supervision targeting, identification of under-utilized or possibly-mis-configured sites, and load-balancing of catchment populations.
- **Standard / framework:** WHO Service Availability and Readiness Assessment (SARA) "service utilization" indicators; Ethiopian HMIS facility-level OPD/IPD attendance reporting. This is the classic **utilization-by-service-delivery-point** operational view.

## Metric definition
- **Numerator:** count of encounters (optionally distinct visits, or distinct patients) attributed to a location.
- **Denominator:** total encounters across all locations (for share), or the count of active days (for an encounters-per-day rate).
- **Formula:** `utilization_share(loc) = encounters(loc) / total_encounters`; `daily_rate(loc) = encounters(loc) / active_days(loc)`.
- **Grain:** one row per `location_id` (roll-up), or `location_id × month` for a trend.
- **Dimensions to slice by:** location type (health post vs. health center vs. clinic vs. drug store — inferable from the name), encounter_type, month, patient gender/age band.

## OpenMRS source (tables & key fields)
- `encounter` — `encounter_id`, `location_id`, `encounter_datetime`, `encounter_type`, `patient_id`, `visit_id`, `voided` (=0 everywhere here).
- `location` — `location_id`, `name`, `description`, `retired`. 80 rows (Adama-area health posts & drug stores, e.g. "Maynebri Health Post", "Asha Ad Health post", "Abule Drug store").
- `encounter_type` — `encounter_type_id`, `name`. **GOTCHA:** `encounter_type=241` is a dangling FK on 4,470 encounters — always `LEFT JOIN`.
- `visit` — `visit_id`, `location_id` (visit-level location, usually equal to encounter location).

## API access
- **REST:** list locations `GET /openmrs/ws/rest/v1/location?v=default` (and `/location/{uuid}`). Per-encounter location: `GET /openmrs/ws/rest/v1/encounter?location={uuid}&fromdate=...&todate=...&v=custom:(uuid,location:(display))`.
- **FHIR R4:** `GET /openmrs/ws/fhir2/R4/Location` for the master list; `GET /openmrs/ws/fhir2/R4/Encounter?location={id}&date=ge2024-01-01` for utilization. FHIR `Encounter.location` carries the SDP reference.
- **Reporting/SQL:** the aggregate counts below are best done directly in SQL (or the OpenMRS Reporting module's SqlCohortDefinition), not row-by-row over REST.

## Method (how to compute)
1. Aggregate `encounter` by `location_id`, counting encounters, distinct visits, and distinct patients.
2. `LEFT JOIN location` to attach the site name; `LEFT JOIN encounter_type` so dangling type 241 does not silently drop rows.
3. Derive a coarse location_type by pattern-matching the name (`Health Post`, `Health Center`/`Health center`, `Clinic`, `Drug Store`/`Drug store`).
4. Compute share = site count / grand total, and a per-active-day rate using `COUNT(DISTINCT DATE(encounter_datetime))`.
5. Rank and inspect the head and the tail (zero/low-volume sites).

```sql
-- Utilization by service-delivery point
SELECT  l.location_id,
        l.name AS location_name,
        CASE
          WHEN l.name LIKE '%Health Post%'   THEN 'Health Post'
          WHEN l.name LIKE '%Health Cent%'   THEN 'Health Center'
          WHEN l.name LIKE '%Clinic%'        THEN 'Clinic'
          WHEN l.name LIKE '%Drug Store%'    THEN 'Drug Store'
          ELSE 'Other'
        END                                            AS location_type,
        COUNT(*)                                       AS encounters,
        COUNT(DISTINCT e.visit_id)                     AS visits,
        COUNT(DISTINCT e.patient_id)                   AS patients,
        COUNT(DISTINCT DATE(e.encounter_datetime))     AS active_days,
        ROUND(COUNT(*) / COUNT(DISTINCT DATE(e.encounter_datetime)), 2) AS enc_per_active_day,
        ROUND(100 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS pct_of_total
FROM        encounter      e
LEFT JOIN   location       l  ON e.location_id = l.location_id
LEFT JOIN   encounter_type et ON e.encounter_type = et.encounter_type_id
WHERE       e.voided = 0
GROUP BY    l.location_id, l.name
ORDER BY    encounters DESC;
```

Observed head of the distribution (live DB, 2026-06-11):

| Location | Encounters |
|---|---|
| Ferazagmir Basic Health Post | 402 |
| Ardo Health Post | 398 |
| Haile Drug Store | 388 |
| Kunzila Health Center | 388 |
| Gada Medium Clinic | 380 |
| Maraol Drug Store | 378 |
| Maynebri Health Post | 377 |
| Deneba Health center | 373 |

```sql
-- Location × month, for a utilization trend / heatmap
SELECT  l.name,
        DATE_FORMAT(e.encounter_datetime, '%Y-%m') AS ym,
        COUNT(*) AS encounters
FROM        encounter e
LEFT JOIN   location  l ON e.location_id = l.location_id
WHERE       e.voided = 0
GROUP BY    l.location_id, ym
ORDER BY    l.name, ym;
```

## Caveats with THIS dataset
- **Synthetic data.** Content is generator-produced; the *schema, keys and relationships are real and warehouse-ready*, but the volumes are not real captured utilization. See `../EMR-DATA-UNDERSTANDING.md`.
- **Volume is deliberately flat.** Encounters are spread at ~20–30/day network-wide and the per-site totals cluster tightly (~370–400 at the top, see table). In a real system you would expect a steep long tail (a few busy health centers, many tiny health posts). **The near-uniform distribution here is an artifact** — do not conclude "all sites are equally busy." The *method* (ranking + share + per-day rate) is what transfers.
- **Location semantics are inferred from names.** OpenMRS does not tag a structured facility level; the `location_type` CASE is a heuristic. "Drug Store" sites generating clinical encounters is itself a generator quirk.
- **No voids/updates.** `voided=0` and `date_changed` NULL everywhere, so no need to filter retired/edited encounters here, but real ELT must.
- **Dangling encounter_type 241** affects 4,470 rows — harmless for location counts if you `LEFT JOIN`, but will null-out type in any type×location crosstab.

## Follow-on questions
- Which sites have *declining* month-over-month utilization (early-warning for a site going dark)?
- Does the encounter-type mix differ by location level (e.g. do health posts skew to triage/immunization vs. clinics to consults)?
- What is the patient-to-site loyalty pattern — do patients attend a single SDP or shop across sites? (distinct patients per site vs. patients appearing at multiple sites)
- Catchment estimate: distinct patients per site as a proxy for served population (EMR-internal only; do **not** merge external population denominators in this single-source view).
