# EthioEMR — Source Replica

## What this source is

**EthioEMR** is the Ethiopia Ministry of Health's Electronic Medical Records system, deployed at hospital and clinic level. It is a **Bahmni-family** stack (OpenMRS Core 2.x + Bahmni clinical modules: appointments, beds, orders, drug management) and is the canonical individual-level clinical record for service-delivery use cases in the NHDW.

Real-world ownership: Ethiopia MoH (deployed per-facility, operates independently of internet for clinical work, syncs back to national systems).

## Real-world interface

Real EthioEMR exposes data on three surfaces:

| Surface | Endpoint | Used by | Standard |
|---|---|---|---|
| **MySQL** (binlog / direct query) | `jdbc:mysql://emr.<facility>.moh.gov.et:3306/openmrs` | CDC pipelines (Debezium) and bulk extract | MySQL wire protocol |
| **OpenMRS REST API** | `https://emr.<facility>.moh.gov.et/openmrs/ws/rest/v1/{resource}` | Mobile apps, integrations | OpenMRS REST |
| **FHIR R4 API** | `https://emr.<facility>.moh.gov.et/openmrs/ws/fhir2/R4/{Resource}` | NHDW ingestor (preferred), interoperable systems | HL7 FHIR R4 + SMART-on-FHIR scopes |

The FHIR R4 endpoint is the **preferred ingestion path** per the NHDW requirements doc (Ch. 6.4). Bulk Export (`$export` operation) is supported.

## What this replica contains

| Item | Source | Volume |
|---|---|---|
| OpenMRS dump (`sample-data/clean_openmrs.sql`) | Real OpenMRS instance, exported via `mysqldump 8.0.44` | 147 MB, 309 tables |
| Schema | OpenMRS Core 2.6.x + Bahmni clinical modules (appointment_service, bed, patient_appointment, allergy, etc.) + FHIR2 module (`fhir_*` tables) installed | — |
| **Real reference data from dump** | Concept dictionary (36,750 concepts + 68,237 concept_name rows), 35 patient_identifier_types, 5 visit_types, 195 encounter_types, 2 encounter_roles, 15 programs (HIV, TB, MCH, etc.), 4,248 drugs | — |
| **Synthesized clinical data** (`scripts/synthesize.py`) | 30 locations from MFR, 20 providers, 500 patients with full demographics, ~2,300 visits, ~4,500 encounters, ~33,000 observations referencing real concept IDs, ~230 patient program enrollments | Tweak via `.env` `ETHIOEMR_SYNTH_*` vars |
| Supplementary CSV (`sample-data/new_lab_tests.csv`) | New lab test definitions slice (small) | ~70 rows |

**Hybrid model**: real schema + real concept dictionary + real Bahmni configuration + synthetic clinical transactions. The clinical synthesis references real concept IDs and respects all foreign-key constraints; queries return realistic-shaped results.

## Deviations from real

| Deviation | Reason |
|---|---|
| One MySQL instance (replica) vs many facility-local OpenMRS instances (production) | We model "the EthioEMR data surface" not "the federation of facility instances". Add more facility partitions when needed. |
| Localhost-only bound ports (`127.0.0.1:33306`, `127.0.0.1:8081`) | Replica is a dev tool, not a production deployment. Real production would be VPN-only or SSH-tunneled. |
| OpenMRS admin user kept as seeded in the dump (`admin/Admin123` typical) | Convenient for local dev. Will be rotated during Vault integration in Phase 2. |
| TLS terminated outside the container (none here) | Replica does not run HTTPS. Real EthioEMR sits behind nginx + Let's Encrypt at the facility. |

## How to start the replica

```bash
cd /mnt/projects/nhdw/0_external/sources/EthioEMR
cp .env.example .env                  # then edit the changeme values
docker compose up -d mysql            # start MySQL first
bash scripts/restore.sh               # load the 147 MB dump (3-8 min)
python3 scripts/synthesize.py         # synthesize clinical data on top of concepts (1-2 min)
docker compose up -d openmrs          # bring up OpenMRS web (boots ~2 min)
bash scripts/verify.sh                # MySQL + REST + FHIR R4 sanity check
```

OpenMRS first boot is slow (~2 minutes) because Liquibase scans the existing schema to confirm nothing is missing. Subsequent restarts are fast.

