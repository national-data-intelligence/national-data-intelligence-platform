/*
    Phase-3.5 sample PHI mart — patient-level observations, consent-gated.

    Uses the consent_gate() macro to anti-join the consent_revocations
    table at query time. Each result row is GUARANTEED to come from a
    patient with no active revocation for purpose=public-health (or
    blanket).

    Lives in bi_staging until promoted via marts_promote. Even at
    bi_staging it is consent-gated — gate is at SQL, not at promotion.
*/

SELECT *
FROM {{ consent_gate(source('nhdw_landing', 'demo_patient_phi'),
                     patient_id_col='patient_id',
                     purpose='public-health') }} phi
ORDER BY encounter_date, patient_id
