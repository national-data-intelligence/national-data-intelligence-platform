# EMR Insights Catalogue — OpenMRS (EthioEMR)

25 industry-standard analytical questions answerable from the **EthioEMR / OpenMRS** source **alone** (single-source — no DHIS2, MFR, or population data combined). Each is a self-contained `.md` file pairing a business question with its stakeholder, metric definition, the exact OpenMRS tables/APIs that answer it, the method, and the caveats imposed by this (synthetic) dataset.

> Profiled against the live `openmrs` DB on 2026-06-11. System: OpenMRS 2.8.3 / KenyaEMR 19.3.1. See `../EMR-DATA-UNDERSTANDING.md` for the full source profile and the §0 synthetic-data warning that governs all numeric interpretation here.

## How to read each file
Every insight follows `emr-insights-TEMPLATE.md`: **Question → Why it matters / Stakeholder → Metric definition → OpenMRS source (tables) → API access → Method → Caveats with this dataset → Follow-on questions.**

## The 25 insights

### A. Service delivery & operations — *facility manager, M&E officer*
- [01 — Patient volume & encounter throughput](emr-insight-01-patient-volume-throughput.md)
- [02 — New vs returning patient acquisition](emr-insight-02-new-vs-returning-patients.md)
- [03 — Inpatient vs outpatient case mix](emr-insight-03-inpatient-outpatient-casemix.md)
- [04 — Service intensity (encounters/visit, obs/encounter)](emr-insight-04-service-intensity.md)
- [05 — Provider workload distribution](emr-insight-05-provider-workload.md)
- [06 — Service-delivery-point (location) utilization](emr-insight-06-location-utilization.md)
- [07 — Temporal demand patterns (day-of-week, seasonality)](emr-insight-07-temporal-demand-patterns.md)

### B. Morbidity & clinical profile — *clinical lead, epidemiologist*
- [08 — Leading causes of morbidity (top diagnoses)](emr-insight-08-leading-morbidity-diagnoses.md)
- [09 — Morbidity trends over time](emr-insight-09-morbidity-trends.md)
- [10 — Comorbidity & multi-diagnosis burden](emr-insight-10-comorbidity-burden.md)
- [11 — Morbidity by age & sex](emr-insight-11-morbidity-by-age-sex.md)

### C. HIV care — *HIV program coordinator*
- [12 — HIV treatment cohort & active-on-ART trend](emr-insight-12-hiv-art-cohort.md)
- [13 — ART appointment-keeping & defaulter/LTFU detection](emr-insight-13-art-appointment-keeping-ltfu.md)
- [14 — HIV viral-load testing coverage & suppression](emr-insight-14-hiv-viral-load-suppression.md)
- [15 — CD4 immunological status distribution](emr-insight-15-cd4-immunological-status.md)

### D. TB & maternal/child health — *TB & MCH coordinators*
- [16 — TB enrollment & treatment outcomes](emr-insight-16-tb-enrollment-outcomes.md)
- [17 — TB/HIV co-infection management](emr-insight-17-tb-hiv-coinfection.md)
- [18 — ANC coverage & contact completeness](emr-insight-18-anc-coverage-completeness.md)
- [19 — MCH / maternal program retention](emr-insight-19-mch-retention.md)

### E. Laboratory, pharmacy & registry — *lab manager, pharmacist, HIS officer*
- [20 — Laboratory demand & order-to-result completeness](emr-insight-20-lab-demand-order-to-result.md)
- [21 — Abnormal lab result detection (reference ranges)](emr-insight-21-abnormal-lab-results.md)
- [22 — Diagnostic test utilization mix](emr-insight-22-diagnostic-test-utilization.md)
- [23 — Prescribing & drug-order patterns](emr-insight-23-prescribing-drug-order-patterns.md)
- [24 — Patient demographic & catchment profile](emr-insight-24-demographic-catchment-profile.md)
- [25 — Patient identification & record completeness](emr-insight-25-patient-identification-completeness.md)
