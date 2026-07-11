# EMR Insight NN — <Title>

> **Source:** OpenMRS / EthioEMR **only** (single-source). **Domain:** <HIV | TB | MCH | OPD | Lab | Pharmacy | Operations>.

## The question
The precise business question(s) this insight answers. State it the way a stakeholder would ask it.

## Why it matters / stakeholder
- **Primary stakeholder:** <role>
- **Decision it drives:** <what action changes based on the answer>
- **Standard / framework:** <e.g. WHO/PEPFAR cascade, HMIS indicator, IPT, ANC4+ — if applicable>

## Metric definition
- **Numerator / denominator / formula:**
- **Grain:** <patient | encounter | visit | obs | month>
- **Dimensions to slice by:** <time, age band, sex, location, provider, program>

## OpenMRS source (tables & key fields)
- Tables and the joins that connect them; the columns that carry the answer.

## API access
- **REST:** `/openmrs/ws/rest/v1/...`
- **FHIR R4:** `/openmrs/ws/fhir2/R4/...`
- **Reporting/SQL:** direct SQL or the Reporting/Cohort Builder module.

## Method (how to compute)
Step-by-step, with a SQL sketch against the tables above.

## Caveats with THIS dataset
Synthetic-data limitations specific to this metric (what is trustworthy vs what is generator artifact), referencing `../EMR-DATA-UNDERSTANDING.md`.

## Follow-on questions
Two or three deeper questions this one naturally leads to.
