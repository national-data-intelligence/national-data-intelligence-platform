# EthioEMR schema reference

The authoritative DDL is the dump itself: `../sample-data/clean_openmrs.sql`.

Extract the schema-only (no INSERT) view with:

```bash
grep -E "^(CREATE TABLE|ALTER TABLE|--|/\*|DROP TABLE)" ../sample-data/clean_openmrs.sql > openmrs_schema.sql
```

## Table inventory (309 tables)

Generated with:

```bash
sed -n 's/^CREATE TABLE `\([a-z_]*\)`.*/\1/p' ../sample-data/clean_openmrs.sql | sort -u
```

Grouped by domain:

- **OpenMRS Core**: `patient`, `person`, `person_name`, `person_address`, `person_attribute`, `encounter`, `encounter_provider`, `encounter_type`, `encounter_role`, `encounter_diagnosis`, `obs`, `visit`, `visit_type`, `visit_attribute`, `concept`, `concept_name`, `concept_class`, `concept_datatype`, `location`, `location_attribute`, `provider`, `provider_attribute`, `users`, `role`, `privilege`, `form`, `field`, `form_field`, `program`, `patient_program`, `patient_state`, `drug`, `drug_ingredient`, `drug_order`, `order`, `order_type`, `order_set`.
- **Bahmni clinical**: `appointment_service`, `appointment_service_type`, `appointment_speciality`, `patient_appointment`, `patient_appointment_*`, `bed`, `bed_type`, `bed_location_map`, `bed_patient_assignment_map`, `bed_tag`, `bed_tag_map`, `allergy`, `allergy_reaction`.
- **FHIR2 module** (enables FHIR R4 API): `fhir_concept_source`, `fhir_patient_identifier_system`, `fhir_diagnostic_report`, `fhir_diagnostic_report_performers`, `fhir_diagnostic_report_results`, `fhir_encounter_class_map`, `fhir_observation_category_map`, `fhir_contact_point_map`, `fhir_reference`, `fhir_task`, `fhir_task_based_on_reference`, `fhir_task_input`, `fhir_task_output`, `fhir_task_part_of_reference`.
- **App Framework / UI**: `appframework_component_state`, `appframework_user_app`.
- **Address Hierarchy** (Ethiopia geographic hierarchy): `address_hierarchy_level`, `address_hierarchy_entry`, `address_hierarchy_address_to_entry_map`.
- **Adverse Drug Reactions**: `adr_report_email_log`.

## Key entity relationships

```
person ── patient (1:0..1)
person ── person_name, person_address, person_attribute (1:many)
patient ── patient_identifier (1:many)
patient ── visit (1:many)
visit  ── encounter (1:many)
encounter ── obs (1:many)
encounter ── encounter_provider (1:many)
encounter ── encounter_diagnosis (1:many)
encounter ── drug_order (1:many)
obs ── concept (many:1)
concept ── concept_name (1:many; multilingual)
patient ── patient_program (1:many)
```

## FHIR ↔ OpenMRS resource mapping

| FHIR R4 Resource | OpenMRS table(s) | Notes |
|---|---|---|
| `Patient` | `patient` + `person` + `person_name` + `patient_identifier` | merged on read |
| `Encounter` | `encounter` + `visit` | hierarchical |
| `Observation` | `obs` (+ `concept_name` for display) | concept value mapping |
| `Condition` | `encounter_diagnosis` + `concept` | diagnosis as `Condition` |
| `MedicationRequest` | `drug_order` | active drug orders |
| `Practitioner` | `provider` + `person` | |
| `Location` | `location` | facility / ward / bed |
| `DiagnosticReport` | `fhir_diagnostic_report` + obs | lab reports |
| `Task` | `fhir_task` | workflow tasks |
| `AllergyIntolerance` | `allergy` + `allergy_reaction` | Bahmni |
| `Appointment` | `patient_appointment` + Bahmni schema | Bahmni |

The FHIR2 module handles these mappings on-the-fly when the OpenMRS web app is up — no separate FHIR server required.
