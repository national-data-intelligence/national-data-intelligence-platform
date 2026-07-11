# EthioEMR · synthesizer rewire (NHDW shared entity model)

`scripts/synthesize.py` now sources every entity from
`0_external/sources/_shared/_build/*.json` so EthioEMR rows join cleanly to MFR, DHIS2,
HCMIS and mBrana on the same keys.

## Tables rewritten

| Table | Source | Key contract |
|---|---|---|
| `location` | `facilities.json` where `tier_id ∈ {HC,PH,GH,SH}` (~338) | `uuid = uuid5(NS_DNS, facility_id)`; `address1` smuggles `FAC_ID=…;MFR_ID=…`; `description = tier_name` |
| `program` | `programmes.json` (HIV, TB, MNCH, NCD) | `description` carries `[programme_id=HIV]…`; NCD added as `program_id=100`, others reuse seed ids 1/3/4 |
| `drug` | 14-item curated subset of `commodities.json` | `drug.name` == shared `commodity_id` (e.g. `HIV-TLD`) |
| `person`, `patient`, `person_name`, `person_address`, `patient_identifier` | generated | address tied to home-facility region / zone / woreda |
| `visit`, `encounter`, `encounter_provider`, `obs` | generated | `encounter_datetime` clamped to the `periods.json` window (2023-01-01 → 2026-06-30) |
| `orders` + `drug_order` | curated commodities | one drug order per ART Refill / NCD / TB consult at ~70% rate |
| `patient_program` | cohort rules | HIV 12% all, TB 8% all, MNCH 22% women 15-49, NCD 14% age ≥35 |
| `conditions` | NCD problem list | HTN / DM for 20% of patients ≥35 |
| `patient.allergy_status` | flip | 6% set to `See List` |

Untouched: concept dictionary, `liquibasechangelog`, every `muzima_*` / `il_*` / `fhir_*` / `openconceptlab_*` / `stockmgmt_*` module table.

## Env knobs

| Var | Default | Notes |
|---|---|---|
| `ETHIOEMR_SYNTH_PATIENT_COUNT` | **1500** | was 500 |
| `ETHIOEMR_SYNTH_PROVIDER_COUNT` | 20 | |
| `ETHIOEMR_SYNTH_YEARS_HISTORY` | 3 | clamped to periods window |
| `ETHIOEMR_SYNTH_LOCATION_COUNT` | **0** → all 338 | set >0 only for smoke runs |
| `ETHIOEMR_SYNTH_SEED` | unset → inherits `entity-model.yaml.random_seed` (20260624) | |

## Sample row counts (defaults)

```
location              338     drug                14
program                 4     provider            20
patient              1500     patient_identifier ~2400
visit              ~6750     encounter        ~13500
encounter_provider~13500     obs            ~100000
orders             ~4500     drug_order        ~4500
patient_program    ~1100     conditions         ~150
```

## Run

```bash
cd 0_external/sources/EthioEMR
python3 scripts/synthesize.py
```

Idempotent: regenerated tables are `DELETE`-d before re-insert and every UUID
is `uuid5(NS_DNS, key)`, so re-running with the same seed reproduces the same
rows.
