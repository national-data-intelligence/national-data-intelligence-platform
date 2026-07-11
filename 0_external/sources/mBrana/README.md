# mBrana — Source Replica

## What this source is

**mBrana** is the mobile-first commodity-management platform deployed by Ethiopia MoH / EPSS at woreda and facility level. Its backend cloud database is **HCMISWCloud** — the same SQL Server-based cloud platform that hosts the broader EPSS supply-chain operations. mBrana's mobile clients sync stock-on-hand, requisitions, and shipment notices into HCMISWCloud, where they live alongside masters (institutions, products, administrative units) that are shared with the wider HCMIS ecosystem.

Real-world ownership: Ethiopia MoH / EPSS.

## Real-world interface

| Surface | Endpoint | Used by | Standard |
|---|---|---|---|
| **SQL Server (TDS)** | `jdbc:sqlserver://mbrana.epss.gov.et:1433;databaseName=HCMISWCloud` (via SSH tunnel from outside EPSS network) | NHDW ingestor — primary path | Microsoft TDS |
| Mobile sync (USSD-style protocol) | Internal to mBrana app ↔ mFlowUSSD endpoints | Mobile clients only — not the ingestor | — |

There is no public REST or FHIR API for the ingestor to consume. The ingestor reads directly from the SQL Server tables.

## What this replica contains

| Item | Source | Volume |
|---|---|---|
| `sample-data/HCMISWCloud.bak` | Real EPSS HCMISWCloud production backup — schema-only snapshot | 13 MB, **417 tables across 35 schemas** |
| `sample-data/mfr_facilities.json` | Real MFR export — 63,805 Ethiopian facilities | 26 MB |
| Synthesized row data | `scripts/synthesize.py` populates realistic Ethiopian data into the schemas an ingestor would actually consume | See table below |

### Synthesized data summary

After running `bash scripts/restore.sh && python3 scripts/synthesize.py`:

| Schema.Table | Rows | What it represents |
|---|---|---|
| `mBrana.SiteStatus` | 3 | Active / Inactive / Maintenance lookup |
| `mBrana.TrendStatus` | 3 | Improving / Stable / Declining lookup |
| `mBrana.InstitutionEnvironment` | 300 | Bridge linking institutions → environments via hub (the canonical mBrana ↔ HCMIS link) |
| `dbo.Region` / `dbo.Zone` / `dbo.Woreda` | 11 / 42 / 50 | Real Ethiopian regions, zones, woredas |
| `dbo.Institution` | 750 | Real Ethiopian facilities (sampled from MFR JSON) |
| `AdministrativeUnit.AdministrativeUnit` | 62 | Geographic hierarchy using SQL Server's native `hierarchyid` type — Country → Region → Woreda |
| `USM.Environment` | 18 | EPSS central + 17 regional hubs |
| `USM.EnvironmentGroup` | 3 | Central / Hub / Facility tier lookup |
| `Commodity.CommodityType` | 4 | Vaccine / Pharmaceutical / Supply / Diagnostic |
| `Commodity.Product` | 25 | EPI vaccines + antimalarials + ARVs + TB drugs + RDTs + ITNs |
| `Institution.OwnershipType` | 4 | Public / Private / NGO / Military |
| **`mFlowUSSD.Commodities`** | 25 | Mobile-side commodity catalog (mirrors `Commodity.Product`) |
| **`mFlowUSSD.Institutions`** | 200 | Mobile-side facility list |
| **`mFlowUSSD.Users`** | 200 | HEW / facility-staff mobile users with Ethiopian phone numbers (`+251 9XXXXXXXX`) |
| **`mFlowUSSD.SOHLogs`** | 7,200 | 24 months of stock-on-hand mobile reports |
| **`mFlowUSSD.Requests`** | 616 | Mobile-submitted request headers |
| **`mFlowUSSD.RequestLines`** | 2,170 | Line items per request |
| **`mFlowUSSD.ASNs`** | 184 | Advance Shipment Notices |
| **`mFlowUSSD.ASNLines`** | 463 | Line items per ASN |

Tweak via `.env`: `MBRANA_SYNTH_WOREDA_COUNT`, `MBRANA_SYNTH_FACILITIES_PER_WOREDA`, `MBRANA_SYNTH_MONTHS_HISTORY`, `MBRANA_SYNTH_SEED`.

### What we don't populate (Phase-2 follow-ups)

- `RRF.Request` + `RRF.RequestDetail` — formal eVRF chain. Requires populating `dbo.FiscalYear`, `dbo.Order`, `dbo.OrderDetail`, `Commodity.RRGroup` first. The mobile flow (`mFlowUSSD.Requests`) covers day-to-day request capture; RRF formalizes it monthly/quarterly.
- `Institution.InstitutionType` / `InstitutionParentType` — facility classification chain (`dbo.Institution.RUType` left NULL).
- `Commodity.*` deeper catalog tables — ABC analysis, VEN categorization, dosage forms, supplier links, etc. The basic Product + CommodityType is enough for the ingestor.

These are easy extensions to `scripts/synthesize.py` when needed.

## Deviations from real

