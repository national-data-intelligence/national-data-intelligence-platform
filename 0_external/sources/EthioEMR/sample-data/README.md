# EthioEMR sample data

## Contents

| File | Provenance | Size | Refreshed |
|---|---|---|---|
| `clean_openmrs.sql` | Symlink → `_resources/sample-data/clean_openmrs.sql`. Real OpenMRS / Bahmni-family DB dump from a working instance. MySQL 8.0.44 dump format. | 147 MB | Originally exported 2026-01-30 (latest data timestamps in dump) |
| `new_lab_tests.csv` | Symlink → prior team's `tests/minio-connectivity/openmrs_new_lab_tests.csv`. Slice of lab-test concept definitions with LOINC mappings. | 12 KB | 2026-04-23 |

## Provenance

The dump was produced by a `mysqldump` against a live OpenMRS instance. Data spans 2014 → 2026-01 timestamps, with active patients, encounters, observations, drug orders, lab orders, and FHIR2 module configuration.

## Refresh policy

- These files are immutable references — do not modify in place.
- To refresh: replace the file under `_resources/sample-data/` with a new export. Re-run `scripts/restore.sh` to reload into the running container.
- Large fixtures live in `_resources/sample-data/` and are symlinked here per the source-replica conventions (`bundle/source-replica-conventions.md`).
