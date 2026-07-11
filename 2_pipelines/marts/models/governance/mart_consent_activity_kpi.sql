/*
    mart_consent_activity_kpi — Governance KPI strip (bi_governance).
    Three rows (label, value) covering current consent state:
      - "active consents"   distinct gated patients whose data the
        consent gate currently SERVES — i.e. patients in the gated PHI
        population NOT suppressed by a blanket or purpose=public-health
        revocation (the exact gate bi_demo_patient_observations applies,
        via the same consent_gate() macro, so the KPI can never drift
        from the gate)
      - "revoked (24h)"     revocations in the trailing 24 hours
      - "pending review"    revocations with `source = 'pending'` (review queue)

    Gated population: nhdw_landing.demo_patient_phi (the Phase-3.5
    fixture every consent-gated mart reads). When a real PHI source
    ships, swap the population source — the consumer contract (3
    label/value rows) is unchanged.

    NOTE: no dashboard renders this yet — the internal-BI Governance
    page is not built. The mart is kept (correct logic, correct schema)
    as the contract for that page; wire a gateway fetcher + widget when
    the page lands.
*/
{{ config(materialized='table') }}

WITH counts AS (
    SELECT
        (SELECT COUNT(DISTINCT g.patient_id)
           FROM {{ consent_gate(source('nhdw_landing', 'demo_patient_phi'),
                                patient_id_col='patient_id',
                                purpose='public-health') }} g) AS active_consents,
        (SELECT COUNT(*)
           FROM {{ source('nhdw_landing', 'consent_revocations') }}
          WHERE revoked_at >= (now() - interval '24 hours')) AS revoked_24h,
        (SELECT COUNT(*)
           FROM {{ source('nhdw_landing', 'consent_revocations') }}
          WHERE source = 'pending')                          AS pending_review
)
SELECT 'active consents'::text AS label, active_consents::bigint AS value FROM counts
UNION ALL
SELECT 'revoked (24h)'::text,           revoked_24h::bigint           FROM counts
UNION ALL
SELECT 'pending review'::text,          pending_review::bigint         FROM counts