| Deviation | Reason |
|---|---|
| Synthetic row data (real schema) | Production EPSS data not exported. All transactions randomly generated with realistic distributions. |
| 750 facilities vs ~30,000 in production | Configurable via `MBRANA_SYNTH_FACILITIES_PER_WOREDA × MBRANA_SYNTH_WOREDA_COUNT`. Small for fast restore cycles. |
| Only `mBrana.*`, `mFlowUSSD.*` and core masters populated out of 417 tables | Targets the actual ingestor extraction surface. Rest of the schema is present (schema-only) for any future extension. |
| `sa` password rotates on `reset.sh` | Local dev convenience. Production EPSS would use Active Directory auth. |

## How to start the replica

```bash
cd ./0_external/sources/mBrana
cp .env.example .env                           # edit passwords
docker compose up -d                           # start SQL Server 2025 container (~30 sec)
bash scripts/restore.sh                        # restore HCMISWCloud.bak (~30 sec)
python3 scripts/synthesize.py                  # generate realistic row data (~10 sec)
bash scripts/verify.sh                         # sanity check
```

**Top-level alternative:** from `.`, `docker compose up -d` brings up *all* source replicas via the aggregated `include:`. You still run `scripts/restore.sh` + `scripts/synthesize.py` per source for data.

## How to verify it's working

```bash
bash scripts/verify.sh
```

Or manually from inside the container:

```bash
docker exec -it mbrana-sqlserver /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U ingestor -P "$MBRANA_READER_PASSWORD" -C -d HCMISWCloud \
  -Q "SELECT TOP 5 ID, Name FROM dbo.Institution;"

# Stock-on-hand for last month, top 10 reports:
docker exec -it mbrana-sqlserver /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U ingestor -P "$MBRANA_READER_PASSWORD" -C -d HCMISWCloud \
  -Q "SELECT TOP 10 InstitutionId, CommodityId, Quantity, Date
      FROM mFlowUSSD.SOHLogs
      WHERE Date >= DATEADD(MONTH, -1, GETDATE())
      ORDER BY Date DESC;"
```

## How to connect from the ingestor

```bash
MBRANA_JDBC_URL="jdbc:sqlserver://127.0.0.1:1434;databaseName=HCMISWCloud;encrypt=true;trustServerCertificate=true"
MBRANA_USER="ingestor"
MBRANA_PASSWORD="$MBRANA_READER_PASSWORD"
```

```python
# Python ingestor pattern (pyodbc)
import os, pyodbc
conn = pyodbc.connect(
    f"DRIVER={{ODBC Driver 18 for SQL Server}};"
    f"SERVER=127.0.0.1,1434;DATABASE=HCMISWCloud;"
    f"UID=ingestor;PWD={os.environ['MBRANA_READER_PASSWORD']};"
    f"TrustServerCertificate=yes;Encrypt=yes"
)
cur = conn.cursor()
# Incremental SOH pull
cur.execute("""
    SELECT s.SohLogId, s.Date, s.InstitutionId, i.Name AS InstitutionName,
           s.CommodityId, c.Name AS CommodityName, s.Quantity
    FROM mFlowUSSD.SOHLogs s
    JOIN dbo.Institution i ON i.ID = s.InstitutionId
    JOIN Commodity.Product c ON c.ProductID = s.CommodityId
    WHERE s.Date >= ?
""", (last_watermark,))
```

**To swap to real production mBrana**, change only:
- `MBRANA_JDBC_URL` → `jdbc:sqlserver://mbrana.epss.gov.et:1433;...` (via SSH tunnel)
- `MBRANA_USER` / `MBRANA_PASSWORD` → EPSS-issued credentials

No code change required.

## Ports

| Service | Host port | Container port |
|---|---|---|
| SQL Server (TDS) | `127.0.0.1:1434` | `1433` |

mBrana is on host port **1434** to coexist with the HCMIS WDM SQL Server which uses 1433. In production both would typically be on 1433 of different hosts (`hcmis.epss.gov.et` vs `mbrana.epss.gov.et`).

## How to reset / wipe / re-seed

```bash
bash scripts/reset.sh    # destructive — drops volume, re-restores, re-synthesizes
```

## Schema reference

The full HCMISWCloud schema is in `sample-data/HCMISWCloud.bak`. After restore, browse with DBeaver / Azure Data Studio or:

```bash
docker exec -it mbrana-sqlserver /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "$MBRANA_SA_PASSWORD" -C -d HCMISWCloud -Q "
  SELECT s.name + '.' + t.name AS table_name
  FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id
  ORDER BY s.name, t.name;"
```

Key schemas the ingestor consumes:

| Schema | Purpose |
|---|---|
| **`mBrana`** | The bridge between mBrana mobile and HCMIS cloud (3 tables: SiteStatus, TrendStatus, InstitutionEnvironment) |
| **`mFlowUSSD`** | Mobile-side operational data — the "live feed" from HEW phones |
| **`RRF`** | Report and Requisition Form — formal monthly/quarterly request cycle |
| **`AdministrativeUnit`** | Ethiopian geographic hierarchy with `hierarchyid` type |
| **`Institution`** | Facility classification (types, ownership, catchment) |
| **`Commodity`** | Product catalog (vaccines, drugs, supplies) |
| **`USM`** | User and environment master (hubs, central, facilities) |
| **`dbo`** | Core legacy tables (Institution, Region, Zone, Woreda, User) |
