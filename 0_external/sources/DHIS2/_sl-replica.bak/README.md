# DHIS2 — Source Replica

## What this source is

**DHIS2** (District Health Information Software 2) is Ethiopia MoH's national aggregate health-reporting platform. Adopted by MoH in 2016; national rollout 2019. Runs across ~30,192 health facilities (incl. health posts), with ~20 program instances (HMIS, PHEM, COVID, COVAX, WBP, multisectoral nutrition, etc.) and ~1 billion data values projected to grow to 2 billion by 2030.

Real-world ownership: Ethiopia MoH; open source platform (UiO collaboration).

## Real-world interface

| Surface | Endpoint | Used by | Standard |
|---|---|---|---|
| **DHIS2 Web API** | `https://ethio-dhis2.dataforimplementation.org/api/<resource>` | NHDW ingestor (preferred), OpenFn DHIS2 adaptor, dashboards | DHIS2 Web API + JSON |
| **PostgreSQL backend** | `jdbc:postgresql://<dhis2-vm>:5432/dhis2` | Restricted — direct DB access only by sysadmin / special arrangement | Postgres wire |
| **ADX export** | `/api/dataValueSets.adx` | Aggregate data exchange (HL7 ADX) | HL7 ADX |
| **DHIS2 → FHIR adapter** | Via OpenHIM bridge | Future-state | FHIR Mapping |

Key endpoints the ingestor uses (raw-only — see "On `/api/analytics.json`" below):
- `GET /api/dataValueSets?orgUnit=…&period=…&dataSet=…&lastUpdated=<watermark>` — **raw submitted values**, CDC-friendly via `lastUpdated`. Primary extraction surface.
- `GET /api/organisationUnits` — paginated org-unit tree (region → zone → woreda → facility)
- `GET /api/dataElements` and `/api/dataElementGroups` — indicator metadata
- `GET /api/categoryCombos` and `/api/categoryOptionCombos` — disaggregations (age, sex, facility type)
- `GET /api/dataSets` — reporting form definitions
- `GET /api/periods` — period definitions

### On `/api/analytics.json` (and why we don't use it)

DHIS2 also exposes `/api/analytics.json`, which returns *pre-aggregated* pivot-table data. The NHDW ingestor **deliberately does not consume this endpoint**. Reasons:

