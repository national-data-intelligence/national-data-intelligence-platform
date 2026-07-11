# EthioEMR — Source Data Understanding (Pre-Warehouse Profiling)

> **Purpose:** A formal source-system analysis of the EthioEMR transactional database, written to answer the five questions you need answered *before* you model a data warehouse: what the data **means**, how tables **connect**, how records **change**, how to **extract** them, and where the **gotchas** are.
>
> **Method:** This is not theory. Every claim below was checked directly against the live database on **2026-06-11**. Where a number appears, it came from a query against the running container.
>
> **System under analysis:** `ethioemr-openmrs` (OpenMRS platform 2.8.3, **KenyaEMR 19.3.1**-derived distribution, image `nhdw/ethioemr-openmrs:2.8.3-adama-20250611-fix2`) backed by `ethioemr-mysql` (MySQL 8.0), database `openmrs`, **325 tables**.

---

## 0. The single most important finding — read this first

**The data in this EMR is synthetically generated, not a captured real-world dump.** This is the most consequential fact for warehouse design, and it changes how you should interpret everything else in this document.

The evidence is overwhelming and consistent:

| Signal | What we observe | What a real EMR would look like |
|---|---|---|
| **Updates** | `date_changed` is **NULL on every row** of every clinical table (obs, encounter, person, patient_identifier) | Real records get edited; you'd see populated `date_changed` |
| **Soft deletes** | `voided = 0` on **all** obs, encounters, visits, patients (only 10 voided orders exist) | Real data has corrections, mistaken entries, merges |
| **Obs value types** | **100% numeric** (193,388 / 193,388). Zero coded, text, datetime, or drug obs | Real obs are a mix; coded answers dominate clinical forms |
| **Obs vocabulary** | Only **10 distinct concepts**, all lab analytes | Real EMR has hundreds of concepts (vitals, symptoms, etc.) |
| **Visit closure** | **All 13,418 visits are open** (`date_stopped IS NULL`) | Historical visits are closed |
| **Date span** | Encounters run **2023-06-10 → 2026-06-10**, i.e. ending *exactly yesterday*, ~20–30 encounters/day, every day | A static dump ends on its export date and then stops |
| **Impossible values** | ~10% of ESR and HIV-viral-load results are **negative** (see §5) | Lab machines don't emit negative concentrations |

**Practical implication:** Treat this as a **structurally faithful but semantically synthetic** dataset. The *schema*, *keys*, *relationships* and *OpenMRS conventions* are 100% real and are exactly what a production EthioEMR/KenyaEMR instance would give you — so build your warehouse modelling and ELT against them with confidence. But the *clinical content* (value distributions, diagnosis mix, the fact that obs are labs-only) is generator output. **Do not draw epidemiological conclusions** (e.g. "URTI is the top diagnosis in Adama") from this data, and design your data-quality tests to tolerate generator artifacts you'll later tighten against the real distro.

> ⚠️ **Memory correction:** earlier notes recorded this as "the real Adama dump, 492 patients." The live system actually holds **3,000 patients** across a rolling 3-year synthetic timeline. The "real Adama" lineage may survive in the reference data (the 80 Adama-area facility locations, the OpenMRS/CIEL concept dictionary), but the *transactional* clinical rows are generated.

---

## 1. The Business Meaning (the "What")

### 1.1 What the system is

OpenMRS is a patient-centric clinical record. Its data model is **EAV (Entity–Attribute–Value)**: rather than one wide table per clinical form, almost every clinical fact is a row in the **`obs`** ("observation") table whose meaning is defined by a pointer into a **concept dictionary**. This is the single most important mental model to hold: *the columns don't tell you what a value means — the `concept_id` does.*

### 1.2 The core business entities and their grain

