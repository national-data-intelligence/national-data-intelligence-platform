# HCMIS WDM — Source Replica

## What this source is

**HCMIS WDM** (Health Commodity Management Information System — Warehouse Data Management; formerly **Vitas**) is Ethiopia's national supply-chain operational system, run by **EPSS** (Ethiopian Pharmaceutical Supply Service, formerly PFSA). It manages procurement, warehousing, requisition fulfilment, and stock control for pharmaceuticals and health commodities across the EPSS central warehouse + 17 regional hubs, flowing down to facility level (via Dagu and mBrana).

Real-world ownership: EPSS (Ministry of Health agency).

## Real-world interface

| Surface | Endpoint | Used by | Protocol |
|---|---|---|---|
| **SQL Server** (direct DB) | `jdbc:sqlserver://hcmis.epss.gov.et:1433;databaseName=HCMISWDM` (via SSH tunnel from outside the EPSS network) | NHDW ingestor (read replica) | TDS |

There is no public REST or FHIR API. The HCMIS WDM application is a Windows desktop client + thick service tier that reads/writes the database directly. External data access is exclusively via authorized read-only SQL logins (and increasingly through an internal `Fact.*` analytic layer maintained by EPSS).

## What this replica contains

| Item | Source | Volume |
|---|---|---|
| Schema (`sample-data/HCMISWDM.bak`) | Real EPSS production backup — schema-only snapshot taken before data load. | 19 MB, 143 + tables |
| Vaccine module backup (`HCMISWDM_Vaccine.bak`) | Vaccine subsystem backup — also schema-only. | 29 MB |
| MFR facility seed (`seeds/mfr_facilities.json`) | Real Master Facility Registry export — 63,805 Ethiopian facilities. | 26 MB |
| **Synthesized row data** | `scripts/synthesize.py` — generated against the restored schema | See table below |

### Synthesized data summary

Two synthesis scripts are run sequentially against a fresh restore:

**Phase 1 — `scripts/synthesize.py` (Vaccine.* operational schema):**

| Table | Rows | What it represents |
|---|---|---|
| `Vaccine.Environment` | 18 | EPSS central + 17 regional hubs |
| `Vaccine.Unit` | 4 | Dose / Vial / Box / Carton |
| `Vaccine.Item` | 20 | EPI vaccine catalog |
| `Vaccine.Institution` | 500 | Sampled real facilities from the MFR JSON |
| `Vaccine.DailyRecord` | ~58,000 | Weekly stock snapshots × 18 envs × 20 items × 3 yrs |
| `Vaccine.Received` | ~1,700 | Receipts into warehouses |
| `Vaccine.Issued` | ~2,800 | Issues out to institutions |
| `Vaccine.Expired` | ~200 | Expired stock disposals |

**Phase 2 — `scripts/synthesize_analytics.py` (Dim.*, Commodity.*, Fact.* analytics layer):**

| Table | Rows | What it represents |
|---|---|---|
| `Dim.Mode` | 3 | Central / Hub / Facility operating modes |
| `Dim.Program` | 6 | HIV / EPI / Malaria / TB / MNCH / RH |
| `Dim.Environment` | 18 | Mirrors `Vaccine.Environment` IDs for fact-table joins |
| `Dim.Item` | 20 | Mirrors `Vaccine.Item` IDs |
| `Dim.Date` | ~1,974 | Daily calendar with both Gregorian and **Ethiopian** dates |
| `Commodity.CommodityType` | 4 | Vaccine / Pharmaceutical / Supply / Diagnostic |
| `Commodity.Country` | 6 | Ethiopia + manufacturer countries |
| `Commodity.SupplierType` | 3 | Direct / Distributor / Donation Agency |
| `Commodity.Category` | 6 | Vaccines, Anti-malarials, ARVs, TB, Diagnostics, FP |
| `Commodity.UnitOfIssue` | 5 | Dose / Vial / Box / Carton / Pack |
| `Commodity.DosageForm` | 6 | Injection / Suspension / Tablet / Capsule / Kit / Net |
| `Commodity.Program` | 6 | Program catalog |
| `Commodity.Manufacturer` | 10 | Serum Institute, GSK, Sanofi, Pfizer, Moderna, etc. |
| `Commodity.Supplier` | 8 | UNICEF, Gavi, Global Fund, PFSA Direct, etc. |
| `Commodity.Product` | 30 | 20 vaccines + 10 non-vaccine commodities |
| **`Fact.DailyRecord`** | **~44,280** | Environment × Item × Mode × Date monthly facts (the primary ingestion target per the primer) |
| `Fact.Inventory` | ~2,214 | Environment × Mode × Date inventory snapshots |