**Why synthesize.py?** The shipped dump contains the OpenMRS concept dictionary (~36,750 concepts) + Bahmni clinical configuration — but **no patients, encounters, or observations**. `synthesize.py` populates `location` (from real MFR facilities), `provider`, `person`+`patient`+`patient_identifier`+`person_name`+`person_address`, `visit`, `encounter`+`encounter_provider`, `obs` (against real concept IDs with correct datatype matching), and `patient_program` (HIV / TB / MCH enrollments). Defaults: 30 locations, 20 providers, 500 patients, ~2,300 visits, ~4,500 encounters, ~33,000 obs.

**Top-level alternative:** from `/mnt/projects/nhdw`, `docker compose up -d` brings up *all* source replicas via the aggregated include. You still need to run `scripts/restore.sh` + `scripts/synthesize.py` per source for data.

## How to verify it's working

| Check | Command | Expected |
|---|---|---|
| MySQL up + tables populated | `bash scripts/verify.sh` | All three checks PASS |
| Direct MySQL query | `docker exec -it ethioemr-mysql mysql -uingestor -p$ETHIOEMR_READER_PASSWORD openmrs -e "SELECT COUNT(*) FROM patient;"` | Non-zero count |
| OpenMRS REST | `curl -u admin:Admin123 http://127.0.0.1:8081/openmrs/ws/rest/v1/patient?q=&limit=1` | JSON with patient |
| FHIR R4 capability | `curl -u admin:Admin123 http://127.0.0.1:8081/openmrs/ws/fhir2/R4/metadata` | FHIR CapabilityStatement |
| FHIR Patient search | `curl -u admin:Admin123 'http://127.0.0.1:8081/openmrs/ws/fhir2/R4/Patient?_count=1'` | FHIR Bundle |
| FHIR Bulk Export kickoff | `curl -u admin:Admin123 -X POST 'http://127.0.0.1:8081/openmrs/ws/fhir2/R4/$export'` | 202 Accepted + polling URL |

## How to connect from the ingestor

The ingestor reads its connection config from a single source (env vars now, OpenBao later). To point the ingestor at the replica:

```bash
ETHIOEMR_MYSQL_URL="jdbc:mysql://127.0.0.1:33306/openmrs?useSSL=false"
ETHIOEMR_MYSQL_USER="ingestor"
ETHIOEMR_MYSQL_PASSWORD="$ETHIOEMR_READER_PASSWORD"

ETHIOEMR_FHIR_BASE_URL="http://127.0.0.1:8081/openmrs/ws/fhir2/R4"
ETHIOEMR_FHIR_USER="admin"
ETHIOEMR_FHIR_PASSWORD="Admin123"
```

**To swap to real production EthioEMR**, change only:
- `ETHIOEMR_MYSQL_URL` → `jdbc:mysql://<production-host>:3306/openmrs?useSSL=true&...`
- `ETHIOEMR_FHIR_BASE_URL` → `https://emr.<facility>.moh.gov.et/openmrs/ws/fhir2/R4`
- All four credentials

No ingestor code change is required.

## How to reset / wipe / re-seed

```bash
bash scripts/reset.sh    # destructive: drops data volume, re-restores
```

To stop without destroying data: `docker compose down`.
To stop AND wipe: `docker compose down -v && sudo rm -rf data/`.

## Schema reference

- 309 tables, see `sample-data/clean_openmrs.sql` for full DDL.
- Core OpenMRS data model: `patient`, `person`, `encounter`, `obs`, `visit`, `concept`, `concept_name`, `location`, `provider`, `drug`, `drug_order`, `patient_program`, `program`.
- Bahmni additions: `appointment_service`, `patient_appointment*`, `bed*`, `allergy*`, `appframework_*`.
- FHIR2 module: `fhir_concept_source`, `fhir_patient_identifier_system`, `fhir_diagnostic_report*`, `fhir_task*`, `fhir_observation_category_map`, `fhir_encounter_class_map`. These enable the `/ws/fhir2/R4/...` endpoints.

For a concept-by-concept primer on OpenMRS data, see the official [OpenMRS Data Model](https://wiki.openmrs.org/display/docs/Data+Model).