| Table | One row = | Count (live) | Notes |
|---|---|---|---|
| `person` | one human being (patient **or** provider/staff) | 3,061 | Supertype. Demographics live here. |
| `patient` | one person who is a patient | 3,000 | Subtype of `person` (shares the PK). 61 persons are non-patients (staff). |
| `visit` | one **contact period** at a facility (admission-to-discharge, or one OPD day) | 13,418 | The outer temporal container. |
| `encounter` | one **clinical interaction** within a visit (a triage, a consult, a lab order…) | 26,773 | ~2.0 encounters per visit. |
| `obs` | **one single measurement / answer** | 193,388 | The atomic clinical fact. ~7.2 obs per encounter. |
| `orders` / `test_order` / `drug_order` | one ordered action (lab test, drug, procedure) | 766 | `orders` is the supertype; `test_order`/`drug_order` extend it. |
| `encounter_diagnosis` | one diagnosis assigned at an encounter | 2,144 | Coded dx with rank + certainty. |
| `patient_program` | one **enrolment** of a patient into a care program | 1,361 | e.g. an HIV enrolment with start/end dates. |
| `conditions` | one ongoing clinical condition | 199 | Problem list (distinct from per-visit diagnosis). |
| `allergy` | one recorded allergy | 79 | |

**The grain hierarchy is the spine of your model:**

```
person (1) ──< patient (1:1)
                   │
                   └──< visit (1:N)          "a trip to the facility"
                            │
                            └──< encounter (1:N)   "an interaction in that trip"
                                     │
                                     ├──< obs (1:N)              "a measurement"
                                     ├──< encounter_diagnosis (1:N)
                                     └──< orders (1:N)
```

This maps cleanly onto a star schema later: **`obs` / `encounter` are your fact-table candidates; `patient`, `provider`, `location`, `concept`, `date` are your dimensions.**

### 1.3 What clinical processes are actually represented

**Encounter types in use** (only 5 of 226 defined types carry data — generator scope):

| Encounter type | Encounters | Business event |
|---|---|---|
| Lab Order | 4,621 | A lab panel was ordered/resulted |
| ANC | 4,462 | Antenatal-care contact |
| Triage | 4,444 | Vitals/intake screening |
| Consultation | 4,427 | Clinician sees patient |
| ART Refill | 4,349 | HIV antiretroviral refill |
| *(orphaned id 241)* | 4,470 | **Broken — see §5.1** |

**Visit types:** Outpatient 11,423 / Inpatient 1,995 (≈85/15 split).

**Care programs** (`patient_program`):

| Program | Enrolments | Currently active (no `date_completed`) |
|---|---|---|
| TB | 485 | 334 |
| HIV | 470 | 323 |
| MCH – Mother Services | 406 | 276 |

So the represented business is a **primary-care / OPD facility with TB, HIV and maternal-health vertical programs** — the classic Ethiopian health-post / health-centre profile.

### 1.4 What is actually measured (`obs`)

All 193,388 obs are numeric lab results drawn from a **10-concept panel**:

| Concept | Rows | Observed min | Observed max | Plausible? |
|---|---|---|---|---|
| Erythrocyte sedimentation rate | 19,494 | **−9** | 39 | ❌ negatives impossible |
| Hematocrit | 19,388 | 26.4 | 57.8 | ✅ |
| CD4% | 19,376 | 21 | 69 | ✅ |
| Red blood cells | 19,359 | 3.4 | 6.7 | ✅ |
| White blood cells | 19,332 | 1.9 | 13.1 | ✅ |
| Haemoglobin | 19,319 | 8.2 | 20.0 | ✅ |
| Platelets | 19,313 | 48.5 | 504.5 | ✅ |
| Serum glucose | 19,306 | 58 | 122 | ✅ |
| Total cholesterol (mmol/L) | 19,275 | 1.7 | 6.0 | ✅ |
| HIV viral load | 19,226 | **−29,974** | 129,994 | ❌ negatives impossible |

> Note there are **no vital signs** (height, weight, BP, temperature) despite 4,444 Triage encounters. In a real instance you would expect a much richer obs vocabulary; plan your concept-mapping layer to scale to hundreds of concepts, not ten.

### 1.5 "Junk" columns to ignore

OpenMRS carries large amounts of application-backend machinery you should **not** pull into the warehouse:

