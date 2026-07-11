# EthioEMR — Ingestor

Reads the facility **OpenMRS/Bahmni EMR directly over MySQL** and reshapes each
row into the **FHIR R4 resource shape** the downstream vault expects. A real EMR's
native integration surface is CDC/JDBC on its database, so instead of standing up
the OpenMRS web app just to serve FHIR, we SELECT the clinical tables and rebuild
the same FHIR-shaped columns. dlt then lands them as Parquet.

> The source replica (`0_external/sources/EthioEMR/docker-compose.yml`) runs **MySQL only** —
> no OpenMRS app. It publishes `0.0.0.0:33306` so in-cluster (k3d) pods reach it via
> `host.k3d.internal`.

## What this ingestor produces

`s3://nhdw-raw/ethioemr/<resource>/year=YYYY/month=MM/day=DD/...`

Three tables, driven by `ETHIOEMR_MYSQL_RESOURCES` (default `Patient,Encounter,Observation`):

| Table | FHIR resource | OpenMRS source tables |
|---|---|---|
| `patient` | Patient | `patient` ⋈ `person` ⋈ `person_name` |
| `encounter` | Encounter | `encounter` ⋈ `person` ⋈ `visit` ⋈ `location` ⋈ `patient_identifier` |
| `observation` | Observation | `obs` ⋈ `person` ⋈ `encounter` ⋈ `concept_name` ⋈ `concept_numeric` |

**FHIR-shaped columns via dlt flattening.** Each reader yields a nested dict that
mirrors the FHIR JSON; dlt's `snake_case` naming convention flattens it with the
`__` nesting separator into exactly the columns the staging models parse — e.g.
`meta.lastUpdated → meta__last_updated`, `valueQuantity.value → value_quantity__value`,
`subject.identifier.system → subject__identifier__system`, `effectiveDateTime →
effective_date_time`.

Two invariants keep the Parquet schema stable and match the NHDW "raw surface is
all-string" contract:

1. **Full skeleton every row.** Every FHIR leaf is emitted on every row (`""` when
   absent, never `None`, never a missing key). dlt drops all-NULL columns, and the
   raw ClickHouse views are `SELECT * FROM s3(...parquet)`, so a dropped column would
   make a staging model reference a non-existent identifier.
2. **All-string leaves.** Numeric/date typing happens downstream (vault/marts cast
   explicitly).

### Identity & reference mapping (byte-compatible with the old FHIR path)

| FHIR field | OpenMRS source |
|---|---|
| `Patient.id` | `person.uuid` |
| `Encounter.id` | `encounter.uuid` |
| `Observation.id` | `obs.uuid` |
| `*.subject.reference` | `"Patient/<person.uuid>"` |
| `Observation.encounter.reference` | `"Encounter/<encounter.uuid>"` |
| `meta.lastUpdated` | `coalesce(date_changed, date_created)` |

Because the references use the same `Patient/<uuid>` / `Encounter/<uuid>` form the
FHIR server emitted, the vault's `lnk_encounter_patient` /
`lnk_observation_encounter` links resolve identically.

## Incremental cursor

`date_created` — **not** `date_changed`, which is NULL on synthetic rows. On the
first run anything created before `ETHIOEMR_MYSQL_INITIAL_CURSOR` is skipped.

## How to start

```bash
# 1. Bring up the MySQL source replica + restore the OpenMRS dump
docker compose -f 0_external/sources/EthioEMR/docker-compose.yml up -d
bash 0_external/sources/EthioEMR/scripts/restore.sh      # imports dump + creates `ingestor` user

# 2. Build the ingestor image
cd 2_pipelines/ingestor/EthioEMR
cp .env.example .env                             # set ETHIOEMR_MYSQL_PASSWORD, MINIO_SECRET_KEY
docker build -t nhdw/ethioemr-ingestor:dev .
```

## How to run

```bash
docker run --rm --env-file .env nhdw/ethioemr-ingestor:dev extract
docker run --rm --env-file .env nhdw/ethioemr-ingestor:dev -v extract   # verbose
```

In the cluster the ingestor runs as a k8s Job; point `ETHIOEMR_MYSQL_HOST` at
`host.k3d.internal` and `ETHIOEMR_MYSQL_PORT` at `33306`.

## To point at real production EthioEMR

```env
ETHIOEMR_MYSQL_HOST=emr.<facility>.moh.gov.et
ETHIOEMR_MYSQL_PORT=3306
ETHIOEMR_MYSQL_DB=openmrs
ETHIOEMR_MYSQL_USER=<MoH-issued read-only>
ETHIOEMR_MYSQL_PASSWORD=<MoH-issued>
```

The reader uses a read-only `SELECT` surface (`GRANT SELECT` + `REPLICATION`), so it
is safe against a production replica / CDC standby.
