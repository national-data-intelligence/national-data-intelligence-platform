# HCMIS-WDM · synthesizers wired to shared entity model

Both synthesizers now read every reference dimension from
`./0_external/sources/_shared/_build/*.json` instead of hardcoded
Python tuples. HCMIS-WDM rows are deterministically joinable to MFR /
DHIS2 / EthioEMR / mBrana on shared keys.

## Tables rewritten

`scripts/synthesize.py` (Vaccine schema):

- `Vaccine.Environment` ← `epss_hubs.json` (19 hubs)
- `Vaccine.Item` ← EPI commodities from `commodities.json` (10 vaccines)
- `Vaccine.Institution` ← `facilities.json` (893; every tier)
- `Vaccine.DailyRecord` / `Received` / `Issued` / `Expired` — volumetric tables, env-knob driven

`scripts/synthesize_analytics.py` (Dim / Commodity / Fact):

- `Dim.Program` ← `programmes.json` (8); `Dim.Environment` mirrors the 19
  hubs; `Dim.Item` mirrors the 10 EPI vaccines; `Dim.Date` ← `periods.json`
  days (Gregorian + Ethiopian columns from the canonical source)
- `Commodity.Product` ← all 34 commodities; `Commodity.Supplier` ← suppliers
  from `commodities.json` (GAVI, GFATM, PEPFAR, UNFPA, UNICEF, COVAX, WFP, EPSS)
- `Fact.DailyRecord` / `Fact.Inventory` — monthly grain, all 19 hubs × 34 commodities × 3 modes

Canonical IDs (`hub_id`, `region_id`, `facility_id`, `mfr_id`,
`commodity_id`) are stashed in the `Description` columns so dbt can join
without surrogate-key arithmetic.

## Env knobs (`.env`)

- `SYNTH_FACILITY_COUNT` — default `all` (loads all 893); integer samples N.
- `SYNTH_YEARS_HISTORY` — default `3`.
- `SYNTH_RANDOM_SEED` — default `20260624` (entity-model `random_seed`).
- `SYNTH_FACT_DAILY_CAP` — default `80000` (Fact.DailyRecord hard cap).

## Expected row counts

| Table | Rows |
|---|---|
| Vaccine.Environment / Unit / Item | 19 / 4 / 10 |
| Vaccine.Institution | 893 |
| Vaccine.DailyRecord | ~60,000 (weekly × {Dose,Vial}) |
| Vaccine.Received / Issued / Expired | ~1.8k / ~2.9k / ~0.2k |
| Dim.Mode / Program / Environment / Item | 3 / 8 / 19 / 10 |
| Dim.Date | ~1,277 |
| Commodity.Product / Supplier / Program | 34 / 8 / 8 |
| Fact.DailyRecord / Inventory | ≤80,000 / ~4,300 |

Both scripts are idempotent (`DELETE FROM` inside a transaction precedes every `INSERT`).

## Run command

```bash
cd ./0_external/sources/HCMISWDM
python3 scripts/synthesize.py && python3 scripts/synthesize_analytics.py
```