1. **Data Vault 2.0 (req doc §2.7.4) separates raw data from business rules.** Analytics-API values are pre-rolled-up by DHIS2's category-combo / org-unit-hierarchy logic — that's *business rules*, which belong in the warehouse, not in the Hubs/Satellites.
2. **dbt re-aggregates anyway**, with formulas we own and can change without re-pulling from source.
3. **The analytics endpoint depends on pre-built materialised tables** (rebuilt by DHIS2's `/api/resourceTables/generate`, takes 15-30 min on the demo DB and hours on real Ethiopia DHIS2). Skipping it makes our cold start ~10 min instead of 30-60 min.
4. **`/api/dataValueSets` has full row-level fidelity** — anything analytics-API can return is derivable from raw rows in dbt.

We use the raw path for the same reason real production ingestion increasingly does.

## What this replica contains

| Item | Source | Status |
|---|---|---|
| DHIS2 demo DB (Sierra Leone reference) | Official `databases.dhis2.org` artifact, version 2.40.4 | Downloaded on first `restore.sh` run; cached under `sample-data/` |
| MFR facilities JSON (`sample-data/mfr_facilities_2026-04-30.json`) | Real MFR export — 63,805 Ethiopian facilities | Available but not loaded into DHIS2 by default (see Deviations) |
| Schema | DHIS2 2.40.4 default (>200 tables) | Created by Liquibase migrations on first DHIS2 boot |

## Deviations from real

| Deviation | Reason |
|---|---|
| **Demo DB is Sierra Leone, not Ethiopia** | Official Ethiopia DHIS2 dumps are not publicly distributed. The Sierra Leone reference DB has the *same API shape* (org units, data elements, dataValueSets, analytics), so ingestor code is identical against both. The data itself differs (SL org units, English/Krio names, SL geographic hierarchy). |
| **Ingestor must not assume Ethiopian calendar periods** | When pointing at real Ethiopian DHIS2, period codes use the Ethiopian calendar (`200701` = Ethiopian year 2007 month 1 = Meskerem). Sierra Leone uses Gregorian. The ingestor must support both — declare the calendar in config. |
| Gregorian periods (`202401`) in the demo | See above; switch to Ethiopian when ingesting from real Ethiopia DHIS2. |
| Admin password = `district` (DHIS2 demo default) | Rotate after first boot for any non-throwaway environment. |
| Optional Ethiopia-shaped seed via MFR JSON not auto-loaded | We have 63,805 real Ethiopian facilities sitting in `sample-data/`. Loading them into DHIS2 requires either (a) replacing the demo `organisationunit` rows or (b) standing up a second blank DHIS2 and seeding via the API. Both are TODOs; not blocking ingestor development. |

## How to start the replica

```bash
cd /mnt/projects/nhdw/0_external/sources/DHIS2
cp .env.example .env

# Step 1: bring up Postgres
docker compose up -d dhis2-db

# Step 2: download + restore the Sierra Leone demo DB (~5-15 min)
bash scripts/restore.sh

# Step 3: start the DHIS2 Java app (Liquibase + boot ~5-15 min)
docker compose up -d dhis2
docker logs -f dhis2-web                # tail until "Server startup in X ms"

# Step 4: verify
bash scripts/verify.sh
```

**First boot is ~10-20 min** (Postgres restore + Liquibase + Tomcat warm). Subsequent restarts are fast. We deliberately do not generate analytics tables (see "On `/api/analytics.json`" above).

**Top-level alternative:** from `/mnt/projects/nhdw`, `docker compose up -d` brings up *all* source replicas via the aggregated `include:`. You still run `scripts/restore.sh` here for the demo-DB load.

## How to verify it's working

```bash
bash scripts/verify.sh
```

Or manually:

```bash
# System info
curl -u admin:district http://127.0.0.1:8080/api/system/info | jq

# Org-unit tree
curl -u admin:district 'http://127.0.0.1:8080/api/organisationUnits?level=1&fields=id,name'

# Pivot-style analytics query — Sierra Leone version
curl -u admin:district 'http://127.0.0.1:8080/api/analytics.json?dimension=dx:fbfJHSPpUQD&dimension=pe:LAST_12_MONTHS&dimension=ou:USER_ORGUNIT'
```

## How to connect from the ingestor

```bash
DHIS2_BASE_URL="http://127.0.0.1:8080"
DHIS2_USER="admin"
DHIS2_PASSWORD="district"        # rotate post-restore

# Or via the OpenFn DHIS2 adaptor:
state.configuration = {
  hostUrl: 'http://127.0.0.1:8080',
  username: 'admin',
  password: 'district',
  apiVersion: 40,
};
```

**To swap to real production Ethiopia DHIS2**, change only:
- `DHIS2_BASE_URL` → `https://ethio-dhis2.dataforimplementation.org`
- `DHIS2_USER` / `DHIS2_PASSWORD` → MoH-issued credentials
- Set the ingestor's calendar config to Ethiopian
- Use Ethiopian period codes (`200701`, `200702`, …) in extract jobs

No code change required.

## How to reset / wipe / re-seed

```bash
bash scripts/reset.sh
```

To swap the seed to another DHIS2 demo variant, set `DHIS2_DEMO_DB_URL` and `DHIS2_DEMO_DB_VARIANT` in `.env` to one of:
- `https://databases.dhis2.org/sierra-leone/2.40.4/dhis2-db-sierra-leone.sql.gz` (default)
- `https://databases.dhis2.org/trainingland/2.40.4/dhis2-db-trainingland.sql.gz` (training)

To seed with the Ethiopian MFR facilities, see the TODO in `scripts/` (not implemented yet — requires either replacing organisationunit rows or pushing via DHIS2 API).

## Schema reference

DHIS2 schema is created by Liquibase on first boot — there are ~200 tables. The DHIS2 documentation has a [data model reference](https://docs.dhis2.org/en/develop/using-the-api/dhis-core-version-master/data.html). Key tables:

| Table | Purpose |
|---|---|
| `organisationunit` | Org-unit tree — facilities, woredas, zones, regions |
| `dataelement` / `dataelementgroup` | Indicators |
| `dataset` | Reporting forms (HMIS, PHEM, etc.) |
| `datavalue` | Raw submitted values |
| `period` | Period codes (Gregorian or Ethiopian) |
| `analytics_*` | Pre-aggregated analytics tables (generated by `/api/resourceTables/generate`) |
| `category` / `categorycombo` / `categoryoptioncombo` | Disaggregations (age, sex, facility type) |

## Credits

- Compose pattern adapted from `aben-preliminary-experiments/dwh-server-setup/infrastructure/dhis2/`.
- DHIS2 docs + demo DB: [dhis2.org](https://dhis2.org).
- Ethiopian DHIS2 primer (Ethiopian calendar, period codes, EPI indicators): `_experiments/aben-preliminary-experiments/dwh-server-setup/docs/primers/dhis2-openfn-primer.md`.
