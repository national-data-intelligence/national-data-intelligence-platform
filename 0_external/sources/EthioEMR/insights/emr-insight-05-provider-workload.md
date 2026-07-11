# EMR Insight 05 — Provider Workload Distribution

> **Source:** OpenMRS / EthioEMR **only** (single-source). **Domain:** Operations.

## The question
How is clinical workload distributed across **providers**? How many **encounters** and **distinct patients** does each provider handle, and is the load **concentrated** on a few clinicians or spread equitably across the team?

## Why it matters / stakeholder
- **Primary stakeholder:** Facility manager / clinical lead; HR / rostering.
- **Decision it drives:** Detect overloaded vs under-utilised clinicians, rebalance rosters, justify additional staff, and flag burnout risk. Concentration is also a continuity-of-care and key-person-risk signal.
- **Standard / framework:** Workforce / workload-distribution analysis; equity measured via share-of-top-N or a Gini/Herfindahl concentration index.

## Metric definition
- **Numerator / denominator / formula:**
  - `encounters_per_provider = COUNT(encounter_provider rows) per provider_id`.
  - `patients_per_provider = COUNT(DISTINCT patient_id) per provider`.
  - Concentration: share handled by the top-5 providers; or Gini over per-provider encounter counts.
- **Grain:** provider (aggregating the encounter↔provider link).
- **Dimensions to slice by:** time (month), `encounter_type`, `visit_type`, `location_id`, provider role.

## OpenMRS source (tables & key fields)
- `encounter_provider` — **the link table; MANY-TO-MANY** (`encounter_id`, `provider_id`, `encounter_role_id`). One encounter can have several providers; one provider many encounters. This is the grain for workload.
- `provider` — `provider_id`, `person_id`, `identifier`, `name` (60 rows).
- `encounter` — `encounter_id`, `patient_id`, `encounter_datetime`, `encounter_type` for slicing.
- `users` (47 rows) is the *login* account, distinct from `provider` (the clinical actor) — **do not** equate them; join workload through `provider`.

## API access
- **REST:** `/openmrs/ws/rest/v1/provider` (catalog); `/openmrs/ws/rest/v1/encounter?provider=<uuid>&v=custom:(uuid,encounterDatetime,patient:(uuid))` to pull a provider's encounters.
- **FHIR R4:** `/openmrs/ws/fhir2/R4/Practitioner` ; `/openmrs/ws/fhir2/R4/Encounter?participant=<practitioner-id>`.
- **Reporting/SQL:** the link-table aggregation below; the Reporting module can group an encounter indicator by provider.

## Method (how to compute)
1. Aggregate `encounter_provider` by `provider_id` → encounter count.
2. Join to `encounter` for distinct-patient counts and time slicing.
3. Rank providers; compute top-5 share and a concentration ratio.

```sql
-- Workload league table
SELECT p.provider_id,
       COALESCE(p.name, p.identifier)                          AS provider,
       COUNT(*)                                                AS encounters,
       COUNT(DISTINCT e.patient_id)                            AS distinct_patients,
       ROUND(100*COUNT(*)/SUM(COUNT(*)) OVER (), 2)            AS pct_of_all_encounters
FROM   encounter_provider ep
JOIN   encounter e ON e.encounter_id = ep.encounter_id AND e.voided = 0
JOIN   provider  p ON p.provider_id  = ep.provider_id
GROUP  BY p.provider_id, provider
ORDER  BY encounters DESC;

-- Concentration: share handled by the busiest 5 providers
WITH per_prov AS (
  SELECT ep.provider_id, COUNT(*) AS enc
  FROM   encounter_provider ep
  JOIN   encounter e ON e.encounter_id = ep.encounter_id AND e.voided = 0
  GROUP  BY ep.provider_id
)
SELECT SUM(enc)                                                       AS total_enc,
       SUM(CASE WHEN rnk <= 5 THEN enc ELSE 0 END)                    AS top5_enc,
       ROUND(100*SUM(CASE WHEN rnk<=5 THEN enc ELSE 0 END)/SUM(enc),1) AS top5_share_pct
FROM (SELECT enc, RANK() OVER (ORDER BY enc DESC) AS rnk FROM per_prov) r;
```

Observed (live DB): **60 providers, all active**; 26,773 encounter↔provider links (≈1 provider per encounter here). Load is **near-uniform** — busiest provider ≈497 encounters, mean ≈446 — so top-5 share is only marginally above the equal-split 8.3%.

## Caveats with THIS dataset
- **The near-uniform distribution is the headline artifact.** Real facilities are highly skewed (a few clinicians carry most load); here the generator spreads encounters almost evenly across 60 providers. Trust the *many-to-many join, the league-table method, and the concentration formula*; do **not** present this flat distribution as a real equity finding.
- **`encounter_provider` is many-to-many** — counting `encounter` rows instead of link rows, or joining provider directly onto `encounter`, will mis-state workload. Always aggregate the link table.
- **`provider` ≠ `users`** (60 vs 47): provider is the clinical actor for workload; users is the login account. Don't cross-attribute.
- Encounter roles exist (`encounter_role_id`) but are uniform here; role-based splitting (e.g. attending vs nurse) won't be meaningful until real data.
- See `../EMR-DATA-UNDERSTANDING.md`.

## Follow-on questions
- Does workload concentration **change over time** (rolling monthly top-5 share)?
- Do certain providers specialise by **encounter_type or visit_type** (e.g. ANC vs ART Refill vs IPD)?
- Cross with **service intensity** (Insight 04): do high-volume providers also log more obs per encounter, or fewer (a quality flag)?
