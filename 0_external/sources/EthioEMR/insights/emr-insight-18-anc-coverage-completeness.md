# EMR Insight 18 — ANC Coverage & Contact Completeness

> **Source:** OpenMRS / EthioEMR **only** (single-source). **Domain:** MCH.

## The question
How many antenatal contacts does each pregnant woman receive, and what share of women reach **ANC4+** (≥4 contacts) and the **WHO 2016 8-contact** standard? Where in the contact ladder do women drop off?

## Why it matters / stakeholder
- **Primary stakeholder:** MCH/RMNCH coordinator; ANC focal nurse; district RH officer.
- **Decision it drives:** Whether women are completing the recommended schedule of antenatal contacts. Low ANC4+/8-contact completeness drives demand-generation, defaulter-tracing, and scheduling interventions.
- **Standard / framework:** **WHO 2016 ANC model — 8 contacts** (replacing the older 4-visit "focused ANC"). Legacy HMIS still reports **ANC1** (first contact) and **ANC4+** (≥4 contacts). Both are computed here.

## Metric definition
- **Numerator / denominator / formula:**
  - *Denominator:* distinct women with ≥1 ANC contact (proxy for pregnant women in care; no population denominator — single-source).
  - *ANC4+ rate:* women with ≥4 ANC contacts in an episode / denominator.
  - *8-contact rate:* women with ≥8 ANC contacts / denominator.
  - *Drop-off ladder:* count of women reaching exactly N contacts, N=1..8+.
- **Grain:** pregnancy **episode** (approximated — see method), aggregated to patient and to month.
- **Dimensions to slice by:** age band, episode start month, location, contact number.

## OpenMRS source (tables & key fields)
- `encounter` — `encounter_id`, `patient_id`, `encounter_type`, `encounter_datetime`, `visit_id`, `location_id`. ANC contacts = encounters whose type is **"ANC"** (4,462 encounters).
- `encounter_type` — `encounter_type_id`, `name`. **LEFT JOIN** — `encounter_type=241` is a dangling FK on 4,470 encounters; ANC type resolves cleanly.
- `visit` — optional, to bound an episode by visit windows.
- `person` — `gender` (female), `birthdate`.
- *No pregnancy-ID table* — episodes are derived (see caveat).

## API access
- **REST:** `GET /openmrs/ws/rest/v1/encounter?patient={uuid}&encounterType={ancUuid}&v=custom:(encounterDatetime)` to list a woman's ANC contacts.
- **FHIR R4:** `GET /openmrs/ws/fhir2/R4/Encounter?subject={patientUuid}&type=ANC` (or by class) — count and order by `period.start`.
- **Reporting/SQL:** KenyaEMR MCH/ANC report definitions, or SQL below.

## Method (how to compute)
1. Select ANC encounters (`encounter_type` resolving to name `'ANC'`), LEFT JOIN `encounter_type` to survive the dangling FK.
2. **Approximate the pregnancy episode:** cluster a woman's ANC encounters; start a new episode when the gap between consecutive ANC encounters exceeds ~9 months (270 days). Within an episode, order encounters → contact number.
3. Per episode compute total contacts; flag ANC4+ (≥4) and 8-contact (≥8).
4. Build the drop-off ladder = women reaching exactly N contacts.

```sql
-- Contacts per patient (single-episode approximation) and ANC4+/8 flags
WITH anc AS (
  SELECT e.patient_id, COUNT(*) AS contacts
  FROM encounter e
  LEFT JOIN encounter_type et ON e.encounter_type = et.encounter_type_id
  WHERE et.name = 'ANC' AND e.voided = 0
  GROUP BY e.patient_id
)
SELECT
  COUNT(*)                                   AS women_with_anc,
  SUM(contacts >= 1)                         AS anc1,
  SUM(contacts >= 4)                         AS anc4plus,
  SUM(contacts >= 8)                         AS anc8,
  ROUND(100*SUM(contacts>=4)/COUNT(*),1)     AS pct_anc4plus,
  ROUND(100*SUM(contacts>=8)/COUNT(*),1)     AS pct_anc8
FROM anc;

-- Drop-off ladder
SELECT LEAST(contacts,8) AS contact_band, COUNT(*) AS women
FROM (
  SELECT e.patient_id, COUNT(*) AS contacts
  FROM encounter e
  LEFT JOIN encounter_type et ON e.encounter_type = et.encounter_type_id
  WHERE et.name='ANC' AND e.voided=0
  GROUP BY e.patient_id
) t
GROUP BY contact_band ORDER BY contact_band;
```

**Live numbers (current snapshot):** 4,462 ANC encounters. Contacts-per-woman distribution: 1→887, 2→599, 3→382, 4→187, 5→58, 6→20, 7→7, 8→3 women. So ANC4+ ≈ **275 of ~2,143 women (~13%)** and 8-contact ≈ **3 women** — patterns to validate as method, not real coverage.

## Caveats with THIS dataset
- **GENERATED data** — structure/keys/method REAL and reusable; counts synthetic. See `../EMR-DATA-UNDERSTANDING.md`.
- **No pregnancy ID.** Episodes are *approximated* by clustering ANC encounters per woman with a gap threshold; the SQL above uses the simplest one-episode-per-woman approximation. A woman with two pregnancies in the window will be over-counted as one long episode — refine with the 270-day gap rule for production.
- **Dangling encounter_type FK** (`241` on 4,470 encounters) — always LEFT JOIN; an INNER JOIN silently drops rows.
- **Single-source denominator only.** This measures completeness *among women already in ANC care*; true population ANC coverage needs a population denominator and is **out of scope** (never combine with population data).
- No gestational-age obs to confirm contact timing vs the WHO schedule; contact *number* is available, contact *timing-appropriateness* is not.

## Follow-on questions
- With a 270-day gap rule, how many women have multiple pregnancy episodes, and does ANC4+ differ between first and subsequent pregnancies?
- Do ANC contacts cluster late (poor early-booking / ANC1 timing) once visit datetimes are analysed?
- How does ANC completeness relate to MCH-program retention (→ Insight 19)?