- **Search/index plumbing:** `concept_word` (438k rows), `openconceptlab_item` (449k) — these are dictionary-loading/search artifacts, not clinical data.
- **Interop queues:** `il_message*` (84k+5.6k+3.1k), `muzima_*`, `prescription_outbox`, `queue_entry`, `fhir_*` — these are message/sync buffers for mobile and FHIR integration; transient by nature.
- **Module bookkeeping:** `*_database_version`, `liquibasechangelog` (2,255), `metadatasharing_*`, `spreadsheetimport_*`.
- **ML add-ons:** `kenyaemr_ml_patient_risk_score` (841) — a KenyaEMR risk model's outputs; derived, not source-of-truth.

Rule of thumb: if a table name carries a module prefix (`muzima_`, `il_`, `fhir_`, `openconceptlab_`, `stockmgmt_`, `cashier_`, `spreadsheetimport_`) it is a **feature module**, not core clinical data. Core clinical data lives in the unprefixed OpenMRS tables listed in §1.2.

---

## 2. The Relationships (the "How they connect")

### 2.1 Primary keys

Every core table uses a **single surrogate integer PK** named `<table>_id` (auto-increment). There are **no composite business keys** to worry about at the row level. Examples: `person.person_id`, `encounter.encounter_id`, `obs.obs_id`, `visit.visit_id`.

**The one special case:** `patient.patient_id` is **not** independently generated — it **equals** the `person_id` of the same individual (shared-PK inheritance). So `patient` is a 1:1 extension of `person`, joined on `patient.patient_id = person.person_id`.

### 2.2 The natural / business keys you'll actually carry to the warehouse

Surrogate `_id`s are internal and **can differ between environments**. The stable identifiers are:

- **`uuid`** — every core table has one (present on **264 tables**). This is a globally-unique, stable, cross-system key. **Use UUIDs as your durable join/lineage keys in the warehouse**, not the integer ids.
- **`patient_identifier`** — human-facing medical record numbers:
  - **OpenMRS Identification Number** — format `MRN00000001` (sequential), 3,000 of them, one per patient, all `preferred=1`. This is the facility MRN.
  - **National ID** — format `ET` + 12 digits (e.g. `ET716017224649`), 1,813 patients. This is the **Fayda / National Health ID linkage key** and is your bridge to cross-source patient matching (MFR, DHIS2, etc.). Note **only ~60%** of patients have one (see §5).

### 2.3 Foreign keys (the join map)

| Child | FK column | → Parent | Cardinality | Optional? |
|---|---|---|---|---|
| `patient` | `patient_id` | `person.person_id` | 1 : 1 | mandatory |
| `visit` | `patient_id` | `patient` | N : 1 | mandatory |
| `encounter` | `visit_id` | `visit` | N : 1 | **see below** |
| `encounter` | `patient_id` | `patient` | N : 1 | mandatory |
| `encounter` | `encounter_type` | `encounter_type` | N : 1 | mandatory |
| `encounter` | `location_id` | `location` | N : 1 | mandatory |
| `obs` | `encounter_id` | `encounter` | N : 1 | usually set |
| `obs` | `person_id` | `person` | N : 1 | mandatory |
| `obs` | `concept_id` | `concept` | N : 1 | mandatory |
| `obs` | `value_coded` | `concept` | N : 1 | only for coded obs |
| `obs` | `obs_group_id` | `obs` (self) | N : 1 | **never used here** (0 rows) |
| `encounter_provider` | `encounter_id`,`provider_id` | `encounter`,`provider` | M : N | the encounter↔provider bridge |
| `encounter_diagnosis` | `encounter_id`,`patient_id` | … | N : 1 | |
| `encounter_diagnosis` | `diagnosis_coded` | `concept` | N : 1 | coded dx |
| `patient_program` | `patient_id`,`program_id` | … | N : 1 | |
| `orders` | `encounter_id`,`patient_id`,`concept_id` | … | N : 1 | |

**Encounter ↔ Provider is many-to-many** via `encounter_provider` (27,225 rows for 26,773 encounters → most encounters have exactly one provider, a few have more). Don't model provider as a column on encounter.