Tweak via `.env`: `SYNTH_FACILITY_COUNT`, `SYNTH_YEARS_HISTORY`, `SYNTH_RANDOM_SEED`.

## Deviations from real

| Deviation | Reason |
|---|---|
| Synthetic row data (real schemas) | Production data was not exported by EPSS. All transactions are randomly generated with realistic distributions. |
| 500 institutions vs ~30,000 in production | Configurable via `SYNTH_FACILITY_COUNT`. Keep small for fast restore cycles. |
| Weekly grain in `DailyRecord` vs production daily | Reduces row volume from ~60M → ~58k while preserving shape. Increase if needed. |
| Only the `Vaccine.*` schema is populated | The 143-table schema includes Dim, Fact, StageThree, Staging, DM, Commodity. Synthesizer covers vaccine module only. Extend `scripts/synthesize.py` as additional tables become relevant. |
| Sa password rotates on `reset.sh` | Local dev convenience. Production EPSS would use Active Directory auth. |

## How to start the replica

```bash
cd /mnt/projects/nhdw/0_external/sources/HCMISWDM
cp .env.example .env                           # then edit passwords
docker compose up -d                           # start SQL Server 2025 container
bash scripts/restore.sh                        # restore HCMISWDM.bak (~1 min)
python3 scripts/synthesize.py                  # Vaccine.* operational schema (~30 sec)
python3 scripts/synthesize_analytics.py        # Dim.* + Commodity.* + Fact.* (~3 min)
bash scripts/verify.sh                         # sanity-check connectivity + counts
```

**Top-level alternative:** from `/mnt/projects/nhdw`, `docker compose up -d` brings up *all* source replicas via the aggregated `include:`. You still run `scripts/restore.sh` + the two `synthesize*.py` scripts here for data.

## How to verify it's working

```bash
bash scripts/verify.sh
```

Or manually:

```bash
docker exec -it hcmiswdm-sqlserver /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U nscd_reader -P "$HCMISWDM_NSCD_READER_PASSWORD" \
  -C -d HCMISWDM \
  -Q "SELECT TOP 5 InstitutionID, Name FROM Vaccine.Institution;"
```

## How to connect from the ingestor

```bash
HCMISWDM_JDBC_URL="jdbc:sqlserver://127.0.0.1:1433;databaseName=HCMISWDM;encrypt=true;trustServerCertificate=true"
HCMISWDM_USER="nscd_reader"
HCMISWDM_PASSWORD="$HCMISWDM_NSCD_READER_PASSWORD"

# Equivalent Python (pyodbc / pymssql):
# DRIVER={ODBC Driver 18 for SQL Server};SERVER=127.0.0.1,1433;DATABASE=HCMISWDM;
# UID=nscd_reader;PWD=...;TrustServerCertificate=yes
```

**To swap to real production HCMIS WDM**, change only:
- `HCMISWDM_JDBC_URL` → `jdbc:sqlserver://hcmis.epss.gov.et:1433;...` (via SSH tunnel)
- `HCMISWDM_USER` / `HCMISWDM_PASSWORD` → EPSS-issued credentials

No code change required.

## How to reset / wipe / re-seed

```bash
bash scripts/reset.sh    # destructive — drops volume, re-restores, re-synthesizes
```

## Schema reference

- 143 tables across 8 schemas: `Vaccine`, `DM`, `Commodity`, `Dim`, `Fact`, `StageOne`, `StageThree`, `Staging`, plus `Internal`, `RRF`, `KPI`, `Forecasting`.
- The full table list and column DDL is in `sample-data/HCMISWDM_schema_export.sql` (UTF-16 LE — view with `iconv -f UTF-16LE -t UTF-8`).
- Prior team's primer is the most useful narrative reference: `_experiments/aben-preliminary-experiments/dwh-server-setup/docs/primers/hcmiswdm-nscd-primer.md`.

## Credits

Restore script and SQL Server compose pattern adapted from `aben-preliminary-experiments/dwh-server-setup/infrastructure/sqlserver/`.