**Obs denormalises `person_id`** even though it also has `encounter_id`. This is deliberate OpenMRS design (obs can exist without an encounter). In *this* dataset every obs has an encounter, but **code defensively**: derive patient from `obs.person_id`, not by assuming `encounter_id` is always present.

### 2.4 Orphans and referential integrity

- **Encounter → visit:** in this dataset **0 encounters are orphaned** from a visit (`visit_id` is always populated, 2.0 encounters/visit). Good. *But* OpenMRS permits visit-less encounters, so keep a `LEFT JOIN` discipline.
- **Encounter → encounter_type:** **BROKEN.** 4,470 encounters (16.7%) point to `encounter_type = 241`, which **does not exist** in `encounter_type` (the catalog only goes to id 226). This is a genuine dangling FK — see §5.1.
- **Obs self-grouping:** `obs_group_id` is NULL on all 193,388 rows. In a real instance, multi-part form answers nest under a parent obs; here every obs is flat/standalone. Your obs-flattening logic must not *assume* groups, but should be *ready* for them.

---

## 3. Data Mutability (the "How it changes")

This is where a DWH lives or dies, because the warehouse keeps history while the source keeps "current state."

### 3.1 OpenMRS's built-in change-tracking (the good news)

OpenMRS was designed for auditability. Core tables carry a standard audit quartet:

| Audit column | Present on (# tables) | Meaning |
|---|---|---|
| `date_created` / `creator` | 241 / 223 | When/who inserted the row |
| `date_changed` / `changed_by` | 212 / 208 | When/who last **updated** the row |
| `voided` / `date_voided` / `void_reason` | 112 / 109 / 96 | **Soft delete** for clinical/transactional data |
| `retired` | 91 | **Soft delete** for metadata (concepts, types, locations) |

**Critically: OpenMRS performs SOFT deletes, never hard deletes, for clinical data.** A "deleted" obs is `voided=1` with a `date_voided`, `voided_by` and `void_reason` — the row stays. **This is the best possible case for a warehouse**: you can capture deletions as just another change, and you can reconstruct point-in-time truth.

### 3.2 What this *specific* dataset shows (the synthetic caveat)

Because the data is generated and never edited:
- `date_changed` is **NULL everywhere** → no updates have occurred.
- `voided=1` exists on only **10 orders**, nowhere else → soft-delete is essentially unexercised.

**So you cannot validate your SCD / change-capture logic against this data** — there is no change to capture. You must design your SCD strategy from the *schema's capabilities* (§3.1) and test it later against the real distro or by deliberately editing test records.

### 3.3 SCD design guidance for the warehouse

- **Dimensions that drift** (patient address, name, demographics): OpenMRS itself already does a form of SCD —
  - `person_name` and `person_address` are **versioned tables**: a name/address change inserts a *new* row and marks the old `voided=1` rather than overwriting. (3,083 name rows for 3,061 persons; 3,043 address rows.) This means **history is already preserved in the source** — model these as **SCD Type 2** and you can backfill prior states from the voided rows.
  - `person.gender`, `person.birthdate` live on the base row and *would* be overwritten on edit → treat as **SCD Type 1/2** as policy dictates; rely on `date_changed` for change detection once real edits occur.
- **Facts** (`obs`, `encounter`, `orders`): immutable-by-convention. A correction = void old + insert new. Carry `voided`, `date_voided` and `uuid` into the warehouse so you can supersede facts without losing the original.

### 3.4 ID reuse

Surrogate `_id`s are MySQL `AUTO_INCREMENT` — **never reused** within an environment, even after a void (the row isn't deleted, so the value isn't freed). UUIDs are content-stable and unique forever. **No ID-reuse risk.** The only cross-environment hazard is that integer ids differ between the dev seed and a future prod load — which is exactly why you key on `uuid` (§2.2).

---

## 4. Extraction Logistics (the "How to get it")

### 4.1 Connection facts

| Item | Value |
|---|---|
| Container | `ethioemr-mysql` (MySQL 8.0) |
| Host port | `127.0.0.1:33306 → 3306` |
| Database | `openmrs` |
| App user | `openmrs` / `LieuT3a1cg9jSIIQzUONvbCE48vHheP` |
| In-network host | `ethioemr-mysql:3306` on `nhdw_net` (used by `ethioemr-openmrs`) |

### 4.2 Incremental-extraction watermarks (the good news)

**`date_created` exists on 241 tables and is populated on every obs.** For the immutable fact tables (`obs`, `encounter`, `visit`, `orders`) this is a **reliable insert watermark** — extract `WHERE date_created > :last_run` and you get new clinical events. Combined with `date_changed` (for when real edits start) and `date_voided` (for deletes), you have a complete **`GREATEST(date_created, date_changed, date_voided)` high-water-mark** strategy available natively. This is close to ideal for incremental ELT.

⚠️ **Reliability caveat to verify on the real system:** OpenMRS updates `date_changed` through its service layer (Hibernate), so application edits are captured — **but** bulk SQL operations, module batch jobs, and direct DB writes can bypass it. The KenyaEMR ML module (`kenyaemr_ml_patient_risk_score`) and the interop modules write rows on their own schedules. **Recommendation:** for the first production cycles, run a periodic full-table reconciliation (hash/rowcount by day) against the incremental loads to catch any watermark gaps before trusting CDC alone. For maximum safety, prefer **MySQL binlog-based CDC** (Debezium) over timestamp polling — it captures every INSERT/UPDATE/DELETE regardless of whether the app set `date_changed`.

### 4.3 Volume & velocity

- **Static footprint:** ~193k obs, ~27k encounters, ~13k visits, 3k patients. Tiny — a **full reload is trivially cheap today** (seconds).
- **Velocity:** the generator adds **~20–30 encounters/day** (and proportionally more obs). Real volume per facility will be higher but still modest by warehouse standards.
- **Per-year encounter growth:** 2023≈5.0k, 2024≈9.0k, 2025≈8.9k, 2026≈3.9k (partial year).

**Implication:** you do **not** need incremental extraction for correctness yet — full snapshots are fine at this scale and eliminate watermark risk. Build the **incremental pattern now** (so it's proven), but you have the luxury of falling back to full reloads while the volumes are small.

### 4.4 What to extract vs skip

Pull the **core clinical tables** (§1.2) plus the **reference/metadata tables** needed to decode them: `concept`, `concept_name`, `concept_reference_map/term` (for ICD/SNOMED/CIEL crosswalks), `encounter_type`, `visit_type`, `program`, `order_type`, `patient_identifier_type`, `location`, `provider`. **Skip** the module/queue/search tables in §1.5.

---

## 5. Data Quality (the "Gotchas")

These are the concrete traps found in *this* data. Build dbt/Great-Expectations tests for each.

### 5.1 🔴 Dangling encounter_type FK (structural)
4,470 encounters (16.7%) reference `encounter_type = 241`, which **does not exist** in the `encounter_type` table (max valid id = 226). An inner join to `encounter_type` **silently drops one-sixth of all encounters**. **Mitigations:** (a) use `LEFT JOIN` and surface NULLs; (b) add a test `encounter.encounter_type ∈ (SELECT encounter_type_id FROM encounter_type)`; (c) map orphan 241 to an "Unknown" dimension member rather than dropping the rows.

### 5.2 🔴 Biologically impossible negative lab values
- **HIV viral load:** 1,967 rows (~10%) are **negative**, min **−29,974 copies/mL**. Viral load cannot be negative.
- **ESR:** 1,953 rows (~10%) are **negative**, min **−9 mm/hr**. ESR cannot be negative.

These are generator artifacts but they tell you to **range-check every numeric obs** against clinical bounds before loading to any analytics mart. Don't assume a numeric column is clean just because it's typed numeric.

### 5.3 🟠 Sentinel / out-of-range maxima
HIV viral load max is **129,994** and platelets max **504.5** — watch for generator "fence-post" sentinels masquerading as real high values. Establish clinical reference ranges per concept and flag (don't silently clip) outliers.

### 5.4 🟠 Incomplete National ID coverage (the linkage key)
Only **1,813 of 3,000** patients (60%) have a National ID. Since this is your **cross-source patient-matching key** (Fayda/Health ID → MFR, DHIS2), **40% of patients cannot be linked by it** and will need fallback matching (MRN within facility, or deterministic demographics). Plan your master-patient-index logic around partial coverage, and **never assume National ID is non-null or unique** without testing.

### 5.5 🟠 All visits are perpetually "open"
`date_stopped IS NULL` for **all 13,418 visits**. You **cannot compute visit duration / length-of-stay** from this data, and any "currently admitted" logic will treat every historical visit as still active. Derive episode boundaries from encounter datetimes instead, and add a test for visits open longer than N days.

### 5.6 🟡 Duplicate concept names in the dictionary
Some analytes resolve to two fully-specified names (e.g. *CD4%* / *CD4% Test*, *Red blood cells* / *RED BLOOD CELLS COUNT*). Joining obs→concept_name without filtering `locale='en' AND concept_name_type='FULLY_SPECIFIED'` (and even then) can **double-count**. Always aggregate on `concept_id`, then attach a single display name via a deduplicated name lookup.

### 5.7 🟡 No vital signs despite Triage encounters
The 10-concept obs vocabulary is labs-only; there are no height/weight/BP/temperature obs even though Triage encounters exist. Any KPI that needs vitals (BMI, hypertension screening) **has no source data here** and must wait for the real distro.

### 5.8 🟡 Person vs Patient counts
`person` (3,061) > `patient` (3,000): 61 persons are providers/staff, not patients. **Filter to `patient` for clinical analytics**; don't count `person` rows as patients. (`dead = 0` for everyone — no mortality data.)

### 5.9 Defaults / NULL conventions to confirm on real data
OpenMRS commonly uses **NULL** (not sentinel dates like `1900-01-01`) for unknown dates, and explicit `*_id` FKs rather than `-1`. This dataset is consistent with that, but **re-verify against the production distro** — generator data and real EMR data diverge most in their NULL-handling.

---

## 6. Summary scorecard for the warehouse team

| Dimension | Verdict | One-line takeaway |
|---|---|---|
| **Business clarity** | 🟢 Good | OPD + TB/HIV/MCH facility; clean grain hierarchy person→visit→encounter→obs. |
| **Relational integrity** | 🟡 Mostly good | Surrogate+UUID keys are clean; one dangling encounter_type FK (16.7%). |
| **Mutability handling** | 🟢 Excellent *by design* | Soft-delete everywhere, versioned name/address (SCD2-ready), full audit columns — but **untested** because the seed has no edits. |
| **Extractability** | 🟢 Excellent | `date_created` watermark + tiny volume; prefer binlog CDC for safety. |
| **Data quality** | 🔴 Needs guardrails | Negative labs, dangling FK, 40% missing linkage ID, all-open visits — all generator artifacts; gate with tests. |
| **Fitness for epi analysis** | 🔴 No | Synthetic content — model the pipeline, don't trust the numbers. |

### Recommended next actions
1. **Build the dimensional model against the schema** (it's real): `dim_patient`, `dim_provider`, `dim_location`, `dim_concept`, `dim_date`; `fct_obs`, `fct_encounter`, `fct_diagnosis`, `fct_program_enrolment`. Key on **UUID**.
2. **Stand up the 9 data-quality tests** named in §5 before any mart is published.
3. **Choose CDC = binlog/Debezium** over timestamp polling, given the `date_changed`-reliability caveat.
4. **When the real hardened distro is swapped in** (see `DISTRO-SWAP.md`), re-run this exact profiling — expect richer obs vocabulary, real voids/updates, closed visits, and a different diagnosis mix. This document is the baseline to diff against.
5. **Buy the EMR backend engineer a coffee** — and specifically ask them: *what does encounter_type 241 mean, why are 40% of National IDs missing, and which modules write rows without setting `date_changed`?* Those three answers will save you weeks.

---

*Profiled 2026-06-11 against the live `ethioemr-mysql` / `openmrs` database. Every figure herein is reproducible by querying that container.*
